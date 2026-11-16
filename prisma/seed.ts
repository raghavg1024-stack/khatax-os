import nextEnv from "@next/env";
nextEnv.loadEnvConfig(process.cwd());
process.env.DATABASE_URL ||= "file:./khatax.db";
// Demo seeding always targets the configured local SQLite file, never the hosted adapter.
const { PrismaClient } = await import("@prisma/client");
const db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
const { relativeDate } = await import("../src/lib/shared");
const customers = [
  { name: "Ramesh Kumar", phone: "9876500001", nicknames: "Ramesh,Ramu,रमेश" },
  { name: "Sunita Devi", phone: "9876500002", nicknames: "Sunita,सुनीता" },
  {
    name: "Ravi Sharma",
    phone: "9876500003",
    nicknames: "Ravi,Ravi bhai,रवि,ರವಿ,రవి",
  },
  {
    name: "Suresh Patil",
    phone: "9876500004",
    nicknames: "Suresh,सुरेश,ಸುರೇಶ್,సురేష్",
  },
  {
    name: "Lakshmi Rao",
    phone: "9876500005",
    nicknames: "Lakshmi,ಲಕ್ಷ್ಮಿ,లక్ష్మి",
  },
  { name: "Anil Gupta", phone: "9876500006", nicknames: "Anil,अनिल" },
  { name: "Ramesh Patel", phone: "9876500007", nicknames: "Ramesh,Patel ji" },
  { name: "Meena Joshi", phone: "9876500008", nicknames: "Meena,मीना" },
];
try {
  if (await db.customer.count()) {
    console.log("Existing ledger preserved. Demo seed skipped.");
  } else
    await db.$transaction(async (tx) => {
      const people = [];
      for (const c of customers)
        people.push(await tx.customer.create({ data: c }));
      for (let day = -6; day <= 0; day++) {
        for (let i = 0; i < people.length; i++) {
          if ((i - day) % 3 === 0) continue;
          const payment = day > -6 && (i - day) % 4 === 0;
          const entry = await tx.entry.create({
            data: {
              customerId: people[i].id,
              kind: payment ? "payment" : "credit",
              amountPaise:
                (payment ? 100 + i * 50 : 120 + ((i * 173 - day * 97) % 850)) *
                100,
              occurredOn: relativeDate(day),
              createdAt: new Date(
                `${relativeDate(day)}T${String(9 + i).padStart(2, "0")}:20:00+05:30`,
              ),
              note: payment
                ? "Cash payment — sample data"
                : [
                    "Monthly groceries",
                    "Rice, dal & cooking oil",
                    "Milk & daily essentials",
                  ][i % 3] + " — sample data",
              source: "demo",
            },
          });
          await tx.audit.create({
            data: {
              event: "transaction.seeded",
              entityId: entry.id,
              detail: JSON.stringify({
                sampleData: true,
                amountPaise: entry.amountPaise,
              }),
            },
          });
        }
      }
      console.log(
        "Sample shop created: 8 customers, 7 days of auditable demo transactions.",
      );
    });
} finally {
  await db.$disconnect();
}
