import { NextResponse } from "next/server";
import { buildWealthPayload } from "@/lib/wealth";
import { requireUser } from "@/lib/auth";

export async function GET() {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;
  const { userId } = user;

  return NextResponse.json(await buildWealthPayload(userId));
}
