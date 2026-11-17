import OpenAI from "openai";
import {z} from "zod";
import {extractionSchema, toPaise, type ExtractedAction} from "./shared";
import {zodResponseFormat} from "openai/helpers/zod";
import {UserInputError} from "./errors";
import {assertProviderKey} from "./provider-config";

/** NVIDIA's documented Chat Completions endpoint uses the already-installed SDK. */
export async function extractNvidia(text: string, instruction: string, key: string) {
  assertProviderKey(key, "NVIDIA");
  const client = new OpenAI({
    apiKey: key,
    baseURL: "https://integrate.api.nvidia.com/v1",
    timeout: 25000,
    maxRetries: 0,
  });
  let response;
  try {
    response = await client.chat.completions.create({
      model: process.env.NVIDIA_MODEL || "nvidia/nemotron-3.5-lightning-30b-a3b",
      messages: [
        {role:"system",content:`${instruction}\nReturn only JSON matching this schema: ${JSON.stringify(z.toJSONSchema(extractionSchema))}`},
        {role:"user",content:text},
      ],
      response_format: zodResponseFormat(extractionSchema,"ledger_intentions"),
      temperature: 0,
      max_tokens: 4096,
      stream: false,
      ...{chat_template_kwargs:{enable_thinking:false}},
    });
  } catch (error) {
    // Raw SDK/provider errors must never reach the browser or logs.
    if (error instanceof OpenAI.APIError && error.status === 429)
      throw new UserInputError("NVIDIA quota or rate limit reached. Check NVIDIA API access, wait, and retry. Manual entries still work.", "nvidia_rate_limited", 429);
    if (error instanceof OpenAI.APIError && [400,401,403,404].includes(error.status ?? 0))
      throw new UserInputError("NVIDIA rejected the request. Check NVIDIA_API_KEY, model access, and NVIDIA_MODEL.", "nvidia_configuration", 502);
    throw new UserInputError("NVIDIA could not complete the request. Retry or use a manual entry.", "nvidia_unavailable", 503);
  }
  try {
    const candidate = response.choices[0];
    if (candidate?.finish_reason !== "stop" || !candidate.message.content || candidate.message.refusal)
      throw new Error("Incomplete output");
    return extractionSchema.parse(JSON.parse(candidate.message.content)).actions;
  } catch {
    throw new UserInputError("NVIDIA did not return a complete, valid ledger instruction. Rephrase or use a manual entry.", "nvidia_invalid_output", 502);
  }
}

/** BhashaBridge understands the original language; Nemotron checks the normalized plan's consistency. */
export async function reviewWithNvidia(actions: ExtractedAction[], instruction: string, key: string) {
  const reviewed = await extractNvidia(
    `Review these normalized ledger intentions. Preserve their exact action order, amounts, customer names, dates, and unresolved questions. Do not invent or expand any field. Return the same ledger schema.\n${JSON.stringify({actions})}`,
    instruction,
    key,
  );
  const amountKey = (value: string | null) => {
    if (value === null) return null;
    try { return toPaise(value); } catch { return value.trim(); }
  };
  if (
    reviewed.length !== actions.length ||
    actions.some((action,index) => {
      const other=reviewed[index];
      return action.kind !== other.kind ||
        (!action.needsClarification && amountKey(action.amount) !== amountKey(other.amount)) ||
        (action.date !== null && action.date !== other.date);
    })
  ) throw new UserInputError("The language checks disagreed about this instruction. Rephrase it or use a manual entry; nothing was posted.","intent_disagreement",422);
  return actions.map((action,index)=>({
    ...action,
    needsClarification: action.needsClarification || reviewed[index].needsClarification,
    question: action.question || reviewed[index].question,
  }));
}
