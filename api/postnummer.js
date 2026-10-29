const KDS="https://adressevaelger.dk";
const TOKEN=()=>process.env.ADRESSEVAELGER_TOKEN||"adressevaelger123";
const ENDPOINT=process.env.DATAFORDELER_GRAPHQL_URL||"https://graphql.datafordeler.dk/flexible/v3";
function normalized(v){return String(v||"").toLocaleLowerCase("da-DK").normalize("NFD").replace(/[\u0300-\u036f]/g,"").trim();}
function escapeGraphQL(v){return String(v).replace(/\\/g,"\\\\").replace(/"/g,'\\"');}
async function queryPublicPostnummer(query){
 const code=String(query||"").trim();
 const urls=[];
 if(/^\\d{4}$/.test(code)){
  urls.push(new URL("https://api.dataforsyningen.dk/postnumre?nr="+encodeURIComponent(code)));
  urls.push(new URL("https://api.dataforsyningen.dk/postnumre/"+encodeURIComponent(code)));
 }else{
  urls.push(new URL("https://api.dataforsyningen.dk/postnumre?navn_startswith="+encodeURIComponent(code)));
 }
 const settled=await Promise.allSettled(urls.map(async url=>{
  const response=await fetch(url,{headers:{accept:"application/json"},signal:AbortSignal.timeout(4000),cache:"no-store"});
  const payload=await response.json().catch(()=>null);
  if(!response.ok)throw new Error("Dataforsyningen HTTP "+response.status);
  const rows=Array.isArray(payload)?payload:(payload&&typeof payload==="object"?[payload]:[]);
  return rows.map(x=>({nr:String(x.nr||""),navn:String(x.navn||x.postdistrikt||"").trim(),source:"Dataforsyningen postnumre"}))
   .filter(x=>/^\\d{4}$/.test(x.nr)&&x.navn&&(/^\\d{4}$/.test(code)?x.nr===code:normalized(x.navn).startsWith(normalized(code))));
 }));
 for(const item of settled){
  if(item.status==="fulfilled"&&item.value.length)return item.value;
 }
 const errors=settled.filter(x=>x.status==="rejected").map(x=>String(x.reason?.message||"Dataforsyningen fejlede"));
 throw new Error(errors.join("; ")||"Dataforsyningen returnerede intet match");
}
async function queryPostnummer(query){
 const key=process.env.DATAFORDELER_API_KEY;
 if(!key)throw new Error("DATAFORDELER_API_KEY mangler");
 const now=new Date().toISOString();
 const isNumber=/^\d{4}$/.test(query);
 const variants=isNumber?[query]:[query.charAt(0).toLocaleUpperCase("da")+query.slice(1),query];
 const distinct=[...new Set(variants.map(x=>x.trim()).filter(Boolean))];
 const tasks=distinct.map(value=>{
  const where=isNumber?'postnr:{eq:"'+escapeGraphQL(value)+'"}':'navn:{startsWith:"'+escapeGraphQL(value)+'"}';
  const gql='query { DAR_Postnummer(first:100, registreringstid:"'+now+'", virkningstid:"'+now+'", where:{'+where+'}) { nodes { id_lokalId postnr navn } } }';
  const url=new URL(ENDPOINT);url.searchParams.set("apiKey",key);
  return fetch(url,{method:"POST",headers:{"content-type":"application/json",accept:"application/json"},body:JSON.stringify({query:gql}),signal:AbortSignal.timeout(3500)})
   .then(async response=>{
    const payload=await response.json().catch(()=>({}));
    const errors=(payload.errors||[]).map(x=>x.message).join("; ");
    if(!response.ok||errors)throw new Error(errors||"DAR_Postnummer HTTP "+response.status);
    const nodes=payload.data?.DAR_Postnummer?.nodes;
    if(!Array.isArray(nodes))throw new Error("DAR_Postnummer returnerede ikke en liste");
    return nodes.map(x=>({nr:String(x.postnr||""),navn:String(x.navn||"").trim(),id:x.id_lokalId||null,source:"Datafordeleren DAR_Postnummer"})).filter(x=>/^\d{4}$/.test(x.nr)&&x.navn);
   });
 });
 const settled=await Promise.allSettled(tasks);
 const values=settled.filter(x=>x.status==="fulfilled").flatMap(x=>x.value);
 const errors=settled.filter(x=>x.status==="rejected").map(x=>String(x.reason?.message||"GraphQL-fejl").slice(0,120));
 const unique=new Map();
 for(const item of values)if(!unique.has(item.nr))unique.set(item.nr,item);
 return {items:[...unique.values()],errors};
}
async function searchKds(query){
 const url=new URL("/husnumre/soeg/",KDS);
 url.searchParams.set("tekst",query);
 url.searchParams.set("maksimum","100");
 url.searchParams.set("token",TOKEN());
 const response=await fetch(url,{headers:{accept:"application/json"},signal:AbortSignal.timeout(3500)});
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw new Error("Adressevælger HTTP "+response.status);
 if(data.status&&data.status!=="ok")throw new Error(data.beskrivelse||"Adressevælger fejlede");
 const hits=Array.isArray(data.fund)?data.fund:[];
 const matches=hits.map(hit=>{
  const title=String(hit.titel||"");
  const postcode=String(hit.postnr||title.match(/(?:,\s*|\s)(\d{4})\s/)?.[1]||"");
  const city=String(hit.postdistrikt||title.match(/\d{4}\s+(.+)$/)?.[1]||"");
  return {nr:postcode,navn:city,source:"Klimadatastyrelsens Adressevælger"};
 }).filter(x=>/^\d{4}$/.test(x.nr)&&x.navn);
 const filtered=/^\d{4}$/.test(query)?matches.filter(x=>x.nr===query):matches.filter(x=>normalized(x.navn).includes(normalized(query)));
 const unique=new Map();
 for(const item of filtered)if(!unique.has(item.nr))unique.set(item.nr,item);
 return [...unique.values()];
}
export default async function handler(req,res){
 if(req.method!=="GET"){res.setHeader("Allow","GET");return res.status(405).json({ok:false,error:"Method not allowed"});}
 const nr=String(req.query.nr||"").trim(),q=String(req.query.q||"").trim(),query=nr||q;
 if(!query||query.length<2||query.length>60)return res.status(400).json({ok:false,error:"Angiv et postnummer på fire cifre eller et bynavn."});
 if(nr&&!/^\d{4}$/.test(nr))return res.status(400).json({ok:false,error:"Postnummer skal bestå af fire cifre."});
 let publicItems=[];
 let publicError="";
 if(nr){
  try{
   publicItems=await queryPublicPostnummer(nr);
   const exact=publicItems.find(item=>item.nr===nr&&item.navn);
   if(exact){
    res.setHeader("Cache-Control","public, s-maxage=86400, stale-while-revalidate=604800");
    return res.status(200).json({ok:true,...exact});
   }
  }catch(error){publicError=String(error?.message||error).slice(0,150);}
 }
 const [primary,secondary]=await Promise.allSettled([queryPostnummer(query),searchKds(query)]);
 const all=[...publicItems];let primaryErrors=publicError?[publicError]:[];
 if(primary.status==="fulfilled"){all.push(...primary.value.items);primaryErrors.push(...primary.value.errors);}
 else primaryErrors.push(String(primary.reason?.message||"DAR_Postnummer fejlede").slice(0,150));
 if(secondary.status==="fulfilled")all.push(...secondary.value);
 else primaryErrors.push(String(secondary.reason?.message||"Adressevælger fejlede").slice(0,150));
 const unique=new Map();
 for(const item of all){
  if(nr&&item.nr!==nr)continue;
  if(q&&!nr&&!normalized(item.navn).startsWith(normalized(q))&&!item.nr.startsWith(q))continue;
  if(!unique.has(item.nr))unique.set(item.nr,item);
 }
 const results=[...unique.values()].sort((a,b)=>a.nr.localeCompare(b.nr));
 if(nr){
  const found=results.find(x=>x.nr===nr);
  if(found){res.setHeader("Cache-Control","public, s-maxage=86400, stale-while-revalidate=604800");return res.status(200).json({ok:true,...found});}
 }else if(results.length){
  res.setHeader("Cache-Control","public, s-maxage=900, stale-while-revalidate=3600");
  return res.status(200).json({ok:true,results:results.slice(0,30),source:"Officielle postnummerkilder"});
 }
 res.setHeader("Cache-Control","no-store");
 return res.status(502).json({ok:false,error:"Postnummer/by kunne ikke verificeres hos de officielle kilder.",details:primaryErrors});
}