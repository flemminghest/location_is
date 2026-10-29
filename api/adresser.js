const BASE = "https://adressevaelger.dk";
const TOKEN = () => process.env.ADRESSEVAELGER_TOKEN || "adressevaelger123";
async function fetchSuggestions(endpoint, q, limit) {
  const url = new URL(endpoint, BASE);
  url.searchParams.set("tekst", q);
  url.searchParams.set("maksimum", String(limit));
  url.searchParams.set("token", TOKEN());
  const response = await fetch(url, { headers:{accept:"application/json"}, signal:AbortSignal.timeout(12000) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error("Adressevælger HTTP " + response.status);
  if (body.status && body.status !== "ok") throw new Error(body.beskrivelse || "Adressevælgerens søgning fejlede");
  return Array.isArray(body.fund) ? body.fund : [];
}
function normalize(hit, kind) {
  const type = String(hit.type || "").toLowerCase();
  const labels = {
    adresse:"Adresse", husnummer:"Husnummer",
    navngivenvejpostnummer:"Vej og postnummer",
    vejnavn:"Vejnavn", vejnavnhusnummer:"Muligt husnummer"
  };
  const label = hit.titel || hit.adgangsadressebetegnelse || hit.adressebetegnelse || [hit.vejnavn,hit.husnummer,hit.postnr,hit.postdistrikt].filter(Boolean).join(" ");
  const detailParts = [];
  if (hit.postnr && hit.postdistrikt) detailParts.push(hit.postnr + " " + hit.postdistrikt);
  else if (hit.postdistrikt) detailParts.push(hit.postdistrikt);
  if (hit.antal_husnumre != null) detailParts.push(hit.antal_husnumre + " husnumre på vejen");
  if (type === "vejnavn") detailParts.push("Vejnavn · tilføj husnummer og postnummer");
  if (type === "vejnavnhusnummer") detailParts.push("Ikke entydig endnu · tilføj postnummer/by");
  const specific = type === "adresse" || type === "husnummer";
  return {
    id:hit.id || null, type, label:String(label || ""),
    detail:detailParts.join(" · "), kindLabel:labels[type] || (kind === "adresse" ? "Adresseforslag" : "Søgeforslag"),
    source:"official-dar", husnummerId:hit.husnummerId || hit.husnummerid || null,
    vejnavn:hit.vejnavn || null, husnummer:hit.husnummer || null, postnr:hit.postnr || null, postdistrikt:hit.postdistrikt || null,
    antal_husnumre:hit.antal_husnumre == null ? null : Number(hit.antal_husnumre), specific, rawType:hit.type || null
  };
}
function score(hit, q) {
  const query = q.toLocaleLowerCase("da").replace(/[.,]/g," ").replace(/\\s+/g," ").trim();
  const label = hit.label.toLocaleLowerCase("da").replace(/[.,]/g," ").replace(/\\s+/g," ").trim();
  let n = 0;
  if (label === query) n += 100;
  else if (label.startsWith(query)) n += 35;
  else if (label.includes(query)) n += 15;
  if (hit.type === "adresse") n += 24;
  else if (hit.type === "husnummer") n += 18;
  else if (hit.type === "navngivenvejpostnummer") n += 5;
  if (/\\b\\d{4}\\b/.test(q) && hit.postnr === q.match(/\\b\\d{4}\\b/)?.[0]) n += 20;
  if (hit.specific) n += 10;
  return n;
}
export default async function handler(req, res) {
  if (req.method !== "GET") { res.setHeader("Allow","GET"); return res.status(405).json({error:"Method not allowed"}); }
  const q = String(req.query.q || "").trim();
  if (q.length < 2 || q.length > 73) return res.status(400).json({error:"Søgningen skal være 2–73 tegn."});
  try {
    // Address search finds individual floor/door addresses; house-number search finds access locations.
    const [addressHits, houseHits] = await Promise.allSettled([
      fetchSuggestions("/adresser/soeg/", q, 20),
      fetchSuggestions("/husnumre/soeg/", q, 20)
    ]);
    const errors = [];
    const merged = [];
    if (addressHits.status === "fulfilled") merged.push(...addressHits.value.map(x => normalize(x,"adresse")));
    else errors.push("adresse: " + String(addressHits.reason?.message || "fejl").slice(0,120));
    if (houseHits.status === "fulfilled") merged.push(...houseHits.value.map(x => normalize(x,"husnummer")));
    else errors.push("husnummer: " + String(houseHits.reason?.message || "fejl").slice(0,120));
    const unique = new Map();
    for (const hit of merged) {
      if (!hit.label) continue;
      const key = (hit.id || hit.label) + "|" + hit.type;
      const existing = unique.get(key);
      if (!existing || score(hit,q) > score(existing,q)) unique.set(key,hit);
    }
    const fund = [...unique.values()].sort((a,b) => score(b,q)-score(a,q) || a.label.localeCompare(b.label,"da")).slice(0,12);
    if (errors.length === 2) return res.status(502).json({error:"Begge officielle adresseopslag fejlede.",details:errors});
    res.setHeader("Cache-Control","public, max-age=30");
    return res.status(200).json({status:"ok",query:q,fund,partial:errors.length>0,details:errors,source:"Klimadatastyrelsens Adressevælger",hint:fund.length ? "Brug vejnavn + husnummer + postnummer for det mest præcise match." : "Prøv med vejnavn, husnummer og postnummer eller by."});
  } catch (error) {
    return res.status(502).json({error:"Kunne ikke kontakte Klimadatastyrelsens Adressevælger.",detail:String(error.message||"").slice(0,200)});
  }
}