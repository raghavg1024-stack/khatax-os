import { test } from "node:test";
import assert from "node:assert/strict";
import { agedBalances, cashForecast, explainBalances, memoryGraph, reminderDraft, simulateCash, type InsightData } from "../src/lib/business-insights";

const dated=(id:string,occurredOn:string)=>({id,occurredOn,createdAt:`${occurredOn}T12:00:00Z`});
const fixture=():InsightData=>({
 customers:[{id:"c1",name:"Customer One",phone:""},{id:"c2",name:"Customer Two",phone:""}],
 entries:[
  {...dated("credit","2026-10-01"),customerId:"c1",kind:"credit",amountPaise:15000,note:"",reversesId:null},
  {...dated("payment","2026-11-05"),customerId:"c1",kind:"payment",amountPaise:1500,note:"",reversesId:null},
  {...dated("reversed-credit","2026-10-02"),customerId:"c1",kind:"credit",amountPaise:10000,note:"",reversesId:null},
  {...dated("reversal","2026-11-10"),customerId:"c1",kind:"payment",amountPaise:10000,note:"reverse",reversesId:"reversed-credit"},
  {...dated("advance","2026-10-01"),customerId:"c2",kind:"payment",amountPaise:2000,note:"",reversesId:null},
  {...dated("prepaid-credit","2026-11-01"),customerId:"c2",kind:"credit",amountPaise:1000,note:"",reversesId:null},
 ],
 products:[{id:"rice",name:"Rice bag",unit:"bag",stockMilli:5000,pricePaise:1000}],
 suppliers:[{id:"s1",name:"Supplier One"}],
 invoices:[
  {...dated("i1","2026-11-02"),supplierId:"s1",reference:"BILL1",totalPaise:10000,dueOn:"2026-11-20",lines:JSON.stringify([{productId:"rice",productName:"Rice bag",quantityMilli:10000,unitPricePaise:1000,lineTotalPaise:10000}])},
  {...dated("i2","2026-11-03"),supplierId:"s1",reference:"BILL2",totalPaise:10000,dueOn:"2026-11-22",lines:"[]"},
 ],
 supplierPayments:[{...dated("sp1","2026-11-07"),supplierId:"s1",amountPaise:3000}],
 sales:[{...dated("sale1","2026-10-01"),customerId:"c1",mode:"credit",entryId:"reversed-credit",totalPaise:2000,lines:JSON.stringify([{productId:"rice",productName:"Rice bag",quantityMilli:2000,unitPricePaise:1000,lineTotalPaise:2000}])}],
 cash:[
  {...dated("opening","2026-11-01"),kind:"opening",amountPaise:10000,note:"start of day"},
  {...dated("cash-sale","2026-11-06"),kind:"receipt",amountPaise:2000,note:"sale"},
  {...dated("supplier-expense","2026-11-07"),kind:"expense",amountPaise:3000,note:"supplier payment"},
 ],
});

test("intelligence uses recorded evidence, reversal-aware aging, and disclosed forecasts",async()=>{
 const data=fixture(),today="2026-11-20",original=JSON.stringify(data);
 const aged=agedBalances(data,today);
 assert.equal(aged[0].balancePaise,13500);
 assert.equal(aged[0].overduePaise,13500);
 assert.deepEqual(aged[0].overdueEntryIds,["credit"]);
 assert.equal(aged[1].balancePaise,-1000);
 assert.equal(aged[1].overduePaise,0,"Prepaid credit must consume the advance, not become overdue");
 assert.equal(agedBalances(data,"2026-11-06")[0].balancePaise,23500,"A later reversal must not erase an earlier historical balance");
 const forecast=cashForecast(data,today);
 assert.equal(forecast.currentCashPaise,10500,"Cash sale/payment mirror rows must not be counted twice");
 assert.equal(forecast.unpaidInvoices.find(row=>row.invoiceId==="i1")?.remainingPaise,7000);
 assert.equal(forecast.timeline.length,14);
 assert.equal(forecast.history.receivedPaise,1500,"Reversed credits' payment-shaped reversals are not real collections");
 assert.equal(forecast.history.observedDays,20);
 assert.equal(forecast.history.dailyObservedCollectionPaise,75);
 assert.equal(forecast.firstShortage?.date,"2026-11-22");
 assert.ok(forecast.assumptions.some(text=>text.includes("assumed to be cash")));
 const missing=cashForecast({...data,cash:[]},today);
 assert.equal(missing.status,"needs_opening_cash");
 assert.equal(missing.currentCashPaise,null);
 assert.ok(missing.timeline.every(row=>row.projectedCashPaise===null));
 assert.equal(missing.firstShortage,null,"Do not invent cash shortages without an opening balance");
 const history=explainBalances(data,"2026-11-01",today,"c1");
 assert.equal(history.openingOutstandingPaise,25000);
 assert.equal(history.closingOutstandingPaise,13500);
 assert.equal(history.outstandingChangePaise,-11500);
 assert.equal(history.changes[0].entries.find(row=>row.id==="reversal")?.reversesId,"reversed-credit");
 const graph=memoryGraph(data,today,"rice");
 assert.ok(graph.edges.some(edge=>edge.relationship==="purchased" && edge.evidenceIds.includes("sale1")),"Accounting reversal must not invent a stock return");
 assert.ok(graph.edges.some(edge=>edge.relationship==="supplied" && edge.evidenceIds.includes("i1")));
 assert.equal(graph.inactivePurchasers[0].customerId,"c1");
 assert.ok(!graph.nodes.some(node=>node.id==="customer:c2"));
 const simulation=simulateCash(data,{collectPaise:1000000,purchasePaise:600000,expensePaise:1},today);
 assert.equal(simulation.projectedCashPaise,410499);
 assert.equal(simulation.financialWrites,false);
 assert.equal(simulateCash({...data,cash:[]},{collectPaise:1,purchasePaise:0,expensePaise:0},today).projectedCashPaise,null);
 assert.equal(simulateCash({...data,cash:[]},{collectPaise:1,purchasePaise:0,expensePaise:0,openingCashPaise:0},today).projectedCashPaise,1);
 assert.throws(()=>simulateCash(data,{collectPaise:1,purchasePaise:0,expensePaise:0,openingCashPaise:Number.MAX_SAFE_INTEGER},today));
 const draft=await reminderDraft(data,"c1","en-IN",today);
 assert.equal(draft.sent,false);assert.equal(draft.requiresOwnerApproval,true);assert.match(draft.text,/₹135/);
 await assert.rejects(()=>reminderDraft(data,"c2","en-IN",today),/no outstanding/);
 assert.equal(JSON.stringify(data),original,"Queries and scenarios must never mutate source records");
});
