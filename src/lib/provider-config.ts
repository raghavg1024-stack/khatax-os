/** Server-only lookups, including the Production names selected during setup. */
export function openAIKey() {
  return (process.env.OPENAI_API_KEY || process.env.OPEN_AI)?.trim();
}
export function gnaniKey() {
  return (process.env.GNANI_API_KEY || process.env.GNANI_AI)?.trim();
}
import { UserInputError } from "./errors";

export function assertProviderKey(key: string, provider: "OpenAI" | "Gnani") {
  if (!/^[\x21-\x7e]+$/.test(key)) {
    throw new UserInputError(
      `${provider} key setting must contain only one API key on one line, without labels or other credentials. Update the Production setting and redeploy.`,
      "provider_configuration",
    );
  }
}
