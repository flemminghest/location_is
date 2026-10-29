const WFS = "https://geoserver.plandata.dk/geoserver/wfs";
const LAYERS = {
  localPlans: "theme_pdk_lokalplan_vedtaget",
  subAreas: "theme_pdk_lokalplandelomraade_vedtaget",
  buildingFields: "theme_pdk_byggefelt_vedtaget"
};
async function fetchLayer(layer, bbox) {
  const url = new URL(WFS);
  url.searchParams.set("service","WFS");
  url.searchParams.set("version","2.0.0");
  url.searchParams.set("request","GetFeature");
  url.searchParams.set("typeNames",layer);
  url.searchParams.set("outputFormat","application/json");
  url.searchParams.set("count","10");
  url.searchParams.set("bbox",bbox);
  url.searchParams.set("srsName","EPSG:25832");
  const r = await fetch(url,{headers:{accept:"application/json"},signal:AbortSignal.timeout(15000)});
  if(!r.ok) throw new Error("Plandata WFS HTTP "+r.status);
  const data = await r.json();
  const features = Array.isArray(data.features)?data.features:[];
  return features.map(f=>({
    id:f.id||null,
    properties:f.properties||{},
    geometry:f.geometry||null
  }));
}
export default async function handler(req,res){
  if(req.method!=="GET"){res.setHeader("Allow","GET");return res.status(405).json({error:"Method not allowed"});}
  const x=Number(req.query.x), y=Number(req.query.y), crs=String(req.query.crs||"EPSG:25832");
  if(!Number.isFinite(x)||!Number.isFinite(y)||x<40000||x>1e6||y<5e6||y>7.5e6)return res.status(400).json({error:"Gyldige UTM-koordinater (x/y) mangler."});
  if(crs && !/25832|EPSG:25832/i.test(crs))return res.status(400).json({error:"Plandata WFS kræver koordinater i EPSG:25832 (ETRS89 / UTM zone 32N)."});
  const radius=20;
  const bbox=[x-radius,y-radius,x+radius,y+radius,"EPSG:25832"].join(",");
  const results={};
  await Promise.all(Object.entries(LAYERS).map(async ([key,layer])=>{
    try{results[key]=await fetchLayer(layer,bbox);}
    catch(e){results[key]=[];results[key+"Error"]=String(e.message||"WFS-opslag fejlede").slice(0,180);}
  }));
  const plans=results.localPlans||[];
  res.setHeader("Cache-Control","private, max-age=300");
  return res.status(200).json({
    source:"Plandata.dk WFS · vedtagne planer",
    fetchedAt:new Date().toISOString(),
    coordinate:{x,y,crs:"EPSG:25832"},
    searchWindowMeters:{radius},
    matchMethod:"BBOX omkring adressens adgangspunkt; verificér planens præcise geometri og dokument i originalkilden.",
    localPlans:plans,
    subAreas:results.subAreas||[],
    buildingFields:results.buildingFields||[],
    errors:Object.fromEntries(Object.entries(results).filter(([k])=>k.endsWith("Error")))
  });
}