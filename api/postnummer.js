const DAWA = "https://api.dataforsyningen.dk/postnumre";
const KDS = "https://adressevaelger.dk";
const TOKEN = () => process.env.ADRESSEVAELGER_TOKEN || "adressevaelger123";
function mapDawa(item){
  return {nr:String(item.nr||""),navn:String(item.navn||"").trim(),source:"DAWA / Dataforsyningen"};
}
function mapKds(list,q){
  const out=[];
  for(const hit of Array.isArray(list)?list:[]){
    const nr=String(hit.postnr||"").trim(),navn=String(hit.postdistrikt||"").trim();
    if(/^\d{4}$/.test(nr)&&navn)out.push({nr,navn,source:"Klimadatastyrelsens Adressevælger"});
  }
  const seen=new Map();
  for(const item of out)if(!seen.has(item.nr))seen.set(item.nr,item);
  return [...seen.values()].sort((a,b)=>a.nr.localeCompare(b.nr));
}
async function dawaSearch(query){
  const url=new URL(DAWA);
  if(/^\d{4}$/.test(query))url.searchParams.set("nr",query);
  else url.searchParams.set("q",query);
  url.searchParams.set("format","json");
  url.searchParams.set("per_side","20");
  const response=await fetch(url,{headers:{accept:"application/json"},signal:AbortSignal.timeout(2800)});
  if(!response.ok)throw new Error("Postnummerkilde HTTP "+response.status);
  const data=await response.json();
  return (Array.isArray(data)?data:[]).map(mapDawa).filter(x=>/^\d{4}$/.test(x.nr)&&x.navn);
}
async function kdsSearch(query){
  const url=new URL("/husnumre/soeg/",KDS);
  url.searchParams.set("tekst",query);
  url.searchParams.set("maksimum","100");
  url.searchParams.set("token",TOKEN());
  const response=await fetch(url,{headers:{accept:"application/json"},signal:AbortSignal.timeout(2800)});
  if(!response.ok)throw new Error("Adressevælger HTTP "+response.status);
  const data=await response.json().catch(()=>({}));
  if(data.status&&data.status!=="ok")throw new Error(data.beskrivelse||"Adressevælger fejlede");
  return mapKds(data.fund,query);
}
export default async function handler(req,res){
  if(req.method!=="GET"){res.setHeader("Allow","GET");return res.status(405).json({ok:false,error:"Method not allowed"});}
  const nr=String(req.query.nr||"").trim(),q=String(req.query.q||"").trim();
  const query=nr||q;
  if(!query||query.length<2||query.length>60)return res.status(400).json({ok:false,error:"Angiv et postnummer på fire cifre eller et bynavn."});
  if(nr&&!/^\d{4}$/.test(nr))return res.status(400).json({ok:false,error:"Postnummer skal bestå af fire cifre."});
  const [dawa,kds]=await Promise.allSettled([dawaSearch(query),kdsSearch(query)]);
  const all=[];
  if(dawa.status==="fulfilled")all.push(...dawa.value);
  if(kds.status==="fulfilled")all.push(...kds.value);
  const unique=new Map();
  for(const item of all){
    if(nr&&item.nr!==nr)continue;
    const key=item.nr;
    if(!unique.has(key)||(!unique.get(key).navn&&item.navn))unique.set(key,item);
  }
  const results=[...unique.values()].filter(x=>x.navn&&(!q||String(x.navn).toLocaleLowerCase("da").includes(q.toLocaleLowerCase("da"))||x.nr.startsWith(q))).sort((a,b)=>a.nr.localeCompare(b.nr));
  if(nr){
    const item=results.find(x=>x.nr===nr);
    if(item){res.setHeader("Cache-Control","public, s-maxage=86400, stale-while-revalidate=604800");return res.status(200).json({ok:true,...item});}
  }else if(results.length){
    res.setHeader("Cache-Control","public, s-maxage=900, stale-while-revalidate=3600");
    return res.status(200).json({ok:true,results:results.slice(0,20),source:"Officielle postnummerkilder"});
  }
  res.setHeader("Cache-Control","no-store");
  return res.status(502).json({ok:false,error:"Postnummer/by kunne ikke verificeres hos de officielle kilder.",details:[dawa.status==="rejected"?"DAWA: "+String(dawa.reason?.message||"fejl").slice(0,100):null,kds.status==="rejected"?"Adressevælger: "+String(kds.reason?.message||"fejl").slice(0,100):null].filter(Boolean)});
}