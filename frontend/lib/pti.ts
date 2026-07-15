/** R8 structured PTI checklist — mirrors backend app/services/pti.py. */

export type PtiChecklist = Record<string, boolean>;

export interface PtiRow {
  label: string;
  /** single-checkbox item key */
  key?: string;
  /** Left/Right pair base key -> `${pair}_left` / `${pair}_right` */
  pair?: string;
  optional?: boolean;
}

export interface PtiSection {
  title: string;
  rows: PtiRow[];
  /** R12: section only applies (and is only required) when is_chassis */
  chassisOnly?: boolean;
}

export const PTI_SECTIONS: PtiSection[] = [
  {
    title: "Trailer",
    rows: [
      { label: "Side DOT Tape", key: "side_dot_tape" },
      { label: "Rear DOT Tape", key: "rear_dot_tape" },
      { label: "No Placards Attached", key: "no_placards_attached" },
      { label: "Movable Mudflap", pair: "movable_mudflap" },
      { label: "Tires and Rims", key: "tires_and_rims" },
      { label: "Brakes and Suspension", key: "brakes_and_suspension" },
      { label: "Airlines", key: "airlines" },
    ],
  },
  {
    title: "Lights",
    rows: [
      { label: "Front Clearance Light", pair: "front_clearance_light" },
      { label: "Side Marker Light", pair: "side_marker_light" },
      { label: "Side Clearance Light", pair: "side_clearance_light" },
      { label: "ABS Light", key: "abs_light" },
      { label: "Turn Signal Light", pair: "turn_signal_light" },
      { label: "Brake Light", pair: "brake_light" },
      { label: "Plate Light", key: "plate_light" },
      { label: "3 Middle Rear ID Lights", key: "three_middle_rear_id_lights" },
      {
        label: "2 Corner Rear ID Lights",
        pair: "two_corner_rear_id_lights",
        optional: true,
      },
    ],
  },
  {
    title: "Chassis",
    chassisOnly: true,
    rows: [
      { label: 'Locks are in "Lock" Position (Horizontal)', key: "locks_horizontal" },
      { label: "Zip Ties on Locks", key: "zip_ties_on_locks" },
    ],
  },
];

export function allPtiKeys(): string[] {
  const keys: string[] = [];
  for (const section of PTI_SECTIONS) {
    for (const row of section.rows) {
      if (row.key) keys.push(row.key);
      if (row.pair) keys.push(`${row.pair}_left`, `${row.pair}_right`);
    }
  }
  return keys;
}

export function emptyChecklist(): PtiChecklist {
  return Object.fromEntries(allPtiKeys().map((k) => [k, false]));
}

/** R18: human labels for every checklist key — powers QC's read-only log. */
export function ptiKeyLabels(): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const section of PTI_SECTIONS) {
    for (const row of section.rows) {
      if (row.key) labels[row.key] = row.label;
      if (row.pair) {
        labels[`${row.pair}_left`] = `${row.label} (L)`;
        labels[`${row.pair}_right`] = `${row.label} (R)`;
      }
    }
  }
  return labels;
}

/** Mirrors backend compute_pti_verified: all required checked; the optional
 * corner-lights pair must be both-or-none; chassis-only sections count only
 * when isChassis (R12). */
export function isPtiComplete(checklist: PtiChecklist, isChassis: boolean): boolean {
  for (const section of PTI_SECTIONS) {
    if (section.chassisOnly && !isChassis) continue;
    for (const row of section.rows) {
      if (row.key && !row.optional && !checklist[row.key]) return false;
      if (row.pair) {
        const left = Boolean(checklist[`${row.pair}_left`]);
        const right = Boolean(checklist[`${row.pair}_right`]);
        if (row.optional) {
          if (left !== right) return false;
        } else if (!(left && right)) {
          return false;
        }
      }
    }
  }
  return true;
}
