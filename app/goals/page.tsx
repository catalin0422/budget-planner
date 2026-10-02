"use client";

import { useEffect, useState, useCallback } from "react";
import type { DayBalancePoint, GoalProjection, TripBreakdown } from "@/lib/types";

function fmt(n: number) {
  return Math.round(n).toLocaleString("ro-RO") + " RON";
}

function perDay(n: number) {
  return Math.round(n).toLocaleString("ro-RO") + " RON/zi";
}

function signed(n: number) {
  return (n >= 0 ? "+ " : "− ") + fmt(Math.abs(n));
}

function formatDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("ro-RO", { day: "numeric", month: "long", year: "numeric" });
}

interface Payload {
  /** sold estimat azi (daca ultimul sold notat e mai vechi, include zilele de atunci) */
  startingBalance: number;
  snapshotDate: string | null;
  dailyBudget: number;
  /** reducerea zilnica ce atinge toate obiectivele (cea mai mare dintre ele) */
  overallDailyCut: number | null;
  goals: GoalProjection[];
}

export default function GoalsPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDate, setNewDate] = useState("");
  const [newAmount, setNewAmount] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/goals");
    const d: Payload = await res.json();
    setData(d);
  }, []);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  async function addGoal() {
    if (!newName.trim()) return;
    setSaving(true);
    await fetch("/api/goals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newName.trim(),
        targetDate: newDate || null,
        targetAmount: newAmount ? parseFloat(newAmount) : null,
      }),
    });
    setNewName("");
    setNewDate("");
    setNewAmount("");
    setAdding(false);
    setSaving(false);
    await load();
  }

  async function patchGoal(id: number, fields: Record<string, unknown>) {
    await fetch("/api/goals", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...fields }),
    });
    await load();
  }

  async function removeGoal(id: number) {
    await fetch(`/api/goals?id=${id}`, { method: "DELETE" });
    await load();
  }

  if (!data) {
    return <p className="text-ink-muted text-sm">Se încarcă...</p>;
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-ink">Obiective</h1>
        <button
          onClick={() => setAdding((v) => !v)}
          className="bg-accent text-accent-ink text-sm font-semibold rounded-full px-4 py-2 hover:brightness-95 transition"
        >
          {adding ? "Anulează" : "+ Obiectiv"}
        </button>
      </div>

      {adding && (
        <div className="bg-surface rounded-3xl p-4 shadow-soft flex flex-col gap-3">
          <div className="flex flex-wrap gap-3">
            <Field label="Nume">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="ex: vacanță în Grecia"
                className="bg-bg rounded-xl px-3 py-2 w-full focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </Field>
            <Field label="Dată țintă (opțional)">
              <input
                type="date"
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
                className="bg-bg rounded-xl px-3 py-2 w-full focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </Field>
            <Field label="În plus față de plan, RON (opțional)">
              <input
                type="number"
                value={newAmount}
                onChange={(e) => setNewAmount(e.target.value)}
                placeholder="ex: 3000"
                className="bg-bg rounded-xl px-3 py-2 w-full focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </Field>
          </div>
          <button
            onClick={addGoal}
            disabled={saving || !newName.trim()}
            className="self-start bg-ink text-white text-sm font-semibold rounded-full px-4 py-2 hover:brightness-110 transition disabled:opacity-40"
          >
            Salvează obiectivul
          </button>
        </div>
      )}

      {data.goals.length === 0 && !adding && (
        <p className="text-sm text-ink-muted">
          Nu ai niciun obiectiv încă. Adaugă unul: cât vrei să ai în plus față de ce arată planul, până la ce dată.
        </p>
      )}

      {data.overallDailyCut != null && data.goals.filter((g) => g.dailyCut != null).length > 1 && (
        <OverallCard dailyBudget={data.dailyBudget} cut={data.overallDailyCut} />
      )}

      {data.goals.map((gp) => (
        <GoalCard
          key={gp.goal.id}
          projection={gp}
          dailyBudget={data.dailyBudget}
          startingBalance={data.startingBalance}
          snapshotDate={data.snapshotDate}
          onPatch={(fields) => patchGoal(gp.goal.id, fields)}
          onDelete={() => removeGoal(gp.goal.id)}
        />
      ))}
    </div>
  );
}

function GoalCard({
  projection,
  dailyBudget,
  startingBalance,
  snapshotDate,
  onPatch,
  onDelete,
}: {
  projection: GoalProjection;
  dailyBudget: number;
  startingBalance: number;
  snapshotDate: string | null;
  onPatch: (fields: Record<string, unknown>) => void;
  onDelete: () => void;
}) {
  const {
    goal,
    dailyBalance,
    minimumPoint,
    breakdown,
    days,
    plannedBalance,
    cumulativeExtra,
    targetBalance,
    dailyCut,
    requiredDailyBudget,
    goalBalance,
  } = projection;
  const [name, setName] = useState(goal.name);
  const [date, setDate] = useState(goal.target_date ?? "");
  const [amount, setAmount] = useState(goal.target_amount != null ? String(goal.target_amount) : "");

  return (
    <div className="bg-surface rounded-3xl p-4 flex flex-col gap-3 shadow-soft">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap gap-3 flex-1">
          <Field label="Nume">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => name.trim() && name !== goal.name && onPatch({ name: name.trim() })}
              className="bg-bg rounded-xl px-3 py-2 w-full font-medium focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </Field>
          <Field label="Dată țintă">
            <input
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                onPatch({ targetDate: e.target.value || null });
              }}
              className="bg-bg rounded-xl px-3 py-2 w-full focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </Field>
          <Field label="În plus față de plan, RON">
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              onBlur={() => onPatch({ targetAmount: amount ? parseFloat(amount) : null })}
              placeholder="opțional"
              className="bg-bg rounded-xl px-3 py-2 w-full focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </Field>
        </div>
        <button
          onClick={onDelete}
          aria-label={`șterge obiectivul ${goal.name}`}
          className="text-ink-muted/50 hover:text-debit text-sm px-2 py-2"
        >
          ✕
        </button>
      </div>

      {!goal.target_date && (
        <p className="text-xs text-ink-muted">Adaugă o dată țintă ca să vezi cât trebuie să pui deoparte.</p>
      )}

      {goal.target_date && dailyBalance.length > 0 && plannedBalance != null && (
        <>
          <div className={"grid gap-3 " + (targetBalance != null ? "grid-cols-3" : "grid-cols-2")}>
            <StatCard
              label={
                snapshotDate && snapshotDate < dailyBalance[0].date
                  ? `Estimat azi (sold notat pe ${formatDate(snapshotDate)})`
                  : "Disponibil azi"
              }
              value={fmt(startingBalance)}
            />
            <StatCard label={`Plan la ${formatDate(goal.target_date)}`} value={fmt(plannedBalance)} />
            {targetBalance != null && <StatCard label="Cu obiectiv" value={fmt(targetBalance)} />}
          </div>

          {cumulativeExtra != null && dailyCut != null && requiredDailyBudget != null && days != null && (
            <div
              className={
                "rounded-2xl px-4 py-3 text-sm font-medium " +
                (requiredDailyBudget >= 0 ? "bg-accent text-accent-ink" : "bg-debit-soft text-debit")
              }
            >
              {requiredDailyBudget >= 0
                ? `Ca să ai ${fmt(cumulativeExtra)} în plus față de plan, cheltuiește maxim ${perDay(requiredDailyBudget)} în loc de ${perDay(dailyBudget)} (−${perDay(dailyCut)}, cam ${fmt(dailyCut * 30)} pe lună puși deoparte, ${days} zile).`
                : `Chiar și cu 0 RON/zi cheltuieli, îți lipsesc ${fmt(-requiredDailyBudget * days)} ca să ai ${fmt(cumulativeExtra)} în plus față de plan.`}
              {goal.target_amount != null && cumulativeExtra > goal.target_amount && (
                <span className="block text-xs font-normal mt-1 opacity-80">
                  Include și obiectivele cu dată mai devreme ({fmt(cumulativeExtra - goal.target_amount)}): banii puși
                  deoparte pentru ele rămân în cont.
                </span>
              )}
            </div>
          )}

          {minimumPoint && minimumPoint.balance < 0 && (
            <div className="bg-debit-soft text-debit rounded-2xl px-4 py-3 text-sm">
              Atenție: soldul scade pe minus în jurul datei de <strong>{formatDate(minimumPoint.date)}</strong> (sold
              estimat {fmt(minimumPoint.balance)}).
            </div>
          )}

          {breakdown && <BreakdownCard breakdown={breakdown} targetDate={goal.target_date} />}

          <BalanceChart points={dailyBalance} goalPoints={goalBalance} />
        </>
      )}
    </div>
  );
}

function BreakdownCard({ breakdown: b, targetDate }: { breakdown: TripBreakdown; targetDate: string }) {
  const programmedIncome = b.recurringIncome + b.oneTimeDatedIncome;
  const fixedExpenses = b.recurringExpense + b.oneTimeDatedExpense;

  let dailyNote = "";
  if (b.dailyExpenseItems.length === 1) {
    dailyNote = ` (${b.dailyDays} zile × ${fmt(b.dailyExpenseItems[0].perDay)})`;
  } else if (b.dailyExpenseItems.length > 1) {
    dailyNote = ` (${b.dailyDays} zile)`;
  }

  const lines: { text: string; negative: boolean }[] = [];
  lines.push({ text: `Start: ${fmt(b.startAssets)} disponibil acum (assets)`, negative: false });
  if (b.confirmedIncoming !== 0)
    lines.push({ text: `${signed(b.confirmedIncoming)} intrări sigure (disponibile de azi)`, negative: b.confirmedIncoming < 0 });
  if (programmedIncome !== 0)
    lines.push({ text: `${signed(programmedIncome)} venituri programate (recurente / la dată)`, negative: false });
  if (b.dailyIncome !== 0) lines.push({ text: `${signed(b.dailyIncome)} venituri zilnice`, negative: false });
  if (fixedExpenses !== 0)
    lines.push({ text: `${signed(-fixedExpenses)} cheltuieli fixe (recurente / la dată)`, negative: true });
  if (b.dailyExpense !== 0)
    lines.push({ text: `${signed(-b.dailyExpense)} cheltuieli zilnice${dailyNote}`, negative: true });

  return (
    <div className="bg-bg rounded-2xl p-4">
      <h3 className="text-xs font-semibold text-ink-muted mb-3">Cum se ajunge la soldul de la {formatDate(targetDate)}</h3>
      <div className="flex flex-col gap-1 text-sm">
        {lines.map((l, i) => (
          <div key={i} className={l.negative ? "text-debit" : "text-ink-muted"}>
            {l.text}
          </div>
        ))}
        <div className="border-t border-surface mt-2 pt-2 font-semibold text-ink">
          = {fmt(b.total)} la {formatDate(targetDate)}
        </div>
      </div>
    </div>
  );
}

function OverallCard({ dailyBudget, cut }: { dailyBudget: number; cut: number }) {
  const required = dailyBudget - cut;
  return (
    <div
      className={
        "rounded-3xl px-4 py-3 text-sm font-medium shadow-soft " +
        (required >= 0 ? "bg-accent text-accent-ink" : "bg-debit-soft text-debit")
      }
    >
      {required >= 0
        ? `Pentru toate obiectivele: cheltuiește maxim ${perDay(required)} în loc de ${perDay(dailyBudget)} (−${perDay(cut)}).`
        : `Toate obiectivele împreună nu se pot atinge doar din bugetul zilnic: ar trebui tăiat cu ${perDay(cut)}, mai mult decât bugetul de ${perDay(dailyBudget)}.`}
    </div>
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

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-bg rounded-2xl p-4">
      <p className="text-xs text-ink-muted mb-1">{label}</p>
      <p className="text-lg font-semibold text-ink">{value}</p>
    </div>
  );
}

function BalanceChart({ points, goalPoints }: { points: DayBalancePoint[]; goalPoints: DayBalancePoint[] }) {
  const width = 640;
  const height = 180;
  const padding = 30;

  const balances = [...points, ...goalPoints].map((p) => p.balance);
  const min = Math.min(0, ...balances);
  const max = Math.max(...balances, 1);
  const range = max - min || 1;

  const xStep = (width - padding * 2) / Math.max(points.length - 1, 1);

  const toPath = (pts: DayBalancePoint[]) =>
    pts
      .map((p, i) => {
        const x = padding + i * xStep;
        const y = padding + (1 - (p.balance - min) / range) * (height - padding * 2);
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  const pathD = toPath(points);
  const goalPathD = goalPoints.length > 0 ? toPath(goalPoints) : null;

  const zeroY = padding + (1 - (0 - min) / range) * (height - padding * 2);
  const areaD = `${pathD} L${(width - padding).toFixed(1)},${(height - padding).toFixed(1)} L${padding.toFixed(1)},${(height - padding).toFixed(1)} Z`;

  return (
    <div className="bg-bg rounded-2xl p-4">
      <h3 className="text-xs font-semibold text-ink-muted mb-3">Evoluția soldului zi-cu-zi</h3>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Grafic evoluție sold">
        <defs>
          <linearGradient id="goalFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#d6f65e" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#d6f65e" stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1={padding} y1={zeroY} x2={width - padding} y2={zeroY} stroke="#e4e6e0" strokeWidth={1} strokeDasharray="4 4" />
        <path d={areaD} fill="url(#goalFill)" stroke="none" />
        <path d={pathD} fill="none" stroke="#13211a" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
        {goalPathD && (
          <path
            d={goalPathD}
            fill="none"
            stroke="#7a9a1f"
            strokeWidth={2}
            strokeDasharray="6 4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
      </svg>
      {goalPathD && (
        <div className="flex gap-4 text-xs text-ink-muted mt-2">
          <span>━ plan</span>
          <span style={{ color: "#7a9a1f" }}>╌ cu obiectiv</span>
        </div>
      )}
      <div className="flex justify-between text-xs text-ink-muted mt-1">
        <span>{formatDate(points[0].date)}</span>
        <span>{formatDate(points[points.length - 1].date)}</span>
      </div>
    </div>
  );
}
