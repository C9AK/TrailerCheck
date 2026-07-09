"use client";

import { Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * Intentional Friction (04-Frontend-UI-UX-Spec §4):
 * approval never fires directly — the QC user must tick all 3 verification
 * checkboxes before "Confirm Approval" becomes enabled.
 */
const FRICTION_CHECKS = [
  "Data matches Samsara/Telematics",
  "Weights are within legal bounds",
  "Documentation is visually confirmed",
];

export default function ConfirmationModal({
  open,
  truckNumber,
  busy,
  onConfirm,
  onClose,
}: {
  open: boolean;
  truckNumber: string;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const [checks, setChecks] = useState<boolean[]>(FRICTION_CHECKS.map(() => false));

  // Every open starts from zero — the friction is the point.
  useEffect(() => {
    if (open) setChecks(FRICTION_CHECKS.map(() => false));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  if (!open) return null;

  const allChecked = checks.every(Boolean);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="approve-modal-title"
      onClick={() => !busy && onClose()}
    >
      <div
        className="w-full max-w-md rounded-lg border border-blue-100 bg-white p-5 shadow-xl dark:border-slate-700 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between">
          <h2 id="approve-modal-title" className="font-mono text-base font-semibold">
            Approve ticket — {truckNumber}
          </h2>
          <button
            type="button"
            aria-label="Cancel approval"
            onClick={onClose}
            disabled={busy}
            className="cursor-pointer rounded p-1 text-slate-500 transition-colors duration-150 hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <p className="mb-4 text-sm text-slate-600 dark:text-slate-400">
          Confirm each verification before approving. All three are required.
        </p>

        <div className="space-y-2.5">
          {FRICTION_CHECKS.map((label, i) => (
            <label
              key={label}
              className="flex cursor-pointer items-center gap-2.5 rounded border border-slate-200 px-3 py-2.5 text-sm transition-colors duration-150 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
            >
              <input
                type="checkbox"
                checked={checks[i]}
                onChange={(e) =>
                  setChecks((prev) => prev.map((v, j) => (j === i ? e.target.checked : v)))
                }
                className="h-4 w-4 accent-brand-600"
              />
              {label}
            </label>
          ))}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="cursor-pointer rounded border border-slate-300 px-4 py-2 text-sm font-medium transition-colors duration-150 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!allChecked || busy}
            className="flex cursor-pointer items-center gap-2 rounded bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors duration-150 hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Confirm Approval
          </button>
        </div>
      </div>
    </div>
  );
}
