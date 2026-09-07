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
 */

export async function runResearchPass(): Promise<void> {
  throw new Error("runResearchPass is not yet implemented. See docs/SPEC.md §5.");
}
