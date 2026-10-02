import { NextRequest, NextResponse } from "next/server";
import { createAccount, deleteAccount, updateAccount } from "@/lib/queries";
import { buildWealthPayload } from "@/lib/wealth";
import { parseCurrency } from "@/lib/balance";
import { requireUser } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;
  const { userId } = user;

  const body = await req.json();
  const { name, currency } = body;
  if (typeof name !== "string") {
    return NextResponse.json({ error: "name este necesar" }, { status: 400 });
  }
  await createAccount(userId, { name, currency: parseCurrency(currency) });
  return NextResponse.json(await buildWealthPayload(userId));
}

export async function PATCH(req: NextRequest) {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;
  const { userId } = user;

  const body = await req.json();
  const { id, ...fields } = body;
  if (!id) {
    return NextResponse.json({ error: "id este necesar" }, { status: 400 });
  }
  await updateAccount(userId, id, fields);
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
  await deleteAccount(userId, id);
  return NextResponse.json(await buildWealthPayload(userId));
}
