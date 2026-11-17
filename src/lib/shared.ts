import { z } from "zod";
import { UserInputError } from "./errors";

export const money = (paise: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: paise % 100 ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(paise / 100);
export function indiaDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
export function relativeDate(days: number) {
  return indiaDate(new Date(Date.now() + days * 86400000));
}
export function toPaise(value: string) {
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(value.trim()))
    throw new UserInputError(
      "Enter an amount with at most two decimal places.",
    );
  const [rupees, paise = ""] = value.trim().split(".");
  const amount = Number(rupees) * 100 + Number(paise.padEnd(2, "0"));
  if (amount <= 0 || amount > 100000000)
    throw new UserInputError("Amount must be between ₹0.01 and ₹10,00,000.");
  return amount;
}
export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (s) =>
      !isNaN(Date.parse(s)) &&
      new Date(s).toISOString().slice(0, 10) === s &&
      s <= indiaDate(),
    "Use a valid date that is today or earlier.",
  );
export const actionSchema = z.object({
  kind: z.enum(["credit", "payment", "balance", "summary", "undo", "correct"]),
  customerName: z.string().max(100).nullable(),
  amount: z.string().max(25).nullable(),
  date: z.string().nullable(),
  note: z.string().max(300),
  needsClarification: z.boolean(),
  question: z.string().max(300).nullable(),
});
export const extractionSchema = z.object({
  actions: z.array(actionSchema).min(1).max(12),
});
export type ExtractedAction = z.infer<typeof actionSchema>;
export type ResolvedAction = ExtractedAction & {
  clarificationFields?: ("customer" | "amount" | "date" | "intent")[];
  customerId?: string;
  amountPaise?: number;
  occurredOn?: string;
  targetId?: string;
  candidates?: { id: string; name: string; phone: string }[];
};
export type Customer = {
  id: string;
  name: string;
  phone: string;
  nicknames: string;
  balancePaise: number;
  entryCount: number;
  lastActivity: string | null;
};
export type Entry = {
  id: string;
  customerId: string;
  customer: { name: string };
  kind: string;
  amountPaise: number;
  note: string;
  source: string;
  occurredOn: string;
  createdAt: string;
  reversesId: string | null;
  reversedBy: { id: string } | null;
};
export type Snapshot = {
  customers: Customer[];
  entries: Entry[];
  audits: {
    id: string;
    event: string;
    entityId: string;
    detail: string;
    createdAt: string;
  }[];
  summary: {
    outstanding: number;
    advance: number;
    todayCredit: number;
    todayPayment: number;
    activeCustomers: number;
    protectedEntries: number;
  };
  chart: { date: string; label: string; credit: number; payment: number }[];
  providers: {
    llm: string;
    stt: string;
    tts: string;
    gnaniVoice: boolean;
    sarvamVoice: boolean;
    streamingVoice: boolean;
  };
  today: string;
  storage: "Hosted SQLite" | "Local SQLite";
};
export type Preview = {
  id: string;
  actions: ResolvedAction[];
  warnings: string[];
  provider: string;
  answers: string[];
  blocked: boolean;
  transcript: string;
};
