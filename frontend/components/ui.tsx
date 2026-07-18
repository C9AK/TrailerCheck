"use client";

import {
  STATUS_FILTER_LABELS,
  type StatusFilterValue,
  type TicketState,
} from "@/lib/types";

export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded bg-slate-200 dark:bg-slate-700 ${className}`}
      aria-hidden="true"
    />
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  id,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  id: string;
}) {
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-800 focus-visible:ring-offset-2 ${
        checked ? "bg-brand-600" : "bg-slate-300 dark:bg-slate-600"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200 ${
          checked ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}

const STATE_STYLES: Record<TicketState, string> = {
  DRAFT: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  DRAFT_IN_PROGRESS:
    "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
  AWAITING_DRIVER: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  PENDING_QC: "bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-200",
  FLAGGED: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  RESOLVED: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300",
  APPROVED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
};

export function StateBadge({ state, dropped }: { state: TicketState; dropped?: boolean }) {
  // R23: dropped overrides the state display — the lifecycle is over
  if (dropped) {
    return (
      <span className="inline-flex items-center rounded bg-slate-700 px-2 py-0.5 font-mono text-xs font-semibold text-slate-100 dark:bg-slate-600">
        DROPPED
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 font-mono text-xs font-semibold ${STATE_STYLES[state]}`}
    >
      {state === "DRAFT_IN_PROGRESS" ? "STILL SENDING" : state.replace(/_/g, " ")}
    </span>
  );
}

/** R25: hazmat marker — the load is (or was) under Samsara movement watch. */
export function HazmatBadge() {
  return (
    <span
      title="Hazmat load — UGL does not haul hazmat; movement alerts are armed"
      className="inline-flex items-center rounded bg-orange-600 px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wide text-white"
    >
      ☣ Hazmat
    </span>
  );
}

/** R25: per-tab Status dropdown — refine any pickup list by lifecycle state. */
export function StatusFilter({
  value,
  onChange,
  options,
}: {
  value: StatusFilterValue;
  onChange: (v: StatusFilterValue) => void;
  options: Exclude<StatusFilterValue, "">[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as StatusFilterValue)}
      aria-label="Filter by status"
      className="rounded border border-slate-300 bg-white px-2.5 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
    >
      <option value="">All statuses</option>
      {options.map((s) => (
        <option key={s} value={s}>
          {STATUS_FILTER_LABELS[s]}
        </option>
      ))}
    </select>
  );
}

export function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/50 dark:text-red-300"
    >
      {message}
    </div>
  );
}

export function SuccessBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div
      role="status"
      className="rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
    >
      {message}
    </div>
  );
}
