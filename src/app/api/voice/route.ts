import { upgradeWebSocket } from "@vercel/functions";
import { relayVoice } from "@/lib/voice-relay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

/** Vercel's native persistent WebSocket lifecycle, not a short-lived HTTP audio handler. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin)
    return Response.json({ error: "Invalid origin." }, { status: 403 });
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return Response.json(
      { error: "Use a WebSocket connection for streaming speech." },
      { status: 426 },
    );
  }
  return upgradeWebSocket(
    (client) => relayVoice(client, url.searchParams.get("language")),
    { maxPayload: 8192 },
  );
}
