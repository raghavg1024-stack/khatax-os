import nextEnv from "@next/env";
nextEnv.loadEnvConfig(process.cwd());
const safeCode = (value) =>
  typeof value === "string" && /^[a-zA-Z_0-9.-]{1,80}$/.test(value)
    ? value
    : undefined;
await Promise.all(
  [
    [
      "OpenAI",
      "https://api.openai.com/v1/responses",
      {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      {
        model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
        input: "Reply OK.",
        max_output_tokens: 16,
        store: false,
      },
    ],
    [
      "Gnani",
      "https://api.vachana.ai/api/v1/tts/inference",
      {
        "X-API-Key-ID": process.env.GNANI_API_KEY,
        "Content-Type": "application/json",
      },
      {
        text: "Connection verified.",
        voice: process.env.GNANI_VOICE_ID || "Shivani",
        model: "timbre-v3.0",
        language: "en-IN",
        speed: 1,
        audio_config: {
          sample_rate: 24000,
          num_channels: 1,
          sample_width: 2,
          encoding: "linear_pcm",
          container: "wav",
        },
      },
    ],
  ].map(async ([provider, url, headers, body]) => {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(25000),
      });
      let details = {};
      if (response.headers.get("content-type")?.includes("json")) {
        const json = await response.json();
        if (!response.ok)
          details = {
            code: safeCode(json.error?.code || json.detail?.error_code),
            type: safeCode(json.error?.type),
            parameter: safeCode(json.error?.param),
          };
      }
      console.log(
        JSON.stringify({
          provider,
          status: response.status,
          ok: response.ok,
          contentType: response.headers.get("content-type"),
          ...details,
        }),
      );
      await response.body?.cancel().catch(() => {});
    } catch (error) {
      console.log(
        JSON.stringify({
          provider,
          transportError: true,
          name: safeCode(error.name),
          cause: safeCode(error.cause?.code || error.code),
        }),
      );
    }
  }),
);
