const ENDPOINT = process.env.DATAFORDELER_GRAPHQL_URL || "https://graphql.datafordeler.dk/flexible/v3";

async function graphql(query) {
  const key = process.env.DATAFORDELER_API_KEY;
  if (!key) { const e = new Error("DATAFORDELER_API_KEY mangler i Vercel Production."); e.status = 503; throw e; }
  const url = new URL(ENDPOINT); url.searchParams.set("apiKey", key);
  const response = await fetch(url, { method:"POST", headers:{"content-type":"application/json",accept:"application/json"}, body:JSON.stringify({query}), signal:AbortSignal.timeout(4000) });
  const payload = await response.json().catch(() => ({}));
  const errors = (payload.errors || []).map(x => x.message).join("; ");
  if (!response.ok || errors) { const e = new Error(errors || payload.message || ("Datafordeler HTTP " + response.status)); e.status = 502; throw e; }
  if (!payload.data) { const e = new Error("Datafordeleren returnerede ikke et data-resultat."); e.status = 502; throw e; }
  return payload.data;
}

function isId(value) { return /^[a-zA-Z0-9._-]{1,100}$/.test(String(value || "")); }
function baseArgs(now, where) { return "first:10, registreringstid:\"" + now + "\", virkningstid:\"" + now + "\"" + (where ? ", where:{" + where + "}" : ""); }
function eqWhere(field, value) { return field + ":{eq:\"" + String(value).replace(/["\\]/g, "") + "\"}"; }
function rootQuery(type, now, where, nodes) { return "query { " + type + "(" + baseArgs(now, where) + ") { nodes { " + nodes + " } } }"; }
function numberValue(obj, keys) {
  if (!obj) return null;
  for (const key of keys) {
    const raw = obj[key];
    if (raw && typeof raw === "object") {
      for (const k of ["value","numericValue","area","valueAsNumber"]) if (raw[k] !== undefined && Number.isFinite(Number(raw[k]))) return Number(raw[k]);
    }
    if (raw !== null && raw !== undefined && raw !== "" && Number.isFinite(Number(raw))) return Number(raw);
  }
  return null;
}
function parseCoordinates(house) {
  const pos = house && (house.HusnummerHarAdgangspunkt && house.HusnummerHarAdgangspunkt.position || house.position);
  if (!pos || typeof pos.wkt !== "string") return null;
  const match = pos.wkt.match(/POINT(?:\s+Z)?\s*\(?\s*([+-]?\d+(?:\.\d+)?)\s+([+-]?\d+(?:\.\d+)?)/i);
  if (!match) return null;
  const x = Number(match[1]), y = Number(match[2]);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 40000 || x > 1000000 || y < 5000000 || y > 7500000) return null;
  return { x, y, crs:"EPSG:25832", source:"DAR_Husnummer.HusnummerHarAdgangspunkt.position" };
}
async function getHouseById(id, now) {
  if (!isId(id)) throw new Error("Ugyldigt DAR-husnummer-ID.");
  const fields = "id_lokalId adgangsadressebetegnelse husnummertekst status adgangTilBygning jordstykke placeretPaaForeloebigtJordstykke adgangspunkt postnummer kommuneinddeling HusnummerHarAdgangspunkt { position { crs dimension wkt } }";
  const query = rootQuery("DAR_Husnummer", now, eqWhere("id_lokalId", id), fields);
  const data = await graphql(query);
  return data.DAR_Husnummer && data.DAR_Husnummer.nodes && data.DAR_Husnummer.nodes[0] || null;
}
async function getAddressAndHouse(id, now) {
  if (!isId(id)) throw new Error("Ugyldigt DAR-adresse-ID.");
  const fields = "id_lokalId adressebetegnelse status adresseHarHusnummer { id_lokalId adgangsadressebetegnelse husnummertekst status adgangTilBygning jordstykke placeretPaaForeloebigtJordstykke adgangspunkt postnummer kommuneinddeling HusnummerHarAdgangspunkt { position { crs dimension wkt } } }";
  const data = await graphql(rootQuery("DAR_Adresse", now, eqWhere("id_lokalId", id), fields));
  const address = data.DAR_Adresse && data.DAR_Adresse.nodes && data.DAR_Adresse.nodes[0] || null;
  const relation = address && address.adresseHarHusnummer;
  const house = Array.isArray(relation) ? relation[0] || null : relation || null;
  return { address, house };
}
async function getBuildingsForHouse(houseId, now) {
  if (!isId(houseId)) return [];
  const fields = "id_lokalId status kommunekode byg007Bygningsnummer byg021BygningensAnvendelse byg026Opfoerelsesaar byg030Vandforsyning byg031Afloebsforhold byg032YdervaeggensMateriale byg033Tagdaekningsmateriale byg038SamletBygningsareal byg039BygningensSamledeBoligAreal byg040BygningensSamledeErhvervsAreal byg041BebyggetAreal byg042ArealIndbyggetGarage byg043ArealIndbyggetCarport byg044ArealIndbyggetUdhus byg048AndetAreal byg054AntalEtager byg056Varmeinstallation byg057Opvarmningsmiddel byg094Revisionsdato husnummer grund jordstykke";
  const data = await graphql(rootQuery("BBR_Bygning", now, eqWhere("husnummer", houseId), fields));
  return data.BBR_Bygning && data.BBR_Bygning.nodes || [];
}
async function getBuildingById(id, now) {
  if (!isId(id)) return null;
  const fields = "id_lokalId status kommunekode byg007Bygningsnummer byg021BygningensAnvendelse byg026Opfoerelsesaar byg030Vandforsyning byg031Afloebsforhold byg032YdervaeggensMateriale byg033Tagdaekningsmateriale byg038SamletBygningsareal byg039BygningensSamledeBoligAreal byg040BygningensSamledeErhvervsAreal byg041BebyggetAreal byg042ArealIndbyggetGarage byg043ArealIndbyggetCarport byg044ArealIndbyggetUdhus byg048AndetAreal byg054AntalEtager byg056Varmeinstallation byg057Opvarmningsmiddel byg094Revisionsdato husnummer grund jordstykke";
  const data = await graphql(rootQuery("BBR_Bygning", now, eqWhere("id_lokalId", id), fields));
  return data.BBR_Bygning && data.BBR_Bygning.nodes && data.BBR_Bygning.nodes[0] || null;
}
async function getParcelById(id, now) {
  if (!isId(id)) return null;
  const fields = "id_lokalId matrikelnummer registreretAreal arealtype arealbetegnelse faelleslod vejareal status registreringFra virkningFra";
  const data = await graphql(rootQuery("MAT_Jordstykke", now, eqWhere("id_lokalId", id), fields));
  return data.MAT_Jordstykke && data.MAT_Jordstykke.nodes && data.MAT_Jordstykke.nodes[0] || null;
}
async function getEstateByBfe(bfe, now) {
  const fields = "id_lokalId BFEnummer status senesteSagLokalId registreringFra virkningFra";
  const data = await graphql(rootQuery("MAT_SamletFastEjendom", now, eqWhere("BFEnummer", bfe), fields));
  return data.MAT_SamletFastEjendom && data.MAT_SamletFastEjendom.nodes && data.MAT_SamletFastEjendom.nodes[0] || null;
}

export default async function handler(req, res) {
  if (req.method !== "GET") { res.setHeader("Allow","GET"); return res.status(405).json({error:"Method not allowed"}); }
  const addressId = String(req.query.adresseId || "").trim();
  const houseId = String(req.query.husnummerId || "").trim();
  const bfe = String(req.query.bfe || "").trim();
  if (!addressId && !houseId && !bfe) return res.status(400).json({error:"adresseId, husnummerId eller bfe er påkrævet."});
  if (addressId && !isId(addressId)) return res.status(400).json({error:"Ugyldigt adresse-ID."});
  if (houseId && !isId(houseId)) return res.status(400).json({error:"Ugyldigt husnummer-ID."});
  if (bfe && !/^\\d{1,20}$/.test(bfe)) return res.status(400).json({error:"Ugyldigt BFE-nummer."});

  const now = new Date().toISOString();
  let address = null, house = null, buildings = [], cadastral = null, estate = null;
  const errors = {};
  try {
    if (addressId) {
      const result = await getAddressAndHouse(addressId, now);
      address = result.address;
      house = result.house;
    } else if (houseId) {
      house = await getHouseById(houseId, now);
    }
  } catch(error) {
    return res.status(error.status || 502).json({
      error:"Adressen kunne ikke slås op i DAR.",
      detail:String(error.message || "DAR-opslag fejlede").slice(0,500),
      source:"Datafordeler Flexible GraphQL v3",
      setup:!process.env.DATAFORDELER_API_KEY
    });
  }

  if (!house && !address && !bfe) {
    return res.status(200).json({
      source:"Datafordeler Flexible GraphQL v3",
      fetchedAt:new Date().toISOString(),
      address:null,house:null,bbr:null,bbrBuildings:[],cadastral:null,estate:null,coordinates:null,
      areas:{groundArea:null,footprint:null,residentialArea:null,buildingArea:null},
      completeness:{address:false,house:false,bbr:false,cadastral:false,estate:false},
      errors:{dar:"Adresse-ID'et blev accepteret, men der blev ikke returneret en aktuel adresse/husnummerpost."},
      note:"Der blev ikke returneret en aktuel DAR-post. Kontrollér adresse-ID og eventuel historik."
    });
  }

  const parcelId = house && (house.jordstykke || house.placeretPaaForeloebigtJordstykke) || null;
  const [buildingResult, parcelResult] = await Promise.allSettled([
    (async()=>{
      if(!house||!house.id_lokalId)throw new Error("Der blev ikke fundet et husnummer, som kan kobles til BBR.");
      const attempts=[getBuildingsForHouse(String(house.id_lokalId),now)];
      if(house.adgangTilBygning)attempts.push(getBuildingById(String(house.adgangTilBygning),now).then(item=>item?[item]:[]));
      const results=await Promise.allSettled(attempts);
      const successful=results.filter(x=>x.status==="fulfilled").map(x=>x.value||[]);
      const found=successful.find(list=>list.length);
      if(found)return found;
      const failures=results.filter(x=>x.status==="rejected").map(x=>String(x.reason?.message||"BBR-kald fejlede"));
      if(failures.length===results.length)throw new Error(failures.join(" · "));
      return [];
    })(),
    (async()=>{
      if(!parcelId)throw new Error("DAR returnerede ikke et jordstykke-ID for adressen.");
      return await getParcelById(String(parcelId),now);
    })()
  ]);
  if(buildingResult.status==="fulfilled")buildings=buildingResult.value||[];
  else errors.bbr=String(buildingResult.reason?.message||"BBR-opslag fejlede").slice(0,500);
  if(parcelResult.status==="fulfilled")cadastral=parcelResult.value||null;
  else errors.cadastral=String(parcelResult.reason?.message||"Matrikelopslag fejlede").slice(0,500);
  const bbr = buildings[0] || null;
  if (bfe) {
    try { estate = await getEstateByBfe(bfe, now); }
    catch(error) { errors.estate = String(error.message || "BFE-opslag fejlede").slice(0,500); }
  }

  const coords = parseCoordinates(house);
  const groundArea = numberValue(cadastral, ["registreretAreal","arealberegnet","samletAreal"]);
  // Sum only actual values from all returned BBR buildings; null means no registered area was returned.
  const sumBuildingField = (field) => {
    const values = buildings.map(item => numberValue(item, [field])).filter(value => value !== null);
    return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
  };
  const primaryFootprint = numberValue(bbr, ["byg041BebyggetAreal"]);
  const footprint = sumBuildingField("byg041BebyggetAreal");
  const residentialArea = sumBuildingField("byg039BygningensSamledeBoligAreal");
  const buildingArea = sumBuildingField("byg038SamletBygningsareal");
  res.setHeader("Cache-Control","private, max-age=60");
  return res.status(200).json({
    source:"Datafordeler Flexible GraphQL v3",
    fetchedAt:new Date().toISOString(),
    address:address?{id:address.id_lokalId,designation:address.adressebetegnelse||null,status:address.status||null}:null,
    house:house?{id:house.id_lokalId,designation:house.adgangsadressebetegnelse||null,streetNumber:house.husnummertekst||null,status:house.status||null,buildingId:house.adgangTilBygning||null,parcelId:house.jordstykke||house.placeretPaaForeloebigtJordstykke||null}:null,
    coordinates:coords,bbr,bbrBuildings:buildings,cadastral,estate,
    areas:{groundArea,footprint,primaryFootprint,residentialArea,buildingArea},
    completeness:{address:Boolean(address),house:Boolean(house),bbr:buildings.length>0,cadastral:Boolean(cadastral),estate:Boolean(estate)},
    errors,
    note:"Arealer vises kun, hvis de officielle registre returnerer dem. Manglende BBR-/matrikeldata er ikke bevis for, at forholdet ikke findes."
  });
}