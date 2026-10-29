export default async function handler(req,res){
 if(req.method!=="GET"){res.setHeader("Allow","GET");return res.status(405).json({error:"Method not allowed"});}
 const configured=Boolean(process.env.DATAFORDELER_API_KEY);
 res.setHeader("Cache-Control","no-store");
 return res.status(200).json({ok:true,configured,addressSearch:"Klimadatastyrelsens Adressevælger",bbr:configured?"configured":"needs_api_key",cadastral:configured?"configured":"needs_api_key",provider:"Datafordeleren GraphQL flexible/v3",instructions:configured?undefined:"Set DATAFORDELER_API_KEY in Vercel environment variables and redeploy."});
}
