"use client";

import { Check, RefreshCw, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import RequireRole from "@/components/RequireRole";
import { ErrorBanner } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { fmtCstFull } from "@/lib/time";
import type { TrailerIssue } from "@/lib/types";

const POLL_MS = 20_000;

/** R44: non-punitive trailer problems QC found where the employee did
 * everything right — visible to the whole team, resolved by anyone,
 * completely separate from the flag/scoring system. */
export default function TrailerIssuesPage() {
  return (
    <RequireRole roles={["employee", "qc", "manager"]}>
      <TrailerIssuesBoard />
    </RequireRole>
  );
}

function TrailerIssuesBoard() {
  const [issues, setIssues] = useState<TrailerIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setIssues(await api<TrailerIssue[]>("/api/trailer-issues"));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load trailer issues.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  async function resolve(issue: TrailerIssue) {
    setResolvingId(issue.id);
    setError(null);
    try {
      await api<TrailerIssue>(`/api/trailer-issues/${issue.id}/resolve`, { method: "POST" });
      setIssues((prev) => prev.filter((i) => i.id !== issue.id));
      setNotice(`Truck ${issue.truck_number}: trailer issue marked resolved.`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not resolve this issue.");
    } finally {
      setResolvingId(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="font-mono text-xl font-semibold">Trailer Issues</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Trailer problems QC found that weren&apos;t the employee&apos;s fault — doesn&apos;t
            affect anyone&apos;s score. Resolve it once it&apos;s handled.
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
      {notice && (
        <div
          role="status"
          className="mb-3 rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
        >
          {notice}
        </div>
      )}

      {!loading && issues.length === 0 && !error && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
          Board clear — no open trailer issues.
        </div>
      )}

      <ul className="space-y-2">
        {issues.map((issue) => (
          <li
            key={issue.id}
            className="rounded-lg border border-amber-300 bg-amber-50/50 p-4 dark:border-amber-800 dark:bg-amber-950/20"
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 font-mono font-semibold">
                <TriangleAlert
                  className="h-4 w-4 text-amber-600 dark:text-amber-400"
                  aria-hidden="true"
                />
                {issue.truck_number}
                {issue.trailer_number && (
                  <span className="text-sm font-normal text-slate-500 dark:text-slate-400">
                    trailer {issue.trailer_number}
                  </span>
                )}
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {issue.mc_name} · reported by {issue.reporter.username} ·{" "}
                {fmtCstFull(issue.created_at)}
              </span>
            </div>
            <p className="mb-3 rounded bg-white px-2.5 py-1.5 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-300">
              {issue.description}
            </p>
            <button
              type="button"
              disabled={resolvingId === issue.id}
              onClick={() => resolve(issue)}
              className="flex cursor-pointer items-center gap-1.5 rounded bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white transition-colors duration-150 hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Check className="h-4 w-4" aria-hidden="true" />
              Resolved
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
