export type Role = "employee" | "qc" | "manager";

export type TicketState =
  | "DRAFT"
  | "DRAFT_IN_PROGRESS"
  | "AWAITING_DRIVER"
  | "PENDING_QC"
  | "FLAGGED"
  | "RESOLVED"
  | "APPROVED";

export type TrailerCondition = "Good" | "Fair" | "Damaged";

export type ErrorCategory =
  | "Missing_BOL"
  | "Incorrect_Weight"
  | "Missed_PTI"
  | "Missing_Inspection"
  | "Missing_Sticker"
  | "Missing_Registration"
  | "Missed_KPRA_Reminder"
  | "PTI_Video_Missing_Light_Test"
  | "Didnt_Text_In_Group"
  | "Other";

export const CATEGORY_LABELS: Record<ErrorCategory, string> = {
  Missing_Inspection: "Missing inspection",
  Missing_Sticker: "Missing sticker",
  Missing_Registration: "Missing registration",
  Missed_KPRA_Reminder: "Didn't remind the driver about KPRA law",
  PTI_Video_Missing_Light_Test: "PTI — video wasn't with the light test (didn't inform)",
  Didnt_Text_In_Group: "Didn't text in the group",
  Missing_BOL: "Missing BOL",
  Incorrect_Weight: "Incorrect weight",
  Missed_PTI: "Missed PTI",
  Other: "Other (describe in notes)",
};

export const ERROR_CATEGORIES = Object.keys(CATEGORY_LABELS) as ErrorCategory[];

export type MediaType = "image" | "video";

export interface UserBrief {
  id: string;
  username: string;
}

export interface User extends UserBrief {
  role: Role;
  performance_score: number;
  is_active: boolean;
}

export interface MotorCarrier {
  id: string;
  name: string;
}

export interface MCAdmin {
  id: string;
  name: string;
  api_endpoint: string;
  api_key_masked: string;
}

export interface Trailer {
  id: string;
  trailer_number: string;
  last_pti_date: string;
  is_lot_trailer: boolean;
}

// R25: persistent trailer papers — saved once, reused on every future pickup
export type TrailerDocType = "inspection" | "registration";

export interface TrailerDocument {
  id: string;
  trailer_id: string;
  doc_type: TrailerDocType;
  media_url: string;
  uploaded_by: string;
  created_at: string;
  updated_at: string;
}

// R25: hazmat movement alert pushed over the SSE stream to every user
export interface HazmatAlert {
  type: "hazmat_movement";
  ticket_id: string;
  truck_number: string;
  mc_name: string;
  speed_mph: number;
  location: string | null;
  message: string;
  created_at: string;
}

export interface Telemetry {
  driver_name: string;
  location: string;
  model: string;
  fuel_percentage: number | null;
  latitude: number | null;
  longitude: number | null;
}

export interface FlagMedia {
  id: string;
  media_url: string;
  media_type: MediaType;
  created_at: string;
}

export interface AuditFlag {
  id: string;
  ticket_id: string;
  flagged_by: string;
  error_category: ErrorCategory;
  severity: number | null;
  notes: string | null;
  created_at: string;
  media: FlagMedia[];
}

export interface Ticket {
  id: string;
  created_by: string;
  creator: UserBrief;
  mc_id: string;
  motor_carrier: MotorCarrier;
  truck_number: string;
  is_lot_trailer: boolean;
  trailer_id: string | null;
  // R21: embedded trailer record (LOT tickets) — prefills the edit form
  trailer: Trailer | null;
  state: TicketState;
  driver_name: string | null;
  truck_location: string | null;
  truck_latitude: number | null;
  truck_longitude: number | null;
  truck_model: string | null;
  fuel_percentage: number | null;
  registration_verified: boolean;
  inspection_paper_verified: boolean;
  sticker_verified: boolean;
  is_ca_fl_destination: boolean;
  bol_present: boolean;
  eld_mentioned: boolean;
  checklist_sent: boolean;
  weight: string | null;
  trailer_condition: TrailerCondition | null;
  condition_notes: string | null;
  needs_scale: boolean;
  scale_ticket_received: boolean;
  scale_requested_at: string | null;
  // R21: "Followed up" restarts the visible waiting timer from here
  last_followed_up_at: string | null;
  submitted_to_qc_at: string | null;
  pti_checklist: Record<string, boolean> | null;
  pti_verified: boolean;
  is_urgent_flag: boolean;
  resolved_by: string | null;
  is_unresolvable: boolean;
  unresolvable_reason: string | null;
  is_chassis: boolean;
  // R23: trailer dropped — lifecycle ended, historical views only
  is_dropped: boolean;
  // R25: hazmat load — under continuous Samsara movement watch while active
  is_hazmat: boolean;
  created_at: string;
  updated_at: string;
  audit_flags: AuditFlag[];
  // R20: only populated on GET /api/tickets/qc — historical context card
  last_pti_date: string | null;
}

export type AuditEventType =
  | "TICKET_CREATED"
  | "TICKET_SENT_TO_QC"
  | "TICKET_FLAGGED"
  | "TICKET_RESOLVED"
  | "TICKET_APPROVED"
  | "TICKET_DELETED"
  | "TICKET_UNRESOLVABLE"
  | "TICKET_DROPPED";

/** R23: a pickup still in play — drives the Active sections on My Pickups
 * and All Pickups. Approved-but-missing-scale stays ACTIVE: the approval
 * doesn't end the scale chase. Dropped ends everything. */
export function isActivePickup(t: Ticket): boolean {
  if (t.is_dropped) return false;
  if (t.state === "APPROVED") return t.needs_scale && !t.scale_ticket_received;
  return true;
}

/** R25: value space of the per-tab Status dropdown. DROPPED is a flag, not a
 * lifecycle state, but reads as a status to the user. */
export type StatusFilterValue = "" | TicketState | "DROPPED";

export const STATUS_FILTER_LABELS: Record<Exclude<StatusFilterValue, "">, string> = {
  DRAFT: "Draft",
  DRAFT_IN_PROGRESS: "Still Sending",
  AWAITING_DRIVER: "Awaiting Driver",
  PENDING_QC: "Sent to QC / Pending",
  FLAGGED: "Flagged",
  RESOLVED: "Resolved (back at QC)",
  APPROVED: "Approved",
  DROPPED: "Dropped",
};

export function matchesStatus(t: Ticket, status: StatusFilterValue): boolean {
  if (!status) return true;
  if (status === "DROPPED") return t.is_dropped;
  return t.state === status && !t.is_dropped;
}

export interface FeedEntry {
  id: string;
  ticket_id: string;
  event: AuditEventType;
  actor_username: string;
  employee_username: string;
  truck_number: string;
  mc_name: string;
  message: string;
  created_at: string;
}

export interface QCHistoryItem {
  processed_at: string;
  ticket: Ticket;
}

export type NoteStatus = "DRAFT" | "PUBLISHED" | "RESOLVED";

export interface ShiftNote {
  id: string;
  created_by: string;
  creator: UserBrief;
  content: string;
  truck_number: string | null;
  mc_name: string | null;
  is_auto_generated: boolean;
  status: NoteStatus;
  resolved_by: string | null;
  resolver: UserBrief | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

// R22: ONE consolidated note per truck, listing every missing item
export interface AutoNote {
  ticket_id: string;
  truck_number: string;
  mc_name: string;
  missing_items: string[];
  content: string;
}

export interface LeaderboardEntry {
  rank: number;
  id: string;
  name: string;
  role: "employee" | "qc";
  score: number;
  volume: number;
  accuracy: number;
  efficiency: number;
  avg_time_mins: number | null;
}

export interface EmployeeStats {
  user_id: string;
  username: string;
  performance_score: number;
  completed_daily: number;
  completed_monthly: number;
  completed_all_time: number;
}
