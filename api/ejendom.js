const ENDPOINT = process.env.DATAFORDELER_GRAPHQL_URL || "https://graphql.datafordeler.dk/flexible/v3";

async function gql(query) {
  const key = process.env.DATAFORDELER_API_KEY;
  if (!key) { const e = new Error("DATAFORDELER_API_KEY mangler i Vercel Production."); e.status = 503; throw e; }
  const url = new URL(ENDPOINT); url.searchParams.set("apiKey", key);
  const r = await fetch(url, { method:"POST", headers:{"content-type":"application/json",accept:"application/json"}, body:JSON.stringify({query}), signal:AbortSignal.timeout(20000) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || (d.errors && d.errors.length)) { const e = new Error((d.errors || []).map(x => x.message).join("; ") || "Datafordeleren HTTP " + r.status); e.status = 502; throw e; }
  return d.data || {};
}

async function typeFields(type) {
  const d = await gql('query { __type(name: "' + type + '") { name fields { name } } }');
  return (d.__type && d.__type.fields || []).map(x => x.name);
}
function selection(fields, candidates) {
  const selected = candidates.filter(x => fields.includes(x));
  if (fields.includes("id_lokalId") && !selected.includes("id_lokalId")) selected.unshift("id_lokalId");
  return selected.length ? selected.join("\n") : "id_lokalId";
}
function validId(value) { return /^[a-zA-Z0-9._-]{8,100}$/.test(String(value || "")); }
function numberFrom(obj, candidates) {
  if (!obj) return null;
  for (const key of candidates) { const v = obj[key]; if (v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v))) return Number(v); }
  return null;
}
async function entityById(type, id, candidates, now) {
  const fields = await typeFields(type);
  if (!fields.length || !validId(id)) return null;
  const sel = selection(fields, candidates);
  const query = 'query { ' + type + '(first:5, registreringstid:"' + now + '", virkningstid:"' + now + '", where:{id_lokalId:{eq:"' + id + '"}}){nodes{' + sel + '}} }';
  const d = await gql(query);
  return d[type] && d[type].nodes && d[type].nodes[0] || null;
}
async function getHouse(id, now) {
  if (!validId(id)) return null;
  const fields = await typeFields("DAR_Husnummer");
  const sel = selection(fields, ["id_lokalId","adgangsadressebetegnelse","husnummertekst","status","adgangTilBygning"]);
  const query = 'query { DAR_Husnummer(first:1, registreringstid:"' + now + '", virkningstid:"' + now + '", where:{id_lokalId:{eq:"' + id + '"}}){nodes{' + sel + '}} }';
  const d = await gql(query);
  return d.DAR_Husnummer && d.DAR_Husnummer.nodes && d.DAR_Husnummer.nodes[0] || null;
}

export default async function handler(req, res) {
  if (req.method !== "GET") { res.setHeader("Allow","GET"); return res.status(405).json({error:"Method not allowed"}); }
  const addressId = String(req.query.adresseId || "").trim();
  const houseId = String(req.query.husnummerId || "").trim();
  const bfe = String(req.query.bfe || "").trim();
  if (!addressId && !houseId && !bfe) return res.status(400).json({error:"adresseId, husnummerId eller bfe er påkrævet."});
  if (addressId && !validId(addressId)) return res.status(400).json({error:"Ugyldigt adresse-ID."});
  if (houseId && !validId(houseId)) return res.status(400).json({error:"Ugyldigt husnummer-ID."});
  if (bfe && !/^\d{1,20}$/.test(bfe)) return res.status(400).json({error:"Ugyldigt BFE-nummer."});
  try {
    const now = new Date().toISOString();
    let address = null, house = null, bbr = null, parcels = [], relationError = null, cadastralEstate = null;
    if (addressId) {
      const addressFields = await typeFields("DAR_Adresse");
      const sel = selection(addressFields, ["id_lokalId","adressebetegnelse","husnummer"]);
      const query = 'query { DAR_Adresse(first:1, registreringstid:"' + now + '", virkningstid:"' + now + '", where:{id_lokalId:{eq:"' + addressId + '"}}){nodes{' + sel + '}} }';
      const d = await gql(query);
      address = d.DAR_Adresse && d.DAR_Adresse.nodes && d.DAR_Adresse.nodes[0] || null;
      if (address && address.husnummer) house = await getHouse(String(address.husnummer), now);
    } else if (houseId) {
      house = await getHouse(houseId, now);
    }
    const bbrCandidates = ["byg007Bygningsnummer","byg021BygningensAnvendelse","byg026Opfoerelsesaar","byg027OmTilbygningsaar","byg030Vandforsyning","byg031Afloebsforhold","byg032YdervaeggensMateriale","byg033Tagdaekningsmateriale","byg038SamletBygningsareal","byg039BygningensSamledeBoligAreal","byg040BygningensSamledeErhvervsAreal","byg041BebyggetAreal","byg042ArealIndbyggetGarage","byg043ArealIndbyggetCarport","byg044ArealIndbyggetUdhus","byg048AndetAreal","byg054AntalEtager","byg056Varmeinstallation","byg057Opvarmningsmiddel","byg094Revisionsdato","kommunekode","status","husnummer"];
    if (bfe) {
      const fields = await typeFields("MAT_SamletFastEjendom");
      const sel = selection(fields, ["id_lokalId","BFEnummer","ejerlavLokalId","kommunekode","status","datafordelerOpdateringstid","registreringFra","virkningFra"]);
      const query = 'query { MAT_SamletFastEjendom(first:5, registreringstid:"' + now + '", virkningstid:"' + now + '", where:{BFEnummer:{eq:"' + bfe + '"}}){nodes{' + sel + '}} }';
      const d = await gql(query); cadastralEstate = d.MAT_SamletFastEjendom && d.MAT_SamletFastEjendom.nodes && d.MAT_SamletFastEjendom.nodes[0] || null;
    }
    if (house && house.adgangTilBygning && validId(String(house.adgangTilBygning))) {
      bbr = await entityById("BBR_Bygning", String(house.adgangTilBygning), bbrCandidates, now);
    }
    if (!bbr && house && house.id_lokalId) {
      const fields = await typeFields("BBR_Bygning");
      if (fields.includes("husnummer")) {
        const sel = selection(fields, bbrCandidates);
        const query = 'query { BBR_Bygning(first:10, registreringstid:"' + now + '", virkningstid:"' + now + '", where:{husnummer:{eq:"' + house.id_lokalId + '"}}){nodes{' + sel + '}} }';
        const d = await gql(query); bbr = d.BBR_Bygning && d.BBR_Bygning.nodes && d.BBR_Bygning.nodes[0] || null;
      }
    }
    const matFields = await typeFields("MAT_Jordstykke");
    const matCandidates = ["matrikelnummer","areal","arealberegnet","arealRegistreret","ejerlavLokalId","status","datafordelerOpdateringstid","kommunekode"];
    if (house && matFields.length) {
      const darFields = await typeFields("DAR_Husnummer");
      if (darFields.includes("husnummerErPlaceretPaaJordstykke")) {
        try {
          const matSel = selection(matFields, matCandidates);
          const query = 'query { DAR_Husnummer(first:1, registreringstid:"' + now + '", virkningstid:"' + now + '", where:{id_lokalId:{eq:"' + house.id_lokalId + '"}}){nodes{id_lokalId husnummerErPlaceretPaaJordstykke{nodes{' + matSel + '}}}} }';
          const d = await gql(query);
          parcels = d.DAR_Husnummer && d.DAR_Husnummer.nodes && d.DAR_Husnummer.nodes[0] && d.DAR_Husnummer.nodes[0].husnummerErPlaceretPaaJordstykke && d.DAR_Husnummer.nodes[0].husnummerErPlaceretPaaJordstykke.nodes || [];
        } catch (e) { relationError = String(e.message || "Matrikelrelation kunne ikke læses").slice(0,250); }
      }
    }
    let point = null;
    if (house && house.id_lokalId) {
      try {
        const pointQuery = 'query { DAR_Husnummer(first:1, registreringstid:"' + now + '", virkningstid:"' + now + '", where:{id_lokalId:{eq:"' + house.id_lokalId + '"}}){nodes{id_lokalId HusnummerHarAdgangspunkt{position{type crs dimension wkt}}}} }';
        const pointData = await gql(pointQuery);
        point = pointData.DAR_Husnummer && pointData.DAR_Husnummer.nodes && pointData.DAR_Husnummer.nodes[0] && pointData.DAR_Husnummer.nodes[0].HusnummerHarAdgangspunkt && pointData.DAR_Husnummer.nodes[0].HusnummerHarAdgangspunkt.position || null;
      } catch (_) { point = null; }
    }
    const pointMatch = point && typeof point.wkt === "string" ? point.wkt.match(/POINT(?:\\s+Z)?\\s*\\(?\\s*([+-]?\\d+(?:\\.\\d+)?)\\s+([+-]?\\d+(?:\\.\\d+)?)/i) : null;
    const coordinates = pointMatch ? { x:Number(pointMatch[1]), y:Number(pointMatch[2]), crs:point.crs||null, wkt:point.wkt } : null;
    const parcel = parcels[0] || null;
    const groundArea = numberFrom(parcel, ["areal","arealberegnet","arealRegistreret"]);
    const footprint = numberFrom(bbr, ["byg041BebyggetAreal","bebyggetAreal"]);
    const residentialArea = numberFrom(bbr, ["byg039BygningensSamledeBoligAreal","samletBoligareal"]);
    const buildingArea = numberFrom(bbr, ["byg038SamletBygningsareal","samletBygningsareal"]);
    res.setHeader("Cache-Control","private, max-age=60");
    return res.status(200).json({source:"Datafordeleren Flexible GraphQL v3",fetchedAt:new Date().toISOString(),address:address?{id:address.id_lokalId,designation:address.adressebetegnelse||null}:null,house:house?{id:house.id_lokalId,designation:house.adgangsadressebetegnelse||null,streetNumber:house.husnummertekst||null,status:house.status||null,buildingId:house.adgangTilBygning||null}:null,coordinates,bbr,cadastral:parcel,parcels,estate:cadastralEstate,areas:{groundArea,footprint,residentialArea,buildingArea},completeness:{address:Boolean(address),house:Boolean(house),bbr:Boolean(bbr),cadastral:parcels.length>0,estate:Boolean(cadastralEstate)},availableFields:{bbr:(await typeFields("BBR_Bygning")).filter(x=>/byg0(21|26|38|39|40|41|54)|husnummer|id_lokalId/i.test(x)),mat:matFields.filter(x=>/matrikelnummer|areal|ejerlav|id_lokalId/i.test(x))},relationError,note:"Arealer vises kun hvis de officielle registre returnerer dem. Et manglende BBR-objekt betyder ikke, at bygningen ikke findes; relationen skal kontrolleres."});
  } catch (e) { return res.status(e.status || 502).json({error:String(e.message || "Dataopslag fejlede").slice(0,600),source:"Datafordeleren Flexible GraphQL v3",setup:!process.env.DATAFORDELER_API_KEY}); }
}