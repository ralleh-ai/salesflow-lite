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
 *   4. Run the duplicate/conflict check (SPEC §4.2) before inserting — phone
 *      match, then normalized name+zip match against existing Leads.
 *   5. Create new Lead rows with research_status=pending, pipeline_stage=new,
 *      source=discovery. If a duplicate is suspected, still insert (no drops)
 *      but set dupOfLeadId and log `possible_duplicate`, not `discovered`.
 *   6. Check the DoNotContact list (SPEC §6.5) and set dnc=true on insert if
 *      the business matches — the row is still created, just frozen from
 *      automated outreach.
 *   7. Log `discovered` events to History.
 *   8. Respect the configured daily Places API call budget — stop early and
 *      resume next run if the budget is hit; never spend past the cap.
 *   9. On a Google API 429/OVER_QUERY_LIMIT response: back off exponentially
 *      (configurable base/max) and log to Errors, not History — this is
 *      operational, not business data (SPEC §4 step 6).
 *   10. Rotate area+type coverage across runs rather than repeating the same
 *       query every cycle.
 *
 * Manual/import leads (SPEC §4.1, source=manual|import) do not flow through
 * this function — they are inserted directly via SheetsClient.upsertLead by
 * whichever surface handles onboarding/manual entry, but MUST go through the
 * same duplicate-check function this module uses (see checkForDuplicateLead
 * below) so there is exactly one duplicate-detection code path, not two.
 */
import type { Lead } from "../types/domain.js";

/**
 * Shared duplicate/conflict check (SPEC §4.2). Exported so manual/import
 * entry points can call the identical logic discovery uses — duplicate
 * detection must not have a second, divergent implementation.
 *
 * Returns the suspected-duplicate lead's id, or undefined if no match.
 * This is a warning surface only: callers must never auto-merge or
 * auto-drop based on this result.
 */
export function checkForDuplicateLead(
  _candidate: Pick<Lead, "phone" | "businessName" | "address">,
  _existing: Lead[]
): string | undefined {
  throw new Error("checkForDuplicateLead is not yet implemented. See docs/SPEC.md §4.2.");
}

export async function runDiscoverySweep(): Promise<void> {
  throw new Error("runDiscoverySweep is not yet implemented. See docs/SPEC.md §4.");
}
