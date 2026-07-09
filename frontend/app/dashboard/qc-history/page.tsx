"use client";

import { CheckCircle2, Flag, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import RequireRole from "@/components/RequireRole";
import { ErrorBanner, StateBadge } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { CATEGORY_LABELS, type QCHistoryItem } from "@/lib/types";

type Outcome = "approved" | "flagged";

const inputCls =
  "rounded border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-800 focus:outline-none focus:ring-1 focus:ring-blue-800 dark:border-slate-700 dark:bg-slate-800";

export default function QCHistoryPage() {
  return (
    <RequireRole roles={["qc", "manager"]}>
      <QCHistoryTable />
    </RequireRole>
  );
}

function QCHistoryTable() {
  const [items, setItems] = useState<QCHistoryItem[]>([]);
  const [outcome, setOutcome] = useState<Outcome>("approved");
  const [onDate, setOnDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ outcome });
      if (onDate) params.set("on_date", onDate);
      setItems(await api<QCHistoryItem[]>(`/api/tickets/qc-history?${params}`));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load your audit history.");
    } finally {
      setLoading(false);
    }
  }, [outcome, onDate]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-mono text-xl font-semibold">My Audit History</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Tickets you approved or flagged, dated by when you acted
          </p>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <label htmlFor="qch-date" className="mb-1 block text-xs font-medium">
              Day
            </label>
            <input
              id="qch-date"
              type="date"
              value={onDate}
              onChange={(e) => setOnDate(e.target.value)}
              className={inputCls}
            />
          </div>
          {onDate && (
            <button
              type="button"
              onClick={() => setOnDate("")}
              className="flex cursor-pointer items-center gap-1 rounded border border-slate-300 px-2.5 py-2 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
            >
              <X className="h-4 w-4" aria-hidden="true" />
              All days
            </button>
          )}
          <button
            type="button"
            onClick={load}
            className="flex cursor-pointer items-center gap-2 rounded border border-slate-300 bg-white px-3 py-2 text-sm font-medium transition-colors duration-150 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
            Refresh
          </button>
        </div>
      </div>

      {/* Approved / Flagged toggle */}
      <div className="mb-4 inline-flex overflow-hidden rounded-lg border border-blue-100 dark:border-slate-700">
        <button
          type="button"
          onClick={() => setOutcome("approved")}
          aria-pressed={outcome === "approved"}
          className={`flex cursor-pointer items-center gap-1.5 px-4 py-2 text-sm font-semibold transition-colors duration-150 ${
            outcome === "approved"
              ? "bg-emerald-600 text-white"
              : "bg-white text-slate-600 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
          }`}
        >
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          Approved
        </button>
        <button
          type="button"
          onClick={() => setOutcome("flagged")}
          aria-pressed={outcome === "flagged"}
          className={`flex cursor-pointer items-center gap-1.5 px-4 py-2 text-sm font-semibold transition-colors duration-150 ${
            outcome === "flagged"
              ? "bg-red-600 text-white"
              : "bg-white text-slate-600 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
          }`}
        >
          <Flag className="h-4 w-4" aria-hidden="true" />
          Flagged
        </button>
      </div>

      <ErrorBanner message={error} />

      {!loading && items.length === 0 && !error && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
          No {outcome} tickets{onDate ? " on this day" : " yet"}.
        </div>
      )}

      {items.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-blue-100 bg-white dark:border-slate-800 dark:bg-slate-900">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead>
              <tr className="border-b border-blue-100 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400">
                <th className="px-3 py-2.5">{outcome === "approved" ? "Approved at" : "Flagged at"}</th>
                <th className="px-3 py-2.5">Truck #</th>
                <th className="px-3 py-2.5">MC</th>
                <th className="px-3 py-2.5">Employee</th>
                <th className="px-3 py-2.5">Current state</th>
                {outcome === "flagged" && <th className="px-3 py-2.5">Categories</th>}
              </tr>
            </thead>
            <tbody>
              {items.map(({ processed_at, ticket: t }) => (
                <tr
                  key={`${t.id}-${processed_at}`}
                  className="border-b border-slate-100 last:border-0 dark:border-slate-800"
                >
                  <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs">
                    {new Date(processed_at).toLocaleString()}
                  </td>
                  <td className="px-3 py-2.5 font-mono font-semibold">{t.truck_number}</td>
                  <td className="px-3 py-2.5">{t.motor_carrier.name}</td>
                  <td className="px-3 py-2.5">{t.creator.username}</td>
                  <td className="px-3 py-2.5">
                    <StateBadge state={t.state} />
                  </td>
                  {outcome === "flagged" && (
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {[...new Set(t.audit_flags.map((f) => f.error_category))].map((c) => (
                          <span
                            key={c}
                            className="rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-medium text-red-700 dark:bg-red-900/40 dark:text-red-300"
                          >
                            {CATEGORY_LABELS[c]}
                          </span>
                        ))}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
