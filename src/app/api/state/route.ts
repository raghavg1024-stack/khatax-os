import { snapshot } from "@/lib/ledger";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    return Response.json(await snapshot());
  } catch {
    return Response.json(
      { error: "Could not read the database. Check the server and retry." },
      { status: 500 },
    );
  }
}
