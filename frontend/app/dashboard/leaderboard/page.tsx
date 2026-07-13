"use client";

import { Info, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import RequireRole from "@/components/RequireRole";
import { ErrorBanner } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import type { LeaderboardEntry } from "@/lib/types";
import { useAuthStore } from "@/store/authStore";

const POLL_MS = 30_000;

const MEDALS: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };

function accuracyClass(pct: number): string {
  if (pct >= 95) return "text-emerald-600 dark:text-emerald-400";
  if (pct >= 85) return "text-amber-600 dark:text-amber-400";
  return "text-rose-600 dark:text-rose-400";
}

export default function LeaderboardPage() {
  return (
    <RequireRole roles={["employee", "qc", "manager"]}>
      <Leaderboard />
    </RequireRole>
  );
}

function Leaderboard() {
  const username = useAuthStore((s) => s.username);
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setEntries(await api<LeaderboardEntry[]>("/api/leaderboard"));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load the leaderboard.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="font-mono text-xl font-semibold">Leaderboard</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Weighted Composite Score — 70% accuracy · 30% efficiency · volume multiplier
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

      {!loading && entries.length === 0 && !error && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
          No active employees yet.
        </div>
      )}

      {entries.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-blue-100 bg-white dark:border-slate-800 dark:bg-slate-900">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-blue-100 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400">
                <th className="px-4 py-3">Rank</th>
                <th className="px-4 py-3">Employee</th>
                <th className="px-4 py-3 text-right">Score</th>
                <th className="px-4 py-3 text-right">Accuracy</th>
                <th className="px-4 py-3 text-right">Efficiency</th>
                <th className="px-4 py-3 text-right">Volume</th>
                <th className="px-4 py-3 text-right">Avg Time</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                const isMe = e.name === username;
                const medal = MEDALS[e.rank];
                return (
                  <tr
                    key={e.id}
                    className={`border-b border-slate-100 last:border-0 dark:border-slate-800 ${
                      isMe
                        ? "bg-brand-50 dark:bg-brand-800/20"
                        : e.rank <= 3
                          ? "bg-amber-50/60 dark:bg-amber-950/20"
                          : ""
                    }`}
                  >
                    <td className="px-4 py-3">
                      {medal ? (
                        <span className="text-xl" role="img" aria-label={`Rank ${e.rank}`}>
                          {medal}
                        </span>
                      ) : (
                        <span className="font-mono text-slate-500 dark:text-slate-400">
                          #{e.rank}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-medium">
                      {e.name}
                      {e.role === "qc" && (
                        <span className="ml-1.5 rounded bg-slate-200 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                          QC
                        </span>
                      )}
                      {isMe && <span className="ml-1.5 text-xs text-brand-600">(you)</span>}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-base font-bold">
                      {e.score.toFixed(1)}
                    </td>
                    <td
                      className={`px-4 py-3 text-right font-mono font-semibold ${accuracyClass(e.accuracy)}`}
                    >
                      {e.accuracy.toFixed(1)}%
                    </td>
                    <td className="px-4 py-3 text-right font-mono">
                      {e.efficiency.toFixed(0)}%
                    </td>
                    <td className="px-4 py-3 text-right font-mono">{e.volume}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-slate-500 dark:text-slate-400">
                      {e.avg_time_mins != null ? `${e.avg_time_mins.toFixed(1)} min` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 flex items-start gap-1.5 text-xs text-slate-500 dark:text-slate-400">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        Score = (0.70 × Accuracy + 0.30 × Efficiency) × volume multiplier. The multiplier
        grows logarithmically and reaches 100% at 50 tickets — consistency beats a single
        perfect pickup. Efficiency starts at 100% for a 15-minute average and loses 10
        points per extra minute. Employees are measured on pickups created (accuracy =
        never-flagged rate); QC members on tickets processed and review turnaround.
      </p>
    </div>
  );
}
