/** R17: dispatch runs strictly on Central Time (America/Chicago).
 *  The backend stores UTC; EVERYTHING rendered goes through these helpers. */

export const DISPATCH_TZ = "America/Chicago";

const dateTimeFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: DISPATCH_TZ,
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const fullDateTimeFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: DISPATCH_TZ,
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const timeFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: DISPATCH_TZ,
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
});

/** "Jul 15, 3:42 PM" in Central Time. */
export function fmtCst(iso: string | Date): string {
  return dateTimeFmt.format(typeof iso === "string" ? new Date(iso) : iso);
}

/** "Jul 15, 2026, 3:42 PM" in Central Time (history/archive rows). */
export function fmtCstFull(iso: string | Date): string {
  return fullDateTimeFmt.format(typeof iso === "string" ? new Date(iso) : iso);
}

/** "3:42:07 PM" in Central Time (live "updated" stamps). */
export function fmtCstTime(iso: string | Date): string {
  return timeFmt.format(typeof iso === "string" ? new Date(iso) : iso);
}

// ---------------------------------------------------------------------------
// Shift bucketing (Central Time):
//   First  01:00–09:00 · Main 09:00–17:00 · Third 17:00–01:00 (spans midnight)
// A ticket between midnight and 1 AM belongs to the PREVIOUS day's Third shift.
// ---------------------------------------------------------------------------

export type Shift = "first" | "main" | "third";

export const SHIFT_LABELS: Record<Shift, string> = {
  first: "First (1 AM–9 AM)",
  main: "Main (9 AM–5 PM)",
  third: "Third (5 PM–1 AM)",
};

const partsFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: DISPATCH_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Central-time calendar date ("YYYY-MM-DD") and hour for a UTC timestamp. */
export function cstParts(iso: string): { date: string; hour: number } {
  const parts = Object.fromEntries(
    partsFmt.formatToParts(new Date(iso)).map((p) => [p.type, p.value])
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
  };
}

/** Which shift a timestamp falls in, plus its OPERATIONAL date —
 *  00:00–01:00 counts as the previous day's Third shift. */
export function shiftOf(iso: string): { shift: Shift; shiftDate: string } {
  const { date, hour } = cstParts(iso);
  if (hour >= 1 && hour < 9) return { shift: "first", shiftDate: date };
  if (hour >= 9 && hour < 17) return { shift: "main", shiftDate: date };
  if (hour >= 17) return { shift: "third", shiftDate: date };
  // 00:00–00:59 → previous day's third shift
  const d = new Date(`${date}T12:00:00Z`); // noon avoids DST edge shifts
  d.setUTCDate(d.getUTCDate() - 1);
  return { shift: "third", shiftDate: d.toISOString().slice(0, 10) };
}

/** Day + shift filter used by All Pickups / Carryover / QC Review.
 *  Day matches the OPERATIONAL date (so 12:30 AM belongs to yesterday's
 *  Third shift day); empty filter values match everything. */
export function matchesDayShift(iso: string, day: string, shift: Shift | ""): boolean {
  if (!day && !shift) return true;
  const s = shiftOf(iso);
  if (shift && s.shift !== shift) return false;
  if (day) {
    // With no shift selected, match the plain Central calendar date too so
    // a "day" filter alone behaves like a normal datepicker.
    if (!shift) return s.shiftDate === day || cstParts(iso).date === day;
    return s.shiftDate === day;
  }
  return true;
}

/** Case-insensitive truck-number / MC-name search used by the list pages. */
export function matchesSearch(
  t: { truck_number: string; motor_carrier: { name: string } },
  query: string
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    t.truck_number.toLowerCase().includes(q) ||
    t.motor_carrier.name.toLowerCase().includes(q)
  );
}
