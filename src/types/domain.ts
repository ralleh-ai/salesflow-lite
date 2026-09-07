/**
 * SalesFlow-Lite — shared domain types.
 * Mirrors the Google Sheets schema defined in docs/SPEC.md §3.
 * These types are the contract between all modules (sheets, discovery,
 * research, pipeline) — update SPEC.md and this file together.
 */

export type ResearchStatus = "pending" | "in_progress" | "completed" | "failed_permanent";

export type PipelineStage =
  | "new"
  | "qualifying"
  | "qualified"
  | "outreach_attempted"
  | "engaged"
  | "meeting_scheduled"
  | "proposal_sent"
  | "won"
  | "lost"
  | "nurture";

export type LostReason =
  "no_budget" | "not_interested" | "unreachable" | "wrong_fit" | (string & {});

export type HistoryActor =
  "discovery_cron" | "research_cron" | "pipeline_cron" | "operator" | "system";

export type HistoryEventType =
  | "discovered"
  | "research_updated"
  | "stage_transition"
  | "notification_sent"
  | "outreach_draft_created"
  | "manual_edit"
  | "digest_sent";

export type CommsChannel = "email" | "call" | "sms" | "in_person" | "other";
export type CommsDirection = "outbound" | "inbound";
export type CommsLoggedBy = "pipeline_cron" | "operator" | "system";
export type CommsSentiment = "positive" | "neutral" | "negative" | "unclear";

export type LeadSource = "discovery" | "manual" | "import";

export type DncMatchedField = "phone" | "email" | "domain" | "business_name";
export type DncReason = "operator_added" | "unsubscribe_request" | "bounced_hard" | "legal_request";

export type NotificationChannelKind =
  "telegram" | "email" | "sms" | "discord" | "slack" | "webhook" | "none";

/** One row logged whenever a notification or digest is actually dispatched. See docs/SPEC.md §7.3. */
export interface NotificationLogEntry {
  logId: string;
  timestamp: string;
  kind: "event" | "digest";
  eventType?: HistoryEventType | "digest";
  destinationName: string;
  channel: NotificationChannelKind;
  status: "sent" | "skipped_quiet_hours" | "failed";
  detail?: string;
}

/** One row in the `Leads` tab. See docs/SPEC.md §3.1 for authoritative field semantics. */
export interface Lead {
  leadId: string;
  placeId: string;
  businessName: string;
  categoryRaw: string;
  address: string;
  lat: number;
  lng: number;
  phone?: string;
  website?: string;
  email?: string;
  socials?: string;
  researchScore: number;
  researchStatus: ResearchStatus;
  productFitCategory?: string;
  productFitConfidence?: number;
  productFitRationale?: string;
  pipelineStage: PipelineStage;
  pipelineStageSince: string;
  nextActionAt?: string;
  nextActionType?: string;
  owner?: string;
  sourceQuery: string;
  source: LeadSource;
  discoveredAt: string;
  lastTouchedAt: string;
  notes?: string;
  /** Do-not-contact flag, cached from the `DoNotContact` tab. See docs/SPEC.md §6.5. */
  dnc: boolean;
  /** Operator-set follow-up suppression override. See docs/SPEC.md §6.2a. */
  snoozeUntil?: string;
  /** Set by duplicate detection when this row is a suspected re-discovery of another lead. See docs/SPEC.md §4.2. Never auto-merged. */
  dupOfLeadId?: string;
}

/** One row in the `History` tab (append-only). See docs/SPEC.md §3.2. */
export interface HistoryEvent {
  eventId: string;
  leadId: string;
  timestamp: string;
  actor: HistoryActor;
  eventType: HistoryEventType;
  fromValue?: string;
  toValue?: string;
  detail?: string;
}

/** One row in the `Errors` tab. See docs/SPEC.md §3.5. */
export interface ErrorRecord {
  timestamp: string;
  component: string;
  leadId?: string;
  errorType: string;
  message: string;
  retryCount: number;
}

/** A single product/service catalog entry from `Categories_Reference`. See docs/SPEC.md §3.4. */
export interface CategoryReference {
  productCategory: string;
  typicalBusinessTypes: string[];
  pitchNotes: string;
}

/** One row in the `Comms_Threads` tab (append-only, per-lead conversation history). See docs/SPEC.md §3.6. */
export interface CommsThreadEvent {
  threadEventId: string;
  leadId: string;
  channel: CommsChannel;
  direction: CommsDirection;
  timestamp: string;
  subject?: string;
  summary: string;
  bodyRef?: string;
  externalThreadId?: string;
  loggedBy: CommsLoggedBy;
  sentiment?: CommsSentiment;
}

/** One entry in the `Config` tab's Template & Collateral Map. See docs/SPEC.md §3.7. */
export interface CollateralMapping {
  productFitCategory?: string;
  collateralName: string;
  driveFileId: string;
  attachToStage?: PipelineStage[];
}

/** One row in the `DoNotContact` tab (source of truth for the `dnc` flag on `Leads`). See docs/SPEC.md §6.5. */
export interface DoNotContactEntry {
  dncId: string;
  matchedField: DncMatchedField;
  matchedValue: string;
  reason: DncReason;
  addedAt: string;
  addedBy: string;
}
