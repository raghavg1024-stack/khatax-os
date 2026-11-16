# KhataX OS

### One Voice. Every Transaction. Any Language.

**[Open the deployed app](https://khatax-os.vercel.app)** — sign in with the owner's Vercel account. The deployment uses persistent hosted SQLite.

A working multilingual voice operating system for Indian kirana stores. Speak or type an instruction, review what was understood, resolve uncertainty, and record it in an auditable financial ledger.

**The AI understands the instruction. Deterministic code controls the money. The database remembers the shop.**

![KhataX OS overview with sample shop data](docs/images/overview.png)

## Four modules, one application

| Module           | Working capabilities                                                                                                                                                                |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **KhataX**       | Customer create/edit/search; credit and payments; outstanding/advance balances; history and filters; daily totals; charts; CSV export                                               |
| **BhashaBridge** | Gnani Prisma v3.0 streaming recognition; Hindi-English, Kannada-English, Telugu-English, and English intent extraction; spoken amounts; relative dates; nicknames; self-corrections |
| **KhataGuard**   | Amount/date clarification; identity selection; duplicate and advance warnings; explicit confirmation; undo/correction; immutable financial and audit history                        |
| **DukaanOS**     | Multi-action instructions, balance/summary questions, review, optional Gnani Timbre v3.0 spoken replies                                                                             |

Manual and voice entries use the same financial rules. Posting, editing customers, reversals, queries, filters, reports, and export operate on the real database.

## Detailed documentation

- [Architecture and voice-to-ledger sequence](docs/ARCHITECTURE.md)
- [Database tables, durable AI memory, paise arithmetic, reversals, and transactions](docs/DATABASE.md)
- [Vercel deployment, hosted SQLite, environments, and access protection](docs/DEPLOYMENT.md)
- [Five-minute hackathon demo](docs/DEMO.md)
- [Tests, live-provider verification, and remaining limitations](VALIDATION.md)

## How the website remembers

Customers, nicknames, financial entries, reversals, reviewed commands, and audit events are saved in SQLite. Refreshing the browser does not erase them. The hosted deployment uses an external SQLite database so replacing a server instance or deploying new code does not erase them either.

Each AI extraction reads the current customer directory. Balance questions and summaries use saved ledger entries through deterministic application code. A new customer is available to future commands without retraining a model. This is durable business-record memory, not unlimited chat memory or a claim that the model trains itself on the shop.

## Technology

Next.js App Router, TypeScript, React, Tailwind CSS, shadcn-style Radix components, Lucide, Recharts, SQLite, Prisma ORM, Zod, OpenAI Responses API Structured Outputs, Gnani Prisma v3.0 STT, and Gnani Timbre v3.0 TTS.

Local voice uses a persistent Node HTTP/WebSocket server. Vercel uses its documented native Node WebSocket lifecycle with Fluid compute. Each recording is bounded; durable financial state always lives in the database.

## Local setup

Requires **Node.js 24.x**.

```bash
git clone https://github.com/raghavg1024-stack/khatax-os.git
cd khatax-os
npm ci
```

Copy `.env.example` to `.env`. Keep `DATABASE_URL="file:./khatax.db"` for local SQLite. Put real API credentials in an ignored `.env.local` file:

```dotenv
OPENAI_API_KEY="your-local-openai-key"
OPENAI_MODEL="gpt-4.1-mini"
GNANI_API_KEY="your-local-gnani-key"
GNANI_VOICE_ID="Shivani"
```

```bash
npx prisma generate
npm run db:setup
npm run dev
```

Open **http://localhost:3000**. Initialization applies migrations and seeds labeled sample records only when the customer table is empty. It never resets an existing ledger. The default file is `prisma/khatax.db`. Restart after changing credentials.

OpenAI and Gnani need separate keys. Keys stay on the server and are never `NEXT_PUBLIC_` variables. Production credentials belong in Vercel environment variables, not Git or the deployment source bundle.

### Honest demo modes

Without an OpenAI key, a limited local parser handles selected patterns and spoken numbers. Without a Gnani key, supported browsers can use SpeechRecognition/SpeechSynthesis, or the user can type. Both are labeled **demo**. Browser speech may use the browser vendor's online service and is not guaranteed offline.

Full code-mixed intent extraction uses the LLM. A configured provider's failure is reported; the app does not pretend a demo fallback came from that provider. Provider settings show configuration, not a guarantee of a successful paid request.

## Try it

| Command                                       | Behavior                                               |
| --------------------------------------------- | ------------------------------------------------------ |
| “Ravi ka 500 add karo, nahi 350.”             | Review ₹350 credit after correction                    |
| “Ramesh ka teen sau chaalis udhaar add karo.” | Ask which matching Ramesh is intended                  |
| “Suresh ne kal 200 diye.”                     | Past payment; clarify date if uncertain                |
| “Ravi 250 credit; Sunita paid 100.”           | Review and post two actions atomically                 |
| “Ravi ka balance batao.”                      | Read the balance from saved entries                    |
| “undo Ravi”                                   | Review reversal of the last active recorded entry      |
| “correct Ravi to 120”                         | Preserve the original; append reversal and replacement |

Natural Hindi, Kannada, Telugu, and code-mixed wording uses the configured LLM. Demo parser coverage is deliberately narrower.

## Financial guarantees in the implementation

- ₹123.45 is stored as **12345 integer paise**, not a floating-point balance.
- There is **no writable balance column** for the LLM to change.
- A saved server-side preview is separate from posting; the browser confirms by command ID.
- Ambiguous or destructive actions and warnings require explicit review/acknowledgment.
- A batch commits together or rolls back together; retrying the same posted command does not duplicate entries.
- Corrections insert linked reversals/replacements. Database triggers reject entry/audit updates and deletes.
- Daily totals use **Asia/Kolkata**. Advances are reported separately from positive outstanding balances.

See [the database guide](docs/DATABASE.md) for equations and worked examples.

## Source map

```text
src/app/api/actions/   customer operations, preview, clarify, confirm, undo
src/app/api/state/     ledger and dashboard snapshot
src/app/api/export/    auditable CSV
src/app/api/voice/     Vercel native WebSocket upgrade
src/app/api/speak/     Gnani TTS proxy
src/components/       workbench and reusable UI
src/lib/db.ts         Prisma database initialization
src/lib/ledger.ts     deterministic money and safety rules
src/lib/intent.ts     structured LLM extraction and demo parser
src/lib/voice.ts      browser capture / PCM streaming
src/lib/voice-relay.ts shared Node relay to Gnani
src/lib/audio.ts      WAV header compatibility
prisma/               schema, migrations, idempotent demo seed
tests/                isolated ledger and audio tests
scripts/              browser QA and safe provider checks
docs/                 detailed explanations
server.ts             persistent local server
vercel.json           hosted runtime settings
```

## Tests and production run

```bash
npm test
npm run typecheck
npm run build
npm start
```

On Windows, stop the running server before a build that regenerates Prisma: Windows locks its loaded engine DLL. Tests use isolated SQLite files under ignored `test-results/`, leaving shop records untouched.

Browser QA: run `node scripts/qa-server.mjs`, then `node scripts/browser-check.mjs` in another terminal. The script expects Chrome at its standard Windows installation path.

Live checks make small billable requests and never post financial entries:

```bash
node scripts/diagnose-providers.mjs
node scripts/verify-providers.mjs --speech-only --browser
node scripts/verify-providers.mjs
```

## Deployment and verification status

The private source repository is [raghavg1024-stack/khatax-os](https://github.com/raghavg1024-stack/khatax-os). Production is deployed at **https://khatax-os.vercel.app** in the owner's `mugiwara` team. Hosted SQLite is provisioned, migrated, and verified through the deployed API. A one-paise test credit persisted across requests, and its confirmed reversal restored the original balance while preserving the audit history.

The deployment configuration selects Mumbai, Node 24, native WebSockets, and external durable SQLite. Do not use `/tmp` or a bundled SQLite file as production storage. The initial resource selection is the free Turso Starter plan. Vercel Authentication protects the single-shop deployment without a complex application login system. [Deployment instructions](docs/DEPLOYMENT.md).

The owner is adding `OPENAI_API_KEY` and `GNANI_API_KEY` directly in Vercel's **Production** environment. Until those are added and the project is redeployed, the hosted app clearly uses the local parser/browser speech demo modes. Local provider keys were not uploaded.

Production build, TypeScript, financial integration tests, browser workflows, and rendered responsive checks passed locally. Gnani synthesis, streaming recognition, and browser audio decoding passed a live round-trip on 16 November 2026. OpenAI last returned `credit_balance_exhausted` / `insufficient_quota`; [add API credits](https://platform.openai.com/settings/organization/billing) for live LLM extraction. Deployment does not change account billing.

## Scope

This is a one-shop hackathon build. It does not implement inventory, suppliers, GST filing, money transfers, multi-tenant SaaS accounts, or unlimited conversational memory. Physical microphone quality in a noisy shop still needs a human test. A public multi-shop service requires application authentication and tenant authorization.

The original brief ended at DukaanOS “Support multiple acti…”. Multi-action commands implement the visible requirement; unseen features are not claimed. For growth, prioritize paginated aggregates, separate preview databases, backups/recovery, and real-world microphone testing while preserving the financial confirmation boundary.
