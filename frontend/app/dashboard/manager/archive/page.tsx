"use client";

import { FileDown, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import RequireRole from "@/components/RequireRole";
import { ErrorBanner, StateBadge } from "@/components/ui";
import { api, API_BASE, ApiError } from "@/lib/api";
import { fmtCstFull } from "@/lib/time";
import type { Ticket, TicketState, User } from "@/lib/types";
import { useAuthStore } from "@/store/authStore";

const STATES: TicketState[] = [
  "DRAFT_IN_PROGRESS",
  "AWAITING_DRIVER",
  "PENDING_QC",
  "FLAGGED",
  "RESOLVED",
  "APPROVED",
];

const PAGE_SIZE = 50;

const inputCls =
  "rounded border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-800 focus:outline-none focus:ring-1 focus:ring-blue-800 dark:border-slate-700 dark:bg-slate-800";

export default function ArchivePage() {
  return (
    <RequireRole roles={["manager"]}>
      <ArchiveTable />
    </RequireRole>
  );
}

function ArchiveTable() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [employees, setEmployees] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [state, setState] = useState<TicketState | "">("");
  const [createdBy, setCreatedBy] = useState("");
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [exporting, setExporting] = useState(false);

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

  async function exportDay() {
    if (!startDate) return;
    setExporting(true);
    setError(null);
    try {
      const { token } = useAuthStore.getState();
      const res = await fetch(`${API_BASE}/api/export/pickups?date=${startDate}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) {
        let detail = `Export failed (${res.status})`;
        try {
          const body = await res.json();
          if (typeof body.detail === "string") detail = body.detail;
        } catch {
          /* keep generic */
        }
        throw new ApiError(res.status, detail);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `pickups_${startDate}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Export failed.");
    } finally {
      setExporting(false);
    }
  }

  useEffect(() => {
    api<User[]>("/api/admin/users")
      .then((users) => setEmployees(users.filter((u) => u.role === "employee")))
      .catch(() => setEmployees([]));
  }, []);

  const load = useCallback(
    async (nextOffset: number, append: boolean) => {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams();
      if (startDate) params.set("start_date", startDate);
      if (endDate) params.set("end_date", endDate);
      if (state) params.set("state", state);
      if (createdBy) params.set("created_by", createdBy);
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(nextOffset));
      try {
        const page = await api<Ticket[]>(`/api/tickets/archive?${params}`);
        setTickets((prev) => (append ? [...prev, ...page] : page));
        setHasMore(page.length === PAGE_SIZE);
        setOffset(nextOffset);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Failed to load the archive.");
      } finally {
        setLoading(false);
      }
    },
    [startDate, endDate, state, createdBy]
  );

  useEffect(() => {
    load(0, false);
  }, [load]);

  return (
    <div>
      <div className="mb-4">
        <h1 className="font-mono text-xl font-semibold">Archive</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Full ticket history — every pickup ever recorded
        </p>
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-blue-100 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
        <div>
          <label htmlFor="arch-start" className="mb-1 block text-xs font-medium">
            From
          </label>
          <input
            id="arch-start"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className={inputCls}
          />
        </div>
        <div>
          <label htmlFor="arch-end" className="mb-1 block text-xs font-medium">
            To
          </label>
          <input
            id="arch-end"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className={inputCls}
          />
        </div>
        <div>
          <label htmlFor="arch-state" className="mb-1 block text-xs font-medium">
            State
          </label>
          <select
            id="arch-state"
            value={state}
            onChange={(e) => setState(e.target.value as TicketState | "")}
            className={inputCls}
          >
            <option value="">All states</option>
            {STATES.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="arch-emp" className="mb-1 block text-xs font-medium">
            Employee
          </label>
          <select
            id="arch-emp"
            value={createdBy}
            onChange={(e) => setCreatedBy(e.target.value)}
            className={inputCls}
          >
            <option value="">All employees</option>
            {employees.map((u) => (
              <option key={u.id} value={u.id}>
                {u.username}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={() => load(0, false)}
          className="flex cursor-pointer items-center gap-2 rounded bg-brand-600 px-3 py-2 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-700"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
          Apply
        </button>
        <button
          type="button"
          onClick={exportDay}
          disabled={!startDate || exporting}
          title={startDate ? `Download pickups_${startDate}.csv` : "Pick a 'From' date first"}
          className="flex cursor-pointer items-center gap-2 rounded bg-amber-600 px-3 py-2 text-sm font-semibold text-white transition-colors duration-150 hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <FileDown className="h-4 w-4" aria-hidden="true" />
          {exporting ? "Exporting…" : "Export Daily Pickups"}
        </button>
      </div>
      {!startDate && (
        <p className="-mt-2 mb-4 text-xs text-slate-500 dark:text-slate-400">
          Select a &quot;From&quot; date to enable the daily CSV export.
        </p>
      )}

      <ErrorBanner message={error} />

      {!loading && tickets.length === 0 && !error && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
          No tickets match these filters.
        </div>
      )}

      {tickets.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-blue-100 bg-white dark:border-slate-800 dark:bg-slate-900">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead>
              <tr className="border-b border-blue-100 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400">
                <th className="px-3 py-2.5">#</th>
                <th className="px-3 py-2.5">Created</th>
                <th className="px-3 py-2.5">Truck #</th>
                <th className="px-3 py-2.5">MC</th>
                <th className="px-3 py-2.5">Driver</th>
                <th className="px-3 py-2.5">State</th>
                <th className="px-3 py-2.5 text-right">Weight</th>
                <th className="px-3 py-2.5 text-center">Flags</th>
                <th className="px-3 py-2.5">Created by</th>
                <th className="px-3 py-2.5 text-center">Del</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((t, i) => (
                <tr
                  key={t.id}
                  className="border-b border-slate-100 last:border-0 dark:border-slate-800"
                >
                  {/* R27b: positional number over the visible, filtered list */}
                  <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs font-semibold text-slate-500 dark:text-slate-400">
                    {i + 1}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs">
                    {fmtCstFull(t.created_at)}
                  </td>
                  <td className="px-3 py-2.5 font-mono font-semibold">{t.truck_number}</td>
                  <td className="px-3 py-2.5">{t.motor_carrier.name}</td>
                  <td className="px-3 py-2.5">{t.driver_name ?? "—"}</td>
                  <td className="px-3 py-2.5">
                    <StateBadge state={t.state} dropped={t.is_dropped} />
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-xs">
                    {t.weight || "—"}
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
                  <td className="px-3 py-2.5 text-slate-500 dark:text-slate-400">
                    {t.creator.username}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <button
                      type="button"
                      aria-label={`Delete truck ${t.truck_number}`}
                      onClick={() => deleteTicket(t)}
                      className="cursor-pointer rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {hasMore && (
        <div className="mt-3 flex justify-center">
          <button
            type="button"
            disabled={loading}
            onClick={() => load(offset + PAGE_SIZE, true)}
            className="cursor-pointer rounded border border-slate-300 bg-white px-4 py-2 text-sm font-medium transition-colors duration-150 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
          >
            Load more
          </button>
        </div>
      )}
    </div>
  );
}
