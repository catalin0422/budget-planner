import { NextRequest, NextResponse } from "next/server";
import {
  createGoal,
  deleteGoal,
  getAppSettings,
  getLatestSnapshotWithBalances,
  listGoals,
  listPlanned,
  listRecurring,
  updateGoal,
} from "@/lib/queries";
import {
  buildDailyBalance,
  estimateBalanceToday,
  findMinimumPoint,
  plannedToEntries,
  recurringToEntries,
  summarizeBreakdown,
  todayIso,
  type DailyEntry,
} from "@/lib/balance";
import { requireUser } from "@/lib/auth";
import { getCurrentRates } from "@/lib/bnr";
import type { Goal, GoalProjection } from "@/lib/types";

function emptyProjection(goal: Goal): GoalProjection {
  return {
    goal,
    dailyBalance: [],
    minimumPoint: null,
    breakdown: null,
    days: null,
    plannedBalance: null,
    cumulativeExtra: null,
    targetBalance: null,
    dailyCut: null,
    requiredDailyBudget: null,
    goalBalance: [],
  };
}

function dailyBudgetEntries(perDay: number): DailyEntry[] {
  return perDay > 0 ? [{ label: "Buget zilnic", amountRON: perDay, kind: "expense" }] : [];
}

export async function GET() {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;
  const { userId } = user;

  const ratesPromise = getCurrentRates();
  const [rates, goals, settings, latestSnapshot, recurring, planned] = await Promise.all([
    ratesPromise,
    listGoals(userId),
    getAppSettings(userId),
    ratesPromise.then((r) => getLatestSnapshotWithBalances(userId, r)),
    listRecurring(userId, true),
    listPlanned(userId),
  ]);

  if (!latestSnapshot) {
    return NextResponse.json({
      startingBalance: 0,
      snapshotDate: null,
      dailyBudget: settings.daily_budget,
      overallDailyCut: null,
      goals: goals.map(emptyProjection),
    });
  }

  const recurringEntries = recurringToEntries(recurring, rates);
  const oneTimeEntries = plannedToEntries(planned, rates);
  const dailyEntries = dailyBudgetEntries(settings.daily_budget);
  const startingBalance = estimateBalanceToday({
    snapshotBalance: latestSnapshot.total,
    snapshotDate: latestSnapshot.date,
    recurringEntries,
    oneTimeEntries,
    dailyEntries,
  });

  const today = todayIso();
  const startDate = new Date(today);

  // Obiectivele se aduna in ordinea datelor: la data obiectivului k trebuie sa
  // ai planul + suma obiectivelor 1..k. Cele fara data sau cu data trecuta nu
  // intra in cumul (n-au un interval in care sa pui bani deoparte).
  const cumulativeById = new Map<number, number>();
  let running = 0;
  for (const goal of [...goals].sort((a, b) =>
    (a.target_date ?? "").localeCompare(b.target_date ?? "")
  )) {
    if (!goal.target_date || goal.target_date < today || goal.target_amount == null) continue;
    running += goal.target_amount;
    cumulativeById.set(goal.id, running);
  }

  const goalProjections: GoalProjection[] = goals.map((goal) => {
    if (!goal.target_date) return emptyProjection(goal);

    const endDate = new Date(goal.target_date);
    const dailyBalance = buildDailyBalance({
      startingBalance,
      startDate,
      endDate,
      recurringEntries,
      oneTimeEntries,
      dailyEntries,
    });
    if (dailyBalance.length === 0) return emptyProjection(goal);

    const days = dailyBalance.length;
    const plannedBalance = dailyBalance[days - 1].balance;
    const base: GoalProjection = {
      ...emptyProjection(goal),
      dailyBalance,
      minimumPoint: findMinimumPoint(dailyBalance),
      breakdown: summarizeBreakdown({
        points: dailyBalance,
        startAssets: startingBalance,
        confirmedIncoming: 0,
        dailyEntries,
      }),
      days,
      plannedBalance,
    };

    const cumulativeExtra = cumulativeById.get(goal.id);
    if (cumulativeExtra == null) return base;

    const dailyCut = cumulativeExtra / days;
    const required = settings.daily_budget - dailyCut;
    const goalBalance =
      required >= 0
        ? buildDailyBalance({
            startingBalance,
            startDate,
            endDate,
            recurringEntries,
            oneTimeEntries,
            dailyEntries: dailyBudgetEntries(required),
          })
        : [];

    return {
      ...base,
      cumulativeExtra,
      targetBalance: plannedBalance + cumulativeExtra,
      dailyCut,
      requiredDailyBudget: required,
      goalBalance,
    };
  });

  // Un singur buget zilnic constant care le atinge pe toate: cel mai mare
  // dintre ritmurile cerute (un obiectiv apropiat poate cere mai mult pe zi
  // decat unul indepartat, chiar daca suma totala e mai mica).
  const cuts = goalProjections.map((g) => g.dailyCut).filter((c): c is number => c != null);
  const overallDailyCut = cuts.length ? Math.max(...cuts) : null;

  return NextResponse.json({
    startingBalance,
    snapshotDate: latestSnapshot.date,
    dailyBudget: settings.daily_budget,
    overallDailyCut,
    goals: goalProjections,
  });
}

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;
  const { userId } = user;

  const body = await req.json();
  const { name, targetDate, targetAmount } = body;
  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "name este necesar" }, { status: 400 });
  }
  await createGoal(userId, {
    name: name.trim(),
    targetDate: targetDate || null,
    targetAmount: targetAmount != null ? Number(targetAmount) : null,
  });
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest) {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;
  const { userId } = user;

  const body = await req.json();
  const { id, name, targetDate, targetAmount, archived } = body;
  if (!id) {
    return NextResponse.json({ error: "id este necesar" }, { status: 400 });
  }
  await updateGoal(userId, id, {
    name,
    targetDate: targetDate !== undefined ? targetDate || null : undefined,
    targetAmount: targetAmount !== undefined ? (targetAmount != null ? Number(targetAmount) : null) : undefined,
    archived,
  });
  return NextResponse.json({ ok: true });
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
  await deleteGoal(userId, id);
  return NextResponse.json({ ok: true });
}
