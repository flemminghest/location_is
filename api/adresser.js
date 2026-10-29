const BASE = "https://adressevaelger.dk";
const TOKEN = () => process.env.ADRESSEVAELGER_TOKEN || "adressevaelger123";
async function requestSearch(path, params, limit=20) {
  const url = new URL(path, BASE);
  for (const [key,value] of Object.entries(params)) if (value !== undefined && value !== null && String(value) !== "") url.searchParams.set(key,String(value));
  url.searchParams.set("maksimum",String(limit));
  url.searchParams.set("token",TOKEN());
  const response = await fetch(url,{headers:{accept:"application/json"},signal:AbortSignal.timeout(12000)});
  const data = await response.json().catch(()=>({}));
  if (!response.ok) throw new Error("Adressevælger HTTP "+response.status);
  if (data.status && data.status !== "ok") throw new Error(data.beskrivelse || "Adressevælgerens søgning fejlede");
  return Array.isArray(data.fund) ? data.fund : [];
}
function normalize(hit, origin) {
  const type=String(hit.type||"").toLowerCase();
  const labels={adresse:"Præcis adresse",husnummer:"Husnummer",navngivenvejpostnummer:"Vej og postnummer",vejnavn:"Vejnavn",vejnavnhusnummer:"Muligt husnummer"};
  const label=hit.titel||hit.adgangsadressebetegnelse||hit.adressebetegnelse||[hit.vejnavn,hit.husnummer,hit.postnr,hit.postdistrikt].filter(Boolean).join(" ");
  const detail=[];
  if(hit.postnr&&hit.postdistrikt)detail.push(hit.postnr+" "+hit.postdistrikt);
  else if(hit.postdistrikt)detail.push(hit.postdistrikt);
  if(hit.antal_husnumre!=null)detail.push(hit.antal_husnumre+" husnumre på vejen");
  if(type==="vejnavn")detail.push("Tilføj husnummer og postnummer for et præcist opslag");
  if(type==="vejnavnhusnummer")detail.push("Ikke entydig endnu · tilføj postnummer/by");
  const specific=type==="adresse"||type==="husnummer";
  return {id:hit.id||null,type,label:String(label||""),detail:detail.join(" · "),kindLabel:labels[type]||"Søgeforslag",source:"official-dar",husnummerId:hit.husnummerId||hit.husnummerid||null,vejnavn:hit.vejnavn||hit.vejNavn||null,husnummer:hit.husnummer||hit.husNummer||null,postnr:hit.postnr||null,postdistrikt:hit.postdistrikt||null,antal_husnumre:hit.antal_husnumre==null?null:Number(hit.antal_husnumre),specific,origin};
}
function score(hit,q) {
  const clean=x=>String(x||"").toLocaleLowerCase("da").replace(/[.,]/g," ").replace(/\\s+/g," ").trim();
  const query=clean(q),label=clean(hit.label);let n=0;
  if(label===query)n+=100;else if(label.startsWith(query))n+=35;else if(label.includes(query))n+=15;
  if(hit.type==="adresse")n+=26;else if(hit.type==="husnummer")n+=20;else if(hit.type==="navngivenvejpostnummer")n+=3;
  const zip=query.match(/\\b\\d{4}\\b/);if(zip&&hit.postnr===zip[0])n+=25;
  if(hit.specific)n+=10;return n;
}
export default async function handler(req,res) {
  if(req.method!=="GET"){res.setHeader("Allow","GET");return res.status(405).json({error:"Method not allowed"});}
  const q=String(req.query.q||"").trim();
  if(q.length<2||q.length>73)return res.status(400).json({error:"Skriv mindst 2 tegn og højst 73 tegn."});
  try {
    const [addressResults,houseResults]=await Promise.allSettled([
      requestSearch("/adresser/soeg/",{tekst:q},20),
      requestSearch("/husnumre/soeg/",{tekst:q},20)
    ]);
    const raw=[];const errors=[];
    if(addressResults.status==="fulfilled")raw.push(...addressResults.value.map(x=>normalize(x,"adresser/soeg")));else errors.push("Adresse: "+String(addressResults.reason?.message||"fejl").slice(0,100));
    if(houseResults.status==="fulfilled")raw.push(...houseResults.value.map(x=>normalize(x,"husnumre/soeg")));else errors.push("Husnummer: "+String(houseResults.reason?.message||"fejl").slice(0,100));
    // If the input only identifies a road + postcode, expand that choice into actual house-number suggestions.
    const broad=raw.filter(x=>x.type==="navngivenvejpostnummer"&&x.vejnavn&&x.postnr).slice(0,3);
    const expanded=await Promise.allSettled(broad.map(async road=>({road,hits:await requestSearch("/husnumre/soeg/",{vejnavn:road.vejnavn,postnummer:road.postnr},12)})));
    for(const result of expanded){
      if(result.status==="fulfilled")raw.push(...result.value.hits.map(x=>normalize(x,"vejnavn+postnummer")));
    }
    const unique=new Map();
    for(const hit of raw){
      if(!hit.label)continue;
      const key=(hit.id||hit.label)+"|"+hit.type;
      const current=unique.get(key);if(!current||score(hit,q)>score(current,q))unique.set(key,hit);
    }
    const fund=[...unique.values()].sort((a,b)=>score(b,q)-score(a,q)||a.label.localeCompare(b.label,"da")).slice(0,14);
    if(addressResults.status!=="fulfilled"&&houseResults.status!=="fulfilled")return res.status(502).json({error:"Begge officielle adresseopslag fejlede.",details:errors});
    res.setHeader("Cache-Control","public, max-age=25");
    return res.status(200).json({status:"ok",query:q,fund,partial:errors.length>0,details:errors,source:"Klimadatastyrelsens Adressevælger",hint:fund.some(x=>x.type==="adresse"||x.type==="husnummer")?"Vælg det præcise husnummer/adresse. Tilføj postnummer eller by, hvis flere ligner hinanden.":"Skriv vejnavn + husnummer + postnummer for at indsnævre resultaterne."});
  } catch(error) {
    return res.status(502).json({error:"Kunne ikke kontakte Klimadatastyrelsens Adressevælger.",detail:String(error.message||"").slice(0,200)});
  }
}