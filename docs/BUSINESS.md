# Connected shop tools

Open **Shop tools** using the small sparkle button in the existing assistant. The application keeps its existing navigation, colors, typography, and page layout. The reply composer now shows a microphone after every assistant response; text answers also remain available.

## Recorded business operations

Add the real product catalog and suppliers before inventory-linked sales. Product prices use integer paise; quantities use thousandths of a unit. Supplier bills record item quantities, purchase prices, tax, total, and due date. Posting a reviewed bill increases stock and creates supplier dues in one database transaction. A reviewed credit sale reduces stock and creates its linked credit entry atomically. A cash sale records cash instead of customer debt. Supplier payments reduce dues and create their cash expense together.

All operations require acknowledgement, have a unique idempotency key, and create audit events. Historical bills, payments, sales, movements, cash records, and idempotency receipts are append-only. Changing a catalog price does not change historical sale prices. Duplicate bill references, insufficient stock, stale sale prices, inconsistent totals, and fractional paise are rejected. Reversing a ledger credit reverses money only; it does not claim that goods were returned.

Say **“Ravi Sharma took two bags of Rice on credit”** to prepare an inventory sale. The model extracts names and quantities. Server code resolves catalog/customer records, uses saved prices, checks stock, and computes totals. Ambiguities remain blocked. The dialog supports spoken follow-up details and explicit review before posting. Manual forms remain available.

## Invoice photographs

Upload a PNG, JPEG, or WebP image under 3 MB. Gemini vision returns a draft, never a database mutation. Match its supplier and products to actual records and verify the quantities, dates, prices, tax, and printed total. Missing or inconsistent values must be corrected; stock and supplier dues change only after review. Create missing catalog/supplier records with their forms first. No synthetic products or suppliers are seeded into production.

## Evidence and decisions

- **Shop memory:** relationships between recorded customers, products, suppliers, credit, and purchases. Search a name/product to filter connections. Inactive repeat purchasers require recorded sales; ledger credit alone cannot reveal purchased products.
- **Cash-flow forecast:** fourteen days of projected liquidity, recorded supplier dues, and observed collections. Enter opening cash at the **start of its date**. Same-date transactions are included. Collections use an observed average over at most 28 days, capped at outstanding credit. Ledger payments are assumed to be cash receipts because the existing ledger does not distinguish bank/cash. Forecasts display these assumptions and never move money.
- **Collection copilot:** credit aging and polite reminder drafts in the selected language. Aging uses a configurable threshold (30 days by default), not a claim of a missed contractual due date. Nothing is sent automatically. Copy the draft or review it in WhatsApp, then choose whether to send it yourself.
- **Business time machine:** opening/closing balances and the entries/reversals explaining changes over a period. Source records remain available; explanations do not rewrite history.
- **What-if simulator:** compare hypothetical collections, stock purchases, and expenses with recorded or explicitly assumed starting cash. Scenarios make no financial writes.

## Offline drafts

With the application already loaded, an internet outage allows typed commands or a microphone recording of at most 25 seconds to be saved in this device's IndexedDB. No online speech/AI processing is claimed while offline. After reconnecting, open **Offline drafts** to transcribe/replay a recording or prepare a command for review. A replay does not post a ledger entry. Financial confirmation and server idempotency still apply. Browser storage failure is reported. Cold-starting the complete application without a network is not supported.

## Verification

`npm test`, `npm run typecheck`, and `npm run build` cover core validation and compilation. `scripts/business-browser-check.mjs` verifies the stock-to-credit, supplier-bill, graph, forecast, reminder, scenario, offline-text, and reply-mic story against isolated SQLite. `scripts/offline-voice-check.mjs` exercises native browser recording and IndexedDB replay with synthetic audio. Live tests separately verified real invoice vision, inventory intent, and transcription of the actual browser-recorded WebM file. All financial test writes use isolated local databases.
