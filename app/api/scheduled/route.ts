import { NextRequest, NextResponse } from "next/server";
import {
  createPlanned,
  createRecurring,
  deletePlanned,
  deleteRecurring,
  updatePlanned,
  updateRecurring,
} from "@/lib/queries";
import { buildWealthPayload } from "@/lib/wealth";
import { parseCurrency } from "@/lib/balance";
import { requireUser } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;
  const { userId } = user;

  const body = await req.json();
  const { itemType, label, amount, currency, kind, dayOfMonth, nthBusinessDay, date } = body;

  if (itemType !== "recurring" && itemType !== "planned") {
    return NextResponse.json({ error: "itemType trebuie sa fie recurring sau planned" }, { status: 400 });
  }
  if (typeof label !== "string" || (kind !== "income" && kind !== "expense")) {
    return NextResponse.json({ error: "label si kind sunt necesare" }, { status: 400 });
  }

  const safeCurrency = parseCurrency(currency);
  const safeAmount = typeof amount === "number" && Number.isFinite(amount) ? amount : 0;

  if (itemType === "recurring") {
    await createRecurring(userId, {
      label,
      amount: safeAmount,
      currency: safeCurrency,
      kind,
      dayOfMonth: dayOfMonth ?? null,
      nthBusinessDay: nthBusinessDay ?? null,
    });
  } else {
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: "date (YYYY-MM-DD) este necesar" }, { status: 400 });
    }
    await createPlanned(userId, { label, amount: safeAmount, currency: safeCurrency, kind, date });
  }

  return NextResponse.json(await buildWealthPayload(userId));
}

export async function PATCH(req: NextRequest) {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;
  const { userId } = user;

  const body = await req.json();
  const { itemType, id, ...fields } = body;
  if ((itemType !== "recurring" && itemType !== "planned") || !id) {
    return NextResponse.json({ error: "itemType si id sunt necesare" }, { status: 400 });
  }
  if (itemType === "recurring") await updateRecurring(userId, id, fields);
  else await updatePlanned(userId, id, fields);
  return NextResponse.json(await buildWealthPayload(userId));
}

export async function DELETE(req: NextRequest) {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;
  const { userId } = user;

  const { searchParams } = new URL(req.url);
  const itemType = searchParams.get("itemType");
  const id = parseInt(searchParams.get("id") || "", 10);
  if ((itemType !== "recurring" && itemType !== "planned") || !id) {
    return NextResponse.json({ error: "itemType si id sunt necesare" }, { status: 400 });
  }
  if (itemType === "recurring") await deleteRecurring(userId, id);
  else await deletePlanned(userId, id);
  return NextResponse.json(await buildWealthPayload(userId));
}
