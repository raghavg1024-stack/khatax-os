# Deploying KhataX OS

Production: **https://khatax-os.vercel.app**. Source: [private GitHub repository](https://github.com/raghavg1024-stack/khatax-os). Vercel Authentication protects the site; use the owner's Vercel login.

The Vercel deployment uses Next.js, a hosted SQLite database, and native Node WebSocket sessions. Local development retains the custom persistent Node server and local SQLite option.

## Deployment resources

| Resource                  | Purpose                                                                 |
| ------------------------- | ----------------------------------------------------------------------- |
| Private GitHub repository | Source, schema/migrations, tests, detailed documentation                |
| Vercel project            | HTTPS web interface, HTTP APIs, bounded native voice WebSocket sessions |
| Turso hosted SQLite       | Durable customers, entries, commands, and audit history                 |
| OpenAI project/key        | Structured multilingual intention extraction                            |
| Gnani key                 | Prisma v3.0 streaming recognition and Timbre v3.0 speech synthesis      |

Turso's Starter plan was selected for the initial database setup. Account/marketplace terms must be accepted by the account owner before provisioning. Additional usage or paid plans are not automatically authorized by this repository.

## Environment variables

| Variable             | Secret?              | Meaning                                        |
| -------------------- | -------------------- | ---------------------------------------------- |
| `DATABASE_URL`       | Local path/config    | Prisma CLI SQLite URL for local migration work |
| `TURSO_DATABASE_URL` | Server configuration | Hosted SQLite endpoint                         |
| `TURSO_AUTH_TOKEN`   | Yes                  | Hosted database authentication                 |
| `OPENAI_API_KEY`     | Yes                  | LLM credential                                 |
| `OPENAI_MODEL`       | No                   | Defaults to `gpt-4.1-mini`                     |
| `GNANI_API_KEY`      | Yes                  | Speech provider credential                     |
| `GNANI_VOICE_ID`     | No                   | Defaults to catalog voice `Shivani`            |

Store production credentials in Vercel environment variables. Never put them in Git, `vercel.json`, a browser bundle, a screenshot, or a command-line argument. Environment files and local SQLite data are excluded from both Git and deployment uploads.

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

OpenAI and Gnani Production keys are added directly by the project owner. This deployment workflow does not upload the local provider keys.

## Runtime details

The project uses Node 24 and `npm run build`. `vercel.json` selects Next.js and Fluid compute in Mumbai. The voice route has a three-minute function budget and closes each recording after two minutes, leaving time for cleanup. HTTP extraction and speech synthesis have shorter limits.

Vercel's `upgradeWebSocket()` API handles the actual socket lifecycle. The shared relay does not depend on an HTTP handler staying alive after its request finishes. Durable state is stored in the database and is not tied to a particular Node instance.

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

OpenAI returned `credit_balance_exhausted` during the last live check. This requires funding the key's API billing account; deploying the same key does not remove that condition. Gnani synthesis, streaming recognition, and browser audio decoding passed the local live-provider checks.

## Updates and rollback

Push reviewed changes to GitHub, run the checks, and deploy a new version. Retain the previous deployment for rollback. Application rollback does not undo database writes or migrations; financial corrections still use linked reversals. Back up/export business records and review schema changes before applying them to a live shop.
