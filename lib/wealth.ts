import { getAppSettings, listAccounts, listPlanned, listRecurring, listSnapshotsWithBalances } from "./queries";
import { compareSnapshots } from "./verdict";
import { getCurrentRates } from "./bnr";
import { buildDailyBalance, estimateBalanceToday, plannedToEntries, recurringToEntries, ronOnlyTotal, todayIso, type DailyEntry } from "./balance";
import type {
  Account,
  AppSettings,
  DayBalancePoint,
  ExchangeRates,
  PlannedItem,
  Projection,
  RecurringItem,
  SnapshotWithBalances,
  Verdict,
} from "./types";

// orizonturile aratate in cardul de proiectie de pe pagina principala
const PROJECTION_HORIZON_DAYS = [7, 30, 90];

/** Payload complet pentru paginile "Averea mea" si "Istoric": stare curenta + verdicte. */
export async function buildWealthPayload(userId: string) {
  // Interogari independente -- le lansam in paralel ca sa nu platim un
  // round-trip la baza pentru fiecare (conteaza acum, cand baza nu mai e un
  // fisier local, ci Supabase peste retea). Doar totalurile snapshot-urilor
  // asteapta cursul BNR.
  const ratesPromise = getCurrentRates();
  const [rates, accounts, snapshots, settings, recurring, planned] = await Promise.all([
    ratesPromise,
    listAccounts(userId),
    ratesPromise.then((r) => listSnapshotsWithBalances(userId, r)),
    getAppSettings(userId),
    listRecurring(userId),
    listPlanned(userId),
  ]);

  const verdicts: Verdict[] = [];
  for (let i = 1; i < snapshots.length; i++) {
    verdicts.push(
      compareSnapshots({
        from: snapshots[i - 1],
        to: snapshots[i],
        dailyBudget: settings.daily_budget,
        recurring,
        planned,
        rates,
      })
    );
  }

  const projection = buildProjection({ snapshots, accounts, settings, recurring, planned, rates });

  return { accounts, snapshots, verdicts, settings, recurring, planned, projection, rates };
}

/**
 * Construieste traiectoria zi-cu-zi a soldului total de la azi pana la
 * `endDate`, pornind de la soldul estimat azi (vezi estimateBalanceToday:
 * snapshot-ul poate fi mai vechi) + recurentele active +
 * planificarile nefinalizate + bugetul zilnic curent. Folosita atat pentru
 * orizonturile fixe de pe pagina principala, cat si pentru o data aleasa
 * liber de user (vezi /api/projection).
 */
export function projectPoints(params: {
  snapshotBalance: number;
  snapshotDate: string;
  endDate: Date;
  settings: AppSettings;
  recurring: RecurringItem[];
  planned: PlannedItem[];
  rates: ExchangeRates;
}): DayBalancePoint[] {
  const { snapshotBalance, snapshotDate, endDate, settings, recurring, planned, rates } = params;

  const recurringEntries = recurringToEntries(recurring, rates);
  const oneTimeEntries = plannedToEntries(planned, rates);
  const dailyEntries: DailyEntry[] =
    settings.daily_budget > 0
      ? [{ label: "Buget zilnic", amountRON: settings.daily_budget, kind: "expense" }]
      : [];

  const startDate = new Date(todayIso());
  const startingBalance = estimateBalanceToday({
    snapshotBalance,
    snapshotDate,
    recurringEntries,
    oneTimeEntries,
    dailyEntries,
  });

  return buildDailyBalance({
    startingBalance,
    startDate,
    endDate,
    recurringEntries,
    oneTimeEntries,
    dailyEntries,
  });
}

/**
 * Proiectia soldului RON pe urmatoarele ~90 de zile, pornind de la ultimul
 * sold notat -- DOAR conturile in RON, fara conturile in valuta (EUR, MDL), ca
 * sa nu se amestece banii "de rezerva" in valuta cu proiectia de
 * cheltuit. Aceeasi logica ca la obiective (buildDailyBalance), dar fara sa
 * fie nevoie sa creezi un obiectiv -- doar ca sa vezi "cat voi avea".
 */
function buildProjection(params: {
  snapshots: SnapshotWithBalances[];
  accounts: Account[];
  settings: AppSettings;
  recurring: RecurringItem[];
  planned: PlannedItem[];
  rates: ExchangeRates;
}): Projection | null {
  const { snapshots, accounts, settings, recurring, planned, rates } = params;
  const latest = snapshots[snapshots.length - 1];
  if (!latest) return null;

  const snapshotBalance = ronOnlyTotal(latest.balances, accounts);

  const maxHorizon = Math.max(...PROJECTION_HORIZON_DAYS);
  const endDate = new Date(todayIso());
  endDate.setDate(endDate.getDate() + maxHorizon);

  const points = projectPoints({
    snapshotBalance,
    snapshotDate: latest.date,
    endDate,
    settings,
    recurring,
    planned,
    rates,
  });

  // points[0] e azi, points[i] e azi + i zile
  const horizons = PROJECTION_HORIZON_DAYS.map((days) => {
    const point = points[Math.min(days, points.length - 1)] ?? null;
    return { days, date: point?.date ?? "", balance: point?.balance ?? snapshotBalance };
  });

  return { points, horizons, snapshotDate: latest.date };
}
