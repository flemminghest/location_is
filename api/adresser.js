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
async function requestAddressWash(address) {
  const variants=[String(address||"").trim(),String(address||"").replace(/,\s*/g," ").trim()];
  let lastError=null;
  for(const variant of [...new Set(variants)].filter(Boolean)){
    const url=new URL("/vask/",BASE);
    url.searchParams.set("adresse",variant);
    url.searchParams.set("token",TOKEN());
    try{
      const response=await fetch(url,{headers:{accept:"application/json"},signal:AbortSignal.timeout(10000)});
      const data=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error("Adressevask HTTP "+response.status);
      if(data.status&&data.status!=="ok")throw new Error(data.beskrivelse||"Adressevask fejlede");
      const result=data.vaskeresultat||{};
      const code=Number(data.vaskestatus?.kode);
      // Only accept a current register result with an ID and a positive validation code.
      if(result.adresse_id_lokalid&&result.adressebetegnelse&&Number.isFinite(code)&&code>0){
        return [{
          id:result.adresse_id_lokalid,
          type:"adresse",
          titel:result.adressebetegnelse,
          adressebetegnelse:result.adressebetegnelse,
          status:result.status,
          matchCode:code,
          matchText:data.vaskestatus?.tekst||"Adresse valideret",
          origin:"official-address-wash"
        }];
      }
      // If only a historical version matches, do not treat it as a current address.
      if(result.adresse_id_lokalid) return [];
    }catch(error){lastError=error;}
  }
  if(lastError)throw lastError;
  return [];
}

function normalize(hit, origin) {
  const type=String(hit.type||"").toLowerCase();
  const labels={adresse:"Præcis adresse",husnummer:"Husnummer",navngivenvejpostnummer:"Vej og postnummer",navngivenvejpostnummerdel:"Vej og postnummer",vejnavn:"Vejnavn",vejnavnhusnummer:"Muligt husnummer"};
  const label=hit.titel||hit.adgangsadressebetegnelse||hit.adressebetegnelse||[hit.vejnavn||hit.vejNavn,hit.husnummer||hit.husNummer,hit.postnr,hit.postdistrikt].filter(Boolean).join(" ");
  const detail=[];
  if(hit.postnr&&hit.postdistrikt)detail.push(hit.postnr+" "+hit.postdistrikt);
  else if(hit.postdistrikt)detail.push(hit.postdistrikt);
  if(hit.antal_husnumre!=null)detail.push(hit.antal_husnumre+" husnumre på vejen");
  if(type==="vejnavn")detail.push("Tilføj husnummer og postnummer for et præcist opslag");
  if(type==="navngivenvejpostnummerdel")detail.push("Vælg husnummer for et præcist opslag");
  if(type==="vejnavnhusnummer")detail.push("Ikke entydig endnu · tilføj postnummer/by");
  const specific=type==="adresse"||type==="husnummer";
  return {id:hit.id||null,type,label:String(label||""),detail:detail.join(" · "),kindLabel:labels[type]||"Søgeforslag",source:"official-dar",husnummerId:hit.husnummerId||hit.husnummerid||null,vejnavn:hit.vejnavn||hit.vejNavn||null,husnummer:hit.husnummer||hit.husNummer||null,postnr:hit.postnr||null,postdistrikt:hit.postdistrikt||null,antal_husnumre:hit.antal_husnumre==null?null:Number(hit.antal_husnumre),specific,origin};
}
function score(hit,q) {
  const clean=x=>String(x||"").toLocaleLowerCase("da").replace(/[.,]/g," ").replace(/\s+/g," ").trim();
  const query=clean(q),label=clean(hit.label);let n=0;
  if(label===query)n+=100;else if(label.startsWith(query))n+=35;else if(label.includes(query))n+=15;
  if(hit.type==="adresse")n+=30;else if(hit.type==="husnummer")n+=24;else if(hit.type==="navngivenvejpostnummer")n+=5;
  const zip=query.match(/\b\d{4}\b/);if(zip&&(hit.postnr===zip[0]||label.includes(zip[0])))n+=25;
  if(hit.specific)n+=10;return n;
}
function parseAddressQuery(q){
 const s=String(q||"").trim();
 // Common Danish form: street + number, then a four-digit postcode and optional city.
 const m=s.match(/^(.+?)\s+(\d+[a-zA-Z]?(?:\s*[-/]\s*\d+[a-zA-Z]?)?)\s*,?\s+(\d{4})(?:\s+(.+))?$/);
 if(!m)return null;
 return {vejnavn:m[1].trim(),husnummer:m[2].replace(/\s+/g,""),postnummer:m[3],postdistrikt:m[4]?.trim()||null};
}
export default async function handler(req,res) {
  if(req.method!=="GET"){res.setHeader("Allow","GET");return res.status(405).json({error:"Method not allowed"});}
  const q=String(req.query.q||"").trim();
  if(q.length<2||q.length>73)return res.status(400).json({error:"Skriv mindst 2 tegn og højst 73 tegn."});
  try {
    const parsed=parseAddressQuery(q);
    const tasks=[
      requestSearch("/adresser/soeg/",{tekst:q},30).then(hits=>({kind:"address-text",hits})),
      requestSearch("/husnumre/soeg/",{tekst:q},30).then(hits=>({kind:"house-text",hits}))
    ];
    // Structured search is more reliable for an exact Danish street + number + postcode query.
    if(parsed){
      tasks.push(requestSearch("/husnumre/soeg/",{vejnavn:parsed.vejnavn,husnummer:parsed.husnummer,postnummer:parsed.postnummer},30).then(hits=>({kind:"house-structured",hits})));
      tasks.push(requestSearch("/adresser/soeg/",{vejnavn:parsed.vejnavn,husnummer:parsed.husnummer,postnummer:parsed.postnummer},30).then(hits=>({kind:"address-structured",hits})));
    }
    if(parsed){
      tasks.push(requestAddressWash(q).then(hits=>({kind:"address-wash",hits})));
    }
    const searchResults=await Promise.allSettled(tasks);
    const raw=[];const errors=[];
    for(const result of searchResults){
      if(result.status==="fulfilled")raw.push(...result.value.hits.map(x=>normalize(x,result.value.kind)));
      else errors.push(String(result.reason?.message||"adresseopslag fejlede").slice(0,120));
    }
    // If a result only identifies a road + postcode, expand it to actual house numbers.
    const broad=parsed?[]:raw.filter(x=>(x.type==="navngivenvejpostnummer"||x.type==="navngivenvejpostnummerdel")&&x.vejnavn&&x.postnr).slice(0,4);
    const expanded=await Promise.allSettled(broad.map(async road=>({road,hits:await requestSearch("/husnumre/soeg/",{vejnavn:road.vejnavn,postnummer:road.postnr},20)})));
    for(const result of expanded){
      if(result.status==="fulfilled")raw.push(...result.value.hits.map(x=>normalize(x,"vejnavn+postnummer")));
      else errors.push(String(result.reason?.message||"vej/postnummer-opslag fejlede").slice(0,100));
    }
    if(parsed){
      const exactLabel=raw.filter(x=>["adresse","husnummer"].includes(x.type)&&x.label&&x.label.toLocaleLowerCase("da").includes(parsed.vejnavn.toLocaleLowerCase("da"))&&String(x.husnummer||"")===parsed.husnummer);
      for(const hit of exactLabel){if(!hit.postnr){hit.postnr=parsed.postnummer;hit.postdistrikt=parsed.postdistrikt||hit.postdistrikt;}}
    }
    const unique=new Map();
    for(const hit of raw){
      if(!hit.label)continue;
      const key=(hit.id||hit.label)+"|"+hit.type;
      const current=unique.get(key);if(!current||score(hit,q)>score(current,q))unique.set(key,hit);
    }
    const fund=[...unique.values()].sort((a,b)=>score(b,q)-score(a,q)||a.label.localeCompare(b.label,"da")).slice(0,14);
    if(searchResults.every(result=>result.status!=="fulfilled"))return res.status(502).json({error:"Begge officielle adresseopslag fejlede.",details:errors});
    res.setHeader("Cache-Control","public, max-age=25");
    return res.status(200).json({status:"ok",query:q,fund,partial:errors.length>0,details:errors,source:"Klimadatastyrelsens Adressevælger",hint:fund.some(x=>x.type==="adresse"||x.type==="husnummer")?"Vælg det præcise husnummer/adresse. Tilføj postnummer eller by, hvis flere ligner hinanden.":"Skriv vejnavn + husnummer + postnummer for at indsnævre resultaterne."});
  } catch(error) {
    return res.status(502).json({error:"Kunne ikke kontakte Klimadatastyrelsens Adressevælger.",detail:String(error.message||"").slice(0,200)});
  }
}