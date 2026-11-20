# Release verification — 20 November 2026

## 20 November release review

Automatic detection is the default Sarvam path. No browser fallback silently replaces `auto` with Hindi: browser compatibility requires an explicit language, and choosing Auto routes back to Sarvam. Chrome's real capture test passed with `language=auto`, 361 PCM frames, the expected 350-rupee payment preview, and unchanged ledger balances. All 20 compiled browser workflows, 12 automated tests, TypeScript, and the production build pass for this change.

Additional speech recovery: capture now reports missing frames, silent input, provider silence, missing final results, and unexpected connection closure rather than failing silently. The assistant offers an explicitly selected browser-speech compatibility mode with language selection; it does not claim browser recognition came from Sarvam. All 12 automated tests and the production build pass. Real Chrome capture to Sarvam again returned the correct 350-rupee payment preview (365 PCM frames) without posting entries. Physical laptop microphone behavior still requires user acceptance.

Voice follow-up: microphone audio is now unlocked during the button click, before asynchronous permission/provider setup. The UI shows a connecting state until capture actually runs, and startup timeouts include the audio engine. All 11 automated tests, TypeScript, and the production build pass. `VERIFY_URL=http://127.0.0.1:3015 node scripts/microphone-check.mjs` passed using Chrome's synthetic microphone device with the real AudioWorklet, 362 outgoing PCM frames, real Sarvam recognition, and a correct 350-rupee payment review. The isolated ledger remained unchanged. Generate the known input recording with the live verifier's `--speech-only` option first. This verifies the browser capture path with synthetic audio, not the user's physical microphone or every browser/device.

Independent backend, product QA, and DevOps reviews found and fixed five issues: clarification could switch the reviewed correction target to a newer entry; a correction date override could be lost; simultaneous clarification could leave multiple live previews; pressing Stop could discard the final speech result; and a delayed spoken reply could play after replies were disabled. Clarification now supersedes its parent atomically, rejects expired previews, and retains the reviewed target. Voice finalization preserves the session, while reply cancellation invalidates pending audio.

Fresh verification of this release passes all 10 automated tests, TypeScript, the optimized production build, and 19 compiled Chrome workflows. The new browser checks simulate final speech arriving only after Stop and delayed synthesis arriving after replies are disabled. The live provider suite separately passes all nine checks, including real Sarvam audio-to-ledger preview and playable Gnani speech, with ledger balances unchanged. Browser and financial write tests use isolated SQLite databases.

GitHub Actions now runs installation, Prisma generation, source-secret exclusion, tests, typechecking, and the production build without production credentials. These checks report results; Vercel Git autodeployment is not configured to wait for them. This release was tested locally before publication.

The release uses hosted SQLite for durable records, Sarvam Saaras v4 for recognition, Gemini for native-language understanding, NVIDIA Nemotron 3.5 Lightning for normalized-plan review, and Gnani Timbre v3.0 for spoken replies. Provider keys remain server-only and are excluded from Git and source archives.

## Automated and compiled application checks

- All 10 Node tests pass, including financial lifecycle integration, provider output validation, safe errors, origin validation, microphone cancellation, and both speech protocols.
- TypeScript and the optimized Next.js production build pass.
- Compiled Chrome QA passes all 19 recorded workflows: customer create/edit, keyboard dialog cancellation and restored focus, preview without writing, exact payment/credit arithmetic, multiple actions, identity clarification, reversal, URL/search state, customer search, insights, audit disclosure, CSV export, cross-origin rejection, final speech after Stop, cancellation of delayed replies, mobile review, responsive layouts, and absence of browser exceptions.
- The QA runner refuses hosted/non-loopback targets before financial test writes. QA databases are isolated SQLite files, and default browser QA disables provider credentials.
- Rendered layouts have no horizontal overflow at 320, 375, 768, 1280, 1440, and 1920px coverage points across the recorded checks.

## Financial safety regressions

The expanded integration suite checks exact integer paise, input/date limits, spoken amounts, atomic multi-action writes, rollback, duplicate warnings, reversals, corrections, immutable entry/audit triggers, cancellation, expiry, and concurrent confirmation idempotency.

Two safety gaps found during independent review are fixed: a shared spoken customer nickname cannot become unique just because an LLM guesses a full name; resolving one amount/date/customer question does not clear other pending questions. AI credit/payment proposals require a valid date rather than silently treating a missing date as today. Explicitly selected identities persist through later clarification rounds.

Browser QA also found and verified fixes for modal opener focus, microphone startup/cancellation races, and Next.js canonicalizing local request URLs to localhost while the browser uses 127.0.0.1. The shared origin guard permits only matching actual destinations and bounded loopback aliases; foreign origins, cross-port requests, and forged nonlocal hosts remain rejected.

## Real provider checks on an isolated compiled app

All checks passed with actual configured providers:

- Hindi self-correction: 500 corrected to 350.
- Kannada-English spoken amount: 200.
- Telugu spoken amount: 350.
- English multiple actions with exact 125.50 credit and 50 payment.
- Shared customer identity requires clarification.
- Gnani synthesis returns playable audio, decoded successfully by Chrome.
- Synthesized speech passes through the real Sarvam WebSocket relay, preserving customer, payment intent, and 350 rupees; the transcript then produces the correct validated ledger preview.
- All previews are cancelled; financial entry counts and customer balances remain unchanged.

The full HTTP/WebSocket integration check exposed a Next.js duplicate-upgrade-listener bug that a relay-only test did not catch. The custom server now isolates Next's implicit upgrade handler with its public httpServer option, so the voice socket has one owner while non-voice/HMR upgrades still reach Next. The previously failing real streaming round-trip now passes.

## Language coverage

All 22 scheduled Indian languages plus English are selectable, along with automatic detection. Real Sarvam sessions accepted all 23 language codes and auto-detection (24 configurations). A synthetic audio round-trip proves the streaming protocol; it does not certify per-language accuracy for every dialect, native speaker, microphone, or noisy shop. See [the full language catalog and limitations](docs/LANGUAGES.md).

Gemini interprets the original language and Nemotron reviews its normalized plan. Deterministic code blocks disagreements about action kinds, amounts, and specified dates. This consistency check is not independent proof that a translation is correct; the original transcript, customer guards, and explicit user confirmation remain essential.

## Visual review

The interface follows the supplied Scaler/Wispr reference's dark workspace, cream ledger canvas, lavender controls, and typography using KhataX content and working product controls. A fresh-context Hallmark finish review identified manual-entry controls below the first fold; the fix places Add customer and New entry near the opening actions at desktop and mobile sizes. The finding was resolved on recapture. Final rendered Hallmark sweep: 0 failures, 0 warnings, with three documented dismissals in the local review record. The repository screenshot uses clean labeled seed data.

## Reproducing checks

Run `npm test`, `npm run typecheck`, and `npm run build`. On Windows, stop local processes that lock generated build/Prisma files before rebuilding.

Run `node scripts/qa-server.mjs`, then `node scripts/browser-check.mjs` for isolated compiled browser QA. `QA_PORT` and `QA_URL` allow another loopback port.

For explicitly authorized live requests, run `node scripts/qa-server.mjs --live-providers` (default port 3003), then set `VERIFY_URL` to that loopback URL and run `node scripts/verify-providers.mjs --browser`. This loads local keys but still disables hosted storage. These calls can consume provider quota. Reports and temporary databases remain under ignored `test-results/`.

## Production scope

Vercel Authentication protects the single-shop deployment, and external Turso SQLite retains customers, transactions, reversal links, commands, and audit history across deployments. Earlier deployed persistence checks posted a one-paise test credit and its linked reversal; both remain auditable. Current release provider verification creates previews only. Application rollback never erases database history.

This is a one-shop hackathon application. Public multi-shop use requires application accounts and tenant isolation. Physical microphone quality and broad native-speaker evaluation remain human acceptance tests; the release does not claim every Indian mother tongue or dialect has been certified.
