const ENDPOINT = process.env.DATAFORDELER_GRAPHQL_URL || "https://graphql.datafordeler.dk/flexible/v3";

async function probe(type, fields, now) {
  const key = process.env.DATAFORDELER_API_KEY;
  if (!key) return { ok:false, error:"DATAFORDELER_API_KEY mangler." };
  // Datafordeler Flexible GraphQL restricts introspection, aliases and multiple root fields.
  // Each probe therefore contains exactly one concrete root entity and scalar fields.
  const query = "query { " + type + '(first:1, registreringstid:"' + now + '", virkningstid:"' + now + '"){ nodes { ' + fields.join(" ") + " } } }";
  const url = new URL(ENDPOINT);
  url.searchParams.set("apiKey", key);
  try {
    const response = await fetch(url, { method:"POST", headers:{"content-type":"application/json",accept:"application/json"}, body:JSON.stringify({query}), signal:AbortSignal.timeout(12000) });
    const payload = await response.json().catch(() => ({}));
    const root = payload.data && payload.data[type];
    const errors = (payload.errors || []).map(x => x.message).join("; ");
    const ok = response.ok && !errors && Boolean(root);
    return { ok, httpStatus:response.status, count:Array.isArray(root?.nodes) ? root.nodes.length : 0, error:ok ? undefined : (errors || payload.message || ("HTTP " + response.status)) };
  } catch (error) {
    return { ok:false, error:String(error.message || "Forbindelsesfejl").slice(0,250) };
  }
}

export default async function handler(req, res) {
  if (req.method !== "GET") { res.setHeader("Allow","GET"); return res.status(405).json({error:"Method not allowed"}); }
  const configured = Boolean(process.env.DATAFORDELER_API_KEY);
  res.setHeader("Cache-Control","no-store");
  if (!configured) return res.status(200).json({ok:false,configured:false,addressSearch:"Klimadatastyrelsens Adressevælger",dataApi:"not_configured",bbr:"needs_api_key",cadastral:"needs_api_key",instructions:"DATAFORDELER_API_KEY mangler i Vercel Production."});
  const now = new Date().toISOString();
  // Three independent, narrowly scoped requests; no introspection, aliases or multi-root query.
  const [dar,bbr,mat] = await Promise.all([
    probe("DAR_Husnummer",["id_lokalId"],now),
    probe("BBR_Bygning",["id_lokalId"],now),
    probe("MAT_Jordstykke",["id_lokalId"],now)
  ]);
  const ok = dar.ok && bbr.ok && mat.ok;
  return res.status(200).json({
    ok, configured:true, addressSearch:"Klimadatastyrelsens Adressevælger",
    dataApi:ok?"connected":(dar.ok?"partial_connection":"connection_error"),
    dar:dar.ok?"reachable":"error", bbr:bbr.ok?"reachable":"error", cadastral:mat.ok?"reachable":"error",
    provider:"Datafordeler Flexible GraphQL v3", checkedAt:new Date().toISOString(),
    checks:{DAR_Husnummer:dar,BBR_Bygning:bbr,MAT_Jordstykke:mat},
    note:"Et statusopslag verificerer adgang til hver entitet; det kontrollerer ikke, at en konkret adresse har BBR-/matrikelrelationer."
  });
}