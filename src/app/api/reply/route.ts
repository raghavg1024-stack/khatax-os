import { z } from "zod";
import { isSameOriginRequest } from "@/lib/origin";
import { UserInputError } from "@/lib/errors";
import { localizeReply } from "@/lib/replies";

export const runtime = "nodejs";
export const maxDuration = 20;
const schema = z.object({ text: z.string().trim().min(1).max(700), language: z.string().max(12) });
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return Response.json({ error: "Invalid origin." }, { status: 403 });
  try {
    const raw = await request.text();
    if (raw.length > 5000) return Response.json({ error: "Reply request is too large." }, { status: 413 });
    const body = schema.parse(JSON.parse(raw));
    return Response.json(await localizeReply(body.text, body.language), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof UserInputError) return Response.json({ error: error.message, code: error.code }, { status: error.status });
    if (error instanceof z.ZodError || error instanceof SyntaxError) return Response.json({ error: "Invalid reply request." }, { status: 400 });
    return Response.json({ error: "Could not translate the reply. The original result is available." }, { status: 502 });
  }
}
