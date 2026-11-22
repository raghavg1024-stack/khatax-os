import {z} from "zod";
import {prepareProductCommand,prepareShopCommand} from "@/lib/shop-command";
import {isSameOriginRequest} from "@/lib/origin";
import {UserInputError} from "@/lib/errors";
export const runtime="nodejs";
export const maxDuration=35;
export async function POST(request:Request){
 if(!isSameOriginRequest(request))return Response.json({error:"Only same-origin requests are allowed."},{status:403});
 try{
  const raw=await request.text();if(raw.length>8000)return Response.json({error:"Command is too large."},{status:413});
  const {text,task}=z.object({text:z.string().trim().min(3).max(2000),task:z.enum(["sale","product"]).default("sale")}).parse(JSON.parse(raw));
  return Response.json(await (task==="product"?prepareProductCommand(text):prepareShopCommand(text)),{headers:{"Cache-Control":"no-store"}});
 }catch(error){
  if(error instanceof UserInputError)return Response.json({error:error.message,code:error.code},{status:error.status});
  if(error instanceof z.ZodError||error instanceof SyntaxError)return Response.json({error:"Use a valid inventory command."},{status:400});
  return Response.json({error:"Could not prepare the inventory sale. Check shop setup and retry."},{status:503});
 }
}
