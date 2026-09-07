/**
 * Pipeline loop — sales pipeline state machine + AgentMail draft creation.
 * See docs/SPEC.md §6 for the full process specification.
 *
 * NOT YET IMPLEMENTED — stub only.
 *
 * HARD RULE (do not violate, do not make configurable — see docs/SPEC.md §6.3
 * and docs/RECIPE.md §0): this module may only ever call AgentMail's
 * draft/compose endpoint. It must never call, wrap, or expose a send
 * endpoint. Outbound business communication requires a human to press send.
 *
 * Responsibilities (per spec, do not narrow scope without updating SPEC.md):
 *   1. This is the ONLY module permitted to write pipeline_stage.
 *   2. Advance new -> qualifying automatically once research_status=completed.
 *   3. Advance qualifying -> qualified based on product_fit_confidence threshold.
 *   4. On next_action_at due with next_action_type being an outreach action:
 *      create an AgentMail DRAFT (never send), then advance to outreach_attempted.
 *   5. Enforce max-dwell timers per stage; auto-advance per configured rules
 *      rather than leaving a lead stale with a passed next_action_at.
 *   6. `lost` requires an explicit reason code; the cron never invents one —
 *      leads that time out with no reason go to `nurture`, not `lost`.
 *   7. Log every transition (cron- or operator-driven) to History.
 */

export async function runPipelineSweep(): Promise<void> {
  throw new Error("runPipelineSweep is not yet implemented. See docs/SPEC.md §6.");
}
