# Verification

The production build, TypeScript check, and isolated SQLite integration test passed. The browser test exercises the compiled production app on a separate database; it does not alter the sample shop ledger.

The final rendered design sweep passed with no open Floor, Reflex, or warning findings across desktop/mobile captures, including a 320px overflow check. Screenshots are in `.hallmark/shots/`.

## Automated coverage

- Exact paise conversion, amount bounds, invalid dates, spoken numbers, ambiguity, and in-sentence corrections.
- Server-side previews leave balances unchanged; retries of the same command create no extra entries.
- Duplicate warnings require acknowledgment; identity selection clears the correct clarification.
- Multiple entries post atomically; a failed action rolls back the whole batch and command claim.
- Reversals cancel the original financial effect; corrections create reversal/replacement links.
- Read-only queries create no financial entries; mixed command queries use the post-commit balance.
- Database triggers reject updates/deletes of entries and audit records.
- Chrome: customer create/edit, manual review/posting, multiple actions, identity clarification, row reversal, URL search state, customer search, reports, audit details, CSV export, cross-origin mutation rejection, mobile overflow, and no browser exceptions.
- Voice WebSocket fallback returns an explicit demo status. The browser SpeechRecognition-to-review event path is checked with a mocked browser speech API; this does not verify microphone transcription quality.

Run `npm test`, `npm run typecheck`, and `npm run build` for core checks. Run `node scripts/qa-server.mjs`, then in another terminal `node scripts/browser-check.mjs` for browser QA (the script expects Chrome at its standard Windows installation path). Test artifacts are in the ignored `test-results/` directory.

## Requires credentials or human verification

On 16 November 2026, live Gnani Timbre v3.0 synthesis and Prisma v3.0 streaming recognition passed a synthesized speech round-trip through the app's HTTP and WebSocket endpoints. The transcript preserved the customer, payment intent, and amount. Chrome successfully decoded the synthesized speech audio. No financial entries or balances changed during verification. The provider returned unknown-length WAV headers; the app now finalizes those lengths for browser compatibility, covered by a regression test.

OpenAI authentication reaches the API, but requests return HTTP 429 with `credit_balance_exhausted` and type `insufficient_quota`. Live LLM extraction remains blocked until API credits are added. The UI now distinguishes this billing condition from a generic key failure. Physical microphone capture and recognition quality in a noisy shop still need a human microphone session. Browser speech support varies by browser.

Run `node scripts/diagnose-providers.mjs` for safe status/error-code diagnostics. Run `node scripts/verify-providers.mjs --speech-only` for the Gnani round-trip, or omit the flag to also test live multilingual LLM extraction. These checks use billable provider requests, keep credentials on the server, cancel all command previews, and leave financial entries unchanged.

The app is scoped to one trusted shop. The Vercel deployment provides HTTPS, Vercel Authentication, and hosted SQLite persistence. A public service serving multiple shops still requires application accounts and tenant isolation.

## Hosted database verification

The Turso Starter database is provisioned in Mumbai and connected to the Vercel project's Production environment. The existing 8 customers, 37 entries, and 37 audit events were imported with IDs and timestamps preserved. All five immutable/validation triggers were installed.

Hosted Prisma reads, a write/read across independent database clients, rejection of entry updates, and atomic rollback passed. Verification writes only an internal health marker; it does not create financial transactions. Production provider keys are stored as sensitive server-only environment variables.

## Deployed application verification

Production deployment `12cc4d0` reached Ready on Vercel in Mumbai. Authenticated requests to the deployed API confirmed hosted SQLite, all 8 imported customers, preview without posting, a one-paise credit persisted across separate HTTP requests, and a linked reversal restoring the original customer balance. The two verification entries remain auditable, bringing the ledger to 39 entries. Foreign-origin mutations were rejected, and unauthenticated access was protected by Vercel Authentication.

The initial deployed verification reported local-parser/browser-speech demo providers while the owner configured the API keys directly in Vercel. No local OpenAI or Gnani keys were uploaded by the deployment process. The server now also supports the owner's sensitive `OPEN_AI` and `GNANI_AI` variable names without reading or replacing their values. Alias precedence and fallback are covered by a regression test.

The deployed voice endpoint also passed a real HTTP-to-WebSocket upgrade and returned an explicit demo event while its provider key is absent. Local demo seeding uses a direct local SQLite client, so pulling production configuration cannot accidentally seed the hosted ledger.

## Production provider verification — 17 November 2026

With the owner's explicit authorization, the existing OpenAI and Gnani keys were copied from ignored `.env.local` into sensitive Production variables `OPENAI_API_KEY` and `GNANI_API_KEY`. Values were validated in memory, passed through stdin, and excluded from command output and Git. The temporary upload helper was removed afterward.

The refreshed deployment reached Ready. Its authenticated provider checks confirmed:

- OpenAI key formatting is valid and requests reach the API. Structured intent extraction is blocked by HTTP 429 / `openai_quota_exhausted`; API billing must be funded before live LLM verification can pass. Another key-format edit or redeployment will not fix this billing response.
- Gnani Timbre speech generation returned HTTP 200 and a valid WAV audio container.
- Gnani Prisma's Hindi streaming session upgraded to WebSocket and returned `connected` without a provider error. This verifies the deployed session setup, not physical microphone accuracy.
- Financial entry counts and every customer balance remained unchanged throughout the checks.

The hosted ledger and manual entry/review workflow remain available while OpenAI credits are exhausted. The app reports the billing error instead of presenting the request as successful AI processing.

## Gemini migration

Gemini structured extraction is implemented using native REST and the existing Zod action schema. Gemini takes precedence when its key is present; there is no silent provider fallback. The optimized production build, TypeScript, and five automated tests passed, including valid structured output, forbidden action kinds, invalid amount types, empty action lists, truncated output, safe quota/auth errors, provider selection, and the financial ledger lifecycle. Live Gemini verification still requires the owner to add `GEMINI_API_KEY`; mocked provider tests do not prove account quota or live model access.
