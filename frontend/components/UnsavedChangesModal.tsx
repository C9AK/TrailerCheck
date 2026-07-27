"use client";

import { AlertTriangle, FileClock, Loader2, LogOut, X } from "lucide-react";

import { useFormGuardStore } from "@/store/formGuardStore";

/** R41: rendered once, globally (dashboard layout), so it can intercept
 * navigation triggered from anywhere — the sidebar, logout, the Active
 * Drafts panel — regardless of which page is currently mounted. */
export default function UnsavedChangesModal() {
  const pendingExecute = useFormGuardStore((s) => s.pendingExecute);
  const actionBusy = useFormGuardStore((s) => s.actionBusy);
  const actionError = useFormGuardStore((s) => s.actionError);
  const resolvePending = useFormGuardStore((s) => s.resolvePending);

  if (!pendingExecute) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="unsaved-changes-title"
      onClick={() => !actionBusy && resolvePending("cancel")}
    >
      <div
        className="w-full max-w-md rounded-lg border-2 border-amber-400 bg-white p-5 shadow-xl dark:border-amber-700 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between">
          <h2
            id="unsaved-changes-title"
            className="flex items-center gap-2 font-mono text-base font-semibold"
          >
            <AlertTriangle className="h-4 w-4 text-amber-600" aria-hidden="true" />
            Unsaved changes
          </h2>
          <button
            type="button"
            aria-label="Cancel"
            onClick={() => resolvePending("cancel")}
            disabled={actionBusy}
            className="cursor-pointer rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-40 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <p className="mb-4 text-sm text-slate-600 dark:text-slate-400">
          You have unsaved changes on the New Pickup form. What would you like to do?
        </p>

        {actionError && (
          <p
            role="alert"
            className="mb-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-950/50 dark:text-red-300"
          >
            {actionError}
          </p>
        )}

        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => resolvePending("save")}
            disabled={actionBusy}
            className="flex cursor-pointer items-center justify-center gap-2 rounded bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {actionBusy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <FileClock className="h-4 w-4" aria-hidden="true" />
            )}
            Save as Draft
          </button>
          <button
            type="button"
            onClick={() => resolvePending("discard")}
            disabled={actionBusy}
            className="flex cursor-pointer items-center justify-center gap-2 rounded border-2 border-red-300 px-4 py-2.5 text-sm font-semibold text-red-700 transition-colors duration-150 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/40"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            Leave (Discard Changes)
          </button>
          <button
            type="button"
            onClick={() => resolvePending("cancel")}
            disabled={actionBusy}
            className="cursor-pointer rounded border border-slate-300 px-4 py-2.5 text-sm font-medium hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            Cancel — stay on this page
          </button>
        </div>
      </div>
    </div>
  );
}
