import { create } from "zustand";

/** R41: cross-cutting "unsaved changes" coordination between the New Pickup
 * form and every navigation surface in the app (sidebar links, logout,
 * resume-draft buttons, the form's own Cancel button). The form's ~25 fields
 * stay as local component state (idiomatic for a form this size) — this
 * store exists only for the coordination problem: the sidebar has no idea
 * what's happening inside the currently-mounted page, so the page registers
 * a dirty flag + save/discard callbacks here, and any navigation trigger
 * anywhere in the app calls requestNavigation() instead of navigating
 * directly. Next.js App Router has no built-in navigation blocker (that's a
 * React Router API) — this is the equivalent for this app. */
interface FormGuardState {
  isDirty: boolean;
  /** The navigation the user originally attempted, deferred until they
   *  resolve the modal. Null when no prompt is showing. */
  pendingExecute: (() => void) | null;
  actionBusy: boolean;
  actionError: string | null;
  saveDraft: (() => Promise<void>) | null;
  discard: (() => void) | null;
  setDirty: (dirty: boolean) => void;
  registerHandlers: (handlers: {
    saveDraft: () => Promise<void>;
    discard: () => void;
  }) => void;
  clearHandlers: () => void;
  /** Call before navigating away from a guarded surface. Runs `execute`
   *  immediately (returns true) when nothing is dirty; otherwise defers it
   *  behind the modal (returns false). */
  requestNavigation: (execute: () => void) => boolean;
  resolvePending: (action: "save" | "discard" | "cancel") => Promise<void>;
}

export const useFormGuardStore = create<FormGuardState>((set, get) => ({
  isDirty: false,
  pendingExecute: null,
  actionBusy: false,
  actionError: null,
  saveDraft: null,
  discard: null,

  setDirty: (dirty) => set({ isDirty: dirty }),

  registerHandlers: (handlers) =>
    set({ saveDraft: handlers.saveDraft, discard: handlers.discard }),

  clearHandlers: () =>
    set({
      saveDraft: null,
      discard: null,
      isDirty: false,
      pendingExecute: null,
      actionError: null,
    }),

  requestNavigation: (execute) => {
    if (!get().isDirty) {
      execute();
      return true;
    }
    set({ pendingExecute: execute, actionError: null });
    return false;
  },

  resolvePending: async (action) => {
    const { pendingExecute, saveDraft, discard } = get();

    if (action === "cancel") {
      set({ pendingExecute: null, actionError: null });
      return;
    }
    if (!pendingExecute) return;

    if (action === "save") {
      if (saveDraft) {
        set({ actionBusy: true, actionError: null });
        try {
          await saveDraft();
        } catch (e) {
          set({
            actionBusy: false,
            actionError:
              e instanceof Error ? e.message : "Could not save the draft.",
          });
          return; // keep the modal open — the user can retry or discard/cancel
        }
        set({ actionBusy: false });
      }
    } else if (action === "discard" && discard) {
      discard();
    }

    set({ isDirty: false, pendingExecute: null, actionError: null });
    pendingExecute();
  },
}));
