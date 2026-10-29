const WFS = "https://geoserver.plandata.dk/geoserver/wfs";
// Current WFS names follow Plandata.dk change notice from 1 December 2025.
const LAYERS = {
  localPlans: "pdk:theme_pdk_lokalplan_vedtaget",
  subAreas: "pdk:theme_pdk_lokalplandelomraade_vedtaget",
  buildingFields: "pdk:theme_pdk_byggefelt_vedtaget",
  municipalFrames: "pdk:theme_pdk_kommuneplanramme_alle_vedtaget_v",
  zoneMap: "pdk:theme_pdk_zonekort_v",
  planProposals: "pdk:theme_pdk_lokalplan_forslag",
  repealedPlans: "pdk:theme_pdk_lokalplan_aflyst",
  planVersions: "pdk:theme_pdk_lokalplan_vedtaget_version"
};
async function fetchLayer(layer, bbox, count=25) {
  const url = new URL(WFS);
  url.searchParams.set("service","WFS");
  url.searchParams.set("version","2.0.0");
  url.searchParams.set("request","GetFeature");
  url.searchParams.set("typeNames",layer);
  url.searchParams.set("outputFormat","application/json");
  url.searchParams.set("count",String(count));
  url.searchParams.set("bbox",bbox);
  url.searchParams.set("srsName","EPSG:25832");
  const r = await fetch(url,{headers:{accept:"application/json"},signal:AbortSignal.timeout(5000)});
  if(!r.ok) throw new Error("Plandata WFS HTTP "+r.status);
  const data = await r.json();
  const features = Array.isArray(data.features)?data.features:[];
  return features.map(f=>({id:f.id||null,properties:f.properties||{},geometry:f.geometry||null}));
}
function getDate(p, keys) { for(const key of keys){const v=p?.[key];if(v!==undefined&&v!==null&&v!=="")return v;}return null; }
function sortDate(item) {
  const p=item.properties||{};
  return String(getDate(p,["datoikraft","datovedt","datoforsl","datoopdt","datoattr","datogeom","datooprt","datogstart","datostart"])||"");
}
function buildHistory(features) {
  const events=[];
  const seen=new Set();
  for(const item of features){
    const p=item.properties||{};
    const id=String(p.planid||p.plannr||item.id||"ukendt");
    const title=[p.plannr,p.plannavn].filter(Boolean).join(" · ")||"Lokalplan";
    const add=(date,label,detail)=>{
      if(!date)return;
      const key=[id,date,label].join("|");if(seen.has(key))return;seen.add(key);
      events.push({id,title,date:String(date),label,detail:detail||null,status:p.status||null,version:p.versionsnr||null,current:p.aktuel===true||p.aktuel==="true"||p.aktuel===1,documentUrl:p.doklink||p.dokumentUrl||null,planId:p.planid||null,planNumber:p.plannr||null,attributesUpdated:p.datoattr||null,geometryUpdated:p.datogeom||null});
    };
    add(getDate(p,["datoforsl"]), "Planforslag", "Registreret forslag til planlægning");
    add(getDate(p,["datostart"]), "Høring starter", "Høringsperiodens start");
    add(getDate(p,["datoslut"]), "Høring afsluttes", "Høringsperiodens afslutning");
    add(getDate(p,["datovedt"]), "Politisk vedtagelse", "Dato for planens vedtagelse");
    add(getDate(p,["datoikraft"]), "Ikrafttrædelse", "Planen er registreret som trådt i kraft");
    add(getDate(p,["datoaflyst","aflysningsdato"]), "Aflysning", "Planen er registreret som aflyst");
    add(getDate(p,["datoattr"]), "Attributter opdateret", "Planhovedets attributter er senest rettet");
    add(getDate(p,["datogeom"]), "Geometri opdateret", "Planens geometri er senest rettet");
    add(getDate(p,["datoopdt","opdateringstidspunkt"]), "Registeropdatering", "Seneste registeropdatering");
    add(getDate(p,["datogstart"]), "Versions gyldighed starter", "Gyldighedsinterval for denne version");
    add(getDate(p,["datogslut"]), "Versions gyldighed slutter", "Gyldighedsinterval for denne version");
  }
  return events.sort((a,b)=>String(a.date).localeCompare(String(b.date))).slice(-100);
}
export default async function handler(req,res){
  if(req.method!=="GET"){res.setHeader("Allow","GET");return res.status(405).json({error:"Method not allowed"});}
  const x=Number(req.query.x), y=Number(req.query.y), crs=String(req.query.crs||"EPSG:25832");
  if(!Number.isFinite(x)||!Number.isFinite(y)||x<40000||x>1e6||y<5e6||y>7.5e6)return res.status(400).json({error:"Gyldige UTM-koordinater (x/y) mangler."});
  if(crs && !/25832|EPSG:25832/i.test(crs))return res.status(400).json({error:"Plandata WFS kræver koordinater i EPSG:25832 (ETRS89 / UTM zone 32N)."});
  const exactRadius=60, historyRadius=500;
  const exactBbox=[x-exactRadius,y-exactRadius,x+exactRadius,y+exactRadius,"EPSG:25832"].join(",");
  const historyBbox=[x-historyRadius,y-historyRadius,x+historyRadius,y+historyRadius,"EPSG:25832"].join(",");
  const results={};
  const tasks=Object.entries(LAYERS).map(async ([key,layer])=>{
    const historyKeys=["planProposals","repealedPlans","planVersions"];
    try{results[key]=await fetchLayer(layer,historyKeys.includes(key)?historyBbox:exactBbox,historyKeys.includes(key)?100:25);}
    catch(e){results[key]=[];results[key+"Error"]=String(e.message||"WFS-opslag fejlede").slice(0,220);}
  });
  await Promise.all(tasks);
  const historyFeatures=[...(results.localPlans||[]),...(results.municipalFrames||[]),...(results.planVersions||[]),...(results.planProposals||[]),...(results.repealedPlans||[])];
  const planHistory=buildHistory(historyFeatures);
  const versions=(results.planVersions||[]).map(x=>({id:x.id,properties:x.properties||{},geometry:x.geometry||null}));
  res.setHeader("Cache-Control","private, max-age=300");
  return res.status(200).json({
    source:"Plandata.dk WFS · vedtagne planer, planversioner, forslag og aflyste planer",
    fetchedAt:new Date().toISOString(),coordinate:{x,y,crs:"EPSG:25832"},
    searchWindowsMeters:{exact:exactRadius,history:historyRadius},
    matchMethod:"Nærhedsopslag omkring adressens adgangspunkt. Historik i radius 500 m er områdenær, ikke nødvendigvis knyttet til selve matriklen.",
    localPlans:results.localPlans||[],subAreas:results.subAreas||[],buildingFields:results.buildingFields||[],
    municipalFrames:results.municipalFrames||[],zoneMap:results.zoneMap||[],
    planProposals:results.planProposals||[],repealedPlans:results.repealedPlans||[],planVersions:versions,planHistory,
    sourceLinks:{plandata:"https://www.plandata.dk/",historicalMaps:"https://historiskekort.dk/",plansSearch:"https://visplaner.plandata.dk/"},
    errors:Object.fromEntries(Object.entries(results).filter(([k])=>k.endsWith("Error")))
  });
}