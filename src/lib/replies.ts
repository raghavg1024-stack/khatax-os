import { LANGUAGES } from "./languages";
import { sarvamKey, assertProviderKey } from "./provider-config";
import { UserInputError } from "./errors";

/** Translation is presentation only; financial values remain application-authored. */
export async function localizeReply(text: string, language: string) {
  if (!LANGUAGES.some(item => item.code === language))
    throw new UserInputError("Choose a supported reply language.");
  if (language === "en-IN") return { text, language, translated: false };
  const key = sarvamKey();
  if (!key) throw new UserInputError("Same-language replies require the Sarvam key.", "reply_configuration", 503);
  assertProviderKey(key, "Sarvam");
  const values: string[] = [];
  const placeholders: string[] = [];
  let sequence = 0;
  const nextToken = () => {
    let candidate: string;
    do {
      let ordinal = sequence++, letters = "";
      do { letters = String.fromCharCode(65 + ordinal % 26) + letters; ordinal = Math.floor(ordinal / 26) - 1; } while (ordinal >= 0);
      candidate = `__${letters}__`;
    } while (text.includes(candidate));
    return candidate;
  };
  const input = text.replace(/[\p{N}]+(?:[.,:/-][\p{N}]+)*/gu, value => {
    values.push(value);
    const placeholder = nextToken();
    placeholders.push(placeholder);
    return placeholder;
  });
  if (input.length > 2000)
    throw new UserInputError("Reply is too long to translate safely.", "reply_too_long");
  let response: Response;
  try {
    response = await fetch("https://api.sarvam.ai/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-subscription-key": key },
      body: JSON.stringify({ input, source_language_code: "en-IN", target_language_code: language === "or-IN" ? "od-IN" : language, model: "sarvam-translate:v1", mode: "formal", numerals_format: "international" }),
      signal: AbortSignal.timeout(12000),
    });
  } catch {
    throw new UserInputError("Reply translation could not connect. The original result is available.", "reply_unavailable", 503);
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new UserInputError("Reply translation is unavailable. The original result is available.", "reply_unavailable", response.status === 429 ? 429 : 502);
  }
  try {
    const body = await response.json();
    let result = typeof body.translated_text === "string" ? body.translated_text.trim() : "";
    if (!result || result.length > 3000 || /\p{N}/u.test(result)) throw new Error("Unsafe translation");
    for (let index = 0; index < values.length; index++) {
      const placeholder = placeholders[index];
      if (result.split(placeholder).length !== 2) throw new Error("Changed financial token");
    }
    for (let index = 0; index < values.length; index++) result = result.replace(placeholders[index], values[index]);
    return { text: result, language, translated: true };
  } catch {
    throw new UserInputError("The translated reply could not preserve the original values. Review the original result.", "reply_invalid_output", 502);
  }
}
