const SERVICE = "https://kort.vd.dk/server/rest/services/Vejkort/Danmarks_Milj%C3%B8_Portal/MapServer";
const SR = 25832;
const NOISE_SERVICE = "https://kort.vd.dk/server/rest/services/Stoej_luft/St%C3%B8jkortl%C3%A6gning_af_statsveje_2022/MapServer";
const FLOOD_SERVICE = "https://gisportal.mst.dk/server/rest/services/ekstern/Kystplanlaegger_Oversvommelsesfare_2/MapServer";
const JUPITER_WFS = "https://data.geus.dk/geusmap/ows/25832.jsp";
const FLOOD_SCENARIOS = [{id:3,year:2020,label:"100-års hændelse · 2020"},{id:12,year:2070,label:"100-års hændelse · 2070"},{id:21,year:2120,label:"100-års hændelse · 2120"}];
const LAYERS = {
  soilV1: { id: 30, fields: "Lokalitetsnr,Lokalitetetsadresse,Lokalitetetsforureningsstatus,Regionsnavn,Kortlaegningsdato,SenesteInddateringsdato" },
  soilV2: { id: 31, fields: "Lokalitetsnr,Lokalitetetsadresse,Lokalitetetsforureningsstatus,Regionsnavn,Kortlaegningsdato,SenesteInddateringsdato" },
  soilNuanced: { id: 27, fields: "Lokalitetsnr,Lokalitetetsadresse,Lokalitetetsforureningsstatus,Regionsnavn,Kortlaegningsdato,SenesteInddateringsdato,Nuanceringsstatus" },
  protectedNature: { id: 3, fields: "Temanavn,Natyp_navn,Natyp_kode,Status,Link,DatoForHentning" },
  naturaHabitat: { id: 10, fields: "Temanavn,Objektnavn,Loc_ident,Site_ident,Link,DatoForHentning" },
  naturaBirds: { id: 9, fields: "Temanavn,Objektnavn,Loc_ident,Site_ident,Link,DatoForHentning" },
  groundwaterAgreement: { id: 16, fields: "Temanavn,Resttyp,Afttyp,Aftalestatus,Tinglyst,Link,DatoForHentning" },
  groundwaterPlans: { id: 19, fields: "Temanavn,Indsatsplan,Dato_pol_vedt,Revisionsdato,Link,DatoForHentning" },
  bnbo: { id: 24, fields: "Temanavn,Status_bnbo,Status,Dgunr,Kommunenav,Datoaend,Link,DatoForHentning" },
  noiseDay: { id: 2, fields: "Isov1,Isov2" },
  noiseNight: { id: 3, fields: "Isov1,Isov2" }
};

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Miljødatakilden svarede ikke inden for tidsgrænsen.")), ms); })
  ]).finally(() => clearTimeout(timer));
}

async function queryLayer(name, x, y, radius) {
  const layer = LAYERS[name];
  const base = name === "noiseDay" || name === "noiseNight" ? NOISE_SERVICE : SERVICE;
  const url = new URL(base + "/" + layer.id + "/query");
  const params = {
    where: "1=1",
    geometry: JSON.stringify({ x, y, spatialReference: { wkid: SR } }),
    geometryType: "esriGeometryPoint",
    inSR: String(SR),
    spatialRel: "esriSpatialRelIntersects",
    distance: String(radius),
    units: "esriSRUnit_Meter",
    outFields: layer.fields,
    returnGeometry: "false",
    resultRecordCount: "15",
    orderByFields: "OBJECTID",
    f: "json"
  };
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await withTimeout(fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(6500) }), 7000);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.error) throw new Error(payload.error?.message || "GIS-kilden svarede med HTTP " + response.status);
  return (payload.features || []).map(feature => ({ ...(feature.attributes || {}), _layer: name }));
}

async function queryJupiterWells(x, y, radius) {
  const url = new URL(JUPITER_WFS);
  const params = {
    mapname: "jupiter",
    SERVICE: "WFS",
    VERSION: "1.0.0",
    REQUEST: "GetFeature",
    TYPENAME: "jupiter_boringer_ws",
    BBOX: [x-radius, y-radius, x+radius, y+radius].join(","),
    MAXFEATURES: "100",
    outputformat: "geojson"
  };
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await withTimeout(fetch(url, { headers: { Accept: "application/geo+json, application/json" }, signal: AbortSignal.timeout(6500) }), 7000);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !Array.isArray(payload.features)) throw new Error("GEUS/Jupiter WFS returnerede ikke et gyldigt GeoJSON-svar (HTTP " + response.status + ").");
  const distance = (a,b) => Math.sqrt(Math.pow(Number(a)-x,2)+Math.pow(Number(b)-y,2));
  return payload.features.map(feature => {
    const coords = feature.geometry?.coordinates;
    const meters = Array.isArray(coords) && coords.length >= 2 ? distance(coords[0],coords[1]) : null;
    return { ...(feature.properties || {}), _distanceMeters: meters };
  }).filter(item => item._distanceMeters !== null && item._distanceMeters <= radius).slice(0,30);
}

async function queryFloodScenario(scenario, x, y, radius) {
  const url = new URL(FLOOD_SERVICE + "/" + scenario.id + "/query");
  const params = {
    where: "1=1",
    geometry: JSON.stringify({ x, y, spatialReference: { wkid: SR } }),
    geometryType: "esriGeometryPoint",
    inSR: String(SR),
    spatialRel: "esriSpatialRelIntersects",
    distance: String(radius),
    units: "esriSRUnit_Meter",
    outFields: "*",
    returnGeometry: "false",
    resultRecordCount: "10",
    f: "json"
  };
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await withTimeout(fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(6500) }), 7000);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.error) throw new Error(payload.error?.message || "Oversvømmelseskilden svarede med HTTP " + response.status);
  return (payload.features || []).map(feature => ({ ...(feature.attributes || {}), _scenario: scenario.label, _year: scenario.year }));
}

function resultStatus(items, failed, emptyText) {
  if (failed) return "error";
  return items.length ? "hit" : "clear";
}

async function settleLayers(names, x, y, radius) {
  const entries = await Promise.all(names.map(async name => {
    try { return [name, { ok: true, items: await queryLayer(name, x, y, radius) }]; }
    catch (error) { return [name, { ok: false, error: String(error.message || error).slice(0, 220), items: [] }]; }
  }));
  return Object.fromEntries(entries);
}

export default async function handler(req, res) {
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); return res.status(405).json({ error: "Method not allowed" }); }
  const x = Number(req.query.x), y = Number(req.query.y);
  const radius = Number(req.query.radius || 100);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 40000 || x > 1000000 || y < 5000000 || y > 7500000) {
    return res.status(400).json({ error: "Gyldige koordinater i EPSG:25832 er påkrævet." });
  }
  if (!Number.isFinite(radius) || radius < 0 || radius > 1000) return res.status(400).json({ error: "Radius skal være mellem 0 og 1000 meter." });

  const startedAt = new Date().toISOString();
  const [soil, nature, groundwater, noise, floodResults, jupiterWellsResult] = await Promise.all([
    settleLayers(["soilV1", "soilV2", "soilNuanced"], x, y, radius),
    settleLayers(["protectedNature", "naturaHabitat", "naturaBirds"], x, y, radius),
    settleLayers(["groundwaterAgreement", "groundwaterPlans", "bnbo"], x, y, radius),
    settleLayers(["noiseDay", "noiseNight"], x, y, radius),
    Promise.all(FLOOD_SCENARIOS.map(async scenario => { try { return { ok: true, scenario, items: await queryFloodScenario(scenario, x, y, radius) }; } catch (error) { return { ok: false, scenario, items: [], error: String(error.message || error).slice(0,220) }; } }))
  ]);

  const combine = group => Object.values(group).flatMap(result => result.items || []);
  const failed = group => Object.values(group).some(result => !result.ok);
  const soilItems = combine(soil), natureItems = combine(nature), groundwaterItems = combine(groundwater);
  const noiseItems = combine(noise);
  const floodItems = floodResults.flatMap(result => result.items || []);
  const floodFailed = floodResults.some(result => !result.ok);
  const allOk = !failed(soil) && !failed(nature) && !groundwaterFailed && !failed(noise) && !floodFailed;

  return res.status(200).json({
    source: "Danmarks Miljøportal / Vejdirektoratet ArcGIS REST: DAI, DKJord og statsvejs-støjkort 2022",
    fetchedAt: startedAt,
    location: { x, y, srid: SR, radiusMeters: radius, method: "adressepunkt med afstandsforespørgsel; ikke matrikelpolygon" },
    checks: {
      soil: {
        status: resultStatus(soilItems, failed(soil)),
        summary: soilItems.length ? soilItems.length + " registrering(er) i søgeområdet" : "Ingen registreringer returneret i søgeområdet",
        v1: soil.soilV1.items.length,
        v2: soil.soilV2.items.length,
        unresolved: 0,
        nuanced: soil.soilNuanced.items.length,
        items: soilItems.slice(0, 20),
        errors: Object.fromEntries(Object.entries(soil).filter(([,v]) => !v.ok).map(([k,v]) => [k,v.error]))
      },
      nature: {
        status: resultStatus(natureItems, failed(nature)),
        summary: natureItems.length ? natureItems.length + " registrering(er) i søgeområdet" : "Ingen registreringer returneret i søgeområdet",
        protectedNature: nature.protectedNature.items,
        naturaHabitat: nature.naturaHabitat.items,
        naturaBirds: nature.naturaBirds.items,
        errors: Object.fromEntries(Object.entries(nature).filter(([,v]) => !v.ok).map(([k,v]) => [k,v.error]))
      },
      groundwater: {
        status: resultStatus(groundwaterItems, failed(groundwater)),
        summary: groundwaterItems.length ? groundwaterItems.length + " grundvandsbeskyttelses-/planregistrering(er) i søgeområdet" : "Ingen registreringer returneret i de forespurgte beskyttelseslag",
        agreements: groundwater.groundwaterAgreement.items,
        actionPlans: groundwater.groundwaterPlans.items,
        bnbo: groundwater.bnbo.items,
        errors: { ...Object.fromEntries(Object.entries(groundwater).filter(([,v]) => !v.ok).map(([k,v]) => [k,v.error])), ...(jupiterWellsResult.ok ? {} : { jupiter: jupiterWellsResult.error }) }
      },
      flood: { status: resultStatus(floodItems, floodFailed), summary: floodItems.length ? floodItems.length + " oversvømmelseszone(r) i 100-års scenarierne 2020, 2070 eller 2120 inden for søgeområdet" : (floodFailed ? "Et eller flere officielle oversvømmelseslag kunne ikke forespørges" : "Ingen 100-års oversvømmelseszoner returneret inden for søgeområdet"), scenarios: floodResults.map(result => ({ year: result.scenario.year, label: result.scenario.label, count: result.items.length, error: result.error || null })), items: floodItems.slice(0,20), errors: floodResults.filter(result => !result.ok).map(result => result.scenario.label + ": " + result.error) },
      noise: { status: resultStatus(noiseItems, failed(noise)), summary: noiseItems.length ? noiseItems.length + " støjpolygon(er) fra Vejdirektoratets statsvejs-kortlægning 2022 inden for søgeområdet" : "Ingen statsvejs-støjpolygoner returneret i søgeområdet", day: noise.noiseDay.items, night: noise.noiseNight.items, errors: Object.fromEntries(Object.entries(noise).filter(([,v]) => !v.ok).map(([k,v]) => [k,v.error])) }
    },
    complete: allOk,
    caveat: "Et tomt resultat betyder ingen match i de forespurgte kortlag inden for radius – ikke dokumentation for at ejendommen er fri for miljømæssige bindinger. Adressepunktets nærhedssøgning er screening, ikke matrikelattest eller myndighedsafgørelse."
  });
}
