/** Server-only lookups, including the Production names selected during setup. */
export function openAIKey() {
  return (process.env.OPENAI_API_KEY || process.env.OPEN_AI)?.trim();
}
export function geminiKey() {
  return (
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
    process.env.GOOGLE_API_KEY
  )?.trim();
}
export function nvidiaKey() {
  return (process.env.NVIDIA_API_KEY || process.env.NVIDIA_NIM_API_KEY)?.trim();
}
export function llmProvider() {
  return nvidiaKey()
    ? geminiKey() ? "NVIDIA Nemotron + Gemini" : "NVIDIA Nemotron"
    : geminiKey() ? "Gemini" : openAIKey() ? "OpenAI" : "Local parser · demo";
}
export function gnaniKey() {
  return (process.env.GNANI_API_KEY || process.env.GNANI_AI)?.trim();
}
export function sarvamKey() {
  return process.env.SARVAM_API_KEY?.trim();
}
import { UserInputError } from "./errors";

export function assertProviderKey(
  key: string,
  provider: "OpenAI" | "Gemini" | "NVIDIA" | "Gnani" | "Sarvam",
) {
  if (!/^[\x21-\x7e]+$/.test(key)) {
    throw new UserInputError(
      `${provider} key setting must contain only one API key on one line, without labels or other credentials. Update the Production setting and redeploy.`,
      "provider_configuration",
    );
  }
}
