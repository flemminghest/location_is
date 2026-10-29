const BASE = "https://adressevaelger.dk";
const TOKEN = () => process.env.ADRESSEVAELGER_TOKEN || "adressevaelger123";

function normalized(value){
  return String(value||"").toLocaleLowerCase("da-DK").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[.,]/g," ").replace(/\s+/g," ").trim();
}
async function requestSearch(path, params, limit=40) {
  const url = new URL(path, BASE);
  for (const [key,value] of Object.entries(params)) {
    if (value !== undefined && value !== null && String(value) !== "") url.searchParams.set(key,String(value));
  }
  url.searchParams.set("maksimum",String(Math.min(200,limit)));
  url.searchParams.set("token",TOKEN());
  const response = await fetch(url,{headers:{accept:"application/json"},signal:AbortSignal.timeout(4500)});
  const data = await response.json().catch(()=>({}));
  if (!response.ok) throw new Error("Adressevælger HTTP "+response.status);
  if (data.status && data.status !== "ok") throw new Error(data.beskrivelse || "Adressevælgerens søgning fejlede");
  return Array.isArray(data.fund) ? data.fund : [];
}
async function requestAddressWash(address) {
  const url=new URL("/vask/",BASE);
  url.searchParams.set("adresse",String(address||"").trim());
  url.searchParams.set("token",TOKEN());
  const response=await fetch(url,{headers:{accept:"application/json"},signal:AbortSignal.timeout(4500)});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error("Adressevask HTTP "+response.status);
  if(data.status&&data.status!=="ok")throw new Error(data.beskrivelse||"Adressevask fejlede");
  const result=data.vaskeresultat||{};
  // Only exact current matches are accepted for automatic property lookup.
  if(Number(data.vaskestatus?.kode)!==1000||!result.adresse_id_lokalid||!result.adressebetegnelse)return [];
  return [{
    id:result.adresse_id_lokalid,type:"adresse",label:result.adressebetegnelse,
    adressebetegnelse:result.adressebetegnelse,postnr:result.adressebetegnelse.match(/(?:,\s*|\s)(\d{4})\s/)?.[1]||null,
    postdistrikt:result.adressebetegnelse.match(/\d{4}\s+(.+)$/)?.[1]||null,
    matchCode:1000,matchText:data.vaskestatus.tekst||"Eksakt match",origin:"address-wash"
  }];
}

const GRAPHQL_ENDPOINT=process.env.DATAFORDELER_GRAPHQL_URL||"https://graphql.datafordeler.dk/flexible/v3";
function rootQuery(type, now, where, nodes){
 const args='first:10, registreringstid:"'+now+'", virkningstid:"'+now+'"'+(where?', where:{'+where+'}':'');
 return 'query { '+type+'('+args+') { nodes { '+nodes+' } } }';
}
async function requestExactHouseFromDar(parsed){
 const key=process.env.DATAFORDELER_API_KEY;
 if(!key)return [];
 const designation=[parsed.vejnavn,parsed.husnummer].filter(Boolean).join(" ")+", "+parsed.postnummer+(parsed.postdistrikt?" "+parsed.postdistrikt:"");
 const escape=v=>String(v).replace(/\\/g,"\\\\").replace(/"/g,'\\"');
 const now=new Date().toISOString();
 const where='adgangsadressebetegnelse:{eq:"'+escape(designation)+'"},status:{in:["2","3"]}';
 const query=rootQuery("DAR_Husnummer",now,where,"id_lokalId adgangsadressebetegnelse husnummertekst status adgangTilBygning jordstykke placeretPaaForeloebigtJordstykke");
 const url=new URL(GRAPHQL_ENDPOINT);url.searchParams.set("apiKey",key);
 const response=await fetch(url,{method:"POST",headers:{"content-type":"application/json",accept:"application/json"},body:JSON.stringify({query}),signal:AbortSignal.timeout(4500)});
 const payload=await response.json().catch(()=>({}));
 const errors=(payload.errors||[]).map(x=>x.message).join("; ");
 if(!response.ok||errors)throw new Error(errors||"Datafordeler DAR HTTP "+response.status);
 const nodes=payload.data?.DAR_Husnummer?.nodes;
 if(!Array.isArray(nodes))throw new Error("DAR returnerede ikke en husnummerliste");
 return nodes.map(node=>{
  const label=node.adgangsadressebetegnelse||designation;
  const zip=label.match(/(?:,\s*|\s)(\d{4})\s/)?.[1]||parsed.postnummer;
  const town=label.match(/\d{4}\s+(.+)$/)?.[1]||parsed.postdistrikt||"";
  return {id:node.id_lokalId,type:"husnummer",label,detail:[zip,town].filter(Boolean).join(" "),
    kindLabel:"Verificeret i DAR",source:"official-dar",origin:"Datafordeler DAR GraphQL",
    husnummerId:node.id_lokalId,vejnavn:parsed.vejnavn,husnummer:node.husnummertekst||parsed.husnummer,
    postnr:zip,postdistrikt:town,specific:true,properties:node};
 });
}
function normalize(hit, origin) {
  const type=String(hit.type||"").toLowerCase();
  const label=String(hit.titel||hit.adgangsadressebetegnelse||hit.adressebetegnelse||[hit.vejnavn||hit.vejNavn,hit.husnummer||hit.husNummer||hit.husnummertekst,hit.postnr,hit.postdistrikt].filter(Boolean).join(" ")||"").trim();
  const postcodeMatch=label.match(/(?:,\s*|\s)(\d{4})\s+([^,]+)\s*$/);
  const postnr=String(hit.postnr||postcodeMatch?.[1]||"");
  const postdistrikt=String(hit.postdistrikt||postcodeMatch?.[2]||"");
  let vejnavn=hit.vejnavn||hit.vejNavn||null;
  let husnummer=hit.husnummer||hit.husNummer||hit.husnummertekst||null;
  if(!vejnavn){
    const m=label.match(/^(.+?)\s+(\d+[a-zA-Z]?)\s*(?:,|\s+\d{4}\s)/);
    if(m){vejnavn=m[1].trim();if(!husnummer)husnummer=m[2];}
  }
  const detail=[];
  if(postnr&&postdistrikt)detail.push(postnr+" "+postdistrikt);
  if(hit.antal_husnumre!=null)detail.push(hit.antal_husnumre+" husnumre på vejen");
  if(type==="vejnavn")detail.push("Tilføj husnummer og postnummer");
  const labels={adresse:"Præcis adresse",husnummer:"Husnummer",navngivenvejpostnummer:"Vej og postnummer",navngivenvejpostnummerdel:"Vej og postnummer",vejnavn:"Vejnavn",vejnavnhusnummer:"Muligt husnummer"};
  return {
    id:hit.id||hit.adresse_id_lokalid||null,type,label,
    detail:detail.join(" · "),kindLabel:labels[type]||"Søgeforslag",source:"official-dar",
    husnummerId:hit.husnummerId||hit.husnummerid||hit.husnummer_id||null,
    vejnavn,husnummer,postnr:postnr||null,postdistrikt:postdistrikt||null,
    etage:hit.etage||hit.etagebetegnelse||null,doer:hit.doer||hit.dør||hit.doerbetegnelse||null,
    antal_husnumre:hit.antal_husnumre==null?null:Number(hit.antal_husnumre),
    specific:type==="adresse"||type==="husnummer",origin,properties:hit
  };
}
function parseAddressQuery(q){
 const s=String(q||"").trim();
 const m=s.match(/^(.+?)\s+(\d+[a-zA-Z]?(?:\s*[-/]\s*\d+[a-zA-Z]?)?)\s*,?\s+(\d{4})(?:\s+(.+))?$/);
 if(!m)return null;
 return {vejnavn:m[1].trim(),husnummer:m[2].replace(/\s+/g,""),postnummer:m[3],postdistrikt:m[4]?.trim()||null};
}
function filterStrict(items, postcode, city){
 let output=items;
 if(postcode)output=output.filter(x=>String(x.postnr||"")===String(postcode));
 if(city)output=output.filter(x=>normalized(x.postdistrikt)===normalized(city));
 return output;
}
function sortAndDedupe(raw,q){
 const map=new Map();
 for(const hit of raw){
  if(!hit.label||!hit.id)continue;
  const key=String(hit.id)+"|"+String(hit.type);
  if(!map.has(key))map.set(key,hit);
 }
 const query=normalized(q);
 return [...map.values()].sort((a,b)=>{
  const aLabel=normalized(a.label),bLabel=normalized(b.label);
  const aScore=(aLabel===query?100:0)+(a.type==="adresse"?12:a.type==="husnummer"?10:0);
  const bScore=(bLabel===query?100:0)+(b.type==="adresse"?12:b.type==="husnummer"?10:0);
  return bScore-aScore||a.label.localeCompare(b.label,"da",{numeric:true,sensitivity:"base"});
 });
}
export default async function handler(req,res) {
  if(req.method!=="GET"){res.setHeader("Allow","GET");return res.status(405).json({error:"Method not allowed"});}
  const q=String(req.query.q||"").trim();
  const vejnavn=String(req.query.vejnavn||"").trim();
  const husnummer=String(req.query.husnummer||"").trim();
  const postnummer=String(req.query.postnummer||"").trim();
  const by=String(req.query.by||req.query.postdistrikt||"").trim();
  const etage=String(req.query.etage||"").trim();
  const doer=String(req.query.doer||"").trim();
  const structured=Boolean(vejnavn||husnummer||postnummer||etage||doer||by);
  if(postnummer&&!/^\d{4}$/.test(postnummer))return res.status(400).json({error:"Postnummer skal bestå af fire cifre."});
  if(structured&&postnummer&&!vejnavn&&!q)return res.status(200).json({status:"ok",query:q,fund:[],requiresStreet:true,scopedToPostcode:postnummer,hint:"Postnummeret er verificeret. Skriv gadenavn for at hente adresser inden for postnummeret."});
  if(!structured&&(q.length<2||q.length>73))return res.status(400).json({error:"Skriv mindst 2 tegn og højst 73 tegn."});
  try {
    let raw=[],errors=[];
    if(structured){
      if(!vejnavn&&q){
        // The visible one-field search remains usable even with a geographic filter selected.
        const results=await Promise.allSettled([
          requestSearch("/adresser/soeg/",{tekst:q},40).then(hits=>hits.map(x=>normalize(x,"filtered-text-address"))),
          requestSearch("/husnumre/soeg/",{tekst:q},40).then(hits=>hits.map(x=>normalize(x,"filtered-text-house")))
        ]);
        for(const result of results){
          if(result.status==="fulfilled")raw.push(...result.value);
          else errors.push(String(result.reason?.message||"adresseopslag fejlede").slice(0,150));
        }
      }else if(vejnavn){
        const searchText=[vejnavn,husnummer,postnummer,by].filter(Boolean).join(" ");
        const parsedStreet=husnummer&&postnummer?{vejnavn,husnummer,postnummer,postdistrikt:by||null}:null;
        const paths=(etage||doer)?["/adresser/soeg/"]:(husnummer?["/husnumre/soeg/","/adresser/soeg/"]:["/husnumre/soeg/"]);
        const results=await Promise.allSettled([
          ...(parsedStreet?[requestExactHouseFromDar(parsedStreet)]:[]),
          ...paths.map(path=>requestSearch(path,{tekst:searchText},50).then(hits=>hits.map(x=>normalize(x,path.includes("adresser")?"structured-address":"structured-house"))))
        ]);
        for(const result of results){
          if(result.status==="fulfilled")raw.push(...result.value);
          else errors.push(String(result.reason?.message||"adresseopslag fejlede").slice(0,180));
        }
      }else{
        return res.status(200).json({status:"ok",query:q,fund:[],scopedToPostcode:postnummer||null,hint:"Skriv en adresse eller et gadenavn, så søgningen kan afgrænses."});
      }
      raw=filterStrict(raw,postnummer,by);
      const fund=sortAndDedupe(raw,q||[vejnavn,husnummer,postnummer,by,etage,doer].filter(Boolean).join(" ")).slice(0,100);
      if(!fund.length&&errors.length&&raw.length===0)return res.status(502).json({error:"Den officielle adressekilde kunne ikke svare inden for tidsgrænsen.",details:errors,scopedToPostcode:postnummer||null});
      res.setHeader("Cache-Control","private, max-age=15");
      return res.status(200).json({
        status:"ok",query:q,fund,partial:errors.length>0,details:errors,
        source:"Klimadatastyrelsens Adressevælger",scopedToPostcode:postnummer||null,
        hint:fund.length?"Officielle adresseforslag inden for det valgte postnummer.":"Ingen match i det valgte postnummer. Kontrollér gadenavn, husnummer, etage og dør."
      });
    }

    const parsed=parseAddressQuery(q);
    if(parsed){
      const results=await Promise.allSettled([
        requestExactHouseFromDar(parsed),
        requestSearch("/husnumre/soeg/",{tekst:q},40).then(hits=>hits.map(x=>normalize(x,"structured-house"))),
        requestSearch("/adresser/soeg/",{tekst:q},40).then(hits=>hits.map(x=>normalize(x,"structured-address"))),
        requestAddressWash(q)
      ]);
      for(const result of results){
        if(result.status==="fulfilled")raw.push(...result.value);
        else errors.push(String(result.reason?.message||"adresseopslag fejlede").slice(0,180));
      }
      raw=filterStrict(raw,parsed.postnummer,parsed.postdistrikt);
    }else{
      const results=await Promise.allSettled([
        requestSearch("/adresser/soeg/",{tekst:q},40).then(hits=>hits.map(x=>normalize(x,"text-address"))),
        requestSearch("/husnumre/soeg/",{tekst:q},40).then(hits=>hits.map(x=>normalize(x,"text-house")))
      ]);
      for(const result of results){
        if(result.status==="fulfilled")raw.push(...result.value);
        else errors.push(String(result.reason?.message||"adresseopslag fejlede").slice(0,150));
      }
    }
    const fund=sortAndDedupe(raw,q).slice(0,60);
    if(!fund.length&&errors.length>=(parsed?4:2))return res.status(502).json({error:"Alle tilgængelige adresseopslag fejlede inden for tidsgrænsen.",details:errors});
    res.setHeader("Cache-Control","private, max-age=15");
    return res.status(200).json({status:"ok",query:q,fund,partial:errors.length>0,details:errors,source:"Klimadatastyrelsens Adressevælger",hint:fund.length?"Vælg en præcis officiel adresse eller et husnummer.":"Ingen adresse fundet; kontrollér stavning og postnummer."});
  }catch(error){
    return res.status(502).json({error:"Kunne ikke kontakte Klimadatastyrelsens Adressevælger.",detail:String(error.message||"").slice(0,200)});
  }
}