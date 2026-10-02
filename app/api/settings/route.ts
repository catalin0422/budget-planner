import { NextRequest, NextResponse } from "next/server";
import { updateAppSettings } from "@/lib/queries";
import { buildWealthPayload } from "@/lib/wealth";
import { requireUser } from "@/lib/auth";

export async function PATCH(req: NextRequest) {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;
  const { userId } = user;

  const body = await req.json();
  const { dailyBudget } = body;

  const fields: { dailyBudget?: number } = {};
  if (typeof dailyBudget === "number" && Number.isFinite(dailyBudget) && dailyBudget >= 0) {
    fields.dailyBudget = dailyBudget;
  }
  await updateAppSettings(userId, fields);
  return NextResponse.json(await buildWealthPayload(userId));
}
