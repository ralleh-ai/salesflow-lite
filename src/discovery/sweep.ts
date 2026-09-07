/**
 * Discovery loop — lead sourcing via Google Places API.
 * See docs/SPEC.md §4 for the full process specification.
 *
 * NOT YET IMPLEMENTED — stub only.
 *
 * Responsibilities (per spec, do not narrow scope without updating SPEC.md):
 *   1. Read Config (areas × target business types).
 *   2. Call Places API (Nearby/Text Search), paginated.
 *   3. Dedupe on place_id against existing Leads rows.
 *   4. Create new Lead rows with research_status=pending, pipeline_stage=new.
 *   5. Log `discovered` events to History.
 *   6. Respect the configured daily Places API call budget — stop early and
 *      resume next run if the budget is hit; never spend past the cap.
 *   7. Rotate area+type coverage across runs rather than repeating the same
 *      query every cycle.
 */

export async function runDiscoverySweep(): Promise<void> {
  throw new Error("runDiscoverySweep is not yet implemented. See docs/SPEC.md §4.");
}
