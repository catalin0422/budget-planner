import { NextRequest, NextResponse } from "next/server";
import { deleteSnapshot, upsertSnapshot } from "@/lib/queries";
import { buildWealthPayload } from "@/lib/wealth";
import { requireUser } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;
  const { userId } = user;

  const body = await req.json();
  const { date, note, balances } = body;
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date (YYYY-MM-DD) este necesar" }, { status: 400 });
  }
  if (!balances || typeof balances !== "object") {
    return NextResponse.json({ error: "balances este necesar" }, { status: 400 });
  }

  const parsedBalances: Record<number, number> = {};
  for (const [accountId, amount] of Object.entries(balances)) {
    const n = Number(amount);
    if (Number.isFinite(n)) parsedBalances[Number(accountId)] = n;
  }

  await upsertSnapshot(userId, {
    date,
    note: typeof note === "string" && note.trim() ? note.trim() : null,
    balances: parsedBalances,
  });

  return NextResponse.json(await buildWealthPayload(userId));
}

export async function DELETE(req: NextRequest) {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;
  const { userId } = user;

  const { searchParams } = new URL(req.url);
  const id = parseInt(searchParams.get("id") || "", 10);
  if (!id) {
    return NextResponse.json({ error: "id este necesar" }, { status: 400 });
  }
  await deleteSnapshot(userId, id);
  return NextResponse.json(await buildWealthPayload(userId));
}
