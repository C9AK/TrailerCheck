"use client";

import { useEffect, useState } from "react";

export type TimerTier = "normal" | "warning" | "critical";

export interface TimerInfo {
  minutes: number | null;
  tier: TimerTier;
}

/** Pure helper so list pages can sort with the same rules the rows render with. */
export function getTimerInfo(scaleRequestedAt: string | null, nowMs: number): TimerInfo {
  if (!scaleRequestedAt) return { minutes: null, tier: "normal" };
  const started = new Date(scaleRequestedAt).getTime();
  if (Number.isNaN(started)) return { minutes: null, tier: "normal" };
  const minutes = Math.max(0, Math.floor((nowMs - started) / 60_000));
  // R2: scale overdue alert at 2 hours (was 1h); critical escalation at 4 hours.
  const tier: TimerTier = minutes >= 240 ? "critical" : minutes >= 120 ? "warning" : "normal";
  return { minutes, tier };
}

/** Re-renders every `intervalMs` so elapsed times stay fresh. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** Compares current time against scale_requested_at (04-Frontend-UI-UX-Spec §3). */
export function useTicketTimer(scaleRequestedAt: string | null): TimerInfo {
  const now = useNow();
  return getTimerInfo(scaleRequestedAt, now);
}
