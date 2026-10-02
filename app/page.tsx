"use client";

import { useEffect, useRef, useState } from "react";
import { CURRENCIES, toRON } from "@/lib/balance";
import { dueRecurringOccurrences, summarizeVerdicts, type VerdictSummary } from "@/lib/verdict";
import type {
  Account,
  AppSettings,
  Currency,
  ExchangeRates,
  PlannedItem,
  Projection,
  RecurringItem,
  SnapshotWithBalances,
  Verdict,
} from "@/lib/types";
import ScheduledPanel from "@/components/ScheduledPanel";

function fmt(n: number) {
  return Math.round(n).toLocaleString("ro-RO") + " RON";
}

function signed(n: number) {
  return (n >= 0 ? "+" : "−") + fmt(Math.abs(n));
}

function formatDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("ro-RO", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function todayIso() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function daysAgoIso(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

interface WealthPayload {
  accounts: Account[];
  snapshots: SnapshotWithBalances[];
  verdicts: Verdict[];
  settings: AppSettings;
  recurring: RecurringItem[];
  planned: PlannedItem[];
  projection: Projection | null;
  rates: ExchangeRates;
}

// ordinea din cardul de sold
const BREAKDOWN_CURRENCIES: Currency[] = ["RON", "MDL", "EUR"];

function fmtRate(n: number) {
  return n.toLocaleString("ro-RO", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
}

function fmtAmount(n: number, currency: string) {
  return Math.round(n).toLocaleString("ro-RO") + " " + currency;
}

interface DueConfirmItem {
  item: RecurringItem;
  date: string;
  answer: boolean | null;
}

export default function HomePage() {
  const [data, setData] = useState<WealthPayload | null>(null);
  const [dateInput, setDateInput] = useState(todayIso());
  const [noteInput, setNoteInput] = useState("");
  const [balanceInputs, setBalanceInputs] = useState<Record<number, string>>({});
  const [budgetInput, setBudgetInput] = useState("70");
  const [newAccountName, setNewAccountName] = useState("");
  const [newAccountCurrency, setNewAccountCurrency] = useState<Currency>("RON");
  const [pendingDue, setPendingDue] = useState<DueConfirmItem[] | null>(null);
  const [pendingBalances, setPendingBalances] = useState<Record<number, number> | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    const res = await fetch("/api/wealth");
    const d: WealthPayload = await res.json();
    setData(d);
    setBudgetInput(String(d.settings.daily_budget));

    const latest = d.snapshots[d.snapshots.length - 1];
    setBalanceInputs((prev) => {
      const next = { ...prev };
      for (const acc of d.accounts) {
        if (next[acc.id] === undefined) {
          next[acc.id] = latest ? String(latest.balances[acc.id] ?? 0) : "0";
        }
      }
      return next;
    });
  }

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, []);

  async function addSnapshot() {
    if (!data) return;

    const balances: Record<number, number> = {};
    for (const acc of data.accounts) {
      const raw = balanceInputs[acc.id];
      const n = parseFloat(raw ?? "0");
      balances[acc.id] = Number.isFinite(n) ? n : 0;
    }

    // daca de la ultimul sold notat pana la data asta sunt recurente scadente
    // neconfirmate inca (ex: salariul, chiria), intrebam userul daca chiar au avut
    // loc, ca sa nu ramana la nesfarsit "urmeaza" desi le-a inclus deja in soldul
    // pe care il salveaza acum. Raspunsul schimba verdictul (cheltuit mai mult /
    // mai putin fata de plan).
    const lastSnapshot = data.snapshots[data.snapshots.length - 1];
    const due = lastSnapshot ? dueRecurringOccurrences(data.recurring, lastSnapshot.date, dateInput) : [];

    if (due.length > 0) {
      setPendingDue(due.map((d) => ({ ...d, answer: null })));
      setPendingBalances(balances);
      return;
    }

    await commitSnapshot(balances, []);
  }

  async function commitSnapshot(balances: Record<number, number>, confirmedIds: { id: number; date: string }[]) {
    setSaving(true);
    await fetch("/api/snapshots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: dateInput, note: noteInput, balances }),
    });

    for (const { id, date } of confirmedIds) {
      await fetch("/api/scheduled", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemType: "recurring", id, confirmed_through: date }),
      });
    }

    setNoteInput("");
    await load();
    setSaving(false);
  }

  function answerDue(index: number, value: boolean) {
    setPendingDue((cur) => cur && cur.map((d, i) => (i === index ? { ...d, answer: value } : d)));
  }

  async function confirmPendingDue() {
    if (!pendingDue || !pendingBalances) return;
    const confirmedIds = pendingDue.filter((d) => d.answer === true).map((d) => ({ id: d.item.id, date: d.date }));
    const balances = pendingBalances;
    setPendingDue(null);
    setPendingBalances(null);
    await commitSnapshot(balances, confirmedIds);
  }

  function cancelPendingDue() {
    setPendingDue(null);
    setPendingBalances(null);
  }

  async function addAccount() {
    if (!newAccountName.trim()) return;
    await fetch("/api/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newAccountName.trim(), currency: newAccountCurrency }),
    });
    setNewAccountName("");
    setNewAccountCurrency("RON");
    await load();
  }

  async function removeAccount(id: number, name: string) {
    const ok = window.confirm(`Ștergi contul „${name}” și tot istoricul lui de solduri? Nu se poate anula.`);
    if (!ok) return;
    await fetch(`/api/accounts?id=${id}`, { method: "DELETE" });
    await load();
  }

  async function saveBudget() {
    const budget = parseFloat(budgetInput);
    if (!Number.isFinite(budget) || budget < 0) return;
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dailyBudget: budget }),
    });
    await load();
  }

  if (!data) {
    return <p className="text-ink-muted text-sm">Se încarcă...</p>;
  }

  const { accounts, snapshots, verdicts, settings, rates } = data;
  const latest = snapshots[snapshots.length - 1] ?? null;
  const previous = snapshots.length > 1 ? snapshots[snapshots.length - 2] : null;
  const latestVerdict = verdicts[verdicts.length - 1] ?? null;
  // totalul: toate conturile convertite in RON la cursul BNR curent (si pentru
  // snapshot-ul anterior, ca diferenta sa nu includa miscarea cursului)
  const totalRon = (snap: SnapshotWithBalances) =>
    accounts.reduce((sum, acc) => sum + toRON(snap.balances[acc.id] ?? 0, acc.currency, rates), 0);
  // cat ai in fiecare valuta, neconvertit
  const amountIn = (currency: Currency) =>
    accounts
      .filter((acc) => acc.currency === currency)
      .reduce((sum, acc) => sum + (latest?.balances[acc.id] ?? 0), 0);
  const total = latest ? totalRon(latest) : 0;
  const previousTotal = previous ? totalRon(previous) : null;
  // ritmul agregat pe ultimele 30 de zile; afisat doar cand acopera mai multe
  // intervale decat ultimul verdict, altfel ar dubla informatia din cardul de mai sus
  const summary = summarizeVerdicts(verdicts, daysAgoIso(30));

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-ink">Soldul meu</h1>
        <div className="flex items-center gap-2 text-[11px] text-ink-muted">
          <span className="flex items-center gap-1 bg-surface rounded-full px-2.5 py-1 shadow-soft">
            <input
              type="number"
              value={budgetInput}
              onChange={(e) => setBudgetInput(e.target.value)}
              onBlur={saveBudget}
              className="w-10 bg-transparent text-ink font-medium focus:outline-none"
            />
            RON/zi
          </span>
        </div>
      </div>

      <div className="relative bg-dark rounded-3xl p-6 overflow-hidden shadow-soft">
        <div
          className="absolute -right-10 -top-16 w-56 h-56 rounded-full opacity-20"
          style={{ background: "radial-gradient(circle, var(--color-accent) 0%, transparent 70%)" }}
        />
        <p className="relative text-xs text-white/50 mb-2">
          Total {latest ? `la ${formatDate(latest.date)}` : ""}
        </p>
        {/* pe ecrane inguste, EUR trece sub RON in loc sa iasa din card */}
        <div className="relative flex flex-wrap items-baseline gap-x-5 gap-y-1">
          {[
            { amount: total, currency: "RON" },
            { amount: total / rates.EUR, currency: "EUR" },
          ].map(({ amount, currency }) => (
            <p key={currency} className="text-4xl font-bold text-white tabular-nums tracking-tight">
              {Math.round(amount).toLocaleString("ro-RO")}
              <span className="text-lg font-semibold text-white/60 ml-1.5">{currency}</span>
            </p>
          ))}
        </div>
        {previous && previousTotal !== null && (
          <span
            className={
              "relative mt-3 inline-flex items-center text-xs font-medium rounded-full px-3 py-1 " +
              (total - previousTotal >= 0 ? "bg-accent text-accent-ink" : "bg-white/15 text-white")
            }
          >
            {signed(total - previousTotal)} față de {formatDate(previous.date)}
          </span>
        )}
        <div className="relative grid grid-cols-3 gap-3 mt-5 pt-4 border-t border-white/10">
          {BREAKDOWN_CURRENCIES.map((currency) => {
            const amount = amountIn(currency);
            return (
              <div key={currency} className="min-w-0">
                <p className="text-[11px] text-white/50 mb-0.5">{currency}</p>
                <p className="text-base font-semibold text-white tabular-nums truncate">
                  {Math.round(amount).toLocaleString("ro-RO")}
                </p>
                {currency !== "RON" && (
                  <p className="text-[11px] text-white/40 tabular-nums truncate">
                    ≈ {fmt(toRON(amount, currency, rates))}
                  </p>
                )}
              </div>
            );
          })}
        </div>
        <p className="relative text-[11px] text-white/40 mt-4">
          {rates.date
            ? `Curs BNR din ${formatDate(rates.date)} · EUR ${fmtRate(rates.EUR)} · MDL ${fmtRate(rates.MDL)}`
            : "Curs BNR indisponibil — conversie aproximativă"}
        </p>
      </div>

      {accounts.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          {accounts.map((acc, i) => {
            const amount = latest?.balances[acc.id] ?? 0;
            const prevAmount = previous?.balances[acc.id];
            const diffRON =
              prevAmount !== undefined
                ? toRON(amount, acc.currency, rates) - toRON(prevAmount, acc.currency, rates)
                : null;
            return (
              <div key={acc.id} className="relative bg-surface rounded-3xl p-4 shadow-soft">
                <div className="flex items-center justify-between mb-3">
                  <span
                    className={
                      "w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold " +
                      avatarStyle(i)
                    }
                  >
                    {initials(acc.name)}
                  </span>
                  <button
                    onClick={() => removeAccount(acc.id, acc.name)}
                    aria-label={`șterge contul ${acc.name}`}
                    className="text-ink-muted/50 hover:text-debit text-xs px-1 py-1 -m-1 transition-colors"
                  >
                    ✕
                  </button>
                </div>
                <p className="text-xs text-ink-muted mb-0.5">{acc.name}</p>
                <p className="text-base font-semibold text-ink tabular-nums">
                  {Math.round(amount).toLocaleString("ro-RO")} {acc.currency}
                </p>
                {diffRON !== null && (
                  <p className={"text-xs mt-1 font-medium " + (diffRON >= 0 ? "text-credit" : "text-debit")}>
                    {signed(diffRON)}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {data.projection && <ProjectionCard projection={data.projection} />}

      {latestVerdict && <VerdictCard v={latestVerdict} />}

      {summary && summary.intervals >= 2 && (
        <SavingsRateCard s={summary} dailyBudget={settings.daily_budget} />
      )}

      {snapshots.length >= 2 && <EvolutionChart snapshots={snapshots} />}

      <ScheduledPanel recurring={data.recurring} planned={data.planned} onChange={load} />

      <div className="bg-surface rounded-3xl p-4 flex flex-col gap-3 shadow-soft">
        <h3 className="text-sm font-semibold text-ink">Notează soldurile</h3>
        <div className="flex flex-wrap gap-3 items-end">
          <Field label="Data">
            <input
              type="date"
              value={dateInput}
              onChange={(e) => setDateInput(e.target.value)}
              className="bg-bg rounded-xl px-3 py-2 w-full focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </Field>
          {accounts.map((acc) => (
            <Field key={acc.id} label={`${acc.name} (${acc.currency})`}>
              <input
                type="number"
                value={balanceInputs[acc.id] ?? ""}
                onChange={(e) => setBalanceInputs((prev) => ({ ...prev, [acc.id]: e.target.value }))}
                className="bg-bg rounded-xl px-3 py-2 w-full focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </Field>
          ))}
          <Field label="Notă (opțional)">
            <input
              type="text"
              value={noteInput}
              onChange={(e) => setNoteInput(e.target.value)}
              placeholder="ex: după salariu"
              className="bg-bg rounded-xl px-3 py-2 w-full focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </Field>
          <button
            onClick={addSnapshot}
            disabled={saving || accounts.length === 0}
            className="bg-accent text-accent-ink text-sm font-semibold rounded-full px-5 py-2.5 hover:brightness-95 transition disabled:opacity-40"
          >
            Salvează
          </button>
        </div>

        <div className="flex flex-wrap gap-2 items-end pt-3 border-t border-bg">
          <Field label="Cont nou">
            <input
              type="text"
              value={newAccountName}
              onChange={(e) => setNewAccountName(e.target.value)}
              placeholder="ex: Revolut"
              className="bg-bg rounded-xl px-3 py-2 w-full focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </Field>
          <select
            value={newAccountCurrency}
            onChange={(e) => setNewAccountCurrency(e.target.value as Currency)}
            className="bg-bg rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <button
            onClick={addAccount}
            className="text-sm text-ink-muted hover:text-ink px-3 py-2 transition-colors"
          >
            + adaugă cont
          </button>
        </div>
      </div>

      {pendingDue && (
        <div className="fixed inset-0 z-50 bg-ink/40 flex items-end sm:items-center justify-center p-4">
          <div className="bg-surface rounded-3xl p-5 shadow-soft w-full max-w-sm flex flex-col gap-4">
            <div>
              <h3 className="text-sm font-semibold text-ink">Ai plătit deja?</h3>
              <p className="text-xs text-ink-muted mt-1">
                Până la {formatDate(dateInput)} au scadență următoarele — răspunsul schimbă dacă ai cheltuit mai mult
                sau mai puțin față de plan.
              </p>
            </div>
            <div className="flex flex-col gap-3">
              {pendingDue.map((d, i) => (
                <div key={i} className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-ink">{d.item.label || "(fără nume)"}</p>
                    <p className="text-xs text-ink-muted">
                      {fmtAmount(d.item.amount, d.item.currency)} · scadent {formatDate(d.date)}
                    </p>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <button
                      onClick={() => answerDue(i, true)}
                      className={
                        "text-xs font-semibold rounded-full px-3.5 py-1.5 transition " +
                        (d.answer === true ? "bg-accent text-accent-ink" : "bg-bg text-ink-muted")
                      }
                    >
                      Da
                    </button>
                    <button
                      onClick={() => answerDue(i, false)}
                      className={
                        "text-xs font-semibold rounded-full px-3.5 py-1.5 transition " +
                        (d.answer === false ? "bg-debit-soft text-debit" : "bg-bg text-ink-muted")
                      }
                    >
                      Nu
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-2 justify-end pt-1">
              <button onClick={cancelPendingDue} className="text-sm text-ink-muted hover:text-ink px-3 py-2">
                Anulează
              </button>
              <button
                onClick={confirmPendingDue}
                disabled={pendingDue.some((d) => d.answer === null) || saving}
                className="bg-accent text-accent-ink text-sm font-semibold rounded-full px-4 py-2 disabled:opacity-40 transition hover:brightness-95"
              >
                Salvează
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const avatarPalette = ["bg-dark text-white", "bg-credit text-white", "bg-debit text-white", "bg-accent text-accent-ink"];

function avatarStyle(i: number) {
  return avatarPalette[i % avatarPalette.length];
}

function initials(name: string) {
  const trimmed = name.trim();
  return trimmed ? trimmed.slice(0, 2).toUpperCase() : "??";
}

function ProjectionCard({ projection }: { projection: Projection }) {
  const [customDate, setCustomDate] = useState("");
  const [customResult, setCustomResult] = useState<{ date: string; balance: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function checkCustomDate() {
    if (!customDate) return;
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/projection?date=${customDate}`);
    const body = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(body.error ?? "Eroare");
      setCustomResult(null);
      return;
    }
    setCustomResult({ date: body.date, balance: body.balance });
  }

  return (
    <div className="bg-surface rounded-3xl p-4 flex flex-col gap-3 shadow-soft">
      <h3 className="text-sm font-semibold text-ink">
        Proiecție RON{" "}
        <span className="text-ink-muted font-normal text-xs">
          (doar conturile RON, fără EUR și MDL — pe baza recurentelor, planificărilor și bugetului zilnic)
        </span>
      </h3>
      {projection.snapshotDate < todayIso() && (
        <p className="text-xs text-ink-muted">
          Ultimul sold notat e din {formatDate(projection.snapshotDate)}. Zilele de atunci până azi sunt estimate din
          buget și plățile programate; notează soldul ca proiecția să pornească de la cifra reală.
        </p>
      )}
      <div className="grid grid-cols-3 gap-3">
        {projection.horizons.map((h) => (
          <div key={h.days} className="bg-bg rounded-2xl p-3">
            <p className="text-xs text-ink-muted mb-1">peste {h.days} zile</p>
            <p className="text-sm font-semibold text-ink tabular-nums">{fmt(h.balance)}</p>
            {h.date && <p className="text-[11px] text-ink-muted mt-0.5">{formatDate(h.date)}</p>}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-2 pt-3 border-t border-bg">
        <Field label="Sau la o dată aleasă">
          <input
            type="date"
            value={customDate}
            onChange={(e) => {
              setCustomDate(e.target.value);
              setCustomResult(null);
              setError(null);
            }}
            className="bg-bg rounded-xl px-3 py-2 w-full focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </Field>
        <button
          onClick={checkCustomDate}
          disabled={!customDate || loading}
          className="bg-accent text-accent-ink text-sm font-semibold rounded-full px-4 py-2.5 hover:brightness-95 transition disabled:opacity-40"
        >
          Vezi soldul
        </button>
      </div>

      {error && <p className="text-xs text-debit">{error}</p>}

      {customResult && (
        <div className="bg-bg rounded-2xl p-3">
          <p className="text-xs text-ink-muted mb-1">sold estimat pe {formatDate(customResult.date)}</p>
          <p className="text-lg font-semibold text-ink tabular-nums">{fmt(customResult.balance)}</p>
        </div>
      )}
    </div>
  );
}

function VerdictCard({ v }: { v: Verdict }) {
  const saved = v.diff >= 0;
  return (
    <div className="bg-surface rounded-3xl p-4 flex flex-col gap-3 shadow-soft">
      <div className="flex flex-wrap justify-between items-center gap-3">
        <h3 className="text-sm font-semibold text-ink">
          {formatDate(v.fromDate)} → {formatDate(v.toDate)}{" "}
          <span className="text-ink-muted font-normal text-xs">
            ({v.days} {v.days === 1 ? "zi" : "zile"})
          </span>
        </h3>
        <span
          className={
            "shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full " +
            (saved ? "bg-accent text-accent-ink" : "bg-debit-soft text-debit")
          }
        >
          {saved ? `Economisit ${fmt(v.diff)}` : `Depășit ${fmt(-v.diff)}`}
        </span>
      </div>

      <div className="flex flex-col gap-1 text-sm">
        <div className="text-ink-muted">
          Total: {fmt(v.fromTotal)} → {fmt(v.toTotal)} ({signed(v.actualDelta)})
        </div>
        <div className="text-ink-muted">
          Buget zilnic: {v.days} {v.days === 1 ? "zi" : "zile"} × {fmt(v.dailyBudget)} = {signed(-v.allowance)}
        </div>
        {v.events.map((e, i) => (
          <div key={i} className={e.kind === "expense" ? "text-debit" : "text-credit"}>
            {e.kind === "expense" ? "Plată programată" : "Venit programat"}: {e.label || "(fără nume)"}{" "}
            {signed(e.kind === "expense" ? -e.amount : e.amount)} ({formatDate(e.date)})
          </div>
        ))}
        <div className="border-t border-bg mt-2 pt-2 text-ink">
          Așteptat: {signed(v.expectedDelta)} · Real: {signed(v.actualDelta)} ·{" "}
          <span className={saved ? "text-credit font-semibold" : "text-debit font-semibold"}>
            {signed(v.diff)}
          </span>
        </div>
      </div>
    </div>
  );
}

function SavingsRateCard({ s, dailyBudget }: { s: VerdictSummary; dailyBudget: number }) {
  const saved = s.diff >= 0;
  // cat s-a cheltuit efectiv "pe zi" din bugetul zilnic, dupa ce scoatem
  // platile/veniturile programate din schimbarea reala a averii
  const actualDailySpend =
    s.days > 0 ? (s.scheduledIncome - s.scheduledExpense - s.actualDelta) / s.days : 0;

  return (
    <div className="bg-surface rounded-3xl p-4 flex flex-col gap-3 shadow-soft">
      <div className="flex flex-wrap justify-between items-baseline gap-2">
        <h3 className="text-sm font-semibold text-ink">
          Ritmul tău — ultimele 30 de zile{" "}
          <span className="font-normal text-xs text-ink-muted">
            ({formatDate(s.fromDate)} → {formatDate(s.toDate)}, {s.days}{" "}
            {s.days === 1 ? "zi" : "zile"}, {s.intervals} intervale)
          </span>
        </h3>
        <span
          className={
            "text-xs font-semibold px-3 py-1.5 rounded-full " +
            (saved ? "bg-accent text-accent-ink" : "bg-debit-soft text-debit")
          }
        >
          {saved ? `+${fmt(s.diff)}` : `−${fmt(-s.diff)}`}
        </span>
      </div>

      <div className="flex flex-col gap-1 text-sm">
        <div className="text-ink-muted">
          Așteptat: {signed(s.expectedDelta)} · Real: {signed(s.actualDelta)} ·{" "}
          <span className={saved ? "text-credit font-semibold" : "text-debit font-semibold"}>
            {signed(s.diff)}
          </span>
        </div>
      </div>

      {s.days > 0 && (
        <p className="text-xs text-ink-muted">
          Ai cheltuit în medie ~{Math.round(actualDailySpend).toLocaleString("ro-RO")} RON/zi din
          bugetul zilnic (limita: {Math.round(dailyBudget)} RON/zi).
        </p>
      )}
    </div>
  );
}

function EvolutionChart({ snapshots }: { snapshots: SnapshotWithBalances[] }) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const width = 640;
  const height = 240;
  const paddingLeft = 64;
  const paddingRight = 16;
  const paddingTop = 20;
  const paddingBottom = 16;
  const plotWidth = width - paddingLeft - paddingRight;
  const plotHeight = height - paddingTop - paddingBottom;

  const totals = snapshots.map((s) => s.total);
  const min = Math.min(0, ...totals);
  const max = Math.max(...totals, 1);
  const range = max - min || 1;

  const xStep = plotWidth / Math.max(snapshots.length - 1, 1);
  const xFor = (i: number) => paddingLeft + i * xStep;
  const yFor = (value: number) => paddingTop + (1 - (value - min) / range) * plotHeight;

  const pathD = snapshots
    .map((s, i) => `${i === 0 ? "M" : "L"}${xFor(i).toFixed(1)},${yFor(s.total).toFixed(1)}`)
    .join(" ");
  const areaD = `${pathD} L${xFor(snapshots.length - 1).toFixed(1)},${(paddingTop + plotHeight).toFixed(1)} L${xFor(0).toFixed(1)},${(paddingTop + plotHeight).toFixed(1)} Z`;

  const tickCount = 4;
  const ticks = Array.from({ length: tickCount + 1 }, (_, i) => min + (range * i) / tickCount);

  const lastTotal = totals[totals.length - 1];
  const lastY = yFor(lastTotal);
  const labelBelow = lastY < paddingTop + 24;

  function nearestIndexFromClientX(clientX: number) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0) return;
    const scale = width / rect.width;
    const svgX = (clientX - rect.left) * scale;
    const index = Math.round((svgX - paddingLeft) / xStep);
    setHoverIndex(Math.min(Math.max(index, 0), snapshots.length - 1));
  }

  return (
    <div className="bg-surface rounded-3xl p-4 shadow-soft">
      <h3 className="text-sm font-semibold text-ink mb-3">Evoluția soldului</h3>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        className="w-full touch-none"
        role="img"
        aria-label="Grafic evoluție sold"
        onMouseMove={(e) => nearestIndexFromClientX(e.clientX)}
        onMouseLeave={() => setHoverIndex(null)}
        onTouchStart={(e) => nearestIndexFromClientX(e.touches[0].clientX)}
        onTouchMove={(e) => nearestIndexFromClientX(e.touches[0].clientX)}
      >
        <defs>
          <linearGradient id="evoFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#d6f65e" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#d6f65e" stopOpacity="0" />
          </linearGradient>
        </defs>

        {ticks.map((t, i) => (
          <g key={i}>
            <line
              x1={paddingLeft}
              y1={yFor(t)}
              x2={width - paddingRight}
              y2={yFor(t)}
              stroke={Math.abs(t) < 0.01 ? "#c7cbc2" : "#eceee9"}
              strokeWidth={1}
              strokeDasharray={Math.abs(t) < 0.01 ? "4 4" : undefined}
            />
            <text x={paddingLeft - 8} y={yFor(t) + 3} textAnchor="end" fontSize="10" fill="#868c82">
              {Math.round(t).toLocaleString("ro-RO")}
            </text>
          </g>
        ))}

        <path d={areaD} fill="url(#evoFill)" stroke="none" />
        <path d={pathD} fill="none" stroke="#13211a" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />

        {snapshots.map((s, i) => (
          <circle key={s.id} cx={xFor(i)} cy={yFor(s.total)} r={i === snapshots.length - 1 ? 4.5 : 3} fill="#13211a" />
        ))}

        <circle cx={xFor(snapshots.length - 1)} cy={lastY} r={4.5} fill="#d6f65e" stroke="#13211a" strokeWidth={1.5} />
        <text
          x={xFor(snapshots.length - 1)}
          y={labelBelow ? lastY + 18 : lastY - 12}
          textAnchor="end"
          fontSize="13"
          fontWeight={600}
          fill="#13211a"
        >
          {fmt(lastTotal)}
        </text>

        {hoverIndex !== null && (
          <line
            x1={xFor(hoverIndex)}
            y1={paddingTop}
            x2={xFor(hoverIndex)}
            y2={paddingTop + plotHeight}
            stroke="#13211a"
            strokeWidth={1}
            strokeDasharray="3 3"
            opacity={0.3}
          />
        )}

        {hoverIndex !== null && (
          <EvolutionTooltip
            x={xFor(hoverIndex)}
            y={yFor(snapshots[hoverIndex].total)}
            width={width}
            date={formatDate(snapshots[hoverIndex].date)}
            value={fmt(snapshots[hoverIndex].total)}
          />
        )}
      </svg>
      <div className="flex justify-between text-xs text-ink-muted mt-1">
        <span>{formatDate(snapshots[0].date)}</span>
        <span>{formatDate(snapshots[snapshots.length - 1].date)}</span>
      </div>
    </div>
  );
}

function EvolutionTooltip({
  x,
  y,
  width,
  date,
  value,
}: {
  x: number;
  y: number;
  width: number;
  date: string;
  value: string;
}) {
  const boxWidth = Math.max(date.length, value.length) * 6.2 + 20;
  const boxHeight = 38;
  const nearRightEdge = x + boxWidth / 2 > width - 8;
  const nearLeftEdge = x - boxWidth / 2 < 8;
  let boxX = x - boxWidth / 2;
  if (nearRightEdge) boxX = width - boxWidth - 8;
  if (nearLeftEdge) boxX = 8;
  const boxY = y > boxHeight + 16 ? y - boxHeight - 12 : y + 14;

  return (
    <g>
      <circle cx={x} cy={y} r={5.5} fill="#d6f65e" stroke="#13211a" strokeWidth={1.5} />
      <rect x={boxX} y={boxY} width={boxWidth} height={boxHeight} rx={10} fill="#13211a" />
      <text x={boxX + boxWidth / 2} y={boxY + 15} textAnchor="middle" fontSize="10" fill="#ffffff" opacity={0.7}>
        {date}
      </text>
      <text x={boxX + boxWidth / 2} y={boxY + 29} textAnchor="middle" fontSize="12" fontWeight={600} fill="#ffffff">
        {value}
      </text>
    </g>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex-1 min-w-[140px]">
      <label className="text-xs text-ink-muted block mb-1">{label}</label>
      {children}
    </div>
  );
}
