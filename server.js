import express from "express";

const app = express();
app.use(express.json({ limit: "256kb" }));
app.use(express.static(process.cwd(), { index: "index.html", extensions: ["html"] }));
app.use(express.static(process.cwd(), { index: "index.html", extensions: ["html"] }));

const PORT = Number(process.env.PORT || 3000);
const GRAPHQL_URL = process.env.DATAFORDELER_GRAPHQL_URL || "https://graphql.datafordeler.dk/flexible/v3";
const API_KEY = process.env.DATAFORDELER_API_KEY;

const jsonHeaders = { "content-type": "application/json", "accept": "application/json" };

function cleanErrorMessage(value) {
  return String(value || "Ukendt fejl").replace(/https?:\/\/[^\s]+/g, "[ekstern tjeneste]").slice(0, 500);
}

async function graphql(query) {
  if (!API_KEY) {
    const error = new Error("Datafordeler API-nøgle mangler. Konfigurér DATAFORDELER_API_KEY på serveren.");
    error.status = 503;
    throw error;
  }
  const url = new URL(GRAPHQL_URL);
  url.searchParams.set("apiKey", API_KEY);
  const response = await fetch(url, {
    method: "POST",
    headers: { ...jsonHeaders },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(20000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.errors?.length) {
    const error = new Error(cleanErrorMessage(payload.errors?.map(e => e.message).join("; ") || payload.message || `Datafordeler HTTP ${response.status}`));
    error.status = response.status === 401 || response.status === 403 ? 502 : 502;
    throw error;
  }
  return payload.data || {};
}

async function getSchemaFields(typeName) {
  const data = await graphql(`query { __type(name: "${typeName}") { fields { name } } }`);
  return (data.__type?.fields || []).map(x => x.name);
}

function choose(fields, candidates) {
  return candidates.filter(name => fields.includes(name));
}

function fieldSelection(fields, candidates, { includeId = true } = {}) {
  const selection = choose(fields, candidates);
  if (includeId && fields.includes("id_lokalId") && !selection.includes("id_lokalId")) selection.unshift("id_lokalId");
  return selection.length ? selection.join("\n") : "id_lokalId";
}

function graphQuery(typeName, id, fields) {
  // Entity-specific GraphQL schema filter. This query only returns the selected object's
  // public register attributes; it does not return owner/person data.
  const now = new Date().toISOString();
  return `query {
    ${typeName}(
      first: 10
      registreringstid: "${now}"
      virkningstid: "${now}"
      where: { id_lokalId: { eq: "${id.replaceAll('"', '')}" } }
    ) {
      nodes { ${fields} }
    }
  }`;
}

async function safeEntity(typeName, id, candidateFields) {
  if (!id || typeof id !== "string" || id.length > 100 || !/^[a-zA-Z0-9._-]+$/.test(id)) return null;
  const schemaFields = await getSchemaFields(typeName);
  if (!schemaFields.length) return null;
  const selection = fieldSelection(schemaFields, candidateFields);
  const data = await graphql(graphQuery(typeName, id, selection));
  return data[typeName]?.nodes?.[0] || null;
}

app.get("/api/status", (_req, res) => {
  res.json({
    addressSearch: "Dataforsyningen/Adressevælger kan kaldes offentligt fra klienten",
    bbr: API_KEY ? "configured" : "needs_api_key",
    cadastral: API_KEY ? "configured" : "needs_api_key",
    provider: "Datafordeleren GraphQL flexible/v3",
    configured: Boolean(API_KEY),
    instructions: API_KEY ? undefined : "Opret en API key på portal.datafordeler.dk og sæt DATAFORDELER_API_KEY som en server-side environment variable."
  });
});

app.get("/api/adresser", async (req, res) => {
  const q = String(req.query.q || "").trim();
  if (q.length < 2 || q.length > 160) return res.status(400).json({ error: "Søgningen skal være 2–160 tegn." });
  try {
    const url = new URL("https://api.dataforsyningen.dk/adresser/autocomplete");
    url.searchParams.set("q", q);
    url.searchParams.set("per_side", "10");
    const upstream = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(12000) });
    if (!upstream.ok) throw new Error(`Adressekilden svarede HTTP ${upstream.status}`);
    res.set("Cache-Control", "public, max-age=60");
    res.json(await upstream.json());
  } catch (error) {
    res.status(502).json({ error: cleanErrorMessage(error.message), source: "Dataforsyningen" });
  }
});

app.get("/api/matrikel", async (req, res) => {
  const bfe = String(req.query.bfe || req.query.q || "").trim();
  if (!/^\\d{1,20}$/.test(bfe)) {
    return res.status(400).json({
      error: "Søg med et numerisk BFE-nummer i dette endpoint. Opslag direkte på matrikelbetegnelse kræver også korrekt ejerlav.",
      hint: "Brug /api/ejendom?adresseId=<DAR-id> for at finde matrikelrelationen fra en valgt adresse."
    });
  }
  try {
    const fields = await getSchemaFields("MAT_SamletFastEjendom");
    const selection = fieldSelection(fields, [
      "id_lokalId", "BFEnummer", "senesteSagLokalId", "kommunekode", "status",
      "datafordelerOpdateringstid", "registreringFra", "virkningFra", "ejerlavLokalId",
      "jordstykkeLokalId", "samletFastEjendomAreal", "tinglystAreal"
    ]);
    const now = new Date().toISOString();
    const data = await graphql(`query {
      MAT_SamletFastEjendom(first: 5, registreringstid: "${now}", virkningstid: "${now}",
        where: { BFEnummer: { eq: "${bfe}" } }) {
        nodes { ${selection} }
      }
    }`);
    res.json({ source: "Datafordeleren/MAT", fetchedAt: new Date().toISOString(), results: data.MAT_SamletFastEjendom?.nodes || [] });
  } catch (error) {
    res.status(error.status || 502).json({ error: cleanErrorMessage(error.message), source: "Datafordeleren/MAT", setup: !API_KEY });
  }
});

app.get("/api/ejendom", async (req, res) => {
  const adresseId = String(req.query.adresseId || "").trim();
  const bfe = String(req.query.bfe || "").trim();
  if (!adresseId && !bfe) return res.status(400).json({ error: "adresseId eller bfe er påkrævet." });
  if (adresseId && !/^[a-zA-Z0-9._-]{8,100}$/.test(adresseId)) return res.status(400).json({ error: "Ugyldigt adresse-ID." });
  if (bfe && !/^\d{1,20}$/.test(bfe)) return res.status(400).json({ error: "Ugyldigt BFE-nummer." });

  try {
    const now = new Date().toISOString();
    let address = null;
    let houseNumberId = null;
    let buildingId = null;
    let jordstykkeId = null;
    let bbrBuilding = null;
    let matParcel = null;

    if (adresseId) {
      // Use the official flexible GraphQL model to resolve the address-to-house-number links.
      // DAR_Adresse links to DAR_Husnummer, which can provide BBR building and
      // MAT parcel identifiers. Keep this explicit because relation fields need sub-selections.
      const addrData = await graphql(`query {
        DAR_Adresse(first: 5, registreringstid: "${now}", virkningstid: "${now}",
          where: { id_lokalId: { eq: "${adresseId}" } }) {
          nodes {
            id_lokalId
            adressebetegnelse
            adresseHarHusnummer(first: 10) {
              nodes {
                id_lokalId
                adgangsadressebetegnelse
                adgangTilBygning
                jordstykke
              }
            }
          }
        }
      }`);
      address = addrData.DAR_Adresse?.nodes?.[0] || null;
      if (address) {
        const rel = address.adresseHarHusnummer;
        const house = Array.isArray(rel?.nodes) ? rel.nodes[0] : (Array.isArray(rel) ? rel[0] : rel);
        houseNumberId = house?.id_lokalId || house?.id || null;
        buildingId = house?.adgangTilBygning || null;
        jordstykkeId = house?.jordstykke || null;
      }

      // If relationships are not exposed in this schema result, query BBR by the address ID
      // as the registered building/address association can be different for apartment addresses.
      if (buildingId) {
        const bbrFields = await getSchemaFields("BBR_Bygning");
        const selection = fieldSelection(bbrFields, [
          "id_lokalId", "byg007Bygningsnummer", "byg021BygningensAnvendelse", "byg026Opfoerelsesaar",
          "byg038SamletBygningsareal", "byg039BygningensSamledeBoligAreal", "byg040BygningensSamledeErhvervsAreal",
          "byg041BebyggetAreal", "byg054AntalEtager", "byg056Varmeinstallation", "byg057Opvarmningsmiddel",
          "byg030Vandforsyning", "byg031Afloebsforhold", "byg032YdervaeggensMateriale", "byg033Tagdaekningsmateriale",
          "byg094Revisionsdato", "byg150Gulvbelaegning", "byg153Konstruktionsforhold", "kommunekode", "husnummer", "grund", "jordstykke", "status"
        ]);
        const d = await graphql(graphQuery("BBR_Bygning", buildingId, selection));
        bbrBuilding = d.BBR_Bygning?.nodes?.[0] || null;
        jordstykkeId = jordstykkeId || bbrBuilding?.jordstykke || null;
      }
      // Try BBR by address/house-number ID if address link didn't directly expose building ID.
      if (!bbrBuilding && houseNumberId) {
        const bbrFields = await getSchemaFields("BBR_Bygning");
        const selection = fieldSelection(bbrFields, [
          "id_lokalId", "byg007Bygningsnummer", "byg021BygningensAnvendelse", "byg026Opfoerelsesaar",
          "byg038SamletBygningsareal", "byg039BygningensSamledeBoligAreal", "byg040BygningensSamledeErhvervsAreal",
          "byg041BebyggetAreal", "byg054AntalEtager", "byg056Varmeinstallation", "byg057Opvarmningsmiddel",
          "byg030Vandforsyning", "byg031Afloebsforhold", "byg032YdervaeggensMateriale", "byg033Tagdaekningsmateriale",
          "byg094Revisionsdato", "kommunekode", "husnummer", "grund", "jordstykke", "status"
        ]);
        const d = await graphql(graphQuery("BBR_Bygning", houseNumberId, selection));
        bbrBuilding = d.BBR_Bygning?.nodes?.[0] || null;
        jordstykkeId = jordstykkeId || bbrBuilding?.jordstykke || null;
      }
    }

    if (jordstykkeId) {
      const fields = await getSchemaFields("MAT_Jordstykke");
      const selection = fieldSelection(fields, [
        "id_lokalId", "matrikelnummer", "arealberegnet", "areal", "ejerlavLokalId", "BFEnummer",
        "status", "registreringFra", "virkningFra", "datafordelerOpdateringstid", "geometri", "kommunekode"
      ]);
      const d = await graphql(graphQuery("MAT_Jordstykke", jordstykkeId, selection));
      matParcel = d.MAT_Jordstykke?.nodes?.[0] || null;
    }

    if (bfe) {
      const fields = await getSchemaFields("MAT_SamletFastEjendom");
      const selection = fieldSelection(fields, [
        "id_lokalId", "BFEnummer", "senesteSagLokalId", "kommunekode", "status",
        "datafordelerOpdateringstid", "registreringFra", "virkningFra", "ejerlavLokalId"
      ]);
      const d = await graphql(`query {
        MAT_SamletFastEjendom(first: 5, registreringstid: "${now}", virkningstid: "${now}",
          where: { BFEnummer: { eq: "${bfe}" } }) { nodes { ${selection} } }
      }`);
      matParcel = d.MAT_SamletFastEjendom?.nodes?.[0] || matParcel;
    }

    res.set("Cache-Control", "private, max-age=60");
    res.json({
      source: "Datafordeleren GraphQL flexible/v3",
      fetchedAt: new Date().toISOString(),
      address: address ? { id: address.id_lokalId, designation: address.adressebetegnelse || null } : null,
      bbr: bbrBuilding,
      cadastral: matParcel,
      identifiers: { houseNumberId, buildingId, jordstykkeId, bfe: bfe || null },
      completeness: {
        address: Boolean(address),
        bbr: Boolean(bbrBuilding),
        cadastral: Boolean(matParcel)
      },
      note: "Fraværende data er ikke det samme som at forholdet ikke findes. Kontrollér felter i de officielle registre."
    });
  } catch (error) {
    const status = error.status || 502;
    res.status(status).json({
      error: cleanErrorMessage(error.message),
      source: "Datafordeleren",
      setup: !API_KEY,
      instructions: !API_KEY ? "Opret en API key på portal.datafordeler.dk og konfigurer DATAFORDELER_API_KEY som miljøvariabel på serveren." : undefined
    });
  }
});

app.get("/api/health", (_req, res) => res.json({ ok: true, service: "ByggeInfo data proxy" }));

app.get("*", async (_req, res) => {
  res.status(404).json({ error: "Ruten findes ikke." });
});

app.listen(PORT, () => {
  console.log(`ByggeInfo API lytter på port ${PORT}`);
});
