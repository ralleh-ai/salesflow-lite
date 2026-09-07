/**
 * Pipeline loop — sales pipeline state machine + email draft creation.
 * See docs/SPEC.md §6 for the full process specification.
 *
 * NOT YET IMPLEMENTED — stub only.
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
import type { EmailDraftClient } from "../agentmail/client.js";
import type { Lead } from "../types/domain.js";

export async function runPipelineSweep(_emailClient: EmailDraftClient): Promise<void> {
  throw new Error("runPipelineSweep is not yet implemented. See docs/SPEC.md §6.");
}

/**
 * Pure predicate: should this lead's auto-advance/follow-up logic be skipped
 * this run? True when dnc is set or snoozeUntil is a future timestamp.
 * Kept as a standalone pure function (no I/O) so it's unit-testable without
 * mocking Sheets/email clients — the pipeline sweep's control flow should
 * call this first, before any stage-transition logic.
 */
export function shouldSkipAutoAdvance(
  _lead: Pick<Lead, "dnc" | "snoozeUntil">,
  _nowIso: string
): boolean {
  throw new Error("shouldSkipAutoAdvance is not yet implemented. See docs/SPEC.md §6.2a/§6.5.");
}
