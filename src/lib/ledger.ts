import { Prisma } from "@prisma/client";
import { db } from "./db";
import { UserInputError } from "./errors";
import { llmProvider, gnaniKey, sarvamKey } from "./provider-config";
import {
  dateSchema,
  indiaDate,
  money,
  relativeDate,
  toPaise,
  type ExtractedAction,
  type Preview,
  type ResolvedAction,
} from "./shared";

export function signed(entry: { kind: string; amountPaise: number }) {
  return entry.kind === "payment" ? -entry.amountPaise : entry.amountPaise;
}
export function normalize(value: string) {
  return value
    .toLocaleLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function namePattern(name: string) {
  const literal = name.normalize("NFKC").trim()
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, "\\s+");
  return new RegExp(`(?<![\\p{L}\\p{M}])${literal}(?![\\p{L}\\p{M}])`, "giu");
}

/** A model may translate a name, but cannot choose between a shared spoken nickname. */
function spokenIdentityGroups(
  transcript: string,
  customers: { id: string; name: string; nicknames: string }[],
) {
  const aliases = new Map<string, { names: Set<string>; ids: Set<string> }>();
  for (const customer of customers)
    for (const name of [customer.name, ...customer.nicknames.split(",")]) {
      const key = normalize(name);
      if (!key) continue;
      const group = aliases.get(key) ?? { names: new Set<string>(), ids: new Set<string>() };
      group.names.add(name.trim());
      group.ids.add(customer.id);
      aliases.set(key, group);
    }
  let remaining = transcript.normalize("NFKC");
  const uniqueNames = [...aliases.values()].filter((group) => group.ids.size === 1)
    .flatMap((group) => [...group.names]).sort((a, b) => b.length - a.length);
  for (const name of uniqueNames) remaining = remaining.replace(namePattern(name), " ");
  return [...aliases.values()].filter((group) =>
    group.ids.size > 1 && [...group.names].some((name) => namePattern(name).test(remaining)),
  );
}

export async function snapshot() {
  // ponytail: scan the full ledger for one local shop; aggregate and paginate when volume makes this slow.
  const [customers, entries, audits] = await Promise.all([
    db.customer.findMany({
      orderBy: { name: "asc" },
      include: { entries: { orderBy: { createdAt: "desc" } } },
    }),
    db.entry.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: {
        customer: { select: { name: true } },
        reversedBy: { select: { id: true } },
      },
    }),
    db.audit.findMany({ orderBy: { createdAt: "desc" }, take: 150 }),
  ]);
  const mapped = customers.map(({ entries, ...customer }) => ({
    ...customer,
    balancePaise: entries.reduce((s, e) => s + signed(e), 0),
    entryCount: entries.filter((e) => !e.reversesId).length,
    lastActivity: entries[0]?.createdAt ?? null,
  }));
  const active = entries.filter((e) => !e.reversesId && !e.reversedBy);
  const today = indiaDate();
  return {
    storage: process.env.TURSO_DATABASE_URL ? "Hosted SQLite" : "Local SQLite",
    customers: mapped,
    entries,
    audits,
    today,
    summary: {
      outstanding: mapped.reduce((s, c) => s + Math.max(0, c.balancePaise), 0),
      advance: mapped.reduce((s, c) => s + Math.max(0, -c.balancePaise), 0),
      todayCredit: active
        .filter((e) => e.occurredOn === today && e.kind === "credit")
        .reduce((s, e) => s + e.amountPaise, 0),
      todayPayment: active
        .filter((e) => e.occurredOn === today && e.kind === "payment")
        .reduce((s, e) => s + e.amountPaise, 0),
      activeCustomers: mapped.filter((c) => c.balancePaise > 0).length,
      protectedEntries: entries.length,
    },
    chart: Array.from({ length: 7 }, (_, i) => {
      const date = relativeDate(i - 6);
      return {
        date,
        label: new Date(`${date}T12:00:00+05:30`).toLocaleDateString("en-IN", {
          weekday: "short",
          timeZone: "Asia/Kolkata",
        }),
        credit:
          active
            .filter((e) => e.occurredOn === date && e.kind === "credit")
            .reduce((s, e) => s + e.amountPaise, 0) / 100,
        payment:
          active
            .filter((e) => e.occurredOn === date && e.kind === "payment")
            .reduce((s, e) => s + e.amountPaise, 0) / 100,
      };
    }),
    providers: {
      llm: llmProvider(),
      stt: sarvamKey() ? "Sarvam Saaras v4" : gnaniKey() ? "Gnani Prisma v3.0" : "Browser speech · demo",
      tts: gnaniKey() ? "Gnani Timbre v3.0" : "Browser voice · demo",
      gnaniVoice: !!gnaniKey(),
      sarvamVoice: !!sarvamKey(),
      streamingVoice: !!(sarvamKey() || gnaniKey()),
    },
  };
}

export async function prepare(
  transcript: string,
  extracted: ExtractedAction[],
  provider: string,
  overrides: Record<
    string,
    { customerId?: string; amount?: string; date?: string }
  > = {},
  client: Prisma.TransactionClient = db,
): Promise<Preview> {
  const customers = await client.customer.findMany();
  const actions: ResolvedAction[] = [];
  const warnings: string[] = [];
  const answers: string[] = [];
  const hasWrites = extracted.some(
    (a) => !["balance", "summary"].includes(a.kind),
  );
  const chosenTargets = new Set<string>();
  const spokenGroups = provider === "manual" ? [] : spokenIdentityGroups(transcript, customers);
  for (const [index, original] of extracted.entries()) {
    const action: ResolvedAction = { ...original };
    const prior = original as ResolvedAction;
    const fields = new Set<"customer" | "amount" | "date" | "intent">(prior.clarificationFields ?? []);
    const modelUncertainty = original.needsClarification && !prior.clarificationFields;
    if (modelUncertainty) {
      const question = original.question ?? "";
      if (/\b(amount|rupees?|price)\b|\d.*\bor\b.*\d/i.test(question)) fields.add("amount");
      if (/\b(date|day|yesterday|tomorrow|when|kal)\b/i.test(question)) fields.add("date");
      if (/\bcustomer\b|^Which .*did you mean|^No customer matches/i.test(question)) fields.add("customer");
      if (!fields.size) fields.add("intent");
    }
    if (["credit", "payment"].includes(action.kind) && !original.date)
      fields.add("date");
    const override = overrides[String(index)];
    if (override?.amount) {
      action.amount = override.amount;
      fields.delete("amount");
    }
    if (override?.date) {
      action.date = override.date;
      fields.delete("date");
    }
    if (action.kind === "summary") {
      if (hasWrites) {
        answers.push(
          "Your shop summary will be calculated after these entries are confirmed.",
        );
        actions.push(action);
        continue;
      }
      const data = await snapshot();
      answers.push(
        `Today: ${money(data.summary.todayCredit)} credit, ${money(data.summary.todayPayment)} received. Total outstanding: ${money(data.summary.outstanding)}.`,
      );
      actions.push(action);
      continue;
    }
    let matches = customers.filter((c) =>
      [c.name, ...c.nicknames.split(",")].some(
        (n) =>
          normalize(n) &&
          (normalize(n) === normalize(action.customerName ?? "") ||
            normalize(n).startsWith(normalize(action.customerName ?? ""))),
      ),
    );
    const shared = spokenGroups.filter((group) => matches.some((customer) => group.ids.has(customer.id)));
    if (shared.length)
      matches = customers.filter((customer) => shared.some((group) => group.ids.has(customer.id)));
    // Saved server metadata retains an explicitly resolved identity across later amount/date edits.
    const selectedCustomerId = override?.customerId ?? (
      prior.clarificationFields && !prior.clarificationFields.includes("customer")
        ? prior.customerId : undefined
    );
    const customer = selectedCustomerId
      ? customers.find(
          (c) =>
            c.id === selectedCustomerId && matches.some((m) => m.id === c.id),
        )
      : matches.length === 1
        ? matches[0]
        : undefined;
    if (action.customerName && !customer) {
      fields.add("customer");
      action.candidates = matches.map((c) => ({
        id: c.id,
        name: c.name,
        phone: c.phone,
      }));
      action.question = matches.length
        ? `Which ${action.customerName} did you mean?`
        : `No customer matches “${action.customerName}”. Add them in Customers, then try again.`;
    }
    if (!action.customerName && !["undo", "correct"].includes(action.kind)) {
      fields.add("customer");
      action.candidates = matches.map((c) => ({ id: c.id, name: c.name, phone: c.phone }));
      action.question =
        "Which customer is this for? Include their name in your command.";
    }
    if (customer) {
      action.customerId = customer.id;
      action.customerName = customer.name;
      fields.delete("customer");
    }
    if (["credit", "payment", "correct"].includes(action.kind)) {
      try {
        action.amountPaise = toPaise(action.amount ?? "");
      } catch {
        fields.add("amount");
        action.question = "What is the exact amount in rupees?";
      }
      const parsed = dateSchema.safeParse(action.date ?? (action.kind === "correct" ? indiaDate() : undefined));
      if (!parsed.success) {
        fields.add("date");
        delete action.occurredOn;
        action.question =
          "What date did this happen? Use today or an earlier date.";
      } else action.occurredOn = parsed.data;
    }
    if (
      ["undo", "correct"].includes(action.kind) &&
      (!action.customerName || customer)
    ) {
      const target = await client.entry.findFirst({
        where: {
          ...(prior.targetId ? { id: prior.targetId } : {}),
          reversesId: null,
          reversedBy: null,
          ...(customer ? { customerId: customer.id } : {}),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        include: { customer: true },
      });
      if (!target || chosenTargets.has(target.id)) {
        fields.add("intent");
        action.question = "There is no unique active transaction to reverse.";
      } else {
        action.targetId = target.id;
        action.customerId = target.customerId;
        action.customerName = target.customer.name;
        if (action.kind === "correct" && !action.date)
          action.occurredOn = target.occurredOn;
        chosenTargets.add(target.id);
        warnings.push(
          `${action.kind === "undo" ? "Reverse" : "Correct"} ${target.customer.name}’s ${money(target.amountPaise)} ${target.kind}. The original entry will remain in the audit trail.`,
        );
      }
    }
    if (
      ["credit", "payment"].includes(action.kind) &&
      customer &&
      action.amountPaise
    ) {
      const duplicate = await client.entry.findFirst({
        where: {
          customerId: customer.id,
          amountPaise: action.amountPaise,
          kind: action.kind,
          occurredOn: action.occurredOn,
          createdAt: { gte: new Date(Date.now() - 86400000) },
          reversedBy: null,
          reversesId: null,
        },
      });
      if (
        duplicate ||
        actions.some(
          (a) =>
            a.customerId === customer.id &&
            a.kind === action.kind &&
            a.amountPaise === action.amountPaise &&
            a.occurredOn === action.occurredOn,
        )
      )
        warnings.push(
          `Possible duplicate: ${money(action.amountPaise)} ${action.kind} for ${customer.name}. Confirm that this is a separate transaction.`,
        );
      if (action.kind === "payment") {
        const entries = await client.entry.findMany({
          where: { customerId: customer.id },
        });
        const balance =
          entries.reduce((s, e) => s + signed(e), 0) +
          actions
            .filter(
              (a) =>
                a.customerId === customer.id &&
                a.amountPaise &&
                ["credit", "payment"].includes(a.kind),
            )
            .reduce(
              (s, a) =>
                s + (a.kind === "credit" ? a.amountPaise! : -a.amountPaise!),
              0,
            );
        if (action.amountPaise > balance)
          warnings.push(
            `${customer.name} will have ${money(action.amountPaise - balance)} in advance credit after this payment.`,
          );
      }
    }
    if (action.kind === "balance" && customer) {
      if (hasWrites)
        answers.push(
          `${customer.name}’s balance will be calculated after these entries are confirmed.`,
        );
      else {
        const rows = await client.entry.findMany({
          where: { customerId: customer.id },
        });
        const balance = rows.reduce((s, e) => s + signed(e), 0);
        answers.push(
          `${customer.name}: ${money(Math.abs(balance))} ${balance < 0 ? "in advance credit" : "outstanding"}.`,
        );
      }
    }
    action.clarificationFields = [...fields];
    action.needsClarification = fields.size > 0;
    if (!fields.size) action.question = null;
    else if (fields.has("customer"))
      action.question = matches.length ? "Which customer did you mean? Choose the correct record." : "Which customer is this for? Add or select their record.";
    else if (fields.has("amount")) action.question = "What is the exact amount in rupees?";
    else if (fields.has("date")) action.question = "What date did this happen? Use today or an earlier date.";
    else action.question ||= "Please rephrase the uncertain instruction, or use a manual entry.";
    actions.push(action);
  }
  const row = await client.command.create({
    data: {
      transcript,
      actions: JSON.stringify(actions),
      warnings: JSON.stringify(warnings),
      provider,
    },
  });
  return {
    id: row.id,
    actions,
    warnings,
    provider,
    answers,
    blocked: actions.some((a) => a.needsClarification),
    transcript,
  };
}

export async function clarify(
  commandId: string,
  overrides: Parameters<typeof prepare>[3],
) {
  return db.$transaction(async (tx) => {
    const command = await tx.command.findUniqueOrThrow({ where: { id: commandId } });
    if (command.state !== "pending")
      throw new UserInputError("This command is no longer pending.");
    if (Date.now() - command.createdAt.getTime() > 15 * 60 * 1000)
      throw new UserInputError("This preview expired. Review your command again.");
    const claim = await tx.command.updateMany({
      where: { id: commandId, state: "pending" },
      data: { state: "superseded" },
    });
    if (!claim.count)
      throw new UserInputError("This command was already processed.");
    return prepare(
      command.transcript,
      JSON.parse(command.actions) as ResolvedAction[],
      command.provider,
      overrides,
      tx,
    );
  }, { timeout: 10000 });
}

export async function commit(commandId: string, acknowledge: boolean) {
  return db.$transaction(
    async (tx) => {
      const command = await tx.command.findUniqueOrThrow({
        where: { id: commandId },
      });
      if (command.state === "posted")
        return {
          message:
            "This command was already recorded. No duplicate entries were created.",
          idempotent: true,
        };
      if (command.state !== "pending")
        throw new UserInputError("This command is no longer available.");
      if (Date.now() - command.createdAt.getTime() > 15 * 60 * 1000)
        throw new UserInputError(
          "This preview expired. Review your command again.",
        );
      const actions = JSON.parse(command.actions) as ResolvedAction[];
      if (actions.some((a) => a.needsClarification))
        throw new UserInputError("Resolve the clarification before recording.");
      if ((JSON.parse(command.warnings) as string[]).length && !acknowledge)
        throw new UserInputError("Please acknowledge the safety checks.");
      const claim = await tx.command.updateMany({
        where: { id: commandId, state: "pending" },
        data: { state: "posted" },
      });
      if (!claim.count)
        throw new UserInputError("This command was already processed.");
      let count = 0;
      for (const action of actions) {
        if (["balance", "summary"].includes(action.kind)) continue;
        if (!action.customerId)
          throw new UserInputError("Customer is required.");
        if (["undo", "correct"].includes(action.kind)) {
          const target = await tx.entry.findUnique({
            where: { id: action.targetId },
            include: { reversedBy: true },
          });
          if (
            !target ||
            target.reversedBy ||
            target.reversesId ||
            target.customerId !== action.customerId
          )
            throw new UserInputError(
              "The original transaction has changed. Review again.",
            );
          const reversal = await tx.entry.create({
            data: {
              customerId: target.customerId,
              kind: "reversal",
              amountPaise: -signed(target),
              occurredOn: indiaDate(),
              note:
                action.kind === "correct"
                  ? "Reversed for correction"
                  : "Reversed by shopkeeper",
              source: "assistant",
              reversesId: target.id,
              batchId: commandId,
            },
          });
          await audit(tx, "transaction.reversed", reversal.id, {
            originalId: target.id,
            commandId,
          });
          count++;
          if (action.kind === "correct") {
            const amount = toPaise(action.amount ?? "");
            const replacement = await tx.entry.create({
              data: {
                customerId: target.customerId,
                kind: target.kind,
                amountPaise: amount,
                occurredOn: dateSchema.parse(
                  action.occurredOn ?? target.occurredOn,
                ),
                note: `Correction of ${target.id}. ${action.note}`,
                source: "assistant",
                batchId: commandId,
              },
            });
            await audit(tx, "transaction.corrected", replacement.id, {
              originalId: target.id,
              reversalId: reversal.id,
              commandId,
            });
            count++;
          }
        } else {
          const amount = toPaise(action.amount ?? "");
          const occurredOn = dateSchema.parse(action.occurredOn);
          const duplicate = await tx.entry.findFirst({
            where: {
              customerId: action.customerId,
              kind: action.kind,
              amountPaise: amount,
              occurredOn,
              reversesId: null,
              reversedBy: null,
              createdAt: { gte: new Date(Date.now() - 86400000) },
            },
          });
          if (duplicate && !acknowledge)
            throw new UserInputError(
              "A possible duplicate appeared since preview. Review again and acknowledge the warning.",
            );
          const entry = await tx.entry.create({
            data: {
              customerId: action.customerId,
              kind: action.kind,
              amountPaise: amount,
              occurredOn,
              note: action.note,
              source: command.provider === "manual" ? "manual" : "assistant",
              batchId: commandId,
            },
          });
          await audit(tx, "transaction.posted", entry.id, {
            kind: entry.kind,
            amountPaise: amount,
            customerId: entry.customerId,
            commandId,
            transcript: command.transcript,
          });
          count++;
        }
      }
      await audit(tx, "command.confirmed", commandId, {
        entryCount: count,
        acknowledged: acknowledge,
      });
      const answers: string[] = [];
      for (const action of actions) {
        if (action.kind === "balance" && action.customerId) {
          const rows = await tx.entry.findMany({
            where: { customerId: action.customerId },
          });
          const balance = rows.reduce((s, e) => s + signed(e), 0);
          answers.push(
            `${action.customerName}: ${money(Math.abs(balance))} ${balance < 0 ? "in advance credit" : "outstanding"}.`,
          );
        }
        if (action.kind === "summary") {
          const people = await tx.customer.findMany({
            include: { entries: true },
          });
          const active = await tx.entry.findMany({
            where: {
              occurredOn: indiaDate(),
              reversesId: null,
              reversedBy: null,
            },
          });
          const credit = active
            .filter((e) => e.kind === "credit")
            .reduce((s, e) => s + e.amountPaise, 0);
          const payment = active
            .filter((e) => e.kind === "payment")
            .reduce((s, e) => s + e.amountPaise, 0);
          const outstanding = people.reduce(
            (s, c) =>
              s +
              Math.max(
                0,
                c.entries.reduce((b, e) => b + signed(e), 0),
              ),
            0,
          );
          answers.push(
            `Today: ${money(credit)} credit, ${money(payment)} received. Total outstanding: ${money(outstanding)}.`,
          );
        }
      }
      return {
        message: count
          ? `${count} ledger ${count === 1 ? "entry" : "entries"} recorded. Your khata is up to date.`
          : "Your query is complete. No financial entries were changed.",
        answers,
        idempotent: false,
      };
    },
    { timeout: 10000 },
  );
}
export async function audit(
  tx: Prisma.TransactionClient,
  event: string,
  entityId: string,
  detail: unknown,
) {
  await tx.audit.create({
    data: { event, entityId, detail: JSON.stringify(detail) },
  });
}
