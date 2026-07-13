export type Role = "employee" | "qc" | "manager";

export type TicketState =
  | "DRAFT"
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
  weight: string | null;
  trailer_condition: TrailerCondition | null;
  condition_notes: string | null;
  needs_scale: boolean;
  scale_ticket_received: boolean;
  scale_requested_at: string | null;
  submitted_to_qc_at: string | null;
  pti_checklist: Record<string, boolean> | null;
  pti_verified: boolean;
  is_urgent_flag: boolean;
  resolved_by: string | null;
  is_unresolvable: boolean;
  unresolvable_reason: string | null;
  is_chassis: boolean;
  created_at: string;
  updated_at: string;
  audit_flags: AuditFlag[];
}

export type AuditEventType =
  | "TICKET_CREATED"
  | "TICKET_SENT_TO_QC"
  | "TICKET_FLAGGED"
  | "TICKET_RESOLVED"
  | "TICKET_APPROVED"
  | "TICKET_DELETED"
  | "TICKET_UNRESOLVABLE";

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

export interface AutoNote {
  truck_number: string;
  mc_name: string;
  missing_item: string;
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
