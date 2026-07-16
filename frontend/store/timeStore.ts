import { create } from "zustand";
import { persist } from "zustand/middleware";

/** R24: how timestamps are DISPLAYED across the app.
 *  - "cst"   — dispatch Central Time (the operational default)
 *  - "local" — the device's own time zone (e.g. Jordan/Lebanon GMT+3)
 *  Display-only: shift definitions and day/shift filters stay CST-based.
 *  Per-device preference, persisted in localStorage. */
export type TimeMode = "cst" | "local";

interface TimeState {
  mode: TimeMode;
  setMode: (mode: TimeMode) => void;
}

export const useTimeStore = create<TimeState>()(
  persist(
    (set) => ({
      mode: "cst",
      setMode: (mode) => set({ mode }),
    }),
    { name: "trailercheck-timezone" }
  )
);
