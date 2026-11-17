# Indian-language support

KhataX OS exposes all **22 scheduled Indian languages plus English**, with an automatic language-detection option. This is the supported catalog, not a claim to recognize every Indian dialect or mother tongue.

## Voice recognition

With `SARVAM_API_KEY` configured, Sarvam Saaras v4 handles the entire catalog through its documented realtime WebSocket API. The server keeps the key private and relays bounded mono 16 kHz audio sessions. The browser receives normalized connection, interim, final transcript, and safe error events.

| Language | Code | Gnani alternative |
| --- | --- | --- |
| Assamese | `as-IN` | — |
| Bengali | `bn-IN` | Available |
| Bodo | `brx-IN` | — |
| Dogri | `doi-IN` | — |
| Gujarati | `gu-IN` | Available |
| Hindi | `hi-IN` | Available |
| Kannada | `kn-IN` | Available |
| Kashmiri | `ks-IN` | — |
| Konkani | `kok-IN` | — |
| Maithili | `mai-IN` | — |
| Malayalam | `ml-IN` | Available |
| Manipuri | `mni-IN` | — |
| Marathi | `mr-IN` | Available |
| Nepali | `ne-IN` | — |
| Odia | `or-IN` | — |
| Punjabi | `pa-IN` | Available |
| Sanskrit | `sa-IN` | — |
| Santali | `sat-IN` | — |
| Sindhi | `sd-IN` | — |
| Tamil | `ta-IN` | Available |
| Telugu | `te-IN` | Available |
| Urdu | `ur-IN` | — |
| English | `en-IN` | Available |

Sarvam realtime uses `or-IN` for Odia and `auto` for language detection. Do not copy the different Odia code from its legacy API. All 23 configured language codes and auto-detection were accepted in live provider session checks. An English synthetic WAV passed through the actual relay and produced a matching final transcript. Those checks prove protocol/configuration and one audio round-trip; they do not certify native-speaker accuracy for every language, dialect, microphone, or shop environment.

Without Sarvam, the configured Gnani provider supports its documented nine Indian languages plus English. Selecting another language produces an explicit setup message rather than silently switching to Hindi. Without server speech credentials, browser speech is clearly labeled as a browser-dependent demo; typed input remains available.

## Meaning and financial safety

With both configured LLM keys, Gemini performs BhashaBridge language understanding and proposes structured intentions. Nemotron 3.5 Lightning reviews the normalized plan using schema-constrained JSON. Server code compares action kinds, exact amounts, and specified dates; disagreement blocks the request. This plan-consistency check is not independent proof that a translation is correct. The original transcript stays available for user review and deterministic identity/date safeguards.

No model can execute a financial write. Customer identity, integer-paise amounts, dates, duplicate warnings, and confirmation are checked by application code. Shared spoken names cannot become unambiguous merely because a model guesses a full name. Resolving an amount does not silently resolve a separate date or identity question.

NVIDIA-only and Gemini-only configurations remain available. Provider labels show the path actually used. Errors do not silently change providers or post a transaction. Physical microphone quality and native-language accuracy should be evaluated with representative speakers before use in a live shop.

## Configuration

```dotenv
SARVAM_API_KEY=""
SARVAM_STT_MODEL="saaras:v4"
NVIDIA_API_KEY=""
NVIDIA_MODEL="nvidia/nemotron-3.5-lightning-30b-a3b"
GEMINI_API_KEY=""
GEMINI_MODEL="gemini-3.5-flash-lite"
GNANI_API_KEY=""
```

Keep actual values in ignored local environment files and sensitive Vercel Production secrets. `GNANI_API_KEY` still supplies optional spoken replies; changing recognition providers does not require replacing that TTS integration.

Sources: [Sarvam language coverage](https://docs.sarvam.ai/api/getting-started/models), [Sarvam realtime API](https://docs.sarvam.ai/api/api-guides-tutorials/speech-to-text/realtime-streaming), [Gnani supported streaming languages](https://docs.gnani.ai/api/STT/stt-websocket).
