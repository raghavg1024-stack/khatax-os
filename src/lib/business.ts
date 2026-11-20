import {createHash} from "node:crypto";
import {z} from "zod";
import {db} from "./db";
import {audit} from "./ledger";
import {dateSchema,indiaDate} from "./shared";
import {UserInputError} from "./errors";

const id=z.string().min(1).max(100);
const integer=z.number().int().safe();
const positive=integer.min(1).max(100_000_000);
const quantity=integer.min(1).max(1_000_000_000);
const dueDate=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s=>!isNaN(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s,"Use a valid due date.");
const common={key:z.string().min(8).max(100),acknowledge:z.literal(true)};
export const businessSchema=z.discriminatedUnion("op",[
 z.object({op:z.literal("product"),...common,id:id.optional(),name:z.string().trim().min(2).max(100),sku:z.string().trim().max(80).optional(),unit:z.string().trim().min(1).max(20).default("unit"),pricePaise:positive,initialStockMilli:integer.min(0).max(1_000_000_000).default(0)}),
 z.object({op:z.literal("supplier"),...common,name:z.string().trim().min(2).max(100),phone:z.string().trim().max(30).default("")}),
 z.object({op:z.literal("receive"),...common,supplierId:id,reference:z.string().trim().min(1).max(100),occurredOn:dateSchema,dueOn:dueDate,lines:z.array(z.object({productId:id,quantityMilli:quantity,unitPricePaise:positive})).min(1).max(50),taxPaise:integer.min(0).max(100_000_000).default(0),totalPaise:positive}),
 z.object({op:z.literal("sale"),...common,customerId:id.optional(),mode:z.enum(["cash","credit"]),occurredOn:dateSchema,lines:z.array(z.object({productId:id,quantityMilli:quantity})).min(1).max(30),expectedTotalPaise:positive.optional()}),
 z.object({op:z.literal("supplierPayment"),...common,supplierId:id,amountPaise:positive,occurredOn:dateSchema}),
 z.object({op:z.literal("cash"),...common,kind:z.enum(["opening","receipt","expense"]),amountPaise:integer.min(0).max(100_000_000),occurredOn:dateSchema,note:z.string().trim().max(300).default("")}),
]);
export type BusinessInput=z.infer<typeof businessSchema>;
export const businessRequestSchema=businessSchema;

/** Exact unit-price multiplication; reject fractional paise rather than round money. */
export function lineTotal(quantityMilli:number,pricePaise:number) {
 const value=BigInt(quantityMilli)*BigInt(pricePaise);
 if(value%1000n) throw new UserInputError("This quantity creates a fractional paise. Adjust quantity or unit price.");
 const result=Number(value/1000n);
 if(!Number.isSafeInteger(result)||result<=0||result>100_000_000) throw new UserInputError("Line total must be between one paise and ten lakh rupees.");
 return result;
}
const sum=(values:number[])=>{
 const total=values.reduce((a,b)=>a+b,0);
 if(!Number.isSafeInteger(total)||total<=0||total>100_000_000) throw new UserInputError("Total must be between one paise and ten lakh rupees.");
 return total;
};
const fingerprint=(input:BusinessInput)=>createHash("sha256").update(JSON.stringify(input)).digest("hex");

export async function businessMutation(raw:unknown) {
 const input=businessSchema.parse(raw);
 const digest=fingerprint(input);
 return db.$transaction(async tx=>{
  const previous=await tx.businessOperation.findUnique({where:{key:input.key}});
  if(previous){
   if(previous.fingerprint!==digest) throw new UserInputError("This request key was already used for different details. Review again.");
   return {...JSON.parse(previous.result),idempotent:true};
  }
  let result:Record<string,unknown>;
  if(input.op==="product"){
   if(input.id&&input.initialStockMilli) throw new UserInputError("Receive stock through a supplier invoice; editing a product cannot rewrite stock.");
   const data={name:input.name,sku:input.sku||null,unit:input.unit,pricePaise:input.pricePaise};
   const row=input.id ? await tx.product.update({where:{id:input.id},data}) : await tx.product.create({data:{...data,stockMilli:input.initialStockMilli}});
   if(!input.id&&input.initialStockMilli) await tx.inventoryMovement.create({data:{productId:row.id,deltaMilli:input.initialStockMilli,reason:"opening",reference:input.key}});
   await audit(tx,input.id?"product.updated":"product.created",row.id,{...data,initialStockMilli:input.id?undefined:input.initialStockMilli,key:input.key});
   result={product:row,message:"Product saved."};
  }else if(input.op==="supplier"){
   const row=await tx.supplier.create({data:{name:input.name,phone:input.phone}});
   await audit(tx,"supplier.created",row.id,{name:row.name,key:input.key});
   result={supplier:row,message:"Supplier saved."};
  }else if(input.op==="receive"){
   if(new Set(input.lines.map(line=>line.productId)).size!==input.lines.length) throw new UserInputError("Combine duplicate product lines before recording this invoice.");
   await tx.supplier.findUniqueOrThrow({where:{id:input.supplierId}});
   if(input.dueOn<input.occurredOn) throw new UserInputError("Supplier due date cannot precede the invoice date.");
   if(new Set(input.lines.map(l=>l.productId)).size!==input.lines.length) throw new UserInputError("Combine duplicate product lines before posting.");
   if(await tx.supplierInvoice.findUnique({where:{supplierId_reference:{supplierId:input.supplierId,reference:input.reference}}})) throw new UserInputError("This supplier invoice reference has already been recorded.");
   const lines=[];
   for(const line of input.lines){
    const product=await tx.product.findUniqueOrThrow({where:{id:line.productId}});
    if(product.stockMilli+line.quantityMilli>1_000_000_000) throw new UserInputError("Stock limit exceeded.");
    lines.push({...line,productName:product.name,lineTotalPaise:lineTotal(line.quantityMilli,line.unitPricePaise)});
   }
   const totalPaise=sum([...lines.map(l=>l.lineTotalPaise),input.taxPaise]);
   if(totalPaise!==input.totalPaise) throw new UserInputError("Invoice line totals and tax do not match the printed total. Correct the draft first.");
   const row=await tx.supplierInvoice.create({data:{supplierId:input.supplierId,reference:input.reference,totalPaise,taxPaise:input.taxPaise,occurredOn:input.occurredOn,dueOn:input.dueOn,lines:JSON.stringify(lines),key:input.key}});
   for(const line of lines){
    const changed=await tx.product.updateMany({where:{id:line.productId,stockMilli:{lte:1_000_000_000-line.quantityMilli}},data:{stockMilli:{increment:line.quantityMilli}}});
    if(!changed.count) throw new UserInputError("Stock changed while receiving this invoice. Review again.");
    await tx.inventoryMovement.create({data:{productId:line.productId,deltaMilli:line.quantityMilli,reason:"supplier.invoice",reference:row.id}});
   }
   await audit(tx,"supplier.invoice.posted",row.id,{totalPaise,reference:input.reference,key:input.key});
   result={invoice:row,message:"Supplier invoice and stock recorded."};
  }else if(input.op==="sale"){
   if(input.mode==="credit"&&!input.customerId) throw new UserInputError("Choose a customer before recording a credit sale.");
   if(input.customerId) await tx.customer.findUniqueOrThrow({where:{id:input.customerId}});
   if(new Set(input.lines.map(l=>l.productId)).size!==input.lines.length) throw new UserInputError("Combine duplicate product lines before posting.");
   const lines=[];
   for(const line of input.lines){
    const product=await tx.product.findUniqueOrThrow({where:{id:line.productId}});
    if(product.stockMilli<line.quantityMilli) throw new UserInputError(`Not enough stock for ${product.name}.`);
    lines.push({...line,productName:product.name,unitPricePaise:product.pricePaise,lineTotalPaise:lineTotal(line.quantityMilli,product.pricePaise)});
   }
   const totalPaise=sum(lines.map(l=>l.lineTotalPaise));
   if(input.expectedTotalPaise!=null&&input.expectedTotalPaise!==totalPaise) throw new UserInputError("The product price changed. Review the sale again.");
   let entryId:string|undefined;
   if(input.mode==="credit"){
    const entry=await tx.entry.create({data:{customerId:input.customerId!,kind:"credit",amountPaise:totalPaise,occurredOn:input.occurredOn,note:"Inventory-linked credit sale",source:"shop.sale",batchId:input.key}});
    entryId=entry.id;
    await audit(tx,"transaction.posted",entry.id,{amountPaise:totalPaise,source:"shop.sale",key:input.key});
   }
   const row=await tx.sale.create({data:{customerId:input.customerId,totalPaise,mode:input.mode,entryId,lines:JSON.stringify(lines),key:input.key,occurredOn:input.occurredOn}});
   for(const line of lines){
    const changed=await tx.product.updateMany({where:{id:line.productId,stockMilli:{gte:line.quantityMilli}},data:{stockMilli:{decrement:line.quantityMilli}}});
    if(!changed.count) throw new UserInputError("Stock changed while recording. Review again.");
    await tx.inventoryMovement.create({data:{productId:line.productId,deltaMilli:-line.quantityMilli,reason:"sale",reference:row.id}});
   }
   if(input.mode==="cash") await tx.cashRecord.create({data:{kind:"receipt",amountPaise:totalPaise,occurredOn:input.occurredOn,key:`sale:${input.key}`,note:`Cash sale ${row.id}`}});
   await audit(tx,"sale.posted",row.id,{totalPaise,mode:input.mode,entryId,key:input.key});
   result={sale:row,message:"Sale, stock, and payment or credit recorded atomically."};
  }else if(input.op==="supplierPayment"){
   await tx.supplier.findUniqueOrThrow({where:{id:input.supplierId}});
   const [invoices,payments]=await Promise.all([tx.supplierInvoice.findMany({where:{supplierId:input.supplierId}}),tx.supplierPayment.findMany({where:{supplierId:input.supplierId}})]);
   const due=invoices.reduce((s,r)=>s+r.totalPaise,0)-payments.reduce((s,r)=>s+r.amountPaise,0);
   if(input.amountPaise>due) throw new UserInputError("Payment exceeds recorded supplier dues. Review the supplier balance.");
   const row=await tx.supplierPayment.create({data:{supplierId:input.supplierId,amountPaise:input.amountPaise,occurredOn:input.occurredOn,key:input.key}});
   await tx.cashRecord.create({data:{kind:"expense",amountPaise:input.amountPaise,occurredOn:input.occurredOn,key:`supplier-payment:${input.key}`,note:`Supplier payment ${row.id}`}});
   await audit(tx,"supplier.payment.posted",row.id,{supplierId:input.supplierId,amountPaise:input.amountPaise,key:input.key});
   result={payment:row,message:"Supplier payment and cash expense recorded."};
  }else{
   if(input.kind!=="opening"&&input.amountPaise===0) throw new UserInputError("Cash receipts and expenses must be positive.");
   const row=await tx.cashRecord.create({data:{kind:input.kind,amountPaise:input.amountPaise,occurredOn:input.occurredOn,key:input.key,note:input.note}});
   await audit(tx,"cash.recorded",row.id,{kind:input.kind,amountPaise:input.amountPaise,key:input.key});
   result={cashRecord:row,message:"Cash record saved."};
  }
  await tx.businessOperation.create({data:{key:input.key,fingerprint:digest,result:JSON.stringify(result)}});
  return {...result,idempotent:false};
 },{timeout:15000});
}

export async function businessSnapshot(){
 const [products,suppliers,invoices,payments,sales,cashRecords,movements]=await Promise.all([
  db.product.findMany({orderBy:{name:"asc"}}),db.supplier.findMany({orderBy:{name:"asc"}}),db.supplierInvoice.findMany({orderBy:{createdAt:"desc"}}),db.supplierPayment.findMany({orderBy:{createdAt:"desc"}}),db.sale.findMany({orderBy:{createdAt:"desc"}}),db.cashRecord.findMany({orderBy:{createdAt:"desc"}}),db.inventoryMovement.findMany({orderBy:{createdAt:"desc"},take:200}),
 ]);
 return {products,suppliers,invoices,payments,sales,cashRecords,movements,today:indiaDate(),quantityScale:1000};
}
