"use client";

import { useEffect, useState } from "react";

export type TimerTier = "normal" | "warning" | "critical";

export interface TimerInfo {
  minutes: number | null;
  tier: TimerTier;
}

/** R21: the waiting timer starts at scale_requested_at, but a "Followed up"
 * action restarts it — use whichever timestamp is newer. No scale request
 * means no timer, follow-up or not. */
export function getTimerStart(t: {
  scale_requested_at: string | null;
  last_followed_up_at: string | null;
}): string | null {
  if (!t.scale_requested_at) return null;
  if (
    t.last_followed_up_at &&
    new Date(t.last_followed_up_at).getTime() > new Date(t.scale_requested_at).getTime()
  ) {
    return t.last_followed_up_at;
  }
  return t.scale_requested_at;
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
