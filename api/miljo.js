const SERVICE = "https://kort.vd.dk/server/rest/services/Vejkort/Danmarks_Milj%C3%B8_Portal/MapServer";
const SR = 25832;
const LAYERS = {
  soilV1: { id: 30, fields: "Lokalitetsnr,Lokalitetetsadresse,Lokalitetetsforureningsstatus,Regionsnavn,Kortlaegningsdato,SenesteInddateringsdato" },
  soilV2: { id: 31, fields: "Lokalitetsnr,Lokalitetetsadresse,Lokalitetetsforureningsstatus,Regionsnavn,Kortlaegningsdato,SenesteInddateringsdato" },
  soilUnresolved: { id: 26, fields: "Lokalitetsnr,Lokalitetetsadresse,Lokalitetetsforureningsstatus,Regionsnavn,Kortlaegningsdato,SenesteInddateringsdato" },
  soilNuanced: { id: 27, fields: "Lokalitetsnr,Lokalitetetsadresse,Lokalitetetsforureningsstatus,Regionsnavn,Kortlaegningsdato,SenesteInddateringsdato" },
  protectedNature: { id: 3, fields: "Temanavn,Natyp_navn,Natyp_kode,Status,Link,DatoForHentning" },
  naturaHabitat: { id: 10, fields: "Temanavn,Objektnavn,Loc_ident,Site_ident,Link,DatoForHentning" },
  naturaBirds: { id: 9, fields: "Temanavn,Objektnavn,Loc_ident,Site_ident,Link,DatoForHentning" },
  groundwaterAgreement: { id: 16, fields: "Temanavn,Resttyp,Afttyp,Aftalestatus,Tinglyst,Link,DatoForHentning" },
  groundwaterPlans: { id: 19, fields: "Temanavn,Link,DatoForHentning" },
  bnbo: { id: 24, fields: "Temanavn,Status,Link,DatoForHentning" }
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
  const url = new URL(SERVICE + "/" + layer.id + "/query");
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
  return (payload.features || []).map(feature => feature.attributes || {});
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
  const [soil, nature, groundwater] = await Promise.all([
    settleLayers(["soilV1", "soilV2", "soilUnresolved", "soilNuanced"], x, y, radius),
    settleLayers(["protectedNature", "naturaHabitat", "naturaBirds"], x, y, radius),
    settleLayers(["groundwaterAgreement", "groundwaterPlans", "bnbo"], x, y, radius)
  ]);

  const combine = group => Object.values(group).flatMap(result => result.items || []);
  const failed = group => Object.values(group).some(result => !result.ok);
  const soilItems = combine(soil), natureItems = combine(nature), groundwaterItems = combine(groundwater);
  const allOk = !failed(soil) && !failed(nature) && !failed(groundwater);

  return res.status(200).json({
    source: "Danmarks Miljøportal / Vejdirektoratets ArcGIS REST-kopi af DAI og DKJord",
    fetchedAt: startedAt,
    location: { x, y, srid: SR, radiusMeters: radius, method: "adressepunkt med afstandsforespørgsel; ikke matrikelpolygon" },
    checks: {
      soil: {
        status: resultStatus(soilItems, failed(soil)),
        summary: soilItems.length ? soilItems.length + " registrering(er) i søgeområdet" : "Ingen registreringer returneret i søgeområdet",
        v1: soil.soilV1.items.length,
        v2: soil.soilV2.items.length,
        unresolved: soil.soilUnresolved.items.length,
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
        errors: Object.fromEntries(Object.entries(groundwater).filter(([,v]) => !v.ok).map(([k,v]) => [k,v.error]))
      },
      flood: { status: "not_queried", summary: "Ikke forespurgt i denne punktservice. De officielle oversvømmelsesdata udstilles primært som WMS/WMTS og modelleret grid; de kan ikke fortolkes som en præcis ejendomsafgørelse." },
      noise: { status: "not_queried", summary: "Ingen verificeret offentlig punkt-API til støj er tilsluttet i denne version." }
    },
    complete: allOk,
    caveat: "Et tomt resultat betyder ingen match i de forespurgte kortlag inden for radius – ikke dokumentation for at ejendommen er fri for miljømæssige bindinger. Adressepunktets nærhedssøgning er screening, ikke matrikelattest eller myndighedsafgørelse."
  });
}
