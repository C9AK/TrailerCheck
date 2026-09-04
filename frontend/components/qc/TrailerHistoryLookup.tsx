"use client";

import { Loader2, Search, X } from "lucide-react";
import { useState } from "react";

import { api, ApiError } from "@/lib/api";
import { fmtCst, fmtCstDate } from "@/lib/time";
import type { Ticket, Trailer, TrailerLastUsed } from "@/lib/types";

/**
 * R51: "Trailer Lookup" popover next to the QC Review Trailer # field.
 *
 * A trailer that's new to THIS truck is not necessarily new to the fleet —
 * another truck may have hauled it last week with a fully verified PTI on
 * record. Without a way to check, QC has no choice but to treat every
 * trailer as unknown, which produces false "missing/stale PTI" flags on
 * trailers that are actually current. This queries a trailer number
 * directly against the two existing lookup endpoints (independent of
 * whichever trailer is currently linked to the ticket, so a manager can
 * check a DIFFERENT number before correcting a typo too) and surfaces its
 * registered Last PTI Date plus the truck that hauled it most recently.
 *
 * "Apply to Ticket" performs the same manager-only PATCH the inline PTI
 * Date field does — it's available to every role for the LOOKUP itself
 * (read-only, informational), but only a manager can commit it to the
 * ticket, matching the backend's own role gate on
 * PATCH /api/tickets/{id}/pti-date-override.
 */
export default function TrailerHistoryLookup({
  ticketId,
  defaultTrailerNumber,
  canApply,
  onApplied,
}: {
  ticketId: string;
  defaultTrailerNumber: string;
  canApply: boolean;
  onApplied: (updated: Ticket) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(defaultTrailerNumber);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    lastPtiDate: string;
    lastHauledTruck: TrailerLastUsed | null;
  } | null>(null);

  async function lookup() {
    const number = query.trim();
    if (!number) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const trailer = await api<Trailer>(`/api/trailers/${encodeURIComponent(number)}`);
      const lastUsed = await api<TrailerLastUsed | null>(
        `/api/trailers/${encodeURIComponent(number)}/last-used?exclude_ticket_id=${ticketId}`
      );
      setResult({ lastPtiDate: trailer.last_pti_date, lastHauledTruck: lastUsed });
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 404
          ? `No record for trailer ${number} — it hasn't been registered yet.`
          : e instanceof ApiError
            ? e.message
            : "Lookup failed."
      );
    } finally {
      setLoading(false);
    }
  }

  async function apply() {
    if (!result) return;
    setApplying(true);
    setError(null);
    try {
      const updated = await api<Ticket>(`/api/tickets/${ticketId}/pti-date-override`, {
        method: "PATCH",
        body: JSON.stringify({ last_pti_date: result.lastPtiDate }),
      });
      onApplied(updated);
      setOpen(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not apply this date to the ticket.");
    } finally {
      setApplying(false);
    }
  }

  return (
    <span className="relative inline-block">
      <button
        type="button"
        aria-label="Trailer Lookup"
        title="Trailer Lookup — check this trailer's history across the whole fleet"
        onClick={() => {
          setQuery(defaultTrailerNumber);
          setResult(null);
          setError(null);
          setOpen((v) => !v);
        }}
        className="cursor-pointer rounded p-0.5 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400"
      >
        <Search className="h-3.5 w-3.5" aria-hidden="true" />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Trailer Lookup"
          className="absolute left-0 top-6 z-20 w-72 rounded-lg border border-blue-100 bg-white p-3 shadow-xl dark:border-slate-700 dark:bg-slate-900"
        >
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Trailer Lookup
            </p>
            <button
              type="button"
              aria-label="Close"
              onClick={() => setOpen(false)}
              className="cursor-pointer rounded p-0.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>

          <div className="mb-2 flex gap-1.5">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  lookup();
                }
              }}
              placeholder="Trailer #"
              aria-label="Trailer number to look up"
              className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1 text-xs font-mono dark:border-slate-600 dark:bg-slate-800"
            />
            <button
              type="button"
              disabled={loading || !query.trim()}
              onClick={lookup}
              className="flex shrink-0 cursor-pointer items-center gap-1 rounded bg-slate-700 px-2 py-1 text-xs font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-slate-600"
            >
              {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
              Check
            </button>
          </div>

          {error && (
            <p role="alert" className="mb-2 text-xs text-red-600 dark:text-red-400">
              {error}
            </p>
          )}

          {result && (
            <div className="space-y-1.5 rounded border border-slate-200 bg-slate-50 p-2 text-xs dark:border-slate-700 dark:bg-slate-800/50">
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-500 dark:text-slate-400">Registered Last PTI</span>
                <span className="font-mono font-semibold">{fmtCstDate(result.lastPtiDate)}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-500 dark:text-slate-400">Last hauled by</span>
                {result.lastHauledTruck ? (
                  <span className="font-mono font-semibold">
                    {result.lastHauledTruck.truck_number}
                    <span className="ml-1 font-sans font-normal text-slate-400">
                      ({fmtCst(result.lastHauledTruck.created_at)})
                    </span>
                  </span>
                ) : (
                  <span className="text-slate-400">no other truck on record</span>
                )}
              </div>
              <button
                type="button"
                disabled={!canApply || applying}
                title={canApply ? "Apply this Last PTI Date to the current ticket" : "Manager only"}
                onClick={apply}
                className="mt-1 flex w-full cursor-pointer items-center justify-center gap-1.5 rounded bg-brand-600 px-2 py-1.5 text-xs font-semibold text-white transition-colors duration-150 hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {applying && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
                Apply to Ticket
              </button>
              {!canApply && (
                <p className="text-center text-[10px] text-slate-400">
                  Manager privileges required to apply this correction.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </span>
  );
}
