import type { Account, Currency, DayBalancePoint, ExchangeRates, PlannedItem, RecurringItem, TripBreakdown } from "./types";
import { isWorkingDay, nthWorkingDayOfMonth, toIsoLocal } from "./dates";

export const CURRENCIES: Currency[] = ["RON", "EUR", "MDL"];

/** Valuta trimisa de client, sau RON daca nu e una cunoscuta. */
export function parseCurrency(value: unknown): Currency {
  return CURRENCIES.includes(value as Currency) ? (value as Currency) : "RON";
}

export function toRON(amount: number, currency: Currency, rates: ExchangeRates): number {
  return currency === "RON" ? amount : amount * rates[currency];
}

/** Suma soldurilor doar din conturile in RON, neconvertita si fara conturile in valuta (EUR, MDL). */
export function ronOnlyTotal(balances: Record<number, number>, accounts: Account[]): number {
  return accounts
    .filter((a) => a.currency === "RON")
    .reduce((sum, a) => sum + (balances[a.id] ?? 0), 0);
}

export interface RecurringEntry {
  label: string;
  amountRON: number;
  /** zi fixa din luna; exclusiv fata de nthBusinessDay */
  dayOfMonth: number | null;
  /** a N-a zi lucratoare din luna (ex: salariu in a 4-a zi lucratoare) */
  nthBusinessDay: number | null;
  kind: "income" | "expense";
  /** ultima data pana la care userul a confirmat ca ocurenta a avut loc deja */
  confirmedThrough: string | null;
}
export interface OneTimeEntry {
  label: string;
  amountRON: number;
  date: string;
  kind: "income" | "expense";
  received: boolean;
}
export interface DailyEntry {
  label: string;
  amountRON: number;
  kind: "income" | "expense";
  /** se aplica doar in zilele lucratoare (ex: bonuri de masa) */
  workingDaysOnly?: boolean;
}

/**
 * Construieste un calendar zi-cu-zi al soldului, de la "startDate" (de regula azi)
 * pana la "endDate" (de regula data calatoriei), folosind:
 * - assets curente (+ intrari sigure disponibile de azi) ca sold de start
 * - intrari recurente (day_of_month) care se repeta in fiecare luna din interval
 * - intrari unice (expected_date) care apar o singura data
 * - intrari zilnice (daily) care se aplica IN FIECARE ZI din interval
 *
 * Daca o intrare unica are received=1, e tratata ca deja incasata/platita si nu mai
 * e injectata din nou la data ei.
 */
export function buildDailyBalance(params: {
  startingBalance: number;
  startDate: Date;
  endDate: Date;
  recurringEntries: RecurringEntry[];
  oneTimeEntries: OneTimeEntry[];
  dailyEntries?: DailyEntry[];
}): DayBalancePoint[] {
  const { startingBalance, startDate, endDate, recurringEntries, oneTimeEntries } = params;
  const dailyEntries = params.dailyEntries ?? [];

  const points: DayBalancePoint[] = [];
  let balance = startingBalance;

  const cur = new Date(startDate);
  cur.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(0, 0, 0, 0);

  if (end < cur) {
    return points;
  }

  const oneTimeByDate = new Map<string, typeof oneTimeEntries>();
  for (const e of oneTimeEntries) {
    if (e.received) continue;
    const key = e.date;
    if (!oneTimeByDate.has(key)) oneTimeByDate.set(key, []);
    oneTimeByDate.get(key)!.push(e);
  }

  // ziua rezolvata pentru "a N-a zi lucratoare", per luna (cheie: an-luna-n)
  const nthDayCache = new Map<string, number | null>();
  function resolveNthDay(year: number, month: number, n: number): number | null {
    const key = `${year}-${month}-${n}`;
    if (!nthDayCache.has(key)) {
      nthDayCache.set(key, nthWorkingDayOfMonth(year, month, n));
    }
    return nthDayCache.get(key)!;
  }

  while (cur <= end) {
    const isoDate = toIsoLocal(cur);
    const dayOfMonth = cur.getDate();
    const events: DayBalancePoint["events"] = [];
    let delta = 0;

    // cheltuieli/venituri zilnice: in fiecare zi a intervalului
    // (sau doar in zilele lucratoare, ex: bonuri de masa)
    for (const d of dailyEntries) {
      if (d.workingDaysOnly && !isWorkingDay(cur)) continue;
      const signedAmount = d.kind === "income" ? d.amountRON : -d.amountRON;
      delta += signedAmount;
      events.push({ label: d.label, amount: signedAmount, kind: d.kind, source: "daily" });
    }

    for (const r of recurringEntries) {
      const targetDay = r.nthBusinessDay
        ? resolveNthDay(cur.getFullYear(), cur.getMonth() + 1, r.nthBusinessDay)
        : r.dayOfMonth;
      // sarim peste ocurenta de azi daca userul a confirmat deja ca a avut loc --
      // e deja reflectata in startingBalance (soldul notat azi), altfel ar aparea de doua ori
      if (targetDay === dayOfMonth && isoDate <= (r.confirmedThrough ?? "")) continue;
      if (targetDay === dayOfMonth) {
        const signedAmount = r.kind === "income" ? r.amountRON : -r.amountRON;
        delta += signedAmount;
        events.push({ label: r.label, amount: signedAmount, kind: r.kind, source: "recurring" });
      }
    }

    const oneTimeToday = oneTimeByDate.get(isoDate);
    if (oneTimeToday) {
      for (const e of oneTimeToday) {
        const signedAmount = e.kind === "income" ? e.amountRON : -e.amountRON;
        delta += signedAmount;
        events.push({ label: e.label, amount: signedAmount, kind: e.kind, source: "one_time" });
      }
    }

    balance += delta;

    points.push({
      date: isoDate,
      day: dayOfMonth,
      delta,
      balance,
      events,
    });

    cur.setDate(cur.getDate() + 1);
  }

  return points;
}

/**
 * Deriva defalcarea soldului final din punctele deja simulate (sursa unica de adevar),
 * categorizand evenimentele dupa sursa. confirmedIncoming si startAssets sunt deja
 * incluse in soldul de start, deci le primim ca parametri.
 */
export function summarizeBreakdown(params: {
  points: DayBalancePoint[];
  startAssets: number;
  confirmedIncoming: number;
  dailyEntries: DailyEntry[];
}): TripBreakdown {
  const { points, startAssets, confirmedIncoming, dailyEntries } = params;

  const acc = {
    recurringIncome: 0,
    recurringExpense: 0,
    oneTimeDatedIncome: 0,
    oneTimeDatedExpense: 0,
    dailyIncome: 0,
    dailyExpense: 0,
  };

  for (const p of points) {
    for (const e of p.events) {
      const positive = e.amount > 0;
      if (e.source === "recurring") {
        if (positive) acc.recurringIncome += e.amount;
        else acc.recurringExpense += -e.amount;
      } else if (e.source === "one_time") {
        if (positive) acc.oneTimeDatedIncome += e.amount;
        else acc.oneTimeDatedExpense += -e.amount;
      } else if (e.source === "daily") {
        if (positive) acc.dailyIncome += e.amount;
        else acc.dailyExpense += -e.amount;
      }
    }
  }

  const total = points.length ? points[points.length - 1].balance : startAssets + confirmedIncoming;

  return {
    startAssets,
    confirmedIncoming,
    ...acc,
    dailyDays: points.length,
    dailyExpenseItems: dailyEntries
      .filter((d) => d.kind === "expense")
      .map((d) => ({ label: d.label, perDay: d.amountRON })),
    total,
  };
}

/**
 * Soldul estimat la inceputul zilei de azi, cand ultimul sold notat e mai vechi.
 *
 * Fara asta, proiectiile porneau de la soldul vechi ca si cum ar fi cel de azi:
 * cu un snapshot de acum 10 zile, se pierdeau 10 zile de buget zilnic plus
 * platile/incasarile din interval, iar estimarea iesea prea optimista.
 *
 * Simulam de la data snapshot-ului (inclusiv, aceeasi conventie ca atunci cand
 * snapshot-ul e de azi: ziua lui intra cu buget zilnic si cu ocurentele
 * neconfirmate) pana ieri. Recurentele confirmate la salvarea snapshot-ului
 * (confirmedThrough) sunt deja in sold si buildDailyBalance le sare.
 */
export function estimateBalanceToday(params: {
  snapshotBalance: number;
  snapshotDate: string;
  recurringEntries: RecurringEntry[];
  oneTimeEntries: OneTimeEntry[];
  dailyEntries: DailyEntry[];
}): number {
  const { snapshotBalance, snapshotDate, recurringEntries, oneTimeEntries, dailyEntries } = params;
  const yesterday = addDaysIso(todayIso(), -1);
  if (snapshotDate > yesterday) return snapshotBalance;

  const points = buildDailyBalance({
    startingBalance: snapshotBalance,
    startDate: parseIsoLocal(snapshotDate),
    endDate: parseIsoLocal(yesterday),
    recurringEntries,
    oneTimeEntries,
    dailyEntries,
  });
  return points.length ? points[points.length - 1].balance : snapshotBalance;
}

function parseIsoLocal(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function findMinimumPoint(points: DayBalancePoint[]): DayBalancePoint | null {
  if (points.length === 0) return null;
  return points.reduce((min, p) => (p.balance < min.balance ? p : min), points[0]);
}

/** Recurentele active, convertite in RON, in formatul cerut de buildDailyBalance. */
export function recurringToEntries(recurring: RecurringItem[], rates: ExchangeRates): RecurringEntry[] {
  return recurring
    .filter((r) => r.active)
    .map((r) => ({
      label: r.label,
      amountRON: toRON(r.amount, r.currency, rates),
      dayOfMonth: r.day_of_month,
      nthBusinessDay: r.nth_business_day,
      kind: r.kind,
      confirmedThrough: r.confirmed_through,
    }));
}

/** Planificarile nefinalizate, convertite in RON, in formatul cerut de buildDailyBalance. */
export function plannedToEntries(planned: PlannedItem[], rates: ExchangeRates): OneTimeEntry[] {
  return planned
    .filter((p) => !p.done)
    .map((p) => ({
      label: p.label,
      amountRON: toRON(p.amount, p.currency, rates),
      date: p.date,
      kind: p.kind,
      received: false,
    }));
}

export function addDaysIso(dateIso: string, days: number): string {
  const [y, m, d] = dateIso.split("-").map(Number);
  return toIsoLocal(new Date(y, m - 1, d + days));
}

export function todayIso(): string {
  return toIsoLocal(new Date());
}
