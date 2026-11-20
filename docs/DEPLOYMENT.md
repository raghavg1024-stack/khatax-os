# Deploying KhataX OS

Production: **https://khatax-os.vercel.app**. Source: [private GitHub repository](https://github.com/raghavg1024-stack/khatax-os). Vercel Authentication protects the site; use the owner's Vercel login.

The Vercel deployment uses Next.js, a hosted SQLite database, and native Node WebSocket sessions. Local development retains the custom persistent Node server and local SQLite option.

## Deployment resources

| Resource                  | Purpose                                                                 |
| ------------------------- | ----------------------------------------------------------------------- |
| Private GitHub repository | Source, schema/migrations, tests, detailed documentation                |
| Vercel project            | HTTPS web interface, HTTP APIs, bounded native voice WebSocket sessions |
| Turso hosted SQLite       | Durable customers, entries, commands, and audit history                 |
| Gemini project/key        | Structured multilingual intention extraction; legacy OpenAI remains optional |
| NVIDIA key                | Nemotron consistency review of Gemini's normalized action plan         |
| Sarvam key                | Realtime recognition for 22 scheduled Indian languages plus English    |
| Gnani key                 | Prisma v3.0 streaming recognition and Timbre v3.0 speech synthesis      |

Turso's Starter plan was selected for the initial database setup. Account/marketplace terms must be accepted by the account owner before provisioning. Additional usage or paid plans are not automatically authorized by this repository.

## Environment variables

| Variable             | Secret?              | Meaning                                        |
| -------------------- | -------------------- | ---------------------------------------------- |
| `DATABASE_URL`       | Local path/config    | Prisma CLI SQLite URL for local migration work |
| `SARVAM_API_KEY`     | Yes                  | All-22-language realtime recognition           |
| `SARVAM_STT_MODEL`   | No                   | Defaults to `saaras:v4`                         |
| `NVIDIA_API_KEY`     | Yes                  | Preferred Nemotron credential                  |
| `NVIDIA_MODEL`       | No                   | Defaults to `nvidia/nemotron-3.5-lightning-30b-a3b` |
| `GEMINI_API_KEY`     | Yes                  | Preferred LLM credential                       |
| `GEMINI_MODEL`       | No                   | Defaults to `gemini-3.5-flash-lite`             |
| `TURSO_DATABASE_URL` | Server configuration | Hosted SQLite endpoint                         |
| `TURSO_AUTH_TOKEN`   | Yes                  | Hosted database authentication                 |
| `OPENAI_API_KEY`     | Yes                  | LLM credential                                 |
| `OPENAI_MODEL`       | No                   | Defaults to `gpt-4.1-mini`                     |
| `GNANI_API_KEY`      | Yes                  | Speech provider credential                     |
| `GNANI_VOICE_ID`     | No                   | Defaults to catalog voice `Shivani`            |

Store production credentials in Vercel environment variables. Never put them in Git, `vercel.json`, a browser bundle, a screenshot, or a command-line argument. Environment files and local SQLite data are excluded from both Git and deployment uploads.

When both NVIDIA and Gemini are configured, Gemini interprets the original instruction and NVIDIA reviews the normalized plan. With only one configured, that provider is used; OpenAI is the legacy option when neither is configured. NVIDIA accepts `NVIDIA_API_KEY` or `NVIDIA_NIM_API_KEY`. Gemini accepts `GEMINI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, or `GOOGLE_API_KEY`. The server also accepts `OPEN_AI` and `GNANI_AI` as legacy names. Canonical names take precedence. Each value must contain only the key, without labels, internal whitespace, or additional credentials. A malformed value returns the safe `provider_configuration` error before calling the provider. Rebuild Production after saving a setting.

Production and preview should use separate databases when testing changes that write records. A preview must not run destructive setup against the production ledger. Schema initialization is a separate deliberate step, not a reset during every build.

## Initialize the hosted ledger

After connecting the Turso resource to the Vercel project, pull its configuration into an ignored file:

```bash
vercel env pull .env.production.local --environment production --yes
npm run db:hosted -- --import-local
npm run db:verify
```

The import is optional and only accepts an empty hosted ledger. It preserves local IDs, timestamps, reversal links, command records, and audit records. A recorded checksum makes repeating the same import safe; it refuses changed source data rather than overwriting hosted financial records. Do not use it as a two-way synchronization mechanism.

For later schema-only updates, run `npm run db:hosted` without the import flag. SQL migrations are applied transactionally, checksummed, and recorded in `_KhataXMigrations`. The runtime uses the Prisma libSQL adapter with `unixepoch-ms` timestamps to remain compatible with the existing native SQLite data.

`npm run db:verify` checks hosted Prisma reads, persistence across independent database clients, immutable entries, and rollback without changing financial records. Automated local ledger/browser tests explicitly disable Turso so they cannot write to production.

Gemini, OpenAI, and Gnani Production keys can be entered directly by the project owner or copied from an ignored local environment file with the owner's explicit authorization. Store them as sensitive server-only variables, pass values through stdin, and suppress credential-bearing command output. The repository does not automatically upload local keys during a build or Git push.

## Runtime details

The project uses Node 24 and `npm run build`. `vercel.json` selects Next.js and Fluid compute in Mumbai. The voice route has a three-minute function budget and closes each recording after two minutes, leaving time for cleanup. HTTP extraction and speech synthesis have shorter limits.

Vercel's `upgradeWebSocket()` API handles the actual socket lifecycle. The shared relay does not depend on an HTTP handler staying alive after its request finishes. Durable state is stored in the database and is not tied to a particular Node instance.

The relay sends the selected language as one `language_code` hint with `model=prisma-v3.0` and `format=codemix`. Although Gnani documents comma-separated language hints, the live endpoint rejected those hints during verification. Single-language sessions connected for English, Hindi, Kannada and Telugu. Keep the code-mixed output setting; do not interpret a successful handshake alone as a transcript-accuracy test.

Reference: [Vercel WebSockets](https://vercel.com/docs/functions/websockets), [upgradeWebSocket API](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package#upgradewebsocket), [Prisma with Turso](https://www.prisma.io/docs/orm/v6/overview/databases/turso).

## Access protection

Use Vercel Authentication on all deployments for the single-shop build. It protects the ledger and provider-backed endpoints using the owner's Vercel account without adding a complex application login flow. Share access deliberately through Vercel's sharing controls.

Turning production protection off makes the one shared shop and its paid API operations reachable by visitors. The code does not implement multi-tenant accounts or per-shop authorization. Public multi-shop service requires those features before launch.

## Verification checklist

1. Confirm project/team and deployed commit.
2. Confirm hosted schema and immutable-ledger triggers are installed.
3. Verify the application reads the hosted database rather than a temporary local file.
4. Create a test customer, preview a transaction, confirm it, reload, and verify persistence.
5. Reverse that test entry and verify the linked original/reversal and audit events.
6. Verify voice WebSocket upgrade, synthesis, and recognition with a short test.
7. Verify provider errors are honest: billing errors must not be reported as a successful AI transaction.
8. Confirm unauthenticated access is protected and secrets are absent from the source upload.

If OpenAI returns `openai_quota_exhausted`, fund the key's API billing account before retrying; redeployment does not remove that condition. If it returns `provider_configuration`, correct the Production key value and rebuild. Gnani synthesis, streaming recognition, and browser audio decoding passed the local live-provider checks; verify the owner's Production credentials separately.

For Gemini, `gemini_rate_limited` means the request reached Google's rate/quota limit; check the project's quota in AI Studio. `gemini_configuration` means the key, model, or project access needs attention. The application does not silently fall back to OpenAI or label a local parse as Gemini. Responses must finish successfully and pass the same Zod schema before becoming a saved preview.

References: [Gemini model](https://aistudio.google.com/docs/models/gemini-3.5-flash-lite), [structured output](https://aistudio.google.com/docs/structured-output), [REST API](https://aistudio.google.com/api-reference/generate-content).

NVIDIA uses `https://integrate.api.nvidia.com/v1/chat/completions` through the existing compatible SDK. Nemotron 3.5 Lightning uses deterministic sampling and schema-constrained JSON; this request format was accepted in live tests. The server still validates the completed output with Zod. When Gemini is also configured, Gemini first proposes the native-language meaning; Nemotron checks the normalized plan, and deterministic code blocks disagreement about action kinds, amounts, or specified dates. This is a consistency check, not independent proof of translation accuracy. Original names and uncertainty are preserved for downstream guards and user review. Labels identify `NVIDIA Nemotron + Gemini`; failures do not silently change providers. See [NVIDIA's hosted API example](https://build.nvidia.com/nvidia/nemotron-3.5-lightning-30b-a3b/build).

Sarvam Saaras v4 recognition uses the documented realtime endpoint with `Api-Subscription-Key`, linear16 PCM, 16 kHz samples, and `session.begin` / `audio_input` / `transcript.final` / `end` events. The shared relay enforces session, frame, transcript, and buffering limits, and closes upstream audio when the browser cancels. The catalog covers 22 scheduled languages plus English and automatic detection; see [language coverage and live verification](LANGUAGES.md).

## Updates and rollback

Push reviewed changes to GitHub, run the checks, and deploy a new version. Retain the previous deployment for rollback. Application rollback does not undo database writes or migrations; financial corrections still use linked reversals. Back up/export business records and review schema changes before applying them to a live shop.
