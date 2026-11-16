import { db } from "@/lib/db";
import { signed } from "@/lib/ledger";
function cell(value: unknown) {
  let s = String(value ?? "");
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replaceAll('"', '""')}"`;
}
export const dynamic = "force-dynamic";
export async function GET() {
  const rows = await db.entry.findMany({
    include: { customer: true, reversedBy: true },
    orderBy: { createdAt: "desc" },
  });
  const lines = [
    [
      "Entry ID",
      "Customer",
      "Type",
      "Amount (paise)",
      "Signed balance change (paise)",
      "Transaction date",
      "Recorded at",
      "Note",
      "Source",
      "Reverses ID",
      "Reversed by ID",
    ],
    ...rows.map((e) => [
      e.id,
      e.customer.name,
      e.kind,
      e.amountPaise,
      signed(e),
      e.occurredOn,
      e.createdAt.toISOString(),
      e.note,
      e.source,
      e.reversesId,
      e.reversedBy?.id,
    ]),
  ];
  return new Response(
    "\uFEFF" + lines.map((row) => row.map(cell).join(",")).join("\r\n"),
    {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": "attachment; filename=khatax-ledger.csv",
        "Cache-Control": "no-store",
      },
    },
  );
}
