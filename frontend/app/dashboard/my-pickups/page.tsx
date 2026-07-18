"use client";

import { PackageX, Pencil, RefreshCw, Search, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import RequireRole from "@/components/RequireRole";
import { ErrorBanner, HazmatBadge, StateBadge, StatusFilter } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { fmtCstFull, matchesSearch } from "@/lib/time";
import {
  isActivePickup,
  matchesStatus,
  type StatusFilterValue,
  type Ticket,
} from "@/lib/types";

const inputCls =
  "rounded border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-800 focus:outline-none focus:ring-1 focus:ring-blue-800 dark:border-slate-700 dark:bg-slate-800";

// R23: two sub-tabs — Active = still in play; All = the complete log
type View = "active" | "all";

export default function MyPickupsPage() {
  return (
    <RequireRole roles={["employee", "qc", "manager"]}>
      <MyPickupsTable />
    </RequireRole>
  );
}

function MyPickupsTable() {
  const router = useRouter();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [onDate, setOnDate] = useState("");
  const [search, setSearch] = useState("");
  // R25: lifecycle status dropdown
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>("");
  const [view, setView] = useState<View>("active");
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = onDate ? `?on_date=${onDate}` : "";
      setTickets(await api<Ticket[]>(`/api/tickets/my-history${qs}`));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load your pickups.");
    } finally {
      setLoading(false);
    }
  }, [onDate]);

  useEffect(() => {
    load();
  }, [load]);

  async function deleteTicket(t: Ticket) {
    if (!window.confirm(`Delete the pickup for truck ${t.truck_number} permanently?`)) return;
    setError(null);
    try {
      await api<void>(`/api/tickets/${t.id}`, { method: "DELETE" });
      setTickets((prev) => prev.filter((x) => x.id !== t.id));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Delete failed.");
    }
  }

  // R23 "Dropped": trailer dropped — ends the lifecycle, ticket moves to the
  // All My Pickups log with a DROPPED badge.
  async function markDropped(t: Ticket) {
    if (
      !window.confirm(
        `Mark truck ${t.truck_number} as DROPPED? This ends the pickup's lifecycle — it moves to your historical log.`
      )
    ) {
      return;
    }
    setSavingId(t.id);
    setError(null);
    try {
      const updated = await api<Ticket>(`/api/tickets/${t.id}/dropped`, { method: "POST" });
      setTickets((prev) => prev.map((x) => (x.id === t.id ? updated : x)));
      setNotice(`Truck ${t.truck_number}: marked as dropped — moved to All My Pickups.`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not mark the ticket as dropped.");
    } finally {
      setSavingId(null);
    }
  }

  const activeCount = tickets.filter(isActivePickup).length;
  const visible = tickets.filter(
    (t) =>
      matchesSearch(t, search) &&
      matchesStatus(t, statusFilter) &&
      (view === "all" || isActivePickup(t))
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-mono text-xl font-semibold">My Pickups</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Every ticket you created — active work up front, the full log behind it
          </p>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <label htmlFor="hist-search" className="mb-1 block text-xs font-medium">
              Search
            </label>
            <span className="relative block">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              />
              <input
                id="hist-search"
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Truck # or MC…"
                className={`${inputCls} w-44 pl-8`}
              />
            </span>
          </div>
          <div>
            <label htmlFor="hist-status" className="mb-1 block text-xs font-medium">
              Status
            </label>
            <StatusFilter
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                "DRAFT_IN_PROGRESS",
                "AWAITING_DRIVER",
                "PENDING_QC",
                "FLAGGED",
                "RESOLVED",
                "APPROVED",
                "DROPPED",
              ]}
            />
          </div>
          <div>
            <label htmlFor="hist-date" className="mb-1 block text-xs font-medium">
              Day
            </label>
            <input
              id="hist-date"
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
              title="Clear date filter"
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

      {/* R23: Active / All sub-tabs */}
      <div className="mb-3 flex w-fit gap-1 rounded-lg border border-slate-200 bg-slate-100 p-1 dark:border-slate-700 dark:bg-slate-800">
        {(
          [
            { key: "active", label: `Active Pickups (${activeCount})` },
            { key: "all", label: `All My Pickups (${tickets.length})` },
          ] as { key: View; label: string }[]
        ).map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setView(tab.key)}
            className={`cursor-pointer rounded-md px-4 py-1.5 text-sm font-semibold transition-colors duration-150 ${
              view === tab.key
                ? "bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-slate-100"
                : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <ErrorBanner message={error} />
      {notice && (
        <div
          role="status"
          className="mb-3 rounded border border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
        >
          {notice}
        </div>
      )}

      {!loading && visible.length === 0 && !error && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
          {view === "active"
            ? "No active pickups — everything you created is wrapped up."
            : onDate
              ? "No pickups on this day."
              : "You haven't created any tickets yet."}
        </div>
      )}

      {visible.length > 0 && (
        // R19: constrained height keeps the horizontal scrollbar on-screen
        <div className="max-h-[calc(100vh-280px)] overflow-auto rounded-lg border border-blue-100 bg-white dark:border-slate-800 dark:bg-slate-900">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="sticky top-0 z-10 bg-white dark:bg-slate-900">
              <tr className="border-b border-blue-100 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400">
                <th className="px-3 py-2.5">Created</th>
                <th className="px-3 py-2.5">Truck #</th>
                <th className="px-3 py-2.5">MC</th>
                <th className="px-3 py-2.5">Driver</th>
                <th className="px-3 py-2.5">State</th>
                <th className="px-3 py-2.5 text-center">Flags</th>
                <th className="px-3 py-2.5 text-center">PTI</th>
                <th className="px-3 py-2.5 text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((t) => (
                <tr
                  key={t.id}
                  className="border-b border-slate-100 last:border-0 dark:border-slate-800"
                >
                  <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs">
                    {fmtCstFull(t.created_at)}
                  </td>
                  <td className="px-3 py-2.5 font-mono font-semibold">
                    <span className="flex items-center gap-1.5">
                      {t.truck_number}
                      {t.is_hazmat && <HazmatBadge />}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">{t.motor_carrier.name}</td>
                  <td className="px-3 py-2.5">{t.driver_name ?? "—"}</td>
                  <td className="px-3 py-2.5">
                    <StateBadge state={t.state} dropped={t.is_dropped} />
                  </td>
                  <td className="px-3 py-2.5 text-center font-mono text-xs">
                    {t.audit_flags.length > 0 ? (
                      <span className="rounded bg-red-100 px-1.5 py-0.5 font-semibold text-red-700 dark:bg-red-900/40 dark:text-red-300">
                        {t.audit_flags.length}
                      </span>
                    ) : (
                      "0"
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-center text-xs">
                    {t.pti_verified ? "✓" : "—"}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <span className="flex justify-center gap-1">
                      {/* R17: creators can correct their own pickups from
                          history — even after approval */}
                      <button
                        type="button"
                        aria-label={`Edit truck ${t.truck_number}`}
                        title="Open the full pickup form pre-filled with this ticket"
                        onClick={() => router.push(`/dashboard/new-pickup?edit=${t.id}`)}
                        className="cursor-pointer rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                      >
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                      </button>
                      {/* R23: Dropped — active pickups only */}
                      {isActivePickup(t) && (
                        <button
                          type="button"
                          aria-label={`Mark truck ${t.truck_number} as dropped`}
                          title="Dropped — trailer was dropped, nothing left to process"
                          disabled={savingId === t.id}
                          onClick={() => markDropped(t)}
                          className="cursor-pointer rounded p-1.5 text-slate-400 hover:bg-amber-50 hover:text-amber-700 disabled:opacity-40 dark:hover:bg-amber-950/40"
                        >
                          <PackageX className="h-4 w-4" aria-hidden="true" />
                        </button>
                      )}
                      <button
                        type="button"
                        aria-label={`Delete truck ${t.truck_number}`}
                        onClick={() => deleteTicket(t)}
                        className="cursor-pointer rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </span>
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
