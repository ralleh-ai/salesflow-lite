/**
 * Research loop — lead enrichment (website scrape, email/phone/socials
 * extraction, LLM categorization, completeness scoring).
 * See docs/SPEC.md §5 for the full process specification.
 *
 * NOT YET IMPLEMENTED — stub only.
 *
 * Responsibilities (per spec, do not narrow scope without updating SPEC.md):
 *   1. Process leads with research_status in {pending, in_progress}, oldest first.
 *   2. Scrape website (home + contact/about) for email, phone, socials, description.
 *   3. If no website, attempt a web search to find one before giving up on that field.
 *   4. Run LLM categorization against Categories_Reference -> product_fit_*.
 *   5. Recompute research_score (see SPEC.md §5.2 weights).
 *   6. On score >= completion threshold: mark research_status=completed.
 *   7. On repeated failure to improve score past maxResearchAttempts: mark
 *      research_status=failed_permanent with a reason — never delete, never
 *      silently drop (see docs/SPEC.md "no drops" principle).
 *   8. Log research_updated events to History with what changed.
 *
 * This loop never mutates dnc, snoozeUntil, or dupOfLeadId — those are
 * discovery/pipeline/operator-owned fields respectively (SPEC §3.1).
 */
import type { Lead } from "../types/domain.js";

export async function runResearchPass(): Promise<void> {
  throw new Error("runResearchPass is not yet implemented. See docs/SPEC.md §5.");
}

/** Recomputes the 0–100 research completeness score per the weights in SPEC.md §5.2. Pure function, no I/O, so it's independently testable. */
export function computeResearchScore(
  _lead: Pick<Lead, "website" | "email" | "phone" | "socials" | "productFitConfidence">
): number {
  throw new Error("computeResearchScore is not yet implemented. See docs/SPEC.md §5.2.");
}
