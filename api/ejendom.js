const ENDPOINT=process.env.DATAFORDELER_GRAPHQL_URL||"https://graphql.datafordeler.dk/flexible/v3";
async function gql(query){
 const key=process.env.DATAFORDELER_API_KEY;
 if(!key){const e=new Error("DATAFORDELER_API_KEY mangler i serverens miljøvariabler.");e.status=503;throw e;}
 const url=new URL(ENDPOINT);url.searchParams.set("apiKey",key);
 const response=await fetch(url,{method:"POST",headers:{"content-type":"application/json",accept:"application/json"},body:JSON.stringify({query}),signal:AbortSignal.timeout(20000)});
 const payload=await response.json().catch(()=>({}));
 if(!response.ok||payload.errors?.length){const e=new Error((payload.errors||[]).map(x=>x.message).join("; ")||"Datafordeleren returnerede en fejl.");e.status=502;throw e;}
 return payload.data||{};
}
async function typeFields(type){const d=await gql(`query { __type(name:"${type}") { fields { name } } }`);return(d.__type?.fields||[]).map(x=>x.name);}
function pick(fields,wanted){return wanted.filter(x=>fields.includes(x));}
function selection(fields,wanted){const a=pick(fields,wanted);if(fields.includes("id_lokalId")&&!a.includes("id_lokalId"))a.unshift("id_lokalId");return a.length?a.join("\n"):"id_lokalId";}
function idArg(x){return String(x||"").trim();}
async function entityById(type,id,wanted,now){
 if(!id)return null;
 const fields=await typeFields(type);if(!fields.length)return null;
 const sel=selection(fields,wanted);
 const query=`query { ${type}(first:5,registreringstid:"${now}",virkningstid:"${now}",where:{id_lokalId:{eq:"${id}"}}){nodes{${sel}}} }`;
 const data=await gql(query);return data[type]?.nodes?.[0]||null;
}
export default async function handler(req,res){
 if(req.method!=="GET"){res.setHeader("Allow","GET");return res.status(405).json({error:"Method not allowed"});}
 const addressId=idArg(req.query.adresseId),houseId=idArg(req.query.husnummerId),bfe=idArg(req.query.bfe);
 if(!addressId&&!houseId&&!bfe)return res.status(400).json({error:"adresseId, husnummerId eller bfe er påkrævet."});
 for(const id of [addressId,houseId])if(id&&!/^[a-zA-Z0-9._-]{8,100}$/.test(id))return res.status(400).json({error:"Ugyldigt adresse-/husnummer-ID."});
 if(bfe&&!/^\d{1,20}$/.test(bfe))return res.status(400).json({error:"Ugyldigt BFE-nummer."});
 try{
  const now=new Date().toISOString();let address=null,house=null,bbr=null,cadastral=null;
  if(addressId){
   // The official model exposes the address-to-house-number relation; its ids then
   // point to BBR_Bygning and MAT_Jordstykke respectively.
   const addressFields=await typeFields("DAR_Adresse");
   const scalar=selection(addressFields,["id_lokalId","adressebetegnelse","status","virkningFra","virkningTil"]);
   const query=`query {
    DAR_Adresse(first:5,registreringstid:"${now}",virkningstid:"${now}",where:{id_lokalId:{eq:"${addressId}"}}){
     nodes{${scalar} adresseHarHusnummer { id_lokalId adgangsadressebetegnelse adgangTilBygning jordstykke }
     }
    }
   }`;
   const d=await gql(query);address=d.DAR_Adresse?.nodes?.[0]||null;house=address?.adresseHarHusnummer||null;
  } else if(houseId){
   const houseFields=await typeFields("DAR_Husnummer");
   const scalar=selection(houseFields,["id_lokalId","adgangsadressebetegnelse","husnummertekst","status","virkningFra","virkningTil"]);
   const query=`query {
    DAR_Husnummer(first:5,registreringstid:"${now}",virkningstid:"${now}",where:{id_lokalId:{eq:"${houseId}"}}){
     nodes{${scalar} adgangTilBygning jordstykke}
    }
   }`;
   const d=await gql(query);house=d.DAR_Husnummer?.nodes?.[0]||null;
  }
  const bbrId=house?.adgangTilBygning;
  const matId=house?.jordstykke;
  if(bbrId){
   bbr=await entityById("BBR_Bygning",String(bbrId),[
    "byg007Bygningsnummer","byg021BygningensAnvendelse","byg026Opfoerelsesaar",
    "byg027OmTilbygningsaar","byg030Vandforsyning","byg031Afloebsforhold",
    "byg032YdervaeggensMateriale","byg033Tagdaekningsmateriale","byg038SamletBygningsareal",
    "byg039BygningensSamledeBoligAreal","byg040BygningensSamledeErhvervsAreal",
    "byg041BebyggetAreal","byg042ArealIndbyggetGarage","byg043ArealIndbyggetCarport",
    "byg044ArealIndbyggetUdhus","byg048AndetAreal","byg054AntalEtager",
    "byg056Varmeinstallation","byg057Opvarmningsmiddel","byg094Revisionsdato","kommunekode","status"
   ],now);
  }
  if(matId){
   cadastral=await entityById("MAT_Jordstykke",String(matId),[
    "matrikelnummer","arealberegnet","areal","ejerlavLokalId","kommunekode",
    "status","registreringFra","virkningFra","datafordelerOpdateringstid"
   ],now);
  }
  if(bfe){
   const mf=await typeFields("MAT_SamletFastEjendom");
   const msel=selection(mf,["BFEnummer","ejerlavLokalId","kommunekode","status","datafordelerOpdateringstid","registreringFra","virkningFra"]);
   const d=await gql(`query { MAT_SamletFastEjendom(first:5,registreringstid:"${now}",virkningstid:"${now}",where:{BFEnummer:{eq:"${bfe}"}}){nodes{${msel}}} }`);
   cadastral=d.MAT_SamletFastEjendom?.nodes?.[0]||cadastral;
  }
  const ground=cadastral?.arealberegnet??cadastral?.areal??null;
  return res.status(200).json({
   source:"Datafordeleren GraphQL flexible/v3",fetchedAt:new Date().toISOString(),
   address:address?{id:address.id_lokalId,designation:address.adressebetegnelse||null}:null,
   house:house?{id:house.id_lokalId,designation:house.adgangsadressebetegnelse||null}:null,
   bbr,cadastral,areas:{groundArea:ground,footprint:bbr?.byg041BebyggetAreal??null,residentialArea:bbr?.byg039BygningensSamledeBoligAreal??null,buildingArea:bbr?.byg038SamletBygningsareal??null},
   completeness:{address:Boolean(address||house),bbr:Boolean(bbr),cadastral:Boolean(cadastral)},
   note:"Arealer vises kun hvis de officielle registre returnerer dem. Manglende data betyder ikke, at forholdet ikke findes."
  });
 }catch(error){
  return res.status(error.status||502).json({error:String(error.message||"Dataopslag fejlede").slice(0,600),source:"Datafordeleren",setup:!process.env.DATAFORDELER_API_KEY});
 }
}
