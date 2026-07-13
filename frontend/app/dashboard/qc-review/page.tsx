"use client";

import { CheckCircle2, Flag, History, Paperclip, RefreshCw, Siren, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import RequireRole from "@/components/RequireRole";
import ConfirmationModal from "@/components/qc/ConfirmationModal";
import { ErrorBanner, StateBadge, Toggle } from "@/components/ui";
import { api, ApiError, mediaUrl, uploadMedia } from "@/lib/api";
import {
  CATEGORY_LABELS,
  ERROR_CATEGORIES,
  type ErrorCategory,
  type MediaType,
  type Ticket,
} from "@/lib/types";

export default function QCReviewPage() {
  return (
    <RequireRole roles={["qc", "manager"]}>
      <QCQueue />
    </RequireRole>
  );
}

function QCQueue() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [includeAwaiting, setIncludeAwaiting] = useState(false);

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
        {tickets.map((t) => (
          <div
            key={t.id}
            className="rounded-lg border border-blue-100 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="mb-3 flex items-center justify-between">
              <span className="font-mono text-base font-semibold">{t.truck_number}</span>
              <StateBadge state={t.state} />
            </div>

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
            </dl>

            <div className="mb-3 flex flex-wrap gap-1.5 text-xs">
              <CheckPill ok={t.registration_verified} label="Registration" />
              <CheckPill ok={t.inspection_paper_verified} label="Inspection" />
              <CheckPill ok={t.sticker_verified} label="Sticker" />
              <CheckPill ok={t.bol_present} label="BOL" />
              <CheckPill ok={t.pti_verified} label="PTI" />
              {t.needs_scale && <CheckPill ok={t.scale_ticket_received} label="Scale ticket" />}
              {t.is_ca_fl_destination && (
                <span className="rounded bg-amber-100 px-2 py-0.5 font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                  CA/FL destination
                </span>
              )}
            </div>

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

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setApproving(t)}
                className="flex cursor-pointer items-center gap-1.5 rounded bg-emerald-600 px-3 py-2 text-sm font-semibold text-white transition-colors duration-150 hover:bg-emerald-700"
              >
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                Approve Ticket
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
            </div>

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
