/**
 * Discovery loop — lead sourcing via Google Places API.
 * See docs/SPEC.md §4 for the full process specification.
 *
 * Responsibilities (per spec, do not narrow scope without updating SPEC.md):
 *   1. Read Config (areas x target business types).
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
 *
 * ZIP-code geography (Rick's decision, 2026-09-07, docs/SPEC.md §3.4a): each
 * configured geography is a single US ZIP code. The Places API search radius
 * below is a fixed operational default, not per-geography-tunable, so
 * discovery cost stays predictable across every install regardless of how
 * an operator describes their service area — broader coverage is achieved
 * by adding more ZIP codes to Config.geographies, not by widening this value.
 */
import { randomUUID } from "node:crypto";
import type { Geography } from "../config/schema.js";
import type { DoNotContactEntry, Lead } from "../types/domain.js";
import type { SheetsClient } from "../sheets/client.js";

/** Fixed operational default search radius (meters) for a ZIP-anchored Places search. See module docstring / docs/SPEC.md §3.4a. */
export const DISCOVERY_SEARCH_RADIUS_METERS = 8000;

/** Base/max backoff (ms) for Google Places 429/OVER_QUERY_LIMIT responses (SPEC §4 step 6). */
const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 32000;
const BACKOFF_MAX_ATTEMPTS = 6;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Strips formatting and returns the last 10 digits of a phone number, for US-number comparison (SPEC §4.2). Returns undefined if fewer than 10 digits remain. */
function normalizePhone(phone: string | undefined): string | undefined {
  if (!phone) return undefined;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10) return undefined;
  return digits.slice(-10);
}

/** Lowercases, strips common legal suffixes and punctuation, for fuzzy business-name comparison (SPEC §4.2). */
function normalizeBusinessName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(llc|inc|incorporated|corp|corporation|co)\b\.?/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Extracts a 5-digit US ZIP from a formatted address string, if present. */
function extractZip(address: string): string | undefined {
  const match = address.match(/\b(\d{5})(-\d{4})?\b/);
  return match ? match[1] : undefined;
}

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
  candidate: Pick<Lead, "phone" | "businessName" | "address">,
  existing: Lead[]
): string | undefined {
  const candidatePhone = normalizePhone(candidate.phone);
  if (candidatePhone) {
    const phoneMatch = existing.find((lead) => normalizePhone(lead.phone) === candidatePhone);
    if (phoneMatch) return phoneMatch.leadId;
  }

  const candidateName = normalizeBusinessName(candidate.businessName);
  const candidateZip = extractZip(candidate.address);
  if (candidateName && candidateZip) {
    const nameZipMatch = existing.find(
      (lead) =>
        normalizeBusinessName(lead.businessName) === candidateName &&
        extractZip(lead.address) === candidateZip
    );
    if (nameZipMatch) return nameZipMatch.leadId;
  }

  return undefined;
}

interface PlacesApiResult {
  place_id: string;
  name: string;
  formatted_address: string;
  geometry: { location: { lat: number; lng: number } };
  types?: string[];
  formatted_phone_number?: string;
  website?: string;
}

interface PlacesApiResponse {
  results: PlacesApiResult[];
  next_page_token?: string;
  status: string;
  error_message?: string;
}

/**
 * Calls Google Places API Text Search for one ZIP-anchored geography +
 * business-type query, following pagination and respecting rate-limit
 * backoff. Returns all results across pages (Places API caps at 60/query
 * via 3 pages of 20 — a hard Google-side limit, not a guardrail we impose).
 */
async function fetchPlacesResults(
  apiKey: string,
  zipCode: string,
  businessType: string
): Promise<PlacesApiResult[]> {
  const results: PlacesApiResult[] = [];
  let pageToken: string | undefined;
  let attempt = 0;

  do {
    const params = new URLSearchParams({
      query: `${businessType} near ${zipCode}`,
      radius: String(DISCOVERY_SEARCH_RADIUS_METERS),
      key: apiKey
    });
    if (pageToken) {
      params.set("pagetoken", pageToken);
      // Google requires a short delay before a next_page_token becomes valid.
      await sleep(2000);
    }

    const res = await fetch(
      `https://maps.googleapis.com/maps/api/place/textsearch/json?${params.toString()}`
    );
    const body = (await res.json()) as PlacesApiResponse;

    if (body.status === "OVER_QUERY_LIMIT" || res.status === 429) {
      attempt += 1;
      if (attempt > BACKOFF_MAX_ATTEMPTS) {
        throw new Error(
          `Places API rate-limited past max backoff attempts for "${businessType}" near ${zipCode}: ${body.error_message ?? body.status}`
        );
      }
      const delay = Math.min(BACKOFF_BASE_MS * 2 ** (attempt - 1), BACKOFF_MAX_MS);
      await sleep(delay);
      continue;
    }

    if (body.status !== "OK" && body.status !== "ZERO_RESULTS") {
      throw new Error(
        `Places API error for "${businessType}" near ${zipCode}: ${body.status} ${body.error_message ?? ""}`.trim()
      );
    }

    results.push(...(body.results ?? []));
    pageToken = body.next_page_token;
    attempt = 0;
  } while (pageToken);

  return results;
}

/** Checks a Places result against the DoNotContact list (SPEC §6.5) by phone/business-name; domain/email matching happens later once research populates those fields. */
function matchesDoNotContact(
  placeResult: Pick<PlacesApiResult, "formatted_phone_number" | "name">,
  dncList: DoNotContactEntry[]
): boolean {
  const phone = normalizePhone(placeResult.formatted_phone_number);
  const name = normalizeBusinessName(placeResult.name);
  return dncList.some((entry) => {
    if (entry.matchedField === "phone" && phone) {
      return normalizePhone(entry.matchedValue) === phone;
    }
    if (entry.matchedField === "business_name") {
      return normalizeBusinessName(entry.matchedValue) === name;
    }
    return false;
  });
}

export interface DiscoverySweepDeps {
  sheets: SheetsClient;
  placesApiKey: string;
  nowIso?: () => string;
}

/**
 * Runs one discovery sweep across all configured geographies x business
 * types, respecting the daily Places API call budget. Rotates which
 * area+type combination starts the run based on the current hour so
 * repeated runs don't always hammer the same combination first if the
 * budget is exhausted partway through (SPEC §4 step 10's "rotate coverage"
 * requirement, kept intentionally simple: rotate start offset by time
 * rather than persisting separate per-combination cursors).
 */
export async function runDiscoverySweep(deps: DiscoverySweepDeps): Promise<void> {
  const { sheets, placesApiKey } = deps;
  const nowIso = deps.nowIso ?? (() => new Date().toISOString());
  const config = await sheets.getConfig();
  const [existingLeads, dncList] = await Promise.all([
    sheets.getLeads(),
    sheets.getDoNotContactList()
  ]);

  const targetBusinessTypes = config.templateCollateralMap
    .map((m) => m.productFitCategory)
    .filter((c): c is string => Boolean(c));
  // Fall back to a generic sweep keyword if no product-fit categories are
  // mapped yet in Config — categories.md drives research-time categorization
  // (SPEC §3.4), but discovery still needs *some* Places query terms to run;
  // "local business" is a broad, harmless default that surfaces something
  // for a fresh install rather than discovery silently doing nothing.
  const businessTypes = targetBusinessTypes.length > 0 ? targetBusinessTypes : ["local business"];

  const geographies: Geography[] = config.geographies;
  const combinations = geographies.flatMap((geo) => businessTypes.map((type) => ({ geo, type })));
  if (combinations.length === 0) return;

  // Rotate the starting combination by hour-of-day so a budget-exhausted
  // run doesn't always starve the same tail-end combinations (SPEC §4 step 10).
  const rotationOffset = new Date().getUTCHours() % combinations.length;
  const rotated = [...combinations.slice(rotationOffset), ...combinations.slice(0, rotationOffset)];

  let callsUsed = 0;
  const maxCalls = config.guardrails.maxPlacesApiCallsPerDay;
  const knownPlaceIds = new Set(existingLeads.map((l) => l.placeId).filter(Boolean));

  for (const { geo, type } of rotated) {
    if (callsUsed >= maxCalls) break;

    let placesResults: PlacesApiResult[];
    try {
      placesResults = await fetchPlacesResults(placesApiKey, geo.zipCode, type);
      callsUsed += 1;
    } catch (err) {
      await sheets.appendError({
        timestamp: nowIso(),
        component: "discovery_cron",
        errorType: "places_api_error",
        message: err instanceof Error ? err.message : String(err),
        retryCount: 0
      });
      continue;
    }

    for (const result of placesResults) {
      if (knownPlaceIds.has(result.place_id)) continue;
      knownPlaceIds.add(result.place_id);

      const candidate: Pick<Lead, "phone" | "businessName" | "address"> = {
        businessName: result.name,
        address: result.formatted_address,
        ...(result.formatted_phone_number ? { phone: result.formatted_phone_number } : {})
      };
      const dupOfLeadId = checkForDuplicateLead(candidate, existingLeads);
      const dnc = matchesDoNotContact(result, dncList);
      const timestamp = nowIso();
      const leadId = randomUUID();

      const lead: Lead = {
        leadId,
        placeId: result.place_id,
        businessName: result.name,
        categoryRaw: (result.types ?? []).join(", "),
        address: result.formatted_address,
        lat: result.geometry.location.lat,
        lng: result.geometry.location.lng,
        researchScore: 0,
        researchStatus: "pending",
        pipelineStage: "new",
        pipelineStageSince: timestamp,
        sourceQuery: `${type} near ${geo.zipCode}`,
        source: "discovery",
        discoveredAt: timestamp,
        lastTouchedAt: timestamp,
        dnc
      };
      if (dupOfLeadId !== undefined) lead.dupOfLeadId = dupOfLeadId;

      await sheets.upsertLead(lead);
      existingLeads.push(lead);

      await sheets.appendHistoryEvent({
        eventId: randomUUID(),
        leadId,
        timestamp,
        actor: "discovery_cron",
        eventType: "discovered",
        toValue: "new",
        detail: dupOfLeadId
          ? `possible_duplicate of ${dupOfLeadId}; source_query="${lead.sourceQuery}"`
          : `source_query="${lead.sourceQuery}"${dnc ? "; dnc=true (matched DoNotContact list)" : ""}`
      });
    }
  }
}
