"use client";

import { useCallback, useEffect, useState } from "react";
import type { Account, AppSettings, SnapshotWithBalances, Verdict } from "@/lib/types";

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

interface WealthPayload {
  accounts: Account[];
  snapshots: SnapshotWithBalances[];
  verdicts: Verdict[];
  settings: AppSettings;
}

export default function IstoricPage() {
  const [data, setData] = useState<WealthPayload | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/wealth");
    const d: WealthPayload = await res.json();
    setData(d);
  }, []);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  async function removeSnapshot(id: number, date: string) {
    const ok = window.confirm(`Ștergi soldul notat pe ${formatDate(date)}? Nu se poate anula.`);
    if (!ok) return;
    setDeletingId(id);
    await fetch(`/api/snapshots?id=${id}`, { method: "DELETE" });
    await load();
    setDeletingId(null);
  }

  if (!data) {
    return <p className="text-ink-muted text-sm">Se încarcă...</p>;
  }

  const { accounts, snapshots, verdicts } = data;

  if (snapshots.length === 0) {
    return (
      <div className="flex flex-col gap-5">
        <h1 className="text-xl font-semibold text-ink">Istoric</h1>
        <p className="text-sm text-ink-muted">
          Nu ai niciun sold notat încă. Adaugă unul din pagina „Acasă”.
        </p>
      </div>
    );
  }

  // cele mai recente solduri primele; verdicts[i-1] descrie intervalul dintre
  // snapshots[i-1] si snapshots[i] (vezi buildWealthPayload)
  const rows = snapshots.map((snap, index) => ({
    snap,
    previous: index > 0 ? snapshots[index - 1] : null,
    verdict: index > 0 ? verdicts[index - 1] : null,
  }));
  rows.reverse();

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-xl font-semibold text-ink">Istoric</h1>

      <div className="flex flex-col gap-3">
        {rows.map(({ snap, previous, verdict }) => {
          const delta = previous ? snap.total - previous.total : null;

          return (
            <div key={snap.id} className="bg-surface rounded-3xl p-4 flex flex-col gap-3 shadow-soft">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-ink">{formatDate(snap.date)}</p>
                  {snap.note && <p className="text-xs text-ink-muted mt-0.5">{snap.note}</p>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {delta !== null && (
                    <span
                      className={
                        "text-xs font-medium rounded-full px-3 py-1 " +
                        (delta >= 0 ? "bg-accent text-accent-ink" : "bg-debit-soft text-debit")
                      }
                    >
                      {signed(delta)}
                    </span>
                  )}
                  <button
                    onClick={() => removeSnapshot(snap.id, snap.date)}
                    disabled={deletingId === snap.id}
                    aria-label={`șterge soldul din ${formatDate(snap.date)}`}
                    className="text-ink-muted/50 hover:text-debit text-xs px-1 py-1 -m-1 transition-colors disabled:opacity-40"
                  >
                    ✕
                  </button>
                </div>
              </div>

              <p className="text-lg font-semibold text-ink tabular-nums">{fmt(snap.total)}</p>

              {accounts.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {accounts.map((acc) => (
                    <span key={acc.id} className="bg-bg rounded-full px-3 py-1 text-xs text-ink-muted">
                      {acc.name}:{" "}
                      <span className="text-ink font-medium tabular-nums">
                        {Math.round(snap.balances[acc.id] ?? 0).toLocaleString("ro-RO")} {acc.currency}
                      </span>
                    </span>
                  ))}
                </div>
              )}

              {verdict && <VerdictSummary v={verdict} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function VerdictSummary({ v }: { v: Verdict }) {
  const saved = v.diff >= 0;
  return (
    <div className="border-t border-bg pt-2 flex flex-col gap-1 text-xs text-ink-muted">
      <div>
        {v.days} {v.days === 1 ? "zi" : "zile"} · buget {fmt(v.dailyBudget)}/zi
        {v.scheduledIncome !== 0 && ` · venituri programate ${fmt(v.scheduledIncome)}`}
        {v.scheduledExpense !== 0 && ` · plăți programate ${fmt(v.scheduledExpense)}`}
      </div>
      <div>
        Așteptat: {signed(v.expectedDelta)} · Real: {signed(v.actualDelta)} ·{" "}
        <span className={saved ? "text-credit font-semibold" : "text-debit font-semibold"}>
          {saved ? `economisit ${fmt(v.diff)}` : `depășit ${fmt(-v.diff)}`}
        </span>
      </div>
    </div>
  );
}
