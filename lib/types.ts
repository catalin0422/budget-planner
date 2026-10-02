export type Currency = "RON" | "EUR" | "MDL";

/** Cat valoreaza in RON o unitate din fiecare valuta straina (cursul BNR curent). */
export interface ExchangeRates {
  EUR: number;
  MDL: number;
  /** ziua pentru care BNR a publicat cursul; null daca BNR n-a raspuns niciodata si folosim un curs aproximativ */
  date: string | null;
}

export type EventSource = "recurring" | "one_time" | "daily";

export interface ScheduledEvent {
  date: string;
  label: string;
  amount: number;
  kind: "income" | "expense";
}

export interface Account {
  id: number;
  name: string;
  currency: Currency;
  sort_order: number;
  archived: number;
}

export interface Snapshot {
  id: number;
  date: string;
  note: string | null;
  created_at: string;
}

/** Snapshot cu soldul fiecarui cont (in valuta contului) si totalul in RON. */
export interface SnapshotWithBalances {
  id: number;
  date: string;
  note: string | null;
  balances: Record<number, number>; // account_id -> amount (in valuta contului)
  total: number; // RON
}

export interface RecurringItem {
  id: number;
  label: string;
  amount: number;
  currency: Currency;
  kind: "income" | "expense";
  day_of_month: number | null;
  nth_business_day: number | null;
  active: number;
  sort_order: number;
  /** ultima data (YYYY-MM-DD) pana la care userul a confirmat ca ocurentele au avut loc */
  confirmed_through: string | null;
}

export interface PlannedItem {
  id: number;
  label: string;
  amount: number;
  currency: Currency;
  kind: "income" | "expense";
  date: string;
  done: number;
}

export interface AppSettings {
  id: number;
  /** cat are voie userul sa cheltuie pe zi (RON), peste platile/veniturile programate */
  daily_budget: number;
}

/**
 * Comparatia dintre doua snapshot-uri consecutive de avere:
 * expectedDelta = venituri programate (recurring + planned) - cheltuieli programate
 *              - (zile × buget zilnic)
 * diff = actualDelta - expectedDelta; >= 0 inseamna economie, < 0 depasire.
 */
export interface Verdict {
  fromDate: string;
  toDate: string;
  fromTotal: number;
  toTotal: number;
  days: number;
  dailyBudget: number;
  allowance: number;
  scheduledIncome: number;
  scheduledExpense: number;
  events: ScheduledEvent[];
  expectedDelta: number;
  actualDelta: number;
  diff: number;
}

export interface Goal {
  id: number;
  name: string;
  /** data tinta (YYYY-MM-DD), optionala */
  target_date: string | null;
  /** suma tinta in RON, optionala */
  target_amount: number | null;
  sort_order: number;
  archived: number;
  created_at: string;
}

/**
 * Proiectia calculata pentru un obiectiv, intoarsa de /api/goals.
 *
 * target_amount inseamna "cu cat vreau sa am MAI MULT decat arata planul" la
 * target_date, nu soldul total. Obiectivele se aduna in ordinea datelor: la
 * data unui obiectiv trebuie sa ai planul + suma tuturor obiectivelor cu data
 * <= a lui (banii pusi deoparte pentru un obiectiv anterior raman in cont).
 *
 * - dailyBalance/minimumPoint/breakdown: traiectoria PLANULUI (buget zilnic
 *   curent) pana la target_date.
 * - cumulativeExtra: suma obiectivelor de pana acum, inclusiv acesta.
 * - dailyCut = cumulativeExtra / days: cu cat trebuie redus bugetul zilnic.
 * - requiredDailyBudget = bugetul curent - dailyCut (negativ = imposibil doar
 *   din bugetul zilnic).
 * - goalBalance: traiectoria cu bugetul redus (gol daca requiredDailyBudget < 0).
 */
export interface GoalProjection {
  goal: Goal;
  dailyBalance: DayBalancePoint[];
  minimumPoint: DayBalancePoint | null;
  breakdown: TripBreakdown | null;
  days: number | null;
  plannedBalance: number | null;
  cumulativeExtra: number | null;
  targetBalance: number | null;
  dailyCut: number | null;
  requiredDailyBudget: number | null;
  goalBalance: DayBalancePoint[];
}

export interface DayBalancePoint {
  date: string;
  day: number;
  delta: number;
  balance: number;
  events: { label: string; amount: number; kind: "income" | "expense"; source: EventSource }[];
}

/** Sold estimat peste `days` zile de la azi, folosind recurente + planificari + buget zilnic. */
export interface ProjectionHorizon {
  days: number;
  date: string;
  balance: number;
}

/** Proiectia generala de avere afisata pe pagina principala (independenta de obiective). */
export interface Projection {
  points: DayBalancePoint[];
  horizons: ProjectionHorizon[];
  /** data ultimului sold notat; daca e mai veche de azi, proiectia porneste de la un sold estimat */
  snapshotDate: string;
}

/**
 * Defalcarea soldului final pentru un obiectiv. Toate sumele sunt in RON.
 * total = startAssets + confirmedIncoming
 *       + recurringIncome + oneTimeDatedIncome + dailyIncome
 *       - recurringExpense - oneTimeDatedExpense - dailyExpense
 */
export interface TripBreakdown {
  startAssets: number;
  confirmedIncoming: number;
  recurringIncome: number;
  recurringExpense: number;
  oneTimeDatedIncome: number;
  oneTimeDatedExpense: number;
  dailyIncome: number;
  dailyExpense: number;
  dailyDays: number;
  dailyExpenseItems: { label: string; perDay: number }[];
  total: number;
}
