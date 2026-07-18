"use client";

import { CheckCircle2, Flag, History, Paperclip, RefreshCw, Search, ShieldAlert, Siren, Trash2, Warehouse, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import RequireRole from "@/components/RequireRole";
import ConfirmationModal from "@/components/qc/ConfirmationModal";
import { ErrorBanner, HazmatBadge, StateBadge, StatusFilter, Toggle } from "@/components/ui";
import { api, ApiError, mediaUrl, uploadMedia } from "@/lib/api";
import {
  CATEGORY_LABELS,
  ERROR_CATEGORIES,
  matchesStatus,
  type ErrorCategory,
  type MediaType,
  type StatusFilterValue,
  type Ticket,
} from "@/lib/types";
import { ptiKeyLabels } from "@/lib/pti";
import {
  fmtCstDate,
  matchesDayShift,
  matchesSearch,
  SHIFT_LABELS,
  type Shift,
} from "@/lib/time";
import { useAuthStore } from "@/store/authStore";

export default function QCReviewPage() {
  return (
    <RequireRole roles={["qc", "manager"]}>
      <QCQueue />
    </RequireRole>
  );
}

function QCQueue() {
  const { username, role } = useAuthStore();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [includeAwaiting, setIncludeAwaiting] = useState(false);
  // R17: queue filters — search, CST shift, employee, sort order
  const [search, setSearch] = useState("");
  const [shift, setShift] = useState<Shift | "">("");
  const [employee, setEmployee] = useState("");
  // R25: lifecycle status filter (queue states only)
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>("");
  const [sort, setSort] = useState<"newest" | "oldest">("oldest");

  // Approval friction modal
  const [approving, setApproving] = useState<Ticket | null>(null);
  const [approveBusy, setApproveBusy] = useState(false);

  // Flag form (per-ticket) — multiple categories per flag action
  const [flaggingId, setFlaggingId] = useState<string | null>(null);
  const [flagCategories, setFlagCategories] = useState<ErrorCategory[]>([]);
  const [flagNotes, setFlagNotes] = useState("");
  const [flagSeverity, setFlagSeverity] = useState(5);
  const [flagUrgent, setFlagUrgent] = useState(false);
  const [flagMedia, setFlagMedia] = useState<{ url: string; media_type: MediaType }[]>([]);
  const [mediaUrlInput, setMediaUrlInput] = useState("");
  const [uploading, setUploading] = useState(false);
  const [flagBusy, setFlagBusy] = useState(false);

  const needsSeverity = flagCategories.includes("Didnt_Text_In_Group");

  function resetFlagForm() {
    setFlagCategories([]);
    setFlagNotes("");
    setFlagSeverity(5);
    setFlagUrgent(false);
    setFlagMedia([]);
    setMediaUrlInput("");
  }

  async function attachFile(file: File | null) {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const res = await uploadMedia(file);
      setFlagMedia((prev) => [...prev, res]);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  function attachUrl() {
    const url = mediaUrlInput.trim();
    if (!url) return;
    const isVideo = /\.(mp4|mov|webm|avi|mkv)(\?|$)/i.test(url);
    setFlagMedia((prev) => [...prev, { url, media_type: isVideo ? "video" : "image" }]);
    setMediaUrlInput("");
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setTickets(
        await api<Ticket[]>(
          `/api/tickets/qc${includeAwaiting ? "?include_awaiting=true" : ""}`
        )
      );
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load the QC queue.");
    } finally {
      setLoading(false);
    }
  }, [includeAwaiting]);

  useEffect(() => {
    load();
  }, [load]);

  async function confirmApprove() {
    if (!approving) return;
    setApproveBusy(true);
    setError(null);
    try {
      const t = await api<Ticket>(`/api/tickets/${approving.id}/approve`, { method: "POST" });
      setTickets((prev) => prev.filter((x) => x.id !== t.id));
      setNotice(`Truck ${t.truck_number} approved (+10 to ${t.creator.username}).`);
      setApproving(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Approval failed.");
    } finally {
      setApproveBusy(false);
    }
  }

  // R16: QC can delete any pickup outright (bogus/duplicate entries)
  async function deleteTicket(t: Ticket) {
    if (!window.confirm(`Delete the pickup for truck ${t.truck_number}? This cannot be undone.`)) {
      return;
    }
    setError(null);
    try {
      await api<void>(`/api/tickets/${t.id}`, { method: "DELETE" });
      setTickets((prev) => prev.filter((x) => x.id !== t.id));
      setNotice(`Truck ${t.truck_number}: pickup deleted.`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Delete failed.");
    }
  }

  async function submitFlag(ticket: Ticket) {
    setFlagBusy(true);
    setError(null);
    try {
      const t = await api<Ticket>(`/api/tickets/${ticket.id}/flag`, {
        method: "POST",
        body: JSON.stringify({
          error_categories: flagCategories,
          notes: flagNotes.trim() || null,
          severity: needsSeverity ? flagSeverity : null,
          media: flagMedia,
          is_urgent: flagUrgent,
        }),
      });
      setTickets((prev) => prev.filter((x) => x.id !== t.id));
      setNotice(
        `Truck ${t.truck_number} flagged (${flagCategories
          .map((c) => CATEGORY_LABELS[c])
          .join(", ")}) — sent back to ${t.creator.username}'s Carryover dashboard.`
      );
      setFlaggingId(null);
      resetFlagForm();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Flagging failed.");
    } finally {
      setFlagBusy(false);
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="font-mono text-xl font-semibold">QC Review</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Pending and resolved tickets awaiting audit
          </p>
        </div>
        <div className="flex items-center gap-4">
          <label
            htmlFor="include-awaiting"
            className="flex cursor-pointer items-center gap-2 text-sm text-slate-600 dark:text-slate-300"
          >
            <Toggle
              id="include-awaiting"
              checked={includeAwaiting}
              onChange={setIncludeAwaiting}
              label="Include pickups awaiting scale ticket"
            />
            Include awaiting scale ticket
          </label>
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

      {/* R17: search + shift + employee + sort filters */}
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
        <select
          value={employee}
          onChange={(e) => setEmployee(e.target.value)}
          aria-label="Filter by employee"
          className="rounded border border-slate-300 bg-white px-2.5 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
        >
          <option value="">All employees</option>
          {[...new Set(tickets.map((t) => t.creator.username))].sort().map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
        {/* R25: lifecycle status dropdown — the queue's three states */}
        <StatusFilter
          value={statusFilter}
          onChange={setStatusFilter}
          options={["PENDING_QC", "RESOLVED", "AWAITING_DRIVER"]}
        />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as "newest" | "oldest")}
          aria-label="Sort order"
          className="rounded border border-slate-300 bg-white px-2.5 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
        >
          <option value="oldest">Oldest first</option>
          <option value="newest">Newest first</option>
        </select>
        {(search || shift || employee || statusFilter) && (
          <button
            type="button"
            onClick={() => {
              setSearch("");
              setShift("");
              setEmployee("");
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
          className="mb-3 rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
        >
          {notice}
        </div>
      )}

      {!loading && tickets.length === 0 && !error && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
          The QC queue is empty.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {tickets
          .filter(
            (t) =>
              matchesSearch(t, search) &&
              matchesDayShift(t.created_at, "", shift) &&
              matchesStatus(t, statusFilter) &&
              (!employee || t.creator.username === employee)
          )
          .sort((a, b) =>
            sort === "newest"
              ? +new Date(b.created_at) - +new Date(a.created_at)
              : +new Date(a.created_at) - +new Date(b.created_at)
          )
          .map((t, i) => (
          <div
            key={t.id}
            className={`rounded-lg border bg-white p-4 dark:bg-slate-900 ${
              t.is_unresolvable
                ? "border-2 border-red-500 dark:border-red-600"
                : "border-blue-100 dark:border-slate-800"
            }`}
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 font-mono text-base font-semibold">
                {/* R27b: positional number within the visible, filtered queue */}
                <span className="text-sm font-semibold text-slate-500 dark:text-slate-400">
                  {i + 1}
                </span>
                {t.truck_number}
                {/* R25: hazmat loads called out for the auditor */}
                {t.is_hazmat && <HazmatBadge />}
                {/* R14: LOT trailers called out prominently for the auditor */}
                {t.is_lot_trailer && (
                  <span className="flex items-center gap-1 rounded bg-blue-800 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">
                    <Warehouse className="h-3 w-3" aria-hidden="true" />
                    LOT Trailer
                  </span>
                )}
                {t.is_unresolvable && (
                  <span className="animate-pulse rounded bg-red-600 px-2 py-0.5 text-[11px] font-bold uppercase text-white">
                    Exception Review
                  </span>
                )}
              </span>
              <StateBadge state={t.state} />
            </div>

            {/* R11: the employee's mandatory explanation, front and center */}
            {t.is_unresolvable && t.unresolvable_reason && (
              <div className="mb-3 rounded border-2 border-red-300 bg-red-50 p-2.5 dark:border-red-800 dark:bg-red-950/40">
                <p className="mb-0.5 text-xs font-bold uppercase text-red-700 dark:text-red-300">
                  Employee reports this cannot be fixed:
                </p>
                <p className="text-sm text-red-900 dark:text-red-200">
                  “{t.unresolvable_reason}”
                </p>
                <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                  Force Approve closes it with this exception on permanent record —
                  or Flag it again to reject the escalation.
                </p>
              </div>
            )}

            <dl className="mb-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
              <Detail label="MC" value={t.motor_carrier.name} />
              <Detail label="Created by" value={t.creator.username} />
              <Detail label="Driver" value={t.driver_name ?? "—"} />
              <Detail label="Location" value={t.truck_location ?? "—"} />
              <Detail label="Model" value={t.truck_model ?? "—"} />
              <Detail
                label="Fuel"
                value={t.fuel_percentage != null ? `${t.fuel_percentage.toFixed(0)}%` : "—"}
              />
              <Detail label="Weight" value={t.weight || "—"} />
              <Detail label="Condition" value={t.trailer_condition ?? "—"} />
              {/* R20: historical context — last time this truck/trailer had
                  a verified PTI, so QC isn't reviewing blind */}
              <Detail
                label="Last PTI Date"
                value={t.last_pti_date ? fmtCstDate(t.last_pti_date) : "No prior record"}
              />
            </dl>

            <div className="mb-3 flex flex-wrap gap-1.5 text-xs">
              <CheckPill ok={t.registration_verified} label="Registration" />
              <CheckPill ok={t.inspection_paper_verified} label="Inspection" />
              <CheckPill ok={t.sticker_verified} label="Sticker" />
              <CheckPill ok={t.bol_present} label="BOL" />
              <CheckPill ok={t.pti_verified} label="PTI" />
              <CheckPill ok={t.eld_mentioned} label="ELD" />
              <CheckPill ok={t.checklist_sent} label="Checklist" />
              {t.needs_scale && <CheckPill ok={t.scale_ticket_received} label="Scale ticket" />}
              {t.is_ca_fl_destination && (
                <span className="rounded bg-amber-100 px-2 py-0.5 font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                  CA/FL destination
                </span>
              )}
            </div>

            {/* R18: read-only granular PTI video log — context only, the
                master PTI pill above is the verification status */}
            <PtiLog checklist={t.pti_checklist} />

            {t.condition_notes && (
              <p className="mb-3 rounded bg-slate-50 px-2.5 py-1.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                {t.condition_notes}
              </p>
            )}

            {t.state === "AWAITING_DRIVER" && (
              <p className="mb-3 rounded border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                Early review — scale ticket not yet received. Approving now closes
                the ticket without it.
              </p>
            )}

            {/* R8: persistent flag context — QC sees exactly what was flagged
                before, especially when verifying a RESOLVED fix. */}
            {t.audit_flags.length > 0 && (
              <div
                className={`mb-3 rounded border p-2.5 ${
                  t.state === "RESOLVED"
                    ? "border-violet-300 bg-violet-50 dark:border-violet-800 dark:bg-violet-950/30"
                    : "border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50"
                }`}
              >
                <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold">
                  <History className="h-3.5 w-3.5" aria-hidden="true" />
                  {t.state === "RESOLVED"
                    ? "Previously flagged for — verify these fixes:"
                    : "Flag history:"}
                  {t.is_urgent_flag && (
                    <span className="rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">
                      urgent
                    </span>
                  )}
                </p>
                <div className="mb-1 flex flex-wrap gap-1">
                  {[...new Set(t.audit_flags.map((f) => f.error_category))].map((c) => {
                    const sev = t.audit_flags.find(
                      (f) => f.error_category === c && f.severity != null
                    )?.severity;
                    return (
                      <span
                        key={c}
                        className="rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-medium text-red-700 dark:bg-red-900/40 dark:text-red-300"
                      >
                        {CATEGORY_LABELS[c]}
                        {sev != null && ` — ${sev}/10`}
                      </span>
                    );
                  })}
                </div>
                {[...new Set(
                  t.audit_flags.map((f) => f.notes?.trim()).filter((n): n is string => !!n)
                ).values()].map((n) => (
                  <p key={n} className="text-xs text-slate-600 dark:text-slate-300">
                    “{n}”
                  </p>
                ))}
                {t.audit_flags.some((f) => f.media.length > 0) && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {t.audit_flags.flatMap((f) =>
                      f.media.map((m) => (
                        <a
                          key={m.id}
                          href={mediaUrl(m.media_url)}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded bg-slate-200 px-1.5 py-0.5 font-mono text-[10px] uppercase text-slate-700 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-200"
                        >
                          {m.media_type} proof
                        </a>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}

            {/* R14 conflict of interest: QC never audits their own pickup —
                the backend enforces this too (403). */}
            {role === "qc" && t.creator.username === username ? (
              <div className="flex items-center gap-2">
                <p className="flex flex-1 items-center gap-2 rounded border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
                  <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
                  Your pickup — another QC or a manager must audit it.
                </p>
                <button
                  type="button"
                  aria-label={`Delete truck ${t.truck_number}`}
                  title="Delete this pickup"
                  onClick={() => deleteTicket(t)}
                  className="cursor-pointer rounded border border-slate-300 p-2 text-slate-500 transition-colors duration-150 hover:bg-red-50 hover:text-red-600 dark:border-slate-700 dark:hover:bg-red-950/40"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            ) : (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setApproving(t)}
                className={`flex cursor-pointer items-center gap-1.5 rounded px-3 py-2 text-sm font-semibold text-white transition-colors duration-150 ${
                  t.is_unresolvable
                    ? "bg-red-600 hover:bg-red-700"
                    : "bg-emerald-600 hover:bg-emerald-700"
                }`}
              >
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                {t.is_unresolvable ? "Force Approve" : "Approve Ticket"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setFlaggingId(flaggingId === t.id ? null : t.id);
                  resetFlagForm();
                }}
                className="flex cursor-pointer items-center gap-1.5 rounded border border-red-300 px-3 py-2 text-sm font-semibold text-red-700 transition-colors duration-150 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/40"
              >
                <Flag className="h-4 w-4" aria-hidden="true" />
                Flag
              </button>
              <button
                type="button"
                aria-label={`Delete truck ${t.truck_number}`}
                title="Delete this pickup"
                onClick={() => deleteTicket(t)}
                className="ml-auto cursor-pointer rounded border border-slate-300 p-2 text-slate-500 transition-colors duration-150 hover:bg-red-50 hover:text-red-600 dark:border-slate-700 dark:hover:bg-red-950/40"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            )}

            {flaggingId === t.id && (
              <div className="mt-3 space-y-2.5 rounded border border-red-200 bg-red-50/60 p-3 dark:border-red-900 dark:bg-red-950/30">
                <fieldset>
                  <legend className="mb-1.5 text-xs font-medium">
                    Error categories — select all that apply{" "}
                    <span className="text-red-600">*</span>
                  </legend>
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {ERROR_CATEGORIES.map((c) => (
                      <label
                        key={c}
                        className="flex cursor-pointer items-center gap-2 rounded border border-slate-200 bg-white px-2.5 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800"
                      >
                        <input
                          type="checkbox"
                          checked={flagCategories.includes(c)}
                          onChange={(e) =>
                            setFlagCategories((prev) =>
                              e.target.checked
                                ? [...prev, c]
                                : prev.filter((x) => x !== c)
                            )
                          }
                          className="h-4 w-4 shrink-0 accent-red-600"
                        />
                        {CATEGORY_LABELS[c]}
                      </label>
                    ))}
                  </div>
                </fieldset>

                {/* Severity gauge — appears only for "Didn't text in the group" */}
                {needsSeverity && (
                  <div className="rounded border border-red-300 bg-white p-2.5 dark:border-red-800 dark:bg-slate-800">
                    <label
                      htmlFor={`flag-severity-${t.id}`}
                      className="mb-1 flex items-center justify-between text-xs font-medium"
                    >
                      <span>
                        Communication failure severity{" "}
                        <span className="text-red-600">*</span>
                      </span>
                      <span className="font-mono text-sm font-bold text-red-700 dark:text-red-400">
                        {flagSeverity}/10
                      </span>
                    </label>
                    <input
                      id={`flag-severity-${t.id}`}
                      type="range"
                      min={1}
                      max={10}
                      step={1}
                      value={flagSeverity}
                      onChange={(e) => setFlagSeverity(Number(e.target.value))}
                      className="w-full cursor-pointer accent-red-600"
                      aria-valuetext={`${flagSeverity} out of 10`}
                    />
                    <div className="flex justify-between text-[10px] text-slate-500 dark:text-slate-400">
                      <span>1 — minor</span>
                      <span>10 — severe</span>
                    </div>
                  </div>
                )}
                <div>
                  <label
                    htmlFor={`flag-notes-${t.id}`}
                    className="mb-1 block text-xs font-medium"
                  >
                    Describe the problem{" "}
                    {flagCategories.includes("Other") ? (
                      <span className="text-red-600">* (required for Other)</span>
                    ) : (
                      <span className="text-slate-500">(optional)</span>
                    )}
                  </label>
                  <textarea
                    id={`flag-notes-${t.id}`}
                    rows={3}
                    value={flagNotes}
                    onChange={(e) => setFlagNotes(e.target.value)}
                    placeholder="What exactly is wrong with this pickup?"
                    className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800"
                  />
                </div>
                {/* R8 triage: urgent flags bypass Mistake Privacy */}
                <label
                  className={`flex cursor-pointer items-center justify-between gap-3 rounded border-2 px-3 py-2.5 text-sm font-semibold transition-colors duration-150 ${
                    flagUrgent
                      ? "border-red-500 bg-red-100 text-red-800 dark:border-red-600 dark:bg-red-950/60 dark:text-red-200"
                      : "border-slate-300 bg-white text-slate-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Siren className="h-4 w-4" aria-hidden="true" />
                    Urgent Flag (Global Visibility)
                    <span className="text-xs font-normal">
                      — visible &amp; fixable by ALL employees
                    </span>
                  </span>
                  <Toggle
                    id={`flag-urgent-${t.id}`}
                    checked={flagUrgent}
                    onChange={setFlagUrgent}
                    label="Urgent Flag (Global Visibility)"
                  />
                </label>

                {/* Proof media: upload or paste URL */}
                <div className="rounded border border-slate-200 bg-white p-2.5 dark:border-slate-700 dark:bg-slate-800">
                  <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium">
                    <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />
                    Proof (pictures / videos)
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="cursor-pointer rounded border border-slate-300 px-2.5 py-1.5 text-xs font-medium hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-700">
                      {uploading ? "Uploading…" : "Upload file"}
                      <input
                        type="file"
                        accept="image/*,video/*"
                        className="hidden"
                        disabled={uploading}
                        onChange={(e) => {
                          attachFile(e.target.files?.[0] ?? null);
                          e.target.value = "";
                        }}
                      />
                    </label>
                    <input
                      value={mediaUrlInput}
                      onChange={(e) => setMediaUrlInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          attachUrl();
                        }
                      }}
                      placeholder="…or paste a media URL"
                      className="min-w-0 flex-1 rounded border border-slate-300 px-2.5 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-900"
                    />
                    <button
                      type="button"
                      onClick={attachUrl}
                      disabled={!mediaUrlInput.trim()}
                      className="cursor-pointer rounded border border-slate-300 px-2.5 py-1.5 text-xs font-medium hover:bg-slate-50 disabled:opacity-40 dark:border-slate-600 dark:hover:bg-slate-700"
                    >
                      Add URL
                    </button>
                  </div>
                  {flagMedia.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {flagMedia.map((m, i) => (
                        <li
                          key={`${m.url}-${i}`}
                          className="flex items-center gap-2 rounded bg-slate-50 px-2 py-1 text-xs dark:bg-slate-900"
                        >
                          <span className="rounded bg-slate-200 px-1.5 py-0.5 font-mono text-[10px] uppercase dark:bg-slate-700">
                            {m.media_type}
                          </span>
                          <span className="min-w-0 flex-1 truncate" title={m.url}>
                            {m.url}
                          </span>
                          <button
                            type="button"
                            aria-label="Remove attachment"
                            onClick={() =>
                              setFlagMedia((prev) => prev.filter((_, j) => j !== i))
                            }
                            className="cursor-pointer rounded p-0.5 text-slate-500 hover:text-red-600"
                          >
                            <X className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <button
                  type="button"
                  disabled={
                    flagBusy ||
                    uploading ||
                    flagCategories.length === 0 ||
                    (flagCategories.includes("Other") && !flagNotes.trim())
                  }
                  onClick={() => submitFlag(t)}
                  className="cursor-pointer rounded bg-red-600 px-3 py-1.5 text-sm font-semibold text-white transition-colors duration-150 hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Submit Flag{flagCategories.length > 1 ? ` (${flagCategories.length} issues)` : ""}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      <ConfirmationModal
        open={approving !== null}
        truckNumber={approving?.truck_number ?? ""}
        busy={approveBusy}
        onConfirm={confirmApprove}
        onClose={() => setApproving(null)}
      />
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="truncate font-medium" title={value}>
        {value}
      </dd>
    </div>
  );
}

const PTI_LABELS = ptiKeyLabels();

/** R18: what the employee logged from the PTI video — read-only for QC;
 *  never drives a flag, the master PTI checkbox is the verification. */
function PtiLog({ checklist }: { checklist: Record<string, boolean> | null }) {
  const checked = Object.entries(checklist ?? {})
    .filter(([, v]) => v)
    .map(([k]) => PTI_LABELS[k] ?? k);
  const total = Object.keys(PTI_LABELS).length;
  return (
    <details className="mb-3 rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800/50">
      <summary className="cursor-pointer font-medium text-slate-600 dark:text-slate-300">
        PTI video log — {checked.length}/{total} item(s) noted (read-only)
      </summary>
      {checked.length === 0 ? (
        <p className="mt-1.5 text-slate-500 dark:text-slate-400">
          Nothing logged from the video for this pickup.
        </p>
      ) : (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {checked.map((label) => (
            <span
              key={label}
              className="rounded bg-emerald-100 px-1.5 py-0.5 font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
            >
              {label}
            </span>
          ))}
        </div>
      )}
    </details>
  );
}

function CheckPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`rounded px-2 py-0.5 font-medium ${
        ok
          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
          : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
      }`}
    >
      {label}: {ok ? "OK" : "Missing"}
    </span>
  );
}
