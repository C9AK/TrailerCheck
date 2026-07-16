"use client";

import { AlertTriangle, CheckCircle2, Flag, PackageX, RotateCcw, Send, Trash2, Truck } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import RequireRole from "@/components/RequireRole";
import { ErrorBanner } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { fmtCstFull, fmtCstTime } from "@/lib/time";
import type { AuditEventType, FeedEntry } from "@/lib/types";
import { useTimeStore } from "@/store/timeStore";

const POLL_MS = 5000;

const EVENT_STYLE: Record<
  AuditEventType,
  { icon: typeof Truck; cls: string }
> = {
  TICKET_CREATED: { icon: Truck, cls: "text-blue-700 bg-blue-100 dark:text-blue-300 dark:bg-blue-900/40" },
  TICKET_SENT_TO_QC: { icon: Send, cls: "text-blue-700 bg-blue-100 dark:text-blue-300 dark:bg-blue-900/40" },
  TICKET_FLAGGED: { icon: Flag, cls: "text-red-700 bg-red-100 dark:text-red-300 dark:bg-red-900/40" },
  TICKET_RESOLVED: { icon: RotateCcw, cls: "text-violet-700 bg-violet-100 dark:text-violet-300 dark:bg-violet-900/40" },
  TICKET_APPROVED: { icon: CheckCircle2, cls: "text-emerald-700 bg-emerald-100 dark:text-emerald-300 dark:bg-emerald-900/40" },
  TICKET_DELETED: { icon: Trash2, cls: "text-red-700 bg-red-100 dark:text-red-300 dark:bg-red-900/40" },
  TICKET_UNRESOLVABLE: { icon: AlertTriangle, cls: "text-amber-700 bg-amber-100 dark:text-amber-300 dark:bg-amber-900/40" },
  // R23: trailer dropped — lifecycle ended
  TICKET_DROPPED: { icon: PackageX, cls: "text-slate-700 bg-slate-200 dark:text-slate-300 dark:bg-slate-700/60" },
};

export default function LiveFeedPage() {
  return (
    <RequireRole roles={["manager"]}>
      <LiveFeed />
    </RequireRole>
  );
}

function LiveFeed() {
  // R24: timestamps follow the display time-zone preference
  const tzLabel = useTimeStore((s) => s.mode) === "cst" ? "CST" : "local";
  const [entries, setEntries] = useState<FeedEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const knownIds = useRef<Set<string>>(new Set());
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const feed = await api<FeedEntry[]>("/api/feed/live?limit=200");
      // Highlight entries we haven't seen in this session yet
      const fresh = new Set<string>();
      for (const e of feed) {
        if (knownIds.current.size > 0 && !knownIds.current.has(e.id)) fresh.add(e.id);
      }
      for (const e of feed) knownIds.current.add(e.id);
      if (fresh.size > 0) {
        setFreshIds(fresh);
        setTimeout(() => setFreshIds(new Set()), 4000);
      }
      setEntries(feed);
      setError(null);
      setLastUpdated(new Date());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Feed unavailable.");
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
          <h1 className="flex items-center gap-2 font-mono text-xl font-semibold">
            Live Activity Feed
            <span className="flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" aria-hidden="true" />
              LIVE
            </span>
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Immutable, timestamped record of every dispatch &amp; QC action
            {lastUpdated && (
              <span className="ml-2 font-mono text-xs">
                (updated {fmtCstTime(lastUpdated)} {tzLabel})
              </span>
            )}
          </p>
        </div>
      </div>

      <ErrorBanner message={error} />

      {entries.length === 0 && !error && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
          No activity yet — actions will appear here the moment they happen.
        </div>
      )}

      <ol className="max-h-[70vh] space-y-1.5 overflow-y-auto pr-1" aria-live="polite">
        {entries.map((e) => {
          const { icon: Icon, cls } = EVENT_STYLE[e.event] ?? EVENT_STYLE.TICKET_CREATED;
          return (
            <li
              key={e.id}
              className={`flex items-start gap-3 rounded-lg border bg-white p-3 transition-colors duration-500 dark:bg-slate-900 ${
                freshIds.has(e.id)
                  ? "border-blue-400 bg-blue-50 dark:border-blue-600 dark:bg-blue-950/40"
                  : "border-blue-100 dark:border-slate-800"
              }`}
            >
              <span className={`mt-0.5 rounded-full p-1.5 ${cls}`}>
                <Icon className="h-4 w-4" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="font-mono text-xs text-slate-500 dark:text-slate-400">
                  [{fmtCstFull(e.created_at)} {tzLabel}]
                </p>
                <p className="text-sm">{e.message}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
