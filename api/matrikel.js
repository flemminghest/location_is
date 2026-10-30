export default async function handler(req,res){
 if(req.method!=="GET"){res.setHeader("Allow","GET");return res.status(405).json({error:"Method not allowed"});}
 const bfe=String(req.query.bfe||req.query.q||"").trim();
 if(!/^\d{1,20}$/.test(bfe))return res.status(400).json({error:"Indtast et numerisk BFE-nummer. Matrikelbetegnelse skal kombineres med ejerlav."});
 const key=process.env.DATAFORDELER_API_KEY;if(!key)return res.status(503).json({error:"DATAFORDELER_API_KEY mangler.",setup:true});
 try{
  const url=new URL(process.env.DATAFORDELER_GRAPHQL_URL||"https://graphql.datafordeler.dk/flexible/v3");url.searchParams.set("apiKey",key);
  const now=new Date().toISOString();
  const query=`query { MAT_SamletFastEjendom(first:5,registreringstid:"${now}",virkningstid:"${now}",where:{BFEnummer:{eq:${bfe}}}){nodes{id_lokalId BFEnummer senesteSagLokalId status registreringFra virkningFra}} }`;
  const r=await fetch(url,{method:"POST",headers:{"content-type":"application/json",accept:"application/json"},body:JSON.stringify({query}),signal:AbortSignal.timeout(20000)});
  const d=await r.json().catch(()=>({}));if(!r.ok||d.errors?.length)return res.status(502).json({error:(d.errors||[]).map(x=>x.message).join("; ")||"Datafordeleren MAT-fejl"});
  return res.status(200).json({source:"Datafordeleren/MAT",fetchedAt:new Date().toISOString(),results:d.data?.MAT_SamletFastEjendom?.nodes||[]});
 }catch{return res.status(502).json({error:"Kunne ikke kontakte Datafordeleren/MAT."});}
}
