"use client";

import { Check, Minus, RefreshCw, Search } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import RequireRole from "@/components/RequireRole";
import { ErrorBanner, StateBadge } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import {
  fmtCst,
  fmtCstTime,
  matchesDayShift,
  matchesSearch,
  SHIFT_LABELS,
  type Shift,
} from "@/lib/time";
import type { Ticket } from "@/lib/types";

const POLL_MS = 20_000;

/** Read-only checklist columns — the "spreadsheet" feel. */
const SHEET_CHECKS: { key: keyof Ticket & string; label: string }[] = [
  { key: "registration_verified", label: "Reg" },
  { key: "inspection_paper_verified", label: "Insp" },
  { key: "sticker_verified", label: "Stkr" },
  { key: "bol_present", label: "BOL" },
  { key: "pti_verified", label: "PTI" },
  { key: "scale_ticket_received", label: "Scale" },
  { key: "eld_mentioned", label: "ELD" },
  { key: "checklist_sent", label: "CkLst" },
];

export default function AllPickupsPage() {
  return (
    <RequireRole roles={["employee", "qc", "manager"]}>
      <GlobalSheet />
    </RequireRole>
  );
}

function GlobalSheet() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  // R17: search + CST day/shift filters
  const [search, setSearch] = useState("");
  const [day, setDay] = useState("");
  const [shift, setShift] = useState<Shift | "">("");

  const load = useCallback(async () => {
    try {
      setTickets(await api<Ticket[]>("/api/tickets/all"));
      setError(null);
      setLastUpdated(new Date());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load the sheet.");
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
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="font-mono text-xl font-semibold">All Pickups — Global Sheet</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Every ticket across the whole team, live — times in CST
            {lastUpdated && (
              <span className="ml-2 font-mono text-xs">
                (updated {fmtCstTime(lastUpdated)})
              </span>
            )}
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

      {/* R17: search + CST day/shift filters */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
            aria-hidden="true"
          />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search truck # or MC…"
            aria-label="Search by truck number or motor carrier"
            className="w-56 rounded border border-slate-300 bg-white py-2 pl-8 pr-3 text-sm dark:border-slate-700 dark:bg-slate-900"
          />
        </span>
        <input
          type="date"
          value={day}
          onChange={(e) => setDay(e.target.value)}
          aria-label="Filter by day (CST)"
          className="rounded border border-slate-300 bg-white px-2.5 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
        />
        <select
          value={shift}
          onChange={(e) => setShift(e.target.value as Shift | "")}
          aria-label="Filter by shift (CST)"
          className="rounded border border-slate-300 bg-white px-2.5 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
        >
          <option value="">All shifts</option>
          {(Object.keys(SHIFT_LABELS) as Shift[]).map((s) => (
            <option key={s} value={s}>
              {SHIFT_LABELS[s]}
            </option>
          ))}
        </select>
        {(search || day || shift) && (
          <button
            type="button"
            onClick={() => {
              setSearch("");
              setDay("");
              setShift("");
            }}
            className="cursor-pointer rounded px-2 py-1 text-xs font-medium text-slate-500 underline hover:text-slate-800 dark:hover:text-slate-200"
          >
            Clear filters
          </button>
        )}
      </div>

      <ErrorBanner message={error} />

      {!loading && tickets.length === 0 && !error && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
          No pickups in the system yet.
        </div>
      )}

      {tickets.length > 0 && (
        <div className="max-h-[75vh] overflow-auto rounded-lg border border-blue-100 bg-white dark:border-slate-800 dark:bg-slate-900">
          <table className="w-full min-w-[1080px] text-left text-sm">
            <thead className="sticky top-0 z-10 bg-white dark:bg-slate-900">
              <tr className="border-b border-blue-100 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400">
                <th className="px-3 py-2">Created</th>
                <th className="px-3 py-2">Truck #</th>
                <th className="px-3 py-2">MC</th>
                <th className="px-3 py-2">By</th>
                <th className="px-3 py-2">Status</th>
                {SHEET_CHECKS.map((c) => (
                  <th key={c.key} className="px-2 py-2 text-center">
                    {c.label}
                  </th>
                ))}
                <th className="px-3 py-2 text-right">Weight</th>
              </tr>
            </thead>
            <tbody>
              {tickets
                .filter(
                  (t) =>
                    matchesSearch(t, search) && matchesDayShift(t.created_at, day, shift)
                )
                .map((t, i) => (
                <tr
                  key={t.id}
                  className={`border-b border-slate-100 last:border-0 dark:border-slate-800 ${
                    i % 2 === 1 ? "bg-slate-50/70 dark:bg-slate-800/40" : ""
                  }`}
                >
                  <td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs">
                    {fmtCst(t.created_at)}
                  </td>
                  <td className="px-3 py-1.5 font-mono font-semibold">{t.truck_number}</td>
                  <td className="px-3 py-1.5">{t.motor_carrier.name}</td>
                  <td className="px-3 py-1.5 text-slate-500 dark:text-slate-400">
                    {t.creator.username}
                  </td>
                  <td className="px-3 py-1.5">
                    <StateBadge state={t.state} />
                  </td>
                  {SHEET_CHECKS.map((c) => {
                    const na = c.key === "scale_ticket_received" && !t.needs_scale;
                    const ok = Boolean(t[c.key]);
                    return (
                      <td key={c.key} className="px-2 py-1.5 text-center">
                        {na ? (
                          <span className="text-xs text-slate-300 dark:text-slate-600">n/a</span>
                        ) : ok ? (
                          <Check
                            className="mx-auto h-4 w-4 text-emerald-600"
                            role="img"
                            aria-label={`${c.label}: done`}
                          />
                        ) : (
                          <Minus
                            className="mx-auto h-4 w-4 text-slate-300 dark:text-slate-600"
                            role="img"
                            aria-label={`${c.label}: missing`}
                          />
                        )}
                      </td>
                    );
                  })}
                  <td className="px-3 py-1.5 text-right font-mono text-xs">
                    {t.weight || "—"}
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
