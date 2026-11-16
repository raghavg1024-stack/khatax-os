import nextEnv from "@next/env";
nextEnv.loadEnvConfig(process.cwd());
const safeCode = (value) =>
  typeof value === "string" && /^[a-zA-Z_0-9.-]{1,80}$/.test(value)
    ? value
    : undefined;
const geminiKey = (process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_API_KEY)?.trim();
const nvidiaKey = (process.env.NVIDIA_API_KEY || process.env.NVIDIA_NIM_API_KEY)?.trim();
await Promise.all(
  [
    nvidiaKey ? [
      "NVIDIA Nemotron",
      "https://integrate.api.nvidia.com/v1/chat/completions",
      { Authorization: `Bearer ${nvidiaKey}`, "Content-Type": "application/json" },
      { model: process.env.NVIDIA_MODEL || "nvidia/nemotron-3.5-lightning-30b-a3b", messages: [{role:"user",content:"Reply OK."}], max_tokens:64, chat_template_kwargs:{enable_thinking:false} },
    ] : geminiKey ? [
      "Gemini",
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(process.env.GEMINI_MODEL || "gemini-3.5-flash-lite")}:generateContent`,
      { "x-goog-api-key": geminiKey, "Content-Type": "application/json" },
      { contents: [{parts:[{text:"Reply OK."}]}], generationConfig: {maxOutputTokens:64} },
    ] : [
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
