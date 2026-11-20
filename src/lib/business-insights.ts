import { indiaDate, money } from "./shared";
import { UserInputError } from "./errors";

type Dated = { id: string; createdAt: Date | string };
export type InsightData = {
  customers: { id: string; name: string; phone: string }[];
  entries: (Dated & { customerId: string; kind: string; amountPaise: number; occurredOn: string; note: string; reversesId: string | null })[];
  products: { id: string; name: string; unit: string; stockMilli: number; pricePaise: number }[];
  suppliers: { id: string; name: string }[];
  invoices: (Dated & { supplierId: string; reference: string; totalPaise: number; dueOn: string; occurredOn: string; lines: string })[];
  supplierPayments: (Dated & { supplierId: string; amountPaise: number; occurredOn: string })[];
  sales: (Dated & { customerId: string | null; totalPaise: number; mode: string; entryId: string | null; occurredOn: string; lines: string })[];
  cash: (Dated & { kind: string; amountPaise: number; occurredOn: string; note: string })[];
};
type Line = { productId: string; productName: string; quantityMilli: number; unitPricePaise: number; lineTotalPaise: number };
const signed = (entry: { kind: string; amountPaise: number }) => entry.kind === "payment" ? -entry.amountPaise : entry.amountPaise;
const stamp = (row: Dated) => new Date(row.createdAt).getTime();
const chronological = <T extends Dated & { occurredOn: string }>(a: T, b: T) => a.occurredOn.localeCompare(b.occurredOn) || stamp(a) - stamp(b) || a.id.localeCompare(b.id);
const shiftDay = (day: string, days: number) => new Date(Date.parse(`${day}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const sum = (values: number[]) => values.reduce((total, value) => {
  const next = total + value;
  if (!Number.isSafeInteger(next)) throw new UserInputError("Recorded totals exceed the safe calculation range.");
  return next;
}, 0);
const activeEntries = (data: InsightData, asOf: string) => {
  const entries=data.entries.filter(entry=>entry.occurredOn<=asOf);
  const reversed = new Set(entries.flatMap(entry => entry.reversesId ? [entry.reversesId] : []));
  return entries.filter(entry => !entry.reversesId && !reversed.has(entry.id));
};
const saleLines = (text: string): Line[] => {
  try {
    const value: unknown = JSON.parse(text);
    return Array.isArray(value) ? value.filter((line): line is Line => !!line && typeof line === "object" && typeof line.productId === "string" && typeof line.productName === "string" && Number.isSafeInteger(line.quantityMilli) && line.quantityMilli > 0 && Number.isSafeInteger(line.lineTotalPaise) && line.lineTotalPaise >= 0) : [];
  } catch { return []; }
};

/** One-shop evidence scan; paginate/aggregate when the shop outgrows in-memory reports. */
export async function loadInsightData(): Promise<InsightData> {
  const { db } = await import("./db");
  const [customers, entries, products, suppliers, invoices, supplierPayments, sales, cash] = await Promise.all([
    db.customer.findMany(), db.entry.findMany(), db.product.findMany(), db.supplier.findMany(),
    db.supplierInvoice.findMany(), db.supplierPayment.findMany(), db.sale.findMany(), db.cashRecord.findMany(),
  ]);
  return { customers, entries, products, suppliers, invoices, supplierPayments, sales, cash };
}

export function agedBalances(data: InsightData, today = indiaDate(), agingDays = 30) {
  const active = activeEntries(data,today);
  const cutoff = shiftDay(today, -agingDays);
  return data.customers.map(customer => {
    const rows = active.filter(entry => entry.customerId === customer.id).sort(chronological);
    const credits: { entryId: string; date: string; remainingPaise: number }[] = [];
    let advance = 0;
    for (const row of rows) {
      if (row.kind !== "payment") {
        const covered = Math.min(advance, row.amountPaise);
        advance -= covered;
        if (row.amountPaise > covered) credits.push({ entryId: row.id, date: row.occurredOn, remainingPaise: row.amountPaise - covered });
      } else {
        let remaining = row.amountPaise;
        for (const credit of credits) {
          const received = Math.min(remaining, credit.remainingPaise);
          credit.remainingPaise -= received;
          remaining -= received;
          if (!remaining) break;
        }
        advance += remaining;
      }
    }
    const unpaid = credits.filter(credit => credit.remainingPaise > 0);
    const overdue = unpaid.filter(credit => credit.date <= cutoff);
    return {
      customerId: customer.id, name: customer.name, hasContactNumber: !!customer.phone,
      balancePaise: sum(rows.map(signed)), overduePaise: sum(overdue.map(credit => credit.remainingPaise)),
      oldestUnpaidOn: unpaid[0]?.date ?? null, lastPaymentOn: rows.filter(row => row.kind === "payment").at(-1)?.occurredOn ?? null,
      entryIds: unpaid.map(credit => credit.entryId), overdueEntryIds: overdue.map(credit => credit.entryId),
    };
  });
}

function unpaidInvoices(data: InsightData, today: string) {
  return data.suppliers.flatMap(supplier => {
    let paid = sum(data.supplierPayments.filter(payment => payment.supplierId === supplier.id && payment.occurredOn <= today).map(payment => payment.amountPaise));
    const invoices = data.invoices.filter(invoice => invoice.supplierId === supplier.id && invoice.occurredOn <= today)
      .sort((a,b) => a.dueOn.localeCompare(b.dueOn) || chronological(a,b));
    return invoices.map(invoice => {
      const covered = Math.min(paid, invoice.totalPaise);
      paid -= covered;
      return { invoiceId: invoice.id, supplierId: supplier.id, supplierName: supplier.name, reference: invoice.reference, dueOn: invoice.dueOn, remainingPaise: invoice.totalPaise - covered };
    }).filter(invoice => invoice.remainingPaise > 0);
  });
}

export function cashForecast(data: InsightData, today = indiaDate(), days = 14) {
  const opening = data.cash.filter(row => row.kind === "opening" && row.occurredOn <= today).sort(chronological).at(-1);
  const active = activeEntries(data,today);
  const since = shiftDay(today, -27);
  const observedEntries = active.filter(row => row.occurredOn >= since);
  const firstObserved = observedEntries.map(row => row.occurredOn).sort()[0];
  const observedDays = firstObserved ? Math.min(28, Math.floor((Date.parse(today) - Date.parse(firstObserved)) / 86400000) + 1) : 0;
  const receivedPaise = sum(observedEntries.filter(row => row.kind === "payment").map(row => row.amountPaise));
  const dailyObservedCollectionPaise = observedDays ? Math.floor(receivedPaise / observedDays) : 0;
  let outstandingRemaining = sum(agedBalances(data, today).map(row => Math.max(0,row.balancePaise)));
  const afterOpening = (row: Dated & { occurredOn: string }) => !!opening && (row.occurredOn > opening.occurredOn || row.occurredOn === opening.occurredOn);
  const cashChanges = data.cash.filter(row => row.kind !== "opening" && row.occurredOn <= today && afterOpening(row));
  // Sales and supplier payments already create CashRecord rows; never count them twice.
  const ledgerReceipts = active.filter(row => row.kind === "payment" && afterOpening(row));
  const currentCashPaise = opening ? sum([opening.amountPaise, ...cashChanges.map(row => row.kind === "expense" ? -row.amountPaise : row.amountPaise), ...ledgerReceipts.map(row => row.amountPaise)]) : null;
  const dues = unpaidInvoices(data,today);
  let projected = currentCashPaise;
  const timeline = Array.from({length:days},(_,index) => {
    const date = shiftDay(today,index+1);
    const expectedCollectionPaise = Math.min(outstandingRemaining,dailyObservedCollectionPaise);
    outstandingRemaining -= expectedCollectionPaise;
    const due = dues.filter(invoice => index === 0 ? invoice.dueOn <= date : invoice.dueOn === date);
    const supplierDuePaise = sum(due.map(invoice => invoice.remainingPaise));
    if (projected !== null) projected = sum([projected,expectedCollectionPaise,-supplierDuePaise]);
    return {date,expectedCollectionPaise,supplierDuePaise,projectedCashPaise:projected,invoiceIds:due.map(invoice=>invoice.invoiceId)};
  });
  return {
    asOf:today, status: opening ? "estimated" : "needs_opening_cash", currentCashPaise,
    opening:opening ? {id:opening.id,occurredOn:opening.occurredOn,amountPaise:opening.amountPaise} : null,
    history:{from:since,to:today,observedDays,receivedPaise,dailyObservedCollectionPaise,paymentEntryIds:observedEntries.filter(row=>row.kind==="payment").map(row=>row.id)},
    assumptions:[
      "Expected collections use the observed daily average over up to 28 days, capped at current outstanding credit; these are not promised payments.",
      "Customer ledger payments are assumed to be cash receipts. Separate bank/cash channels are not recorded.",
      "The opening amount means cash available at the start of its transaction date; all same-date receipts and expenses are included.",
      "Recorded cash sales and supplier payments are already included through cash records. Supplier payments are allocated to earliest-due invoices first.",
      "Only recorded supplier invoices are forecast. Future sales, purchases, expenses, and unrecorded cash are excluded.",
      ...(!opening ? ["Record an opening cash balance before relying on a cash-shortage estimate."] : []),
    ],
    evidence:{cashRecordIds:cashChanges.map(row=>row.id),receiptEntryIds:ledgerReceipts.map(row=>row.id)},
    unpaidInvoices:dues, timeline,
    firstShortage: timeline.find(day=>day.projectedCashPaise !== null && day.projectedCashPaise<0) ?? null,
  };
}

export function explainBalances(data:InsightData, from:string, to:string, customerId?:string) {
  const rows=data.entries.filter(row=>!customerId || row.customerId===customerId);
  const changes=data.customers.filter(customer=>!customerId || customer.id===customerId).map(customer=>{
    const own=rows.filter(row=>row.customerId===customer.id);
    const beforePaise=sum(own.filter(row=>row.occurredOn<from).map(signed));
    const afterPaise=sum(own.filter(row=>row.occurredOn<=to).map(signed));
    const period=own.filter(row=>row.occurredOn>=from && row.occurredOn<=to);
    return {customerId:customer.id,name:customer.name,beforePaise,afterPaise,netChangePaise:afterPaise-beforePaise,outstandingChangePaise:Math.max(0,afterPaise)-Math.max(0,beforePaise),entries:period.map(row=>({id:row.id,kind:row.kind,amountPaise:row.amountPaise,balanceChangePaise:signed(row),occurredOn:row.occurredOn,recordedAt:row.createdAt,note:row.note,reversesId:row.reversesId,reversedById:data.entries.find(other=>other.reversesId===row.id)?.id ?? null}))};
  });
  const openingOutstandingPaise=sum(changes.map(row=>Math.max(0,row.beforePaise)));
  const closingOutstandingPaise=sum(changes.map(row=>Math.max(0,row.afterPaise)));
  return {from,to,openingOutstandingPaise,closingOutstandingPaise,outstandingChangePaise:closingOutstandingPaise-openingOutstandingPaise,changes:changes.filter(row=>row.entries.length),basis:"Transaction dates, including linked reversals; recorded-at timestamps are shown separately. No entries are overwritten."};
}

export function memoryGraph(data:InsightData,today=indiaDate(),query="") {
  const nodes=[
    {id:"shop",type:"shop",name:"Your shop"},
    ...data.customers.map(row=>({id:`customer:${row.id}`,type:"customer",name:row.name})),
    ...data.products.map(row=>({id:`product:${row.id}`,type:"product",name:row.name})),
    ...data.suppliers.map(row=>({id:`supplier:${row.id}`,type:"supplier",name:row.name})),
  ];
  const edges: {from:string;to:string;relationship:string;amountPaise:number;quantityMilli?:number;evidenceIds:string[];lastOn?:string}[]=[];
  for(const balance of agedBalances(data,today)) if(balance.balancePaise!==0) edges.push({from:`customer:${balance.customerId}`,to:"shop",relationship:balance.balancePaise>0 ? "outstanding_credit" : "advance",amountPaise:Math.abs(balance.balancePaise),evidenceIds:data.entries.filter(row=>row.customerId===balance.customerId).map(row=>row.id)});
  const purchaseMap=new Map<string,typeof edges[number]>();
  for(const sale of data.sales.filter(row=>row.occurredOn<=today)) {
    if(!sale.customerId) continue;
    for(const line of saleLines(sale.lines)) {
      const key=`${sale.customerId}:${line.productId}`;
      const edge=purchaseMap.get(key) ?? {from:`customer:${sale.customerId}`,to:`product:${line.productId}`,relationship:"purchased",amountPaise:0,quantityMilli:0,evidenceIds:[],lastOn:sale.occurredOn};
      edge.amountPaise=sum([edge.amountPaise,line.lineTotalPaise]);edge.quantityMilli=sum([edge.quantityMilli??0,line.quantityMilli]);edge.evidenceIds.push(sale.id);if(!edge.lastOn || sale.occurredOn>edge.lastOn)edge.lastOn=sale.occurredOn;purchaseMap.set(key,edge);
    }
  }
  edges.push(...purchaseMap.values());
  for(const invoice of data.invoices.filter(row=>row.occurredOn<=today)) for(const line of saleLines(invoice.lines)) edges.push({from:`supplier:${invoice.supplierId}`,to:`product:${line.productId}`,relationship:"supplied",amountPaise:line.lineTotalPaise,quantityMilli:line.quantityMilli,evidenceIds:[invoice.id],lastOn:invoice.occurredOn});
  const normalized=query.normalize("NFKC").toLocaleLowerCase().trim();
  const matching=new Set(nodes.filter(node=>!normalized || node.name.normalize("NFKC").toLocaleLowerCase().includes(normalized)).map(node=>node.id));
  const selected=normalized ? edges.filter(edge=>matching.has(edge.from)||matching.has(edge.to)) : edges;
  const connected=new Set(selected.flatMap(edge=>[edge.from,edge.to]));
  const inactivePurchasers=[...purchaseMap.values()].filter(edge=>(!normalized || matching.has(edge.to)) && !!edge.lastOn && edge.lastOn<shiftDay(today,-30)).map(edge=>({customerId:edge.from.slice(9),customerName:data.customers.find(row=>`customer:${row.id}`===edge.from)?.name,productId:edge.to.slice(8),productName:data.products.find(row=>`product:${row.id}`===edge.to)?.name,lastPurchaseOn:edge.lastOn,purchaseCount:new Set(edge.evidenceIds).size,regularBuyer:new Set(edge.evidenceIds).size>=2,saleIds:[...new Set(edge.evidenceIds)]}));
  return {asOf:today,query,nodes:normalized ? nodes.filter(node=>matching.has(node.id)||connected.has(node.id)) : nodes,edges:selected,inactivePurchasers,basis:"Relationships use recorded sales, supplier invoice lines, and ledger entries. A ledger reversal does not imply a stock return or erase a recorded sale. Purchases outside these records cannot be inferred."};
}

export function simulateCash(data:InsightData,input:{collectPaise:number;purchasePaise:number;expensePaise:number;openingCashPaise?:number},today=indiaDate()) {
  if(Object.values(input).some(value=>value!==undefined && (!Number.isSafeInteger(value) || value<0))) throw new UserInputError("Use non-negative amounts in integer paise for this scenario.");
  const forecast=cashForecast(data,today);
  const baseline=input.openingCashPaise ?? forecast.currentCashPaise;
  return {asOf:today,baselineCashPaise:baseline,baselineSource:input.openingCashPaise!==undefined ? "scenario_override" : forecast.currentCashPaise===null ? "unknown" : "recorded_estimate",...input,netChangePaise:sum([input.collectPaise,-input.purchasePaise,-input.expensePaise]),projectedCashPaise:baseline===null ? null : sum([baseline,input.collectPaise,-input.purchasePaise,-input.expensePaise]),financialWrites:false,assumptions:["This scenario does not record a collection, purchase, expense, or ledger entry.",...(baseline===null ? ["Provide scenario opening cash or record an opening balance to calculate remaining cash."] : []),"Scenario collections are assumed, not predicted or automatically collected."]};
}

export async function reminderDraft(data:InsightData,customerId:string,language="en-IN",today=indiaDate()) {
  const customer=agedBalances(data,today).find(row=>row.customerId===customerId);
  if(!customer) throw new UserInputError("Customer not found.");
  if(customer.balancePaise<=0) throw new UserInputError("This customer has no outstanding balance.");
  const original=`Hello ${customer.name}, your recorded outstanding balance is ${money(customer.balancePaise)}. Please let us know when you can make a payment. If your records differ, please contact the shop. Thank you.`;
  const text=language==="en-IN" ? original : (await (await import("./replies")).localizeReply(original,language)).text;
  return {customerId,language,text,balancePaise:customer.balancePaise,overduePaise:customer.overduePaise,entryIds:customer.entryIds,requiresOwnerApproval:true,sent:false,hasContactNumber:customer.hasContactNumber};
}
