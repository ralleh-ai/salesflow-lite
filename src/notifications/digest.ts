/**
 * SalesFlow-Lite — configurable digest notification cron.
 * Mirrors docs/SPEC.md §7.2. Reads pre-computed values from the Dashboard
 * tab's formulas (§6.6) — this module must never re-derive funnel/response
 * metrics itself; Dashboard is the single source of truth for those numbers
 * so a human looking at the Sheet and a digest message never disagree.
 *
 * Runs as its own independent cron (separate from discovery/research/
 * pipeline) on the operator's configured schedule (DigestConfig.cronExpr),
 * per the project's existing "independent loops, nothing blocks anything
 * else" design (SPEC.md §2).
 */
import type { DigestConfig, NotificationDestinationConfig } from "../config/schema.js";
import type { NotificationMessage } from "./notifier.js";

/** One row's worth of a Dashboard section, already formula-computed in Sheets — this module only formats it, never computes it. */
export interface DashboardSnapshot {
  pipelineFunnel?: Record<string, number>;
  categoryVolume?: Record<string, number>;
  responseRatePct?: number;
  draftsPendingCount?: number;
  guardrailUsageToday?: {
    placesApiCalls: { used: number; max: number };
    llmCalls: { used: number; max: number };
    scrapeFetches: { used: number; max: number };
    draftsCreated: { used: number; max: number };
  };
  newLeadsSinceLastDigest?: number;
}

/**
 * Pure function: renders a DashboardSnapshot into a NotificationMessage,
 * honoring only the sections the operator configured. No I/O — the caller
 * is responsible for reading the Dashboard tab and for actually dispatching
 * via the Notifier. Kept pure specifically so the rendering logic (which
 * sections show, in what order, formatting of percentages/ratios) has a
 * test seam independent of Sheets access or the notification transport.
 */
export function renderDigestMessage(
  businessName: string,
  sections: DigestConfig["sections"],
  snapshot: DashboardSnapshot
): NotificationMessage {
  const lines: string[] = [];

  for (const section of sections) {
    switch (section) {
      case "pipeline_funnel":
        if (snapshot.pipelineFunnel) {
          const parts = Object.entries(snapshot.pipelineFunnel).map(
            ([stage, count]) => `${stage}: ${count}`
          );
          lines.push(`Pipeline funnel — ${parts.join(", ")}`);
        }
        break;
      case "category_volume":
        if (snapshot.categoryVolume) {
          const parts = Object.entries(snapshot.categoryVolume).map(
            ([cat, count]) => `${cat}: ${count}`
          );
          lines.push(`Leads by category — ${parts.join(", ")}`);
        }
        break;
      case "response_rate":
        if (snapshot.responseRatePct !== undefined) {
          lines.push(`Response rate: ${snapshot.responseRatePct.toFixed(1)}%`);
        }
        break;
      case "drafts_pending":
        if (snapshot.draftsPendingCount !== undefined) {
          lines.push(`Drafts awaiting your review: ${snapshot.draftsPendingCount}`);
        }
        break;
      case "guardrail_usage":
        if (snapshot.guardrailUsageToday) {
          const g = snapshot.guardrailUsageToday;
          lines.push(
            `Guardrail usage today — Places: ${g.placesApiCalls.used}/${g.placesApiCalls.max}, ` +
              `LLM: ${g.llmCalls.used}/${g.llmCalls.max}, Scrape: ${g.scrapeFetches.used}/${g.scrapeFetches.max}, ` +
              `Drafts: ${g.draftsCreated.used}/${g.draftsCreated.max}`
          );
        }
        break;
      case "new_leads_since_last_digest":
        if (snapshot.newLeadsSinceLastDigest !== undefined) {
          lines.push(`New leads since last digest: ${snapshot.newLeadsSinceLastDigest}`);
        }
        break;
    }
  }

  return {
    title: `${businessName} — SalesFlow-Lite digest`,
    body:
      lines.length > 0 ? lines.join("\n") : "No data available for the configured digest sections."
  };
}

/**
 * Pure function: which of the operator's configured destination names
 * should actually receive this digest run, given `respectQuietHours` and
 * the current local hour. Kept separate from dispatch so the "who gets it"
 * decision is independently testable from "how do we send it".
 */
export function resolveDigestDestinations(
  digest: DigestConfig,
  allDestinations: NotificationDestinationConfig[],
  isCurrentlyQuietHours: boolean
): NotificationDestinationConfig[] {
  if (!digest.enabled) return [];
  if (digest.respectQuietHours && isCurrentlyQuietHours) return [];
  return allDestinations.filter((d) => d.enabled && digest.destinationNames.includes(d.name));
}

/**
 * Entry point wired to the digest cron job. Stub — real implementation
 * reads the Dashboard tab via SheetsClient, builds a DashboardSnapshot,
 * calls resolveDigestDestinations() + renderDigestMessage(), dispatches via
 * each destination's NotificationChannelAdapter, and appends one
 * NotificationLogEntry per destination (sent/skipped_quiet_hours/failed) —
 * never a silent no-op. See docs/SPEC.md §7.2/§7.3.
 */
export function runDigestSweep(): Promise<void> {
  throw new Error(
    "runDigestSweep() not yet implemented — depends on src/sheets/client.ts Dashboard read support. See docs/SPEC.md §7.2."
  );
}
