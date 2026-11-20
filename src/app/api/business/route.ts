import {z} from "zod";
import {businessMutation,businessSnapshot} from "@/lib/business";
import {isSameOriginRequest} from "@/lib/origin";
import {UserInputError} from "@/lib/errors";
export const dynamic="force-dynamic";
export async function GET(){
 try{return Response.json(await businessSnapshot(),{headers:{"Cache-Control":"no-store"}});}
 catch{return Response.json({error:"Could not load shop records. Check database setup."},{status:503});}
}
export async function POST(request:Request){
 if(!isSameOriginRequest(request)) return Response.json({error:"Only same-origin requests are allowed."},{status:403});
 try{
  const raw=await request.text();
  if(raw.length>25000) return Response.json({error:"Request is too large."},{status:413});
  return Response.json(await businessMutation(JSON.parse(raw)));
 }catch(error){
  if(error instanceof UserInputError) return Response.json({error:error.message},{status:error.status});
  if(error instanceof z.ZodError) return Response.json({error:error.issues.map(i=>i.message).join(" ")},{status:400});
  if(error instanceof SyntaxError) return Response.json({error:"Invalid request."},{status:400});
  return Response.json({error:"The operation could not be applied. Refresh and review stock, totals, and duplicate references."},{status:409});
 }
}
