import type { ExchangeRates, PlannedItem, RecurringItem, ScheduledEvent, SnapshotWithBalances, Verdict } from "./types";
import { nthWorkingDayOfMonth, toIsoLocal } from "./dates";
import { toRON } from "./balance";

function parseIso(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Agregarea mai multor verdicte consecutive intr-un singur bilant (ex: ultimele 30 de zile). */
export interface VerdictSummary {
  /** fromDate al primului verdict inclus */
  fromDate: string;
  /** toDate al ultimului verdict inclus */
  toDate: string;
  days: number;
  actualDelta: number;
  expectedDelta: number;
  /** suma diff-urilor; >= 0 inseamna economie fata de plan */
  diff: number;
  allowance: number;
  scheduledIncome: number;
  scheduledExpense: number;
  /** cate verdicte au intrat in agregare */
  intervals: number;
}

/**
 * Aduna verdictele al caror interval se termina la sinceIso sau dupa.
 * Verdictele trebuie sa fie deja in ordine cronologica (asa vin din buildWealthPayload).
 */
export function summarizeVerdicts(verdicts: Verdict[], sinceIso: string): VerdictSummary | null {
  const included = verdicts.filter((v) => v.toDate >= sinceIso);
  if (included.length === 0) return null;

  const summary: VerdictSummary = {
    fromDate: included[0].fromDate,
    toDate: included[included.length - 1].toDate,
    days: 0,
    actualDelta: 0,
    expectedDelta: 0,
    diff: 0,
    allowance: 0,
    scheduledIncome: 0,
    scheduledExpense: 0,
    intervals: included.length,
  };

  for (const v of included) {
    summary.days += v.days;
    summary.actualDelta += v.actualDelta;
    summary.expectedDelta += v.expectedDelta;
    summary.diff += v.diff;
    summary.allowance += v.allowance;
    summary.scheduledIncome += v.scheduledIncome;
    summary.scheduledExpense += v.scheduledExpense;
  }

  return summary;
}

/**
 * Ocurentele recurentelor active care nu au fost inca confirmate de user (vezi
 * RecurringItem.confirmed_through), pana la toIso. Folosit la salvarea unui sold
 * nou, ca sa intrebam userul daca o recurenta scadenta chiar a avut loc, inainte
 * sa dispara din lista "Urmeaza" din /plati.
 *
 * Cautarea porneste, per recurenta, de la confirmed_through -- NU de la fromIso
 * (ultimul sold notat). Daca userul a raspuns "Nu" data trecuta, confirmed_through
 * n-a avansat, si vrem sa fie intrebat din nou acum chiar daca acea ocurenta a
 * ramas in urma ultimului sold notat -- altfel, cum fromIso avanseaza la fiecare
 * sold nou, ocurenta refuzata iese pur si simplu din fereastra de cautare si nu
 * mai e ceruta niciodata, desi ramane neconfirmata (si deci exclusa din
 * "asteptat" in compareSnapshots, facand verdictul sa arate o depasire falsa cand
 * plata chiar are loc). Doar recurentele niciodata confirmate (confirmed_through
 * null) pornesc de la fromIso, ca sa nu inunde dialogul cu istoric de dinainte.
 */
export function dueRecurringOccurrences(
  recurring: RecurringItem[],
  fromIso: string,
  toIso: string
): { item: RecurringItem; date: string }[] {
  const end = parseIso(toIso);
  const results: { item: RecurringItem; date: string }[] = [];

  const activeRecurring = recurring.filter((r) => r.active);
  const nthDayCache = new Map<string, number | null>();
  function resolveNthDay(year: number, month: number, n: number): number | null {
    const key = `${year}-${month}-${n}`;
    if (!nthDayCache.has(key)) {
      nthDayCache.set(key, nthWorkingDayOfMonth(year, month, n));
    }
    return nthDayCache.get(key)!;
  }

  for (const r of activeRecurring) {
    const start = parseIso(r.confirmed_through ?? fromIso);
    if (end <= start) continue;

    const cur = new Date(start);
    cur.setDate(cur.getDate() + 1);
    while (cur <= end) {
      const isoDate = toIsoLocal(cur);
      const dayOfMonth = cur.getDate();
      const targetDay = r.nth_business_day
        ? resolveNthDay(cur.getFullYear(), cur.getMonth() + 1, r.nth_business_day)
        : r.day_of_month;
      if (targetDay === dayOfMonth && isoDate > (r.confirmed_through ?? "")) {
        results.push({ item: r, date: isoDate });
      }
      cur.setDate(cur.getDate() + 1);
    }
  }

  results.sort((a, b) => a.date.localeCompare(b.date));
  return results;
}

/**
 * Compara doua snapshot-uri consecutive de avere: cat ar fi trebuit sa se schimbe
 * totalul (buget zilnic + platile/veniturile programate din interval) vs. cat s-a
 * schimbat de fapt.
 *
 * Intervalul e (from, to]: ziua primului snapshot e deja reflectata in totalul lui.
 * Recurentele si planificarile sunt globale (nu mai sunt legate de o luna calendaristica).
 *
 * O recurenta scadenta in interval intra in "asteptat" DOAR daca a fost confirmata
 * (confirmed_through acopera data ei -- vezi dueRecurringOccurrences si dialogul
 * Da/Nu de la salvarea unui sold nou). Daca userul a raspuns "Nu" (n-a platit inca),
 * nu trebuie sa numaram cheltuiala ca si cum ar fi avut loc, altfel verdictul ar
 * arata gresit ca ai economisit banii aia.
 */
export function compareSnapshots(params: {
  from: SnapshotWithBalances;
  to: SnapshotWithBalances;
  dailyBudget: number;
  recurring: RecurringItem[];
  planned: PlannedItem[];
  rates: ExchangeRates;
}): Verdict {
  const { from, to, dailyBudget, recurring, planned, rates } = params;

  const start = parseIso(from.date);
  const end = parseIso(to.date);
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000);

  const events: ScheduledEvent[] = [];
  let scheduledIncome = 0;
  let scheduledExpense = 0;

  const plannedByDate = new Map<string, PlannedItem[]>();
  for (const p of planned) {
    if (p.done) continue;
    if (!plannedByDate.has(p.date)) plannedByDate.set(p.date, []);
    plannedByDate.get(p.date)!.push(p);
  }

  const activeRecurring = recurring.filter((r) => r.active);
  const nthDayCache = new Map<string, number | null>();
  function resolveNthDay(year: number, month: number, n: number): number | null {
    const key = `${year}-${month}-${n}`;
    if (!nthDayCache.has(key)) {
      nthDayCache.set(key, nthWorkingDayOfMonth(year, month, n));
    }
    return nthDayCache.get(key)!;
  }

  const cur = new Date(start);
  cur.setDate(cur.getDate() + 1);
  while (cur <= end) {
    const isoDate = toIsoLocal(cur);
    const dayOfMonth = cur.getDate();

    for (const r of activeRecurring) {
      const targetDay = r.nth_business_day
        ? resolveNthDay(cur.getFullYear(), cur.getMonth() + 1, r.nth_business_day)
        : r.day_of_month;
      if (targetDay === dayOfMonth && isoDate <= (r.confirmed_through ?? "")) {
        const amountRON = toRON(r.amount, r.currency, rates);
        events.push({ date: isoDate, label: r.label, amount: amountRON, kind: r.kind });
        if (r.kind === "income") scheduledIncome += amountRON;
        else scheduledExpense += amountRON;
      }
    }

    const plannedToday = plannedByDate.get(isoDate);
    if (plannedToday) {
      for (const p of plannedToday) {
        const amountRON = toRON(p.amount, p.currency, rates);
        events.push({ date: isoDate, label: p.label, amount: amountRON, kind: p.kind });
        if (p.kind === "income") scheduledIncome += amountRON;
        else scheduledExpense += amountRON;
      }
    }

    cur.setDate(cur.getDate() + 1);
  }

  const allowance = days * dailyBudget;
  const expectedDelta = scheduledIncome - scheduledExpense - allowance;
  const actualDelta = to.total - from.total;

  return {
    fromDate: from.date,
    toDate: to.date,
    fromTotal: from.total,
    toTotal: to.total,
    days,
    dailyBudget,
    allowance,
    scheduledIncome,
    scheduledExpense,
    events,
    expectedDelta,
    actualDelta,
    diff: actualDelta - expectedDelta,
  };
}
