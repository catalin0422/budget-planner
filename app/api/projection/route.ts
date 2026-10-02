import { NextRequest, NextResponse } from "next/server";
import { getAppSettings, getLatestSnapshotWithBalances, listAccounts, listPlanned, listRecurring } from "@/lib/queries";
import { projectPoints } from "@/lib/wealth";
import { ronOnlyTotal, todayIso } from "@/lib/balance";
import { requireUser } from "@/lib/auth";
import { getCurrentRates } from "@/lib/bnr";

/** Soldul total estimat la o data aleasa liber de user, de pe pagina principala. */
export async function GET(req: NextRequest) {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;
  const { userId } = user;

  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date (YYYY-MM-DD) este necesar" }, { status: 400 });
  }
  if (date < todayIso()) {
    return NextResponse.json({ error: "alege o dată din viitor" }, { status: 400 });
  }

  const ratesPromise = getCurrentRates();
  const [rates, settings, latestSnapshot, accounts, recurring, planned] = await Promise.all([
    ratesPromise,
    getAppSettings(userId),
    ratesPromise.then((r) => getLatestSnapshotWithBalances(userId, r)),
    listAccounts(userId),
    listRecurring(userId, true),
    listPlanned(userId),
  ]);

  if (!latestSnapshot) {
    return NextResponse.json({ date, balance: 0 });
  }

  const snapshotBalance = ronOnlyTotal(latestSnapshot.balances, accounts);

  const points = projectPoints({
    snapshotBalance,
    snapshotDate: latestSnapshot.date,
    endDate: new Date(date),
    settings,
    recurring,
    planned,
    rates,
  });

  const last = points[points.length - 1] ?? null;
  return NextResponse.json({ date, balance: last ? last.balance : snapshotBalance });
}
