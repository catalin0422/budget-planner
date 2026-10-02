"use client";

import { useState } from "react";
import { nthWorkingDayOfMonth } from "@/lib/dates";
import type { PlannedItem, RecurringItem } from "@/lib/types";

function fmt(n: number) {
  return Math.round(n).toLocaleString("ro-RO");
}

function signed(n: number, currency: string) {
  return (n >= 0 ? "+" : "−") + fmt(Math.abs(n)) + " " + currency;
}

function formatDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("ro-RO", { day: "numeric", month: "long" });
}

function todayIso() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

interface UpcomingEvent {
  date: string;
  label: string;
  amount: number;
  currency: string;
  kind: "income" | "expense";
}

function getUpcoming(recurring: RecurringItem[], planned: PlannedItem[], horizonDays = 30): UpcomingEvent[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const horizon = new Date(today);
  horizon.setDate(horizon.getDate() + horizonDays);

  const events: UpcomingEvent[] = [];

  for (const r of recurring) {
    if (!r.active) continue;
    // luna curenta si urmatoarele doua, ca sa acoperim orizontul de 30 de zile chiar
    // langa finalul lunii
    for (let offset = 0; offset <= 2; offset++) {
      const d = new Date(today.getFullYear(), today.getMonth() + offset, 1);
      const year = d.getFullYear();
      const month = d.getMonth() + 1;
      const targetDay = r.nth_business_day
        ? nthWorkingDayOfMonth(year, month, r.nth_business_day)
        : r.day_of_month;
      if (!targetDay) continue;
      const occ = new Date(year, month - 1, targetDay);
      const iso = `${year}-${String(month).padStart(2, "0")}-${String(targetDay).padStart(2, "0")}`;
      if (occ >= today && occ <= horizon && iso > (r.confirmed_through ?? "")) {
        events.push({ date: iso, label: r.label, amount: r.amount, currency: r.currency, kind: r.kind });
      }
    }
  }

  for (const p of planned) {
    if (p.done) continue;
    const [y, m, d] = p.date.split("-").map(Number);
    const occ = new Date(y, m - 1, d);
    if (occ >= today && occ <= horizon) {
      events.push({ date: p.date, label: p.label, amount: p.amount, currency: p.currency, kind: p.kind });
    }
  }

  return events.sort((a, b) => a.date.localeCompare(b.date));
}

export default function ScheduledPanel({
  recurring,
  planned,
  onChange,
}: {
  recurring: RecurringItem[];
  planned: PlannedItem[];
  onChange: () => void;
}) {
  const [open, setOpen] = useState(false);
  const upcoming = getUpcoming(recurring, planned);

  return (
    <div className="bg-surface rounded-3xl shadow-soft overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between p-4 text-left"
      >
        <span className="text-sm font-semibold text-ink">
          Recurente & plăți programate{" "}
          <span className="text-ink-muted font-normal">
            ({upcoming.length} în 30 de zile)
          </span>
        </span>
        <span className="text-ink-muted text-xs">{open ? "ascunde ▲" : "arată ▼"}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 flex flex-col gap-4">
          {upcoming.length > 0 && (
            <div className="bg-bg rounded-2xl p-4">
              <h3 className="text-xs font-semibold text-ink-muted mb-3">Urmează în 30 de zile</h3>
              <div className="flex flex-col gap-2">
                {upcoming.map((e, i) => (
                  <div key={i} className="flex justify-between text-sm">
                    <span className="text-ink-muted">
                      {formatDate(e.date)} — {e.label || "(fără nume)"}
                    </span>
                    <span className={e.kind === "expense" ? "text-debit" : "text-credit"}>
                      {signed(e.kind === "expense" ? -e.amount : e.amount, e.currency)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <RecurringSection items={recurring} onChange={onChange} />
          <PlannedSection items={planned} onChange={onChange} />
        </div>
      )}
    </div>
  );
}

function RecurringSection({ items, onChange }: { items: RecurringItem[]; onChange: () => void }) {
  async function add() {
    await fetch("/api/scheduled", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemType: "recurring", label: "", amount: 0, currency: "RON", kind: "expense", dayOfMonth: 1 }),
    });
    onChange();
  }

  async function update(id: number, fields: Record<string, unknown>) {
    await fetch("/api/scheduled", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemType: "recurring", id, ...fields }),
    });
    onChange();
  }

  async function remove(id: number) {
    await fetch(`/api/scheduled?itemType=recurring&id=${id}`, { method: "DELETE" });
    onChange();
  }

  return (
    <div className="bg-bg rounded-2xl p-4">
      <h3 className="text-xs font-semibold text-ink-muted mb-3">
        Recurente lunare (chirie, salariu, abonamente)
      </h3>
      <div className="flex flex-col gap-2">
        {items.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              defaultValue={r.label}
              onBlur={(e) => update(r.id, { label: e.target.value })}
              placeholder="denumire"
              className="flex-1 min-w-[140px] bg-surface rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <input
              type="number"
              defaultValue={r.amount}
              onBlur={(e) => update(r.id, { amount: parseFloat(e.target.value) || 0 })}
              className="w-24 bg-surface rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <select
              defaultValue={r.currency}
              onChange={(e) => update(r.id, { currency: e.target.value })}
              className="bg-surface rounded-lg px-2 py-1.5 w-20 focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="RON">RON</option>
              <option value="EUR">EUR</option>
              <option value="MDL">MDL</option>
            </select>
            <select
              defaultValue={r.kind}
              onChange={(e) => update(r.id, { kind: e.target.value })}
              className="bg-surface rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="expense">cheltuială</option>
              <option value="income">venit</option>
            </select>
            <select
              defaultValue={r.nth_business_day ? "business" : "fixed"}
              onChange={(e) =>
                update(r.id, e.target.value === "business" ? { nth_business_day: 1, day_of_month: null } : { day_of_month: 1, nth_business_day: null })
              }
              className="bg-surface rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="fixed">ziua fixă</option>
              <option value="business">a N-a zi lucrătoare</option>
            </select>
            {r.nth_business_day ? (
              <input
                type="number"
                min={1}
                max={23}
                defaultValue={r.nth_business_day}
                onBlur={(e) => update(r.id, { nth_business_day: parseInt(e.target.value, 10) || null })}
                placeholder="a N-a"
                className="w-16 bg-surface rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent"
              />
            ) : (
              <input
                type="number"
                min={1}
                max={31}
                defaultValue={r.day_of_month ?? ""}
                onBlur={(e) => update(r.id, { day_of_month: parseInt(e.target.value, 10) || null })}
                placeholder="ziua"
                className="w-16 bg-surface rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent"
              />
            )}
            <label className="flex items-center gap-1 text-sm text-ink-muted">
              <input type="checkbox" defaultChecked={!!r.active} onChange={(e) => update(r.id, { active: e.target.checked })} />
              activ
            </label>
            <button onClick={() => remove(r.id)} aria-label="șterge" className="text-ink-muted/50 hover:text-debit px-2 py-1.5 text-sm">
              ✕
            </button>
          </div>
        ))}
        <button onClick={add} className="self-start text-sm text-ink-muted hover:text-ink mt-1">
          + adaugă recurență
        </button>
      </div>
    </div>
  );
}

function PlannedSection({ items, onChange }: { items: PlannedItem[]; onChange: () => void }) {
  async function add() {
    await fetch("/api/scheduled", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemType: "planned", label: "", amount: 0, currency: "RON", kind: "expense", date: todayIso() }),
    });
    onChange();
  }

  async function update(id: number, fields: Record<string, unknown>) {
    await fetch("/api/scheduled", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemType: "planned", id, ...fields }),
    });
    onChange();
  }

  async function remove(id: number) {
    await fetch(`/api/scheduled?itemType=planned&id=${id}`, { method: "DELETE" });
    onChange();
  }

  return (
    <div className="bg-bg rounded-2xl p-4">
      <h3 className="text-xs font-semibold text-ink-muted mb-3">Plăți / venituri unice, cu dată</h3>
      <div className="flex flex-col gap-2">
        {items.map((p) => (
          <div key={p.id} className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              defaultValue={p.label}
              onBlur={(e) => update(p.id, { label: e.target.value })}
              placeholder="denumire"
              className="flex-1 min-w-[140px] bg-surface rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <input
              type="number"
              defaultValue={p.amount}
              onBlur={(e) => update(p.id, { amount: parseFloat(e.target.value) || 0 })}
              className="w-24 bg-surface rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <select
              defaultValue={p.currency}
              onChange={(e) => update(p.id, { currency: e.target.value })}
              className="bg-surface rounded-lg px-2 py-1.5 w-20 focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="RON">RON</option>
              <option value="EUR">EUR</option>
              <option value="MDL">MDL</option>
            </select>
            <select
              defaultValue={p.kind}
              onChange={(e) => update(p.id, { kind: e.target.value })}
              className="bg-surface rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="expense">cheltuială</option>
              <option value="income">venit</option>
            </select>
            <input
              type="date"
              defaultValue={p.date}
              onChange={(e) => update(p.id, { date: e.target.value })}
              className="bg-surface rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <label className="flex items-center gap-1 text-sm text-ink-muted">
              <input type="checkbox" defaultChecked={!!p.done} onChange={(e) => update(p.id, { done: e.target.checked })} />
              finalizat
            </label>
            <button onClick={() => remove(p.id)} aria-label="șterge" className="text-ink-muted/50 hover:text-debit px-2 py-1.5 text-sm">
              ✕
            </button>
          </div>
        ))}
        <button onClick={add} className="self-start text-sm text-ink-muted hover:text-ink mt-1">
          + adaugă
        </button>
      </div>
    </div>
  );
}
