"use client";

import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import RequireRole from "@/components/RequireRole";
import { ErrorBanner } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import type { EmployeeStats } from "@/lib/types";

export default function StatsPage() {
  return (
    <RequireRole roles={["manager"]}>
      <StatsTable />
    </RequireRole>
  );
}

function StatsTable() {
  const [stats, setStats] = useState<EmployeeStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setStats(await api<EmployeeStats[]>("/api/stats/employees"));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load stats.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const totals = stats.reduce(
    (acc, s) => ({
      daily: acc.daily + s.completed_daily,
      monthly: acc.monthly + s.completed_monthly,
      allTime: acc.allTime + s.completed_all_time,
    }),
    { daily: 0, monthly: 0, allTime: 0 }
  );

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="font-mono text-xl font-semibold">Employee Stats</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Completed pickups (approved by QC) per employee
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          className="flex cursor-pointer items-center gap-2 rounded border border-slate-300 bg-white px-3 py-2 text-sm font-medium transition-colors duration-150 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
          Refresh
        </button>
      </div>

      <ErrorBanner message={error} />

      {/* Team totals */}
      <div className="mb-4 grid grid-cols-3 gap-3">
        {[
          { label: "Today", value: totals.daily },
          { label: "This month", value: totals.monthly },
          { label: "All-time", value: totals.allTime },
        ].map(({ label, value }) => (
          <div
            key={label}
            className="rounded-lg border border-blue-100 bg-white p-3 text-center dark:border-slate-800 dark:bg-slate-900"
          >
            <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {label}
            </p>
            <p className="font-mono text-2xl font-bold text-blue-800 dark:text-blue-400">
              {value}
            </p>
          </div>
        ))}
      </div>

      {!loading && stats.length === 0 && !error && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
          No employees yet.
        </div>
      )}

      {stats.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-blue-100 bg-white dark:border-slate-800 dark:bg-slate-900">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead>
              <tr className="border-b border-blue-100 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400">
                <th className="px-3 py-2.5">Employee</th>
                <th className="px-3 py-2.5 text-right">Score</th>
                <th className="px-3 py-2.5 text-right">Daily</th>
                <th className="px-3 py-2.5 text-right">Monthly</th>
                <th className="px-3 py-2.5 text-right">All-Time</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((s) => (
                <tr
                  key={s.user_id}
                  className="border-b border-slate-100 last:border-0 dark:border-slate-800"
                >
                  <td className="px-3 py-2.5 font-medium">{s.username}</td>
                  <td
                    className={`px-3 py-2.5 text-right font-mono font-semibold ${
                      s.performance_score < 70
                        ? "text-red-600 dark:text-red-400"
                        : s.performance_score < 100
                          ? "text-amber-700 dark:text-amber-400"
                          : "text-emerald-700 dark:text-emerald-400"
                    }`}
                  >
                    {s.performance_score}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono">{s.completed_daily}</td>
                  <td className="px-3 py-2.5 text-right font-mono">{s.completed_monthly}</td>
                  <td className="px-3 py-2.5 text-right font-mono font-semibold">
                    {s.completed_all_time}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
