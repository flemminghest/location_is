const DAWA = "https://api.dataforsyningen.dk/postnumre";
const KDS = "https://adressevaelger.dk";
const TOKEN = () => process.env.ADRESSEVAELGER_TOKEN || "adressevaelger123";

function resultFor(list,nr){
  const item=(Array.isArray(list)?list:[]).find(x=>String(x.nr||x.postnr||x.postnummer||"")===String(nr));
  if(!item)return null;
  return {nr:String(item.nr||item.postnr||item.postnummer),navn:String(item.navn||item.postnummernavn||item.postdistrikt||"").trim(),source:"Dataforsyningen / postnumre"};
}
export default async function handler(req,res){
  if(req.method!=="GET"){res.setHeader("Allow","GET");return res.status(405).json({error:"Method not allowed"});}
  const nr=String(req.query.nr||"").trim();
  if(!/^\d{4}$/.test(nr))return res.status(400).json({ok:false,error:"Postnummer skal bestå af fire cifre."});
  try{
    const url=new URL(DAWA);
    url.searchParams.set("nr",nr);
    url.searchParams.set("format","json");
    const response=await fetch(url,{headers:{accept:"application/json"},signal:AbortSignal.timeout(3000)});
    if(response.ok){
      const data=await response.json();
      const found=resultFor(data,nr);
      if(found?.navn){
        res.setHeader("Cache-Control","public, s-maxage=86400, stale-while-revalidate=604800");
        return res.status(200).json({ok:true,...found});
      }
    }
  }catch(error){/* try official current address selector below */}
  try{
    const url=new URL("/husnumre/soeg/",KDS);
    url.searchParams.set("tekst",nr);
    url.searchParams.set("maksimum","100");
    url.searchParams.set("token",TOKEN());
    const response=await fetch(url,{headers:{accept:"application/json"},signal:AbortSignal.timeout(3000)});
    const data=await response.json().catch(()=>({}));
    if(response.ok){
      const hits=Array.isArray(data.fund)?data.fund:[];
      const hit=hits.find(x=>String(x.postnr||"")===nr&&x.postdistrikt);
      if(hit){
        res.setHeader("Cache-Control","public, s-maxage=86400, stale-while-revalidate=604800");
        return res.status(200).json({ok:true,nr,navn:String(hit.postdistrikt),source:"Klimadatastyrelsens Adressevælger"});
      }
    }
  }catch(error){/* report a clean failure, never guess the city from the postal prefix */}
  res.setHeader("Cache-Control","no-store");
  return res.status(502).json({ok:false,error:"Postnummeret kunne ikke verificeres hos de officielle kilder."});
}