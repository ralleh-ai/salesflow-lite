/**
 * Pipeline loop — sales pipeline state machine + email draft creation.
 * See docs/SPEC.md §6 for the full process specification.
 *
 * HARD RULE (do not violate, do not make configurable — see docs/SPEC.md §6.3/§6.4
 * and docs/RECIPE.md §0): this module may only ever call the configured email
 * provider's draft/compose endpoint (src/agentmail/client.ts's EmailDraftClient).
 * It must never call, wrap, or expose a send endpoint. Outbound business
 * communication requires a human to press send.
 *
 * Responsibilities (per spec, do not narrow scope without updating SPEC.md):
 *   1. This is the ONLY module permitted to write pipeline_stage.
 *   2. Advance new -> qualifying automatically once research_status=completed.
 *   3. Advance qualifying -> qualified based on product_fit_confidence threshold.
 *   4. Before any outreach action: check dnc (SPEC §6.5) and refuse to create
 *      a draft if set, logging `dnc_blocked` instead — this check happens
 *      even if the lead reached this stage before being added to DNC.
 *   5. Skip (do not touch pipeline_stage/next_action_at for) any lead whose
 *      snoozeUntil is set and in the future — log `snoozed_skip`, not an error
 *      (SPEC §6.2a). This check runs before dwell-timer/auto-advance logic.
 *   6. On next_action_at due with next_action_type being an outreach action:
 *      create an email DRAFT via EmailDraftClient (never send), attach any
 *      Drive collateral mapped for this category/stage (SPEC §3.7, as a
 *      shareable link by default), log to History AND Comms_Threads
 *      (SPEC §3.6), then advance to outreach_attempted.
 *   7. Enforce max-dwell timers per stage; auto-advance per configured rules
 *      rather than leaving a lead stale with a passed next_action_at.
 *   8. `lost` requires an explicit reason code; the cron never invents one —
 *      leads that time out with no reason go to `nurture`, not `lost`.
 *   9. Log every transition (cron- or operator-driven) to History.
 */
import { randomUUID } from "node:crypto";
import type { EmailDraftClient } from "../agentmail/client.js";
import type { CollateralMappingConfig } from "../config/schema.js";
import type { Lead, PipelineStage } from "../types/domain.js";
import type { SheetsClient } from "../sheets/client.js";

/** Default max-dwell time (hours) per non-terminal stage before the cron auto-advances a stale lead (SPEC §6.2). Config may override per install in a future round; kept as a single shipped default table for v1. */
const DEFAULT_MAX_DWELL_HOURS: Partial<Record<PipelineStage, number>> = {
  qualifying: 24,
  qualified: 48,
  outreach_attempted: 96,
  engaged: 168,
  meeting_scheduled: 336,
  proposal_sent: 336
};

/** Product-fit confidence threshold for qualifying -> qualified (SPEC §6.1 step 3). */
const QUALIFIED_CONFIDENCE_THRESHOLD = 0.6;

/**
 * Pure predicate: should this lead's auto-advance/follow-up logic be skipped
 * this run? True when dnc is set or snoozeUntil is a future timestamp.
 * Kept as a standalone pure function (no I/O) so it's unit-testable without
 * mocking Sheets/email clients — the pipeline sweep's control flow should
 * call this first, before any stage-transition logic.
 */
export function shouldSkipAutoAdvance(
  lead: Pick<Lead, "dnc" | "snoozeUntil">,
  nowIso: string
): boolean {
  if (lead.dnc) return true;
  if (lead.snoozeUntil && lead.snoozeUntil > nowIso) return true;
  return false;
}

/** Finds the best-matching collateral for a lead's current product-fit category and pipeline stage (SPEC §3.7). Pure — no Drive I/O, just table lookup. */
export function resolveCollateralLinks(
  lead: Pick<Lead, "productFitCategory" | "pipelineStage">,
  collateralMap: CollateralMappingConfig[]
): string[] {
  return collateralMap
    .filter((entry) => {
      const categoryMatches =
        !entry.productFitCategory || entry.productFitCategory === lead.productFitCategory;
      const stageMatches = !entry.attachToStage || entry.attachToStage.includes(lead.pipelineStage);
      return categoryMatches && stageMatches;
    })
    .map((entry) => `https://drive.google.com/file/d/${entry.driveFileId}/view`);
}

function hoursSince(isoTimestamp: string, nowIso: string): number {
  return (new Date(nowIso).getTime() - new Date(isoTimestamp).getTime()) / (1000 * 60 * 60);
}

function buildOutreachSubjectAndBody(lead: Lead): { subject: string; bodyText: string } {
  const category = lead.productFitCategory ?? "our services";
  return {
    subject: `${lead.businessName} — quick note about ${category}`,
    bodyText: [
      `Hi ${lead.businessName} team,`,
      "",
      `I wanted to reach out because you may be a great fit for our ${category} offering.`,
      lead.productFitRationale ? lead.productFitRationale : "",
      "",
      "Happy to share more details or answer any questions.",
      "",
      "Best,"
    ]
      .filter(Boolean)
      .join("\n")
  };
}

export interface PipelineSweepDeps {
  sheets: SheetsClient;
  emailClient: EmailDraftClient;
  nowIso?: () => string;
}

/**
 * Runs one pipeline sweep across all leads, advancing pipeline_stage per the
 * state machine rules in SPEC §6. This is the only module permitted to
 * write pipeline_stage (SPEC §6 responsibility 1).
 */
export async function runPipelineSweep(deps: PipelineSweepDeps): Promise<void> {
  const { sheets, emailClient } = deps;
  const nowIso = deps.nowIso ?? (() => new Date().toISOString());
  const now = nowIso();
  const [config, allLeads, dncList] = await Promise.all([
    sheets.getConfig(),
    sheets.getLeads(),
    sheets.getDoNotContactList()
  ]);

  // Sync Leads.dnc from the DoNotContact source of truth (SPEC §6.5) before
  // any transition logic runs, so a lead added to DNC after discovery is
  // still caught this run.
  const dncPhones = new Set(
    dncList.filter((e) => e.matchedField === "phone").map((e) => e.matchedValue)
  );
  const dncEmails = new Set(
    dncList.filter((e) => e.matchedField === "email").map((e) => e.matchedValue)
  );
  const dncNames = new Set(
    dncList.filter((e) => e.matchedField === "business_name").map((e) => e.matchedValue)
  );

  for (const lead of allLeads) {
    const matchesDnc =
      (lead.phone && dncPhones.has(lead.phone)) ||
      (lead.email && dncEmails.has(lead.email)) ||
      dncNames.has(lead.businessName);
    if (matchesDnc && !lead.dnc) {
      lead.dnc = true;
      lead.lastTouchedAt = now;
      await sheets.upsertLead(lead);
    }

    if (shouldSkipAutoAdvance(lead, now)) {
      if (lead.snoozeUntil && lead.snoozeUntil > now) {
        await sheets.appendHistoryEvent({
          eventId: randomUUID(),
          leadId: lead.leadId,
          timestamp: now,
          actor: "pipeline_cron",
          eventType: "stage_transition",
          detail: `snoozed_skip until ${lead.snoozeUntil}`
        });
      }
      continue;
    }

    const priorStage = lead.pipelineStage;
    let stageChanged = false;

    // Step 2: new -> qualifying once research_status=completed.
    if (lead.pipelineStage === "new" && lead.researchStatus === "completed") {
      lead.pipelineStage = "qualifying";
      lead.pipelineStageSince = now;
      stageChanged = true;
    }

    // Step 3: qualifying -> qualified based on product_fit_confidence threshold.
    if (
      lead.pipelineStage === "qualifying" &&
      (lead.productFitConfidence ?? 0) >= QUALIFIED_CONFIDENCE_THRESHOLD
    ) {
      lead.pipelineStage = "qualified";
      lead.pipelineStageSince = now;
      lead.nextActionAt = now;
      lead.nextActionType = "send_intro_email";
      stageChanged = true;
    }

    // Step 6: due outreach action -> create draft, advance to outreach_attempted.
    const isOutreachDue =
      lead.nextActionAt !== undefined &&
      lead.nextActionAt <= now &&
      (lead.nextActionType === "send_intro_email" ||
        lead.nextActionType === "send_follow_up_email");

    if (isOutreachDue) {
      if (lead.dnc) {
        await sheets.appendHistoryEvent({
          eventId: randomUUID(),
          leadId: lead.leadId,
          timestamp: now,
          actor: "pipeline_cron",
          eventType: "stage_transition",
          detail: "dnc_blocked: refused to create outreach draft for a do-not-contact lead"
        });
      } else if (!lead.email) {
        // No drops: reschedule rather than silently skip a lead with no
        // email yet — research may still be in progress or failed_permanent.
        lead.nextActionAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        await sheets.appendError({
          timestamp: now,
          component: "pipeline_cron",
          leadId: lead.leadId,
          errorType: "missing_email_for_outreach",
          message: "Outreach action was due but the lead has no email on file; rescheduled +24h.",
          retryCount: 0
        });
      } else {
        try {
          const collateralLinks = resolveCollateralLinks(lead, config.templateCollateralMap);
          const { subject, bodyText } = buildOutreachSubjectAndBody(lead);
          const draft = await emailClient.createDraft({
            toEmail: lead.email,
            subject,
            bodyText,
            leadId: lead.leadId,
            collateralLinks
          });

          lead.pipelineStage = "outreach_attempted";
          lead.pipelineStageSince = now;
          delete lead.nextActionAt;
          delete lead.nextActionType;
          stageChanged = true;

          await sheets.appendHistoryEvent({
            eventId: randomUUID(),
            leadId: lead.leadId,
            timestamp: now,
            actor: "pipeline_cron",
            eventType: "outreach_draft_created",
            toValue: "outreach_attempted",
            detail: `draft_id=${draft.draftId}${draft.threadId ? ` thread_id=${draft.threadId}` : ""}`
          });

          const commsEvent: Parameters<typeof sheets.appendCommsThreadEvent>[0] = {
            threadEventId: randomUUID(),
            leadId: lead.leadId,
            channel: "email",
            direction: "outbound",
            timestamp: now,
            subject,
            summary: `Draft created: ${subject}`,
            bodyRef: draft.draftId,
            loggedBy: "pipeline_cron"
          };
          if (draft.threadId !== undefined) commsEvent.externalThreadId = draft.threadId;
          await sheets.appendCommsThreadEvent(commsEvent);
        } catch (err) {
          await sheets.appendError({
            timestamp: now,
            component: "pipeline_cron",
            leadId: lead.leadId,
            errorType: "draft_creation_failed",
            message: err instanceof Error ? err.message : String(err),
            retryCount: 0
          });
          // No drops: reschedule for retry rather than leaving next_action_at
          // stale (SPEC §6.3's "never silently marked done" rule).
          lead.nextActionAt = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
        }
      }
    }

    // Step 7: dwell-timer auto-advance for stages with a configured max dwell.
    const maxDwellHours = DEFAULT_MAX_DWELL_HOURS[lead.pipelineStage];
    if (
      maxDwellHours !== undefined &&
      !stageChanged &&
      hoursSince(lead.pipelineStageSince, now) >= maxDwellHours
    ) {
      // SPEC §6.2 step 8: the cron never invents a `lost` reason. A stale
      // lead with no explicit reason goes to `nurture`, not `lost`.
      lead.pipelineStage = "nurture";
      lead.pipelineStageSince = now;
      lead.nextActionAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      lead.nextActionType = "manual_review";
      stageChanged = true;
    }

    if (stageChanged || lead.dnc !== undefined) {
      lead.lastTouchedAt = now;
      await sheets.upsertLead(lead);
    }

    if (stageChanged) {
      await sheets.appendHistoryEvent({
        eventId: randomUUID(),
        leadId: lead.leadId,
        timestamp: now,
        actor: "pipeline_cron",
        eventType: "stage_transition",
        fromValue: priorStage,
        toValue: lead.pipelineStage
      });
    }
  }
}
