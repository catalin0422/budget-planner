import { execute, queryOne } from "./db";
import { todayIso } from "./balance";
import type { ExchangeRates } from "./types";

/**
 * Cursul oficial BNR pentru EUR si MDL, pastrat in tabelul exchange_rates.
 *
 * Nu folosim un cron: cursul conteaza doar cand cineva deschide aplicatia, asa
 * ca il aducem la cerere (getCurrentRates), cel mult o data la SYNC_INTERVAL_MS
 * per instanta. Ne intereseaza doar cursul curent, deci ajunge fisierul cu
 * ultimele 10 zile (acopera weekendurile si sarbatorile, cand BNR nu publica).
 *
 * Sursa (site-ul BNR a mutat XML-urile pe subdomeniul curs.bnr.ro; vechiul
 * www.bnr.ro/nbrfxrates.xml redirectioneaza acum spre prima pagina):
 */
const BNR_10_DAYS_URL = "https://curs.bnr.ro/nbrfxrates10days.xml";

const SYNC_INTERVAL_MS = 30 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5000;

/**
 * Folosit doar cat timp tabelul e gol si BNR nu raspunde (practic: primul
 * deploy, cu BNR picat). E aproximativ, doar ca un cont in valuta sa nu apara
 * cu 0; date: null face UI-ul sa arate ca nu e cursul BNR.
 */
const FALLBACK_RATES: ExchangeRates = { EUR: 5.3, MDL: 0.27, date: null };

interface BnrRate {
  date: string;
  eur_ron: number;
  mdl_ron: number;
}

/** Cursul unei valute dintr-un <Cube>, pe unitate (unele valute vin la 100 de unitati, ex: HUF). */
function rateIn(cube: string, currency: string): number | null {
  const match = new RegExp(`<Rate currency="${currency}"(?: multiplier="(\\d+)")?>([\\d.]+)</Rate>`).exec(cube);
  if (!match) return null;
  const value = Number(match[2]) / Number(match[1] ?? 1);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** Extrage cursurile EUR si MDL din fiecare <Cube date="..."> al unui XML BNR. */
export function parseBnrRates(xml: string): BnrRate[] {
  const rates: BnrRate[] = [];
  const cubeRe = /<Cube date="(\d{4}-\d{2}-\d{2})">([\s\S]*?)<\/Cube>/g;
  for (const [, date, body] of xml.matchAll(cubeRe)) {
    const eur = rateIn(body, "EUR");
    const mdl = rateIn(body, "MDL");
    if (eur !== null && mdl !== null) rates.push({ date, eur_ron: eur, mdl_ron: mdl });
  }
  return rates;
}

async function fetchRates(): Promise<BnrRate[]> {
  const res = await fetch(BNR_10_DAYS_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), cache: "no-store" });
  if (!res.ok) throw new Error(`BNR ${BNR_10_DAYS_URL}: HTTP ${res.status}`);
  const rates = parseBnrRates(await res.text());
  if (rates.length === 0) throw new Error(`BNR ${BNR_10_DAYS_URL}: niciun curs EUR/MDL in raspuns`);
  return rates;
}

/** Un singur INSERT pentru toate zilele: fiecare instructiune e un round-trip pana la Supabase. */
async function saveRates(rates: BnrRate[]): Promise<void> {
  const rows = rates.map(() => "(?, ?, ?)").join(", ");
  await execute(
    `INSERT INTO exchange_rates (date, eur_ron, mdl_ron) VALUES ${rows}
     ON CONFLICT (date) DO UPDATE
       SET eur_ron = excluded.eur_ron, mdl_ron = excluded.mdl_ron, fetched_at = now()`,
    rates.flatMap((r) => [r.date, r.eur_ron, r.mdl_ron])
  );
}

/**
 * Aduce cursurile de la BNR si le salveaza; intoarce cel mai recent. Nu arunca:
 * daca BNR nu raspunde, aplicatia merge mai departe cu ultimul curs salvat.
 */
async function syncRates(): Promise<BnrRate | null> {
  try {
    const rates = await fetchRates();
    await saveRates(rates);
    return rates.reduce((newest, r) => (r.date > newest.date ? r : newest));
  } catch (error) {
    console.error("Nu am putut actualiza cursul BNR:", error);
    return null;
  }
}

let lastSyncAttempt = 0;

/** Ultimul curs BNR publicat (azi sau, in weekend / inainte de ora publicarii, cel anterior). */
export async function getCurrentRates(): Promise<ExchangeRates> {
  let latest = await queryOne<BnrRate>(
    "SELECT date, eur_ron, mdl_ron FROM exchange_rates ORDER BY date DESC LIMIT 1"
  );

  if (latest?.date !== todayIso() && Date.now() - lastSyncAttempt >= SYNC_INTERVAL_MS) {
    lastSyncAttempt = Date.now();
    const fetched = await syncRates();
    if (fetched && (!latest || fetched.date > latest.date)) latest = fetched;
  }

  return latest ? { EUR: latest.eur_ron, MDL: latest.mdl_ron, date: latest.date } : FALLBACK_RATES;
}
