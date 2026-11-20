import { z } from "zod";
import { isSameOriginRequest } from "@/lib/origin";
import { UserInputError } from "@/lib/errors";
import { db } from "@/lib/db";
import { audit, clarify, commit, prepare } from "@/lib/ledger";
import { extract } from "@/lib/intent";
import { resolveCustomerName } from "@/lib/customer-answer";
import {
  dateSchema,
  indiaDate,
  money,
  type ResolvedAction,
} from "@/lib/shared";

const customerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  phone: z
    .string()
    .regex(
      /^(?:\+91[ -]?)?[6-9]\d{9}$|^$/,
      "Use a valid Indian mobile number, or leave it blank.",
    ),
  nicknames: z.string().trim().max(200),
});
const id = z.string().min(1).max(100);
const requestSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("customer"),
    id: id.optional(),
    ...customerSchema.shape,
  }),
  z.object({
    op: z.literal("preview"),
    text: z.string().trim().min(3).max(2000),
  }),
  z.object({
    op: z.literal("manual"),
    customerId: id,
    kind: z.enum(["credit", "payment"]),
    amount: z.string().max(25),
    date: dateSchema,
    note: z.string().trim().max(300),
  }),
  z.object({
    op: z.literal("clarify"),
    commandId: id,
    overrides: z.record(
      z.string(),
      z.object({
        customerId: id.optional(),
        amount: z.string().max(25).optional(),
        date: dateSchema.optional(),
      }),
    ),
  }),
  z.object({
    op: z.literal("commit"),
    commandId: id,
    acknowledge: z.boolean(),
  }),
  z.object({ op: z.literal("cancel"), commandId: id }),
  z.object({ op: z.literal("reverse"), entryId: id }),
  z.object({op:z.literal("answerCustomer"),commandId:id,text:z.string().trim().min(1).max(200)}),
]);
export async function POST(req: Request) {
  if (!isSameOriginRequest(req))
    return Response.json(
      { error: "Only same-origin requests are allowed." },
      { status: 403 },
    );
  try {
    const raw = await req.text();
    if (raw.length > 16000)
      return Response.json({ error: "Request is too large." }, { status: 413 });
    const body = requestSchema.parse(JSON.parse(raw));
    if (body.op === "customer") {
      const customer = await db.$transaction(async (tx) => {
        const before = body.id
          ? await tx.customer.findUniqueOrThrow({ where: { id: body.id } })
          : null;
        const data = {
          name: body.name,
          phone: body.phone,
          nicknames: body.nicknames,
        };
        const row = body.id
          ? await tx.customer.update({ where: { id: body.id }, data })
          : await tx.customer.create({ data });
        await audit(
          tx,
          before ? "customer.updated" : "customer.created",
          row.id,
          { before, after: data },
        );
        return row;
      });
      return Response.json({ customer });
    }
    if (body.op === "preview") {
      const parsed = await extract(body.text);
      return Response.json(
        await prepare(body.text, parsed.actions, parsed.provider),
      );
    }
    if (body.op === "manual") {
      const customer = await db.customer.findUniqueOrThrow({
        where: { id: body.customerId },
      });
      return Response.json(
        await prepare(
          `${body.kind}: ${body.amount} for ${customer.name}`,
          [
            {
              kind: body.kind,
              customerName: customer.name,
              amount: body.amount,
              date: body.date,
              note: body.note,
              needsClarification: false,
              question: null,
            },
          ],
          "manual",
          { "0": { customerId: body.customerId } },
        ),
      );
    }
    if (body.op === "clarify") {
      return Response.json(await clarify(body.commandId, body.overrides));
    }
    if (body.op === "answerCustomer") {
      const command=await db.command.findUniqueOrThrow({where:{id:body.commandId}});
      if(command.state!=="pending" || Date.now()-command.createdAt.getTime()>15*60*1000) throw new UserInputError("Review this command again before answering.");
      const actions=JSON.parse(command.actions) as ResolvedAction[];
      const index=actions.findIndex(a=>a.needsClarification && a.clarificationFields?.includes("customer") && a.candidates?.length);
      if(index<0) throw new UserInputError("No customer selection is pending.");
      const customerId=await resolveCustomerName(body.text,actions[index].candidates!);
      if(!customerId) throw new UserInputError("Please say the full customer name or their option number.");
      return Response.json(await clarify(body.commandId,{[index]:{customerId}}));
    }
    if (body.op === "commit")
      return Response.json(await commit(body.commandId, body.acknowledge));
    if (body.op === "cancel") {
      await db.command.updateMany({
        where: { id: body.commandId, state: "pending" },
        data: { state: "cancelled" },
      });
      return Response.json({
        message: "Preview discarded. No ledger changes.",
      });
    }
    if (body.op === "reverse") {
      const entry = await db.entry.findUniqueOrThrow({
        where: { id: body.entryId },
        include: { customer: true, reversedBy: true },
      });
      if (entry.reversesId || entry.reversedBy)
        throw new UserInputError("This entry is already reversed.");
      const action: ResolvedAction = {
        kind: "undo",
        customerId: entry.customerId,
        customerName: entry.customer.name,
        targetId: entry.id,
        amount: null,
        date: indiaDate(),
        note: "",
        needsClarification: false,
        question: null,
      };
      const warnings = [
        `Reverse ${money(entry.amountPaise)} ${entry.kind} for ${entry.customer.name}? The original entry stays in the audit trail.`,
      ];
      const command = await db.command.create({
        data: {
          transcript: `Reverse entry ${entry.id}`,
          actions: JSON.stringify([action]),
          warnings: JSON.stringify(warnings),
          provider: "manual",
        },
      });
      return Response.json({
        id: command.id,
        actions: [action],
        warnings,
        provider: "manual",
        answers: [],
        blocked: false,
        transcript: command.transcript,
      });
    }
  } catch (error) {
    if (error instanceof UserInputError)
      return Response.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    if (error instanceof z.ZodError)
      return Response.json(
        { error: error.issues.map((i) => i.message).join(" ") },
        { status: 400 },
      );
    if (error instanceof SyntaxError)
      return Response.json({ error: "Invalid request." }, { status: 400 });
    if (error && typeof error === "object" && "status" in error) {
      const code = "code" in error ? error.code : undefined;
      const type = "type" in error ? error.type : undefined;
      if (
        error.status === 429 &&
        (["insufficient_quota", "credit_balance_exhausted"].includes(
          String(code),
        ) ||
          type === "insufficient_quota")
      )
        return Response.json(
          {
            error:
              "OpenAI API credits are exhausted. Add credits in OpenAI Platform billing, then retry. Manual ledger entries still work.",
            code: "openai_quota_exhausted",
          },
          { status: 429 },
        );
      return Response.json(
        {
          error:
            "AI provider request failed. Check the API key, model access, and credits, or use a manual entry.",
        },
        { status: 502 },
      );
    }
    if (error && typeof error === "object" && "code" in error)
      return Response.json(
        {
          error:
            "The database could not apply this change. Refresh and review the transaction again.",
        },
        { status: 409 },
      );
    return Response.json(
      {
        error:
          "Could not process the request. Check provider configuration or try a manual entry.",
      },
      { status: 400 },
    );
  }
}
