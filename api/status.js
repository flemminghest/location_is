export default async function handler(req,res){
 if(req.method!=="GET"){res.setHeader("Allow","GET");return res.status(405).json({error:"Method not allowed"});}
 const configured=Boolean(process.env.DATAFORDELER_API_KEY);
 if(!configured)return res.status(200).json({ok:true,configured:false,addressSearch:"Klimadatastyrelsens Adressevælger",dataApi:"not_configured",bbr:"needs_api_key",cadastral:"needs_api_key",instructions:"DATAFORDELER_API_KEY er ikke sat i Vercel Production."});
 try{
  const url=new URL(process.env.DATAFORDELER_GRAPHQL_URL||"https://graphql.datafordeler.dk/flexible/v3");url.searchParams.set("apiKey",process.env.DATAFORDELER_API_KEY);
  const query='query ByggeInfoConnectionCheck { dar: __type(name:"DAR_Husnummer") { name fields { name } } bbr: __type(name:"BBR_Bygning") { name fields { name } } mat: __type(name:"MAT_Jordstykke") { name fields { name } } }';
  const r=await fetch(url,{method:"POST",headers:{"content-type":"application/json",accept:"application/json"},body:JSON.stringify({query}),signal:AbortSignal.timeout(15000)});
  const d=await r.json().catch(()=>({}));const error=(d.errors||[]).map(x=>x.message).join("; ");const schema=d.data||{};
  const ok=r.ok&&!error&&Boolean(schema.dar?.name);
  return res.status(200).json({ok,configured:true,addressSearch:"Klimadatastyrelsens Adressevælger",dataApi:ok?"connected":"connection_error",bbr:schema.bbr?.name?"schema_available":"not_found",cadastral:schema.mat?.name?"schema_available":"not_found",provider:"Datafordeleren Flexible GraphQL v3",error:ok?undefined:(error||(!r.ok?"Datafordeleren HTTP "+r.status:"GraphQL-schemaet kunne ikke læses")),availableFields:ok?{DAR_Husnummer:(schema.dar.fields||[]).map(x=>x.name).filter(x=>["id_lokalId","adgangsadressebetegnelse","husnummertekst","adgangTilBygning","jordstykke","husnummerErPlaceretPaaJordstykke"].includes(x)),BBR_Bygning:(schema.bbr?.fields||[]).map(x=>x.name).filter(x=>/byg0(21|26|38|39|40|41|54)|husnummer|id_lokalId/i.test(x)),MAT_Jordstykke:(schema.mat?.fields||[]).map(x=>x.name).filter(x=>/matrikelnummer|areal|ejerlav|id_lokalId/i.test(x))}:undefined});
 }catch(e){return res.status(200).json({ok:false,configured:true,addressSearch:"Klimadatastyrelsens Adressevælger",dataApi:"connection_error",provider:"Datafordeleren Flexible GraphQL v3",error:String(e.message||"Forbindelsestest fejlede").slice(0,250)});}
}