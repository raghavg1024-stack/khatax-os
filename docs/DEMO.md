# Five-minute hackathon demo

## Prepare

Open the app, allow microphone access, choose Hindi/English, Kannada/English, Telugu/English, or English, and check provider settings. Use sample customer records or an explicitly created demo customer. Enable spoken replies if desired.

For live AI processing, the OpenAI account needs API credits. Without a configured LLM key, the app offers a clearly labeled limited local parser. A configured key with exhausted credits produces an honest billing error rather than pretending a transaction succeeded.

## Show the flow

1. **Overview:** explain that every total is derived from saved entries, using integer paise.
2. **Self-correction:** say “Ravi ka 500 add karo, nahi 350.” Review ₹350, then confirm. Show the new ledger entry.
3. **Identity safety:** say “Ramesh ka teen sau chaalis udhaar add karo.” Choose the intended Ramesh, then review. Discard if you do not want another entry.
4. **Several actions:** say “Ravi ko 100 credit do aur Sunita ne 50 diye.” Review both actions and their warnings; confirm once.
5. **Balance memory:** ask “Ravi ka balance batao.” Explain that the answer comes from stored ledger entries, not a guessed model number.
6. **Time Machine:** undo the previous transaction from its row. Acknowledge the warning, then show the original and linked reversal in the ledger/audit view.
7. **Reports/export:** show the seven-day chart, customer balances, filters, and CSV download.

## Explain the differentiator

The AI understands the instruction; deterministic code controls the money. A preview is not a posted entry. Database history is durable, and corrections preserve the original record. Code-mixed speech is useful in the shop, while identity and amount clarification keep uncertainty visible.

## State the limits candidly

The build serves one shop. It is not a tax filing system, a money-transfer service, a multi-tenant SaaS, or an inventory application. Physical microphone quality in a noisy shop still needs real-world testing. Vercel voice sessions are bounded, and each new recording opens a new socket. No feature depends on the LLM directly changing a balance.
