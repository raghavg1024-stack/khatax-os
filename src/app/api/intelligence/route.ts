import { z } from "zod";
import { isSameOriginRequest } from "@/lib/origin";
import { indiaDate, toPaise } from "@/lib/shared";
import { LANGUAGES } from "@/lib/languages";
import { UserInputError } from "@/lib/errors";
import { agedBalances, cashForecast, explainBalances, loadInsightData, memoryGraph, reminderDraft, simulateCash } from "@/lib/business-insights";

export const dynamic="force-dynamic";
export const maxDuration=45;
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>!Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value && value<=indiaDate(),"Use a valid date that is today or earlier.");
const id=z.string().min(1).max(100);
const amount=z.string().trim().regex(/^\d{1,7}(?:\.\d{1,2})?$/).transform(value=>Number(value)===0 ? 0 : toPaise(value));
const querySchema=z.object({
 op:z.enum(["memory","forecast","overdue","explain"]).default("forecast"),
 q:z.string().trim().max(100).default(""),agingDays:z.coerce.number().int().min(1).max(365).default(30),
 from:date.optional(),to:date.optional(),customerId:id.optional(),
}).refine(value=>!value.from || !value.to || value.from<=value.to,"The start date must not follow the end date.");
const bodySchema=z.discriminatedUnion("op",[
 z.object({op:z.literal("simulate"),collect:amount.default(0),purchase:amount.default(0),expense:amount.default(0),openingCash:amount.optional()}),
 z.object({op:z.literal("reminder"),customerId:id,language:z.string().default("en-IN").refine(value=>LANGUAGES.some(item=>item.code===value),"Choose a supported language.")}),
]);
function failed(error:unknown) {
 if(error instanceof UserInputError) return Response.json({error:error.message,code:error.code},{status:error.status});
 if(error instanceof z.ZodError) return Response.json({error:error.issues.map(issue=>issue.message).join(" ")},{status:400});
 if(error instanceof SyntaxError) return Response.json({error:"Invalid request."},{status:400});
 return Response.json({error:"Could not read shop intelligence. Check the database and retry."},{status:500});
}
export async function GET(request:Request) {
 try {
  const query=querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
  const data=await loadInsightData(),today=indiaDate();
  if(query.customerId && !data.customers.some(customer=>customer.id===query.customerId))throw new UserInputError("Customer not found.");
  const to=query.to || today,from=query.from || new Date(Date.parse(`${to}T12:00:00Z`)-6*86400000).toISOString().slice(0,10);
  const result=query.op==="memory" ? memoryGraph(data,today,query.q)
   : query.op==="forecast" ? cashForecast(data,today)
   : query.op==="overdue" ? {asOf:today,agingDays:query.agingDays,basis:`Credit aging uses FIFO payment allocation and a ${query.agingDays}-day threshold. Contractual customer due dates are not recorded; these are aging alerts, not claims of a missed agreed deadline.`,customers:agedBalances(data,today,query.agingDays).filter(row=>row.overduePaise>0)}
   : explainBalances(data,from,to,query.customerId);
  return Response.json(result,{headers:{"Cache-Control":"no-store"}});
 }catch(error){return failed(error);}
}
export async function POST(request:Request) {
 if(!isSameOriginRequest(request))return Response.json({error:"Only same-origin requests are allowed."},{status:403});
 try {
  const raw=await request.text();if(raw.length>4000)return Response.json({error:"Request is too large."},{status:413});
  const body=bodySchema.parse(JSON.parse(raw));
  const data=await loadInsightData();
  return Response.json(body.op==="simulate" ? simulateCash(data,{collectPaise:body.collect,purchasePaise:body.purchase,expensePaise:body.expense,openingCashPaise:body.openingCash}) : await reminderDraft(data,body.customerId,body.language),{headers:{"Cache-Control":"no-store"}});
 }catch(error){return failed(error);}
}
