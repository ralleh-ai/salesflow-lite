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

export type LostReason = "no_budget" | "not_interested" | "unreachable" | "wrong_fit" | (string & {});

export type HistoryActor = "discovery_cron" | "research_cron" | "pipeline_cron" | "operator" | "system";

export type HistoryEventType =
  | "discovered"
  | "research_updated"
  | "stage_transition"
  | "notification_sent"
  | "outreach_draft_created"
  | "manual_edit";

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
  discoveredAt: string;
  lastTouchedAt: string;
  notes?: string;
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
