"use client";

import { AlertCircle, Flag, Pencil, RefreshCw, Send, Siren, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { useAuthStore } from "@/store/authStore";

import RequireRole from "@/components/RequireRole";
import { ErrorBanner } from "@/components/ui";
import { getTimerInfo, useNow } from "@/hooks/useTicketTimer";
import { api, ApiError, mediaUrl } from "@/lib/api";
import { CATEGORY_LABELS, type Ticket, type TicketState } from "@/lib/types";

/** Active-board status badges — tickets stay visible until APPROVED. */
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
};

/** Boolean checklist fields rendered as inline-editable checkboxes (04 §3: no modals). */
const INLINE_FIELDS: { key: keyof Ticket & string; label: string }[] = [
  { key: "registration_verified", label: "Reg." },
  { key: "inspection_paper_verified", label: "Insp." },
  { key: "sticker_verified", label: "Sticker" },
  { key: "bol_present", label: "BOL" },
  { key: "scale_ticket_received", label: "Scale Tkt" },
];

export default function CarryoverPage() {
  return (
    <RequireRole roles={["employee", "manager"]}>
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

  // ≥120 min rows sort to the absolute top (04 §3), then by longest wait.
  const sorted = [...tickets].sort((a, b) => {
    const ta = getTimerInfo(a.scale_requested_at, now);
    const tb = getTimerInfo(b.scale_requested_at, now);
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
      if (ticket.state === "AWAITING_DRIVER" && updated.state === "PENDING_QC") {
        setNotice(
          `Truck ${updated.truck_number}: complete — sent to QC. It stays here and remains editable until approved.`
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
          <h1 className="font-mono text-xl font-semibold">Carryover / Active Board</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Your working sheet — tickets stay visible and editable until QC approves them
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
            {flagged.map((t) => {
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
                      {t.truck_number}
                      {t.is_urgent_flag && (
                        <span className="flex animate-pulse items-center gap-1 rounded bg-red-600 px-2 py-0.5 text-[11px] font-bold uppercase text-white">
                          <Siren className="h-3 w-3" aria-hidden="true" />
                          Urgent — anyone can fix
                        </span>
                      )}
                    </span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {t.motor_carrier.name} · by {t.creator.username}
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
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {!loading && sorted.length === 0 && flagged.length === 0 && !error && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
          No active tickets — everything has been approved.
        </div>
      )}

      {sorted.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-blue-100 bg-white dark:border-slate-800 dark:bg-slate-900">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead>
              <tr className="border-b border-blue-100 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400">
                <th className="px-3 py-2.5">Truck #</th>
                <th className="px-3 py-2.5">Status</th>
                <th className="px-3 py-2.5">MC</th>
                <th className="px-3 py-2.5">Driver</th>
                <th className="px-3 py-2.5">Waiting</th>
                {INLINE_FIELDS.map((f) => (
                  <th key={f.key} className="px-3 py-2.5 text-center">
                    {f.label}
                  </th>
                ))}
                <th className="px-3 py-2.5 text-center">PTI</th>
                <th className="px-3 py-2.5">Created by</th>
                <th className="px-3 py-2.5 text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((t) => {
                const timer = getTimerInfo(t.scale_requested_at, now);
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
                    <td className="px-3 py-2.5 font-mono font-semibold">
                      <span className="flex items-center gap-1.5">
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
                      </span>
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
                    <td
                      className="px-3 py-2.5 text-center text-sm"
                      title="PTI is completed via the full checklist — click Edit"
                    >
                      {t.pti_verified ? (
                        <span className="font-semibold text-emerald-600">✓</span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-slate-500 dark:text-slate-400">
                      {t.creator.username}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      {canModify(t) && (
                        <span className="flex justify-center gap-1">
                          <button
                            type="button"
                            aria-label={`Edit truck ${t.truck_number}`}
                            title="Open the full pickup form pre-filled with this ticket"
                            onClick={() => router.push(`/dashboard/new-pickup?edit=${t.id}`)}
                            className="cursor-pointer rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                          >
                            <Pencil className="h-4 w-4" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            aria-label={`Delete truck ${t.truck_number}`}
                            disabled={savingId === t.id}
                            onClick={() => deleteTicket(t)}
                            className="cursor-pointer rounded p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

    </div>
  );
}
