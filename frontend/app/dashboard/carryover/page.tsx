"use client";

import { AlertCircle, Ban, Flag, Loader2, PackageX, Pencil, RefreshCw, Search, Send, Siren, TimerReset, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { useAuthStore } from "@/store/authStore";

import RequireRole from "@/components/RequireRole";
import { ErrorBanner, HazmatBadge, StatusFilter } from "@/components/ui";
import { getTimerInfo, getTimerStart, useNow } from "@/hooks/useTicketTimer";
import { api, ApiError, mediaUrl } from "@/lib/api";
import {
  fmtCst,
  matchesDayShift,
  matchesSearch,
  SHIFT_LABELS,
  type Shift,
} from "@/lib/time";
import {
  CATEGORY_LABELS,
  matchesStatus,
  type StatusFilterValue,
  type Ticket,
  type TicketState,
} from "@/lib/types";

/** R23: scale-chase board badges — every row is waiting on its scale ticket,
 * whatever lifecycle state it's in (APPROVED included). */
const ACTIVE_BADGE: Partial<Record<TicketState, { label: string; cls: string }>> = {
  AWAITING_DRIVER: {
    label: "Awaiting driver",
    cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  },
  PENDING_QC: {
    label: "Sent to QC / Pending",
    cls: "bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-200",
  },
  RESOLVED: {
    label: "Back at QC",
    cls: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300",
  },
  APPROVED: {
    label: "Approved — scale pending",
    cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  },
};

/** Boolean checklist fields rendered as inline-editable checkboxes (04 §3: no modals). */
const INLINE_FIELDS: { key: keyof Ticket & string; label: string }[] = [
  { key: "registration_verified", label: "Reg." },
  { key: "inspection_paper_verified", label: "Insp." },
  { key: "sticker_verified", label: "Sticker" },
  { key: "bol_present", label: "BOL" },
  { key: "eld_mentioned", label: "ELD" },
  { key: "checklist_sent", label: "CkLst" },
  // R18: PTI is a master checkbox now — inline-editable like the rest
  { key: "pti_verified", label: "PTI" },
  { key: "scale_ticket_received", label: "Scale Tkt" },
];

export default function CarryoverPage() {
  return (
    <RequireRole roles={["employee", "qc","manager"]}>
      <CarryoverTable />
    </RequireRole>
  );
}

function CarryoverTable() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [flagged, setFlagged] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  // R17: search + CST day/shift filters; R25: lifecycle status filter
  const [search, setSearch] = useState("");
  const [day, setDay] = useState("");
  const [shiftFilter, setShiftFilter] = useState<Shift | "">("");
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>("");
  const now = useNow();
  const router = useRouter();
  const { role, username } = useAuthStore();

  // R7 RBAC: employees may edit/delete only their OWN tickets; managers any.
  // R8: urgent-flagged tickets are open for team triage.
  const canModify = useCallback(
    (t: Ticket) =>
      role === "manager" ||
      t.creator.username === username ||
      (t.state === "FLAGGED" && t.is_urgent_flag),
    [role, username]
  );
  // R16: QC may DELETE any pickup (editing others' stays manager-only)
  const canDelete = useCallback(
    (t: Ticket) => role === "qc" || canModify(t),
    [role, canModify]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [awaiting, flaggedList] = await Promise.all([
        api<Ticket[]>("/api/tickets/carryover"),
        api<Ticket[]>("/api/tickets/flagged"),
      ]);
      setTickets(awaiting);
      setFlagged(flaggedList);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load carryover tickets.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // R17: search + CST day/shift + R25 status filters apply to both sections
  const matches = (t: Ticket) =>
    matchesSearch(t, search) &&
    matchesDayShift(t.created_at, day, shiftFilter) &&
    matchesStatus(t, statusFilter);

  // ≥120 min rows sort to the absolute top (04 §3), then by longest wait.
  const sorted = [...tickets.filter(matches)].sort((a, b) => {
    const ta = getTimerInfo(getTimerStart(a), now);
    const tb = getTimerInfo(getTimerStart(b), now);
    const critA = ta.tier === "critical" ? 1 : 0;
    const critB = tb.tier === "critical" ? 1 : 0;
    if (critA !== critB) return critB - critA;
    return (tb.minutes ?? -1) - (ta.minutes ?? -1);
  });

  async function patchField(ticket: Ticket, field: string, value: boolean) {
    setSavingId(ticket.id);
    setError(null);
    // Optimistic inline update — no modal, immediate PATCH (04 §3)
    setTickets((prev) =>
      prev.map((t) => (t.id === ticket.id ? { ...t, [field]: value } : t))
    );
    try {
      const updated = await api<Ticket>(`/api/tickets/${ticket.id}`, {
        method: "PATCH",
        body: JSON.stringify({ [field]: value }),
      });
      // Tickets stay on the board through PENDING_QC — edits update live for QC.
      setTickets((prev) => prev.map((t) => (t.id === ticket.id ? updated : t)));
      // R23: rows leave the board the moment the scale ticket is checked
      if (field === "scale_ticket_received" && value) {
        setTickets((prev) => prev.filter((t) => t.id !== ticket.id));
        setNotice(
          `Truck ${updated.truck_number}: scale ticket received — off the carryover board.`
        );
      } else if (ticket.state === "AWAITING_DRIVER" && updated.state === "PENDING_QC") {
        setNotice(
          `Truck ${updated.truck_number}: complete — sent to QC. It stays here until the scale ticket arrives.`
        );
      }
    } catch (e) {
      setTickets((prev) => prev.map((t) => (t.id === ticket.id ? ticket : t)));
      setError(e instanceof ApiError ? e.message : "Update failed.");
    } finally {
      setSavingId(null);
    }
  }

  async function patchFlagged(ticket: Ticket, field: string, value: boolean) {
    setSavingId(ticket.id);
    setError(null);
    try {
      const updated = await api<Ticket>(`/api/tickets/${ticket.id}`, {
        method: "PATCH",
        body: JSON.stringify({ [field]: value }),
      });
      setFlagged((prev) => prev.map((t) => (t.id === ticket.id ? updated : t)));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Update failed.");
    } finally {
      setSavingId(null);
    }
  }

  // R21 "Followed up": the dispatcher chased the driver/scale again — the
  // waiting timer restarts from now and the overdue alert clears.
  async function followUp(ticket: Ticket) {
    setSavingId(ticket.id);
    setError(null);
    try {
      const updated = await api<Ticket>(`/api/tickets/${ticket.id}/follow-up`, {
        method: "PATCH",
      });
      setTickets((prev) => prev.map((t) => (t.id === ticket.id ? updated : t)));
      setNotice(`Truck ${updated.truck_number}: follow-up recorded — waiting timer restarted.`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not record the follow-up.");
    } finally {
      setSavingId(null);
    }
  }

  // R23 "Dropped": trailer dropped — nothing left to process. Any user may
  // press it; the ticket leaves every active board and lives on in history.
  async function markDropped(ticket: Ticket) {
    if (
      !window.confirm(
        `Mark truck ${ticket.truck_number} as DROPPED? This ends the pickup's lifecycle — it moves off all active boards into history.`
      )
    ) {
      return;
    }
    setSavingId(ticket.id);
    setError(null);
    try {
      await api<Ticket>(`/api/tickets/${ticket.id}/dropped`, { method: "POST" });
      setTickets((prev) => prev.filter((t) => t.id !== ticket.id));
      setFlagged((prev) => prev.filter((t) => t.id !== ticket.id));
      setNotice(`Truck ${ticket.truck_number}: marked as dropped — moved to history.`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not mark the ticket as dropped.");
    } finally {
      setSavingId(null);
    }
  }

  async function deleteTicket(ticket: Ticket) {
    if (!window.confirm(`Delete the pickup for truck ${ticket.truck_number}? This cannot be undone.`)) {
      return;
    }
    setSavingId(ticket.id);
    setError(null);
    try {
      await api<void>(`/api/tickets/${ticket.id}`, { method: "DELETE" });
      setTickets((prev) => prev.filter((t) => t.id !== ticket.id));
      setFlagged((prev) => prev.filter((t) => t.id !== ticket.id));
      setNotice(`Truck ${ticket.truck_number}: pickup deleted.`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Delete failed.");
    } finally {
      setSavingId(null);
    }
  }

  // R11 escape hatch: mandatory-reason modal for unfixable flagged tickets
  const [unresolvableTicket, setUnresolvableTicket] = useState<Ticket | null>(null);
  const [unresolvableReason, setUnresolvableReason] = useState("");
  const [unresolvableBusy, setUnresolvableBusy] = useState(false);

  async function submitUnresolvable() {
    if (!unresolvableTicket || unresolvableReason.trim().length < 10) return;
    setUnresolvableBusy(true);
    setError(null);
    try {
      const t = await api<Ticket>(`/api/tickets/${unresolvableTicket.id}/unresolvable`, {
        method: "POST",
        body: JSON.stringify({ reason: unresolvableReason.trim() }),
      });
      setFlagged((prev) => prev.filter((x) => x.id !== t.id));
      setNotice(
        `Truck ${t.truck_number}: escalated to QC as UNRESOLVABLE — it's off your board.`
      );
      setUnresolvableTicket(null);
      setUnresolvableReason("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Escalation failed.");
    } finally {
      setUnresolvableBusy(false);
    }
  }

  async function resendToQC(ticket: Ticket) {
    setSavingId(ticket.id);
    setError(null);
    try {
      const updated = await api<Ticket>(`/api/tickets/${ticket.id}/resolve`, {
        method: "POST",
      });
      setFlagged((prev) => prev.filter((t) => t.id !== ticket.id));
      setNotice(`Truck ${updated.truck_number}: fixes submitted — back in the QC queue.`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not resend to QC.");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="font-mono text-xl font-semibold">Carryover / Scale Chase</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Flagged pickups + everything still waiting on a scale ticket — approved
            or not, a row leaves only when its scale box is checked
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
            placeholder="Search #, truck or MC…"
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
          value={shiftFilter}
          onChange={(e) => setShiftFilter(e.target.value as Shift | "")}
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
        {/* R25: lifecycle status dropdown */}
        <StatusFilter
          value={statusFilter}
          onChange={setStatusFilter}
          options={["FLAGGED", "AWAITING_DRIVER", "PENDING_QC", "RESOLVED", "APPROVED"]}
        />
        {(search || day || shiftFilter || statusFilter) && (
          <button
            type="button"
            onClick={() => {
              setSearch("");
              setDay("");
              setShiftFilter("");
              setStatusFilter("");
            }}
            className="cursor-pointer rounded px-2 py-1 text-xs font-medium text-slate-500 underline hover:text-slate-800 dark:hover:text-slate-200"
          >
            Clear filters
          </button>
        )}
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

      {/* Action Required: own flagged tickets + URGENT team-triage flags */}
      {flagged.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-red-700 dark:text-red-400">
            <Flag className="h-4 w-4" aria-hidden="true" />
            Action Required ({flagged.length})
          </h2>
          <div className="grid gap-3 lg:grid-cols-2">
            {flagged.filter(matches).map((t) => {
              const categories = [...new Set(t.audit_flags.map((f) => f.error_category))];
              const noteList = [
                ...new Set(
                  t.audit_flags.map((f) => f.notes?.trim()).filter((n): n is string => !!n)
                ),
              ];
              return (
                <div
                  key={t.id}
                  className="rounded-lg border border-red-200 bg-red-50/50 p-4 dark:border-red-900 dark:bg-red-950/30"
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 font-mono font-semibold">
                      {t.pickup_number != null && (
                        <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                          #{t.pickup_number}
                        </span>
                      )}
                      {t.truck_number}
                      {t.is_hazmat && <HazmatBadge />}
                      {t.is_urgent_flag && (
                        <span className="flex animate-pulse items-center gap-1 rounded bg-red-600 px-2 py-0.5 text-[11px] font-bold uppercase text-white">
                          <Siren className="h-3 w-3" aria-hidden="true" />
                          Urgent — anyone can fix
                        </span>
                      )}
                    </span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {t.motor_carrier.name} · by {t.creator.username} ·{" "}
                      {fmtCst(t.created_at)}
                    </span>
                  </div>
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {categories.map((c) => {
                      const sev = t.audit_flags.find(
                        (f) => f.error_category === c && f.severity != null
                      )?.severity;
                      return (
                        <span
                          key={c}
                          className="rounded bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700 dark:bg-red-900/50 dark:text-red-300"
                        >
                          {CATEGORY_LABELS[c]}
                          {sev != null && ` — severity ${sev}/10`}
                        </span>
                      );
                    })}
                  </div>
                  {noteList.map((n) => (
                    <p
                      key={n}
                      className="mb-2 rounded bg-white px-2.5 py-1.5 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                    >
                      QC notes: {n}
                    </p>
                  ))}
                  {/* QC proof media */}
                  {t.audit_flags.some((f) => f.media.length > 0) && (
                    <div className="mb-2 flex flex-wrap gap-2">
                      {t.audit_flags.flatMap((f) =>
                        f.media.map((m) =>
                          m.media_type === "image" ? (
                            <a
                              key={m.id}
                              href={mediaUrl(m.media_url)}
                              target="_blank"
                              rel="noreferrer"
                              title="Open proof image"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={mediaUrl(m.media_url)}
                                alt="QC proof"
                                className="h-16 w-16 rounded border border-slate-300 object-cover dark:border-slate-700"
                              />
                            </a>
                          ) : (
                            <video
                              key={m.id}
                              src={mediaUrl(m.media_url)}
                              controls
                              preload="metadata"
                              className="h-16 max-w-32 rounded border border-slate-300 dark:border-slate-700"
                            />
                          )
                        )
                      )}
                    </div>
                  )}
                  <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1.5">
                    {INLINE_FIELDS.map((f) => {
                      const scaleField = f.key === "scale_ticket_received";
                      if (scaleField && !t.needs_scale) return null;
                      return (
                        <label
                          key={f.key}
                          className="flex cursor-pointer items-center gap-1.5 text-sm"
                        >
                          <input
                            type="checkbox"
                            checked={Boolean(t[f.key])}
                            disabled={savingId === t.id || !canModify(t)}
                            onChange={(e) => patchFlagged(t, f.key, e.target.checked)}
                            className="h-4 w-4 cursor-pointer accent-brand-600 disabled:opacity-40"
                          />
                          {f.label}
                        </label>
                      );
                    })}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={savingId === t.id || !canModify(t)}
                      onClick={() => resendToQC(t)}
                      className="flex cursor-pointer items-center gap-1.5 rounded bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-700 disabled:opacity-50"
                    >
                      <Send className="h-3.5 w-3.5" aria-hidden="true" />
                      Fixed — resend to QC
                    </button>
                    {canModify(t) && (
                      <button
                        type="button"
                        onClick={() => router.push(`/dashboard/new-pickup?edit=${t.id}`)}
                        className="flex cursor-pointer items-center gap-1.5 rounded border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                        Open full form
                      </button>
                    )}
                    {/* R23: Dropped — any user, ends the lifecycle */}
                    <button
                      type="button"
                      disabled={savingId === t.id}
                      onClick={() => markDropped(t)}
                      title="Dropped — trailer was dropped, nothing left to process"
                      className="flex cursor-pointer items-center gap-1.5 rounded border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-amber-50 hover:text-amber-700 disabled:opacity-50 dark:border-slate-600 dark:hover:bg-amber-950/40"
                    >
                      <PackageX className="h-3.5 w-3.5" aria-hidden="true" />
                      Dropped
                    </button>
                    {canModify(t) && (
                      <button
                        type="button"
                        onClick={() => {
                          setUnresolvableTicket(t);
                          setUnresolvableReason("");
                        }}
                        className="flex cursor-pointer items-center gap-1.5 rounded border border-amber-400 px-3 py-1.5 text-sm font-medium text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-400 dark:hover:bg-amber-950/40"
                      >
                        <Ban className="h-3.5 w-3.5" aria-hidden="true" />
                        Mark Unresolvable / Can&apos;t Fix
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {!loading && sorted.length === 0 && flagged.length === 0 && !error && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
          Board clear — no flagged pickups and nothing waiting on a scale ticket.
        </div>
      )}

      {sorted.length > 0 && (
        // R19: vertical scroll happens INSIDE this wrapper so the horizontal
        // scrollbar stays pinned on-screen no matter which row you're on.
        <div className="max-h-[calc(100vh-230px)] overflow-auto rounded-lg border border-blue-100 bg-white dark:border-slate-800 dark:bg-slate-900">
          <table className="w-full min-w-[1080px] text-left text-sm">
            <thead className="sticky top-0 z-10 bg-white dark:bg-slate-900">
              <tr className="border-b border-blue-100 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400">
                <th className="px-3 py-2.5">#</th>
                <th className="px-3 py-2.5">Truck #</th>
                <th className="px-3 py-2.5">Created</th>
                <th className="px-3 py-2.5">Status</th>
                <th className="px-3 py-2.5">MC</th>
                <th className="px-3 py-2.5">Driver</th>
                <th className="px-3 py-2.5">Waiting</th>
                {INLINE_FIELDS.map((f) => (
                  <th key={f.key} className="px-3 py-2.5 text-center">
                    {f.label}
                  </th>
                ))}
                <th className="px-3 py-2.5">Created by</th>
                <th className="px-3 py-2.5 text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((t) => {
                const timer = getTimerInfo(getTimerStart(t), now);
                const rowCls =
                  timer.tier === "critical"
                    ? "bg-red-100 dark:bg-red-950/40"
                    : timer.tier === "warning"
                      ? "bg-yellow-100 dark:bg-yellow-950/30"
                      : "bg-white dark:bg-slate-900";
                return (
                  <tr
                    key={t.id}
                    className={`border-b border-slate-100 last:border-0 dark:border-slate-800 ${rowCls}`}
                  >
                    <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs font-semibold text-slate-500 dark:text-slate-400">
                      {t.pickup_number != null ? `#${t.pickup_number}` : "—"}
                    </td>
                    <td className="px-3 py-2.5 font-mono font-semibold">
                      <span className="flex items-center gap-1.5">
                        {/* R21: Followed up — restart the waiting timer */}
                        {timer.minutes !== null && canModify(t) && (
                          <button
                            type="button"
                            aria-label={`Followed up on truck ${t.truck_number} — restart the waiting timer`}
                            title="Followed up — restarts the waiting timer and clears the overdue alert"
                            disabled={savingId === t.id}
                            onClick={() => followUp(t)}
                            className="cursor-pointer rounded p-1 text-slate-500 hover:bg-slate-200 hover:text-brand-600 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-slate-700"
                          >
                            <TimerReset className="h-4 w-4" aria-hidden="true" />
                          </button>
                        )}
                        {timer.tier === "critical" && (
                          <span
                            className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-red-600"
                            role="img"
                            aria-label="Severely overdue: waiting 4+ hours"
                          />
                        )}
                        {timer.tier === "warning" && (
                          <AlertCircle
                            className="h-4 w-4 shrink-0 text-amber-600"
                            role="img"
                            aria-label="Scale ticket overdue: waiting 2+ hours"
                          />
                        )}
                        {t.truck_number}
                        {t.is_hazmat && <HazmatBadge />}
                      </span>
                    </td>
                    {/* When the ticket was ORIGINALLY created (display TZ) */}
                    <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs">
                      {fmtCst(t.created_at)}
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={`inline-flex whitespace-nowrap rounded px-2 py-0.5 text-xs font-semibold ${
                          ACTIVE_BADGE[t.state]?.cls ?? ""
                        }`}
                      >
                        {ACTIVE_BADGE[t.state]?.label ?? t.state}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">{t.motor_carrier.name}</td>
                    <td className="px-3 py-2.5">{t.driver_name ?? "—"}</td>
                    <td className="px-3 py-2.5 font-mono text-xs">
                      {timer.minutes === null ? "—" : `${timer.minutes} min`}
                    </td>
                    {INLINE_FIELDS.map((f) => {
                      const checked = Boolean(t[f.key]);
                      const scaleField = f.key === "scale_ticket_received";
                      const disabled =
                        savingId === t.id ||
                        (scaleField && !t.needs_scale) ||
                        !canModify(t);
                      return (
                        <td key={f.key} className="px-3 py-2.5 text-center">
                          <input
                            type="checkbox"
                            aria-label={`${f.label} for truck ${t.truck_number}`}
                            checked={checked}
                            disabled={disabled}
                            title={
                              !canModify(t)
                                ? "Only the creator (or a manager) can edit this ticket"
                                : undefined
                            }
                            onChange={(e) => patchField(t, f.key, e.target.checked)}
                            className="h-4 w-4 cursor-pointer accent-brand-600 disabled:cursor-not-allowed disabled:opacity-40"
                          />
                        </td>
                      );
                    })}
                    <td className="px-3 py-2.5 text-slate-500 dark:text-slate-400">
                      {t.creator.username}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <span className="flex justify-center gap-1">
                        {canModify(t) && (
                          <button
                            type="button"
                            aria-label={`Edit truck ${t.truck_number}`}
                            title="Open the full pickup form pre-filled with this ticket"
                            onClick={() => router.push(`/dashboard/new-pickup?edit=${t.id}`)}
                            className="cursor-pointer rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                          >
                            <Pencil className="h-4 w-4" aria-hidden="true" />
                          </button>
                        )}
                        {/* R23: Dropped — any user, ends the lifecycle */}
                        <button
                          type="button"
                          aria-label={`Mark truck ${t.truck_number} as dropped`}
                          title="Dropped — trailer was dropped, nothing left to process"
                          disabled={savingId === t.id}
                          onClick={() => markDropped(t)}
                          className="cursor-pointer rounded p-1.5 text-slate-500 hover:bg-amber-50 hover:text-amber-700 disabled:opacity-40 dark:hover:bg-amber-950/40"
                        >
                          <PackageX className="h-4 w-4" aria-hidden="true" />
                        </button>
                        {canDelete(t) && (
                          <button
                            type="button"
                            aria-label={`Delete truck ${t.truck_number}`}
                            disabled={savingId === t.id}
                            onClick={() => deleteTicket(t)}
                            className="cursor-pointer rounded p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </button>
                        )}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* R11 escape hatch: intentional-friction modal with a MANDATORY reason */}
      {unresolvableTicket && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="unresolvable-title"
          onClick={() => !unresolvableBusy && setUnresolvableTicket(null)}
        >
          <div
            className="w-full max-w-md rounded-lg border-2 border-amber-400 bg-white p-5 shadow-xl dark:border-amber-700 dark:bg-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between">
              <h2 id="unresolvable-title" className="flex items-center gap-2 font-mono text-base font-semibold">
                <Ban className="h-4 w-4 text-amber-600" aria-hidden="true" />
                Mark Unresolvable — {unresolvableTicket.truck_number}
              </h2>
              <button
                type="button"
                aria-label="Cancel"
                onClick={() => setUnresolvableTicket(null)}
                disabled={unresolvableBusy}
                className="cursor-pointer rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <p className="mb-3 text-sm text-slate-600 dark:text-slate-400">
              This escalates the ticket back to QC as an exception and removes it
              from your board. QC will decide whether to force-approve it — your
              explanation goes on permanent record.
            </p>

            <label htmlFor="unresolvable-reason" className="mb-1 block text-sm font-medium">
              Why can&apos;t this be fixed? <span className="text-red-600">*</span>
            </label>
            <textarea
              id="unresolvable-reason"
              rows={3}
              value={unresolvableReason}
              onChange={(e) => setUnresolvableReason(e.target.value)}
              placeholder='e.g. "Driver refused to send PTI and is ignoring calls"'
              className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 dark:border-slate-700 dark:bg-slate-800"
            />
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Minimum 10 characters — be specific, management will read this.
            </p>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setUnresolvableTicket(null)}
                disabled={unresolvableBusy}
                className="cursor-pointer rounded border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitUnresolvable}
                disabled={unresolvableBusy || unresolvableReason.trim().length < 10}
                className="flex cursor-pointer items-center gap-2 rounded bg-amber-600 px-4 py-2 text-sm font-semibold text-white transition-colors duration-150 hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {unresolvableBusy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                Escalate to QC
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
