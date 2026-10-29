export default async function handler(req,res){
 if(req.method!=="GET"){res.setHeader("Allow","GET");return res.status(405).json({error:"Method not allowed"});}
 const q=String(req.query.q||"").trim();
 if(q.length<2||q.length>73)return res.status(400).json({error:"Søgningen skal være 2–73 tegn."});
 try{
  const url=new URL("https://adressevaelger.dk/adresser/soeg");
  url.searchParams.set("tekst",q);
  url.searchParams.set("maksimum","10");
  url.searchParams.set("token",process.env.ADRESSEVAELGER_TOKEN||"adressevaelger123");
  const response=await fetch(url,{headers:{accept:"application/json"},signal:AbortSignal.timeout(12000)});
  if(!response.ok)return res.status(502).json({error:"Adressevælgeren svarede ikke som forventet.",providerStatus:response.status});
  const data=await response.json();
  res.setHeader("Cache-Control","public, max-age=60");
  return res.status(200).json(data);
 }catch(error){return res.status(502).json({error:"Kunne ikke kontakte Klimadatastyrelsens Adressevælger."});}
}
