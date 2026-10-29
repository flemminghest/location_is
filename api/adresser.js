export default async function handler(req,res){
 if(req.method!=="GET"){res.setHeader("Allow","GET");return res.status(405).json({error:"Method not allowed"});}
 const q=String(req.query.q||"").trim();if(q.length<2||q.length>120)return res.status(400).json({error:"Søgningen skal være 2–120 tegn."});
 try{
  const url=new URL("https://adressevaelger.dk/husnumre/soeg/");url.searchParams.set("tekst",q);url.searchParams.set("maksimum","10");url.searchParams.set("token",process.env.ADRESSEVAELGER_TOKEN||"adressevaelger123");
  const upstream=await fetch(url,{headers:{accept:"application/json"},signal:AbortSignal.timeout(12000)});
  if(!upstream.ok)return res.status(502).json({error:"Adressevælgeren svarede ikke som forventet.",providerStatus:upstream.status});
  const data=await upstream.json();if(data.status&&data.status!=="ok")return res.status(502).json({error:"Adressevælgeren kunne ikke gennemføre søgningen.",detail:String(data.beskrivelse||"").slice(0,200)});
  res.setHeader("Cache-Control","public, max-age=45");return res.status(200).json(data);
 }catch{return res.status(502).json({error:"Kunne ikke kontakte Klimadatastyrelsens Adressevælger."});}
}