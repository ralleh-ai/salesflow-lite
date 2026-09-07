/**
 * Thin wrapper around the Google Sheets API v4, scoped to the SalesFlow-Lite
 * schema (docs/SPEC.md §3). All reads/writes to the workbook go through this
 * module — no other code should call googleapis directly, so the schema
 * contract stays enforceable in one place.
 *
 * NOT YET IMPLEMENTED — stub only. See docs/SPEC.md §3 for the full tab
 * layout this client must support:
 *   - Leads (read/update, never delete rows)
 *   - History (append-only — no update/delete calls permitted)
 *   - Config (read-only from the app's perspective; operator edits directly)
 *   - Errors (append-only)
 *   - Comms_Threads (append-only, see docs/SPEC.md §3.6)
 *   - DoNotContact (read-only from the app's perspective, see docs/SPEC.md §6.5)
 *
 * Typed against src/types/domain.ts rather than `unknown` — the whole point
 * of these domain types is a compiler-enforced contract between this client
 * and its callers (discovery/research/pipeline). An `unknown`-typed stub
 * would compile today but silently rot the moment a real implementation
 * lands and nobody notices a field was misspelled or a type mismatched.
 */
import type {
  DoNotContactEntry,
  CommsThreadEvent,
  ErrorRecord,
  HistoryEvent,
  Lead
} from "../types/domain.js";
import type { AppConfig } from "../config/schema.js";

export interface SheetsClient {
  getLeads(): Promise<Lead[]>;
  /** Upserts by `leadId`. Callers are responsible for setting `lastTouchedAt`. */
  upsertLead(lead: Lead): Promise<void>;
  /** Append-only — must never issue an update/delete call against the History tab. */
  appendHistoryEvent(event: HistoryEvent): Promise<void>;
  /** Append-only — must never issue an update/delete call against the Errors tab. */
  appendError(error: ErrorRecord): Promise<void>;
  /** Append-only — must never issue an update/delete call against the Comms_Threads tab (see docs/SPEC.md §3.6). */
  appendCommsThreadEvent(event: CommsThreadEvent): Promise<void>;
  getConfig(): Promise<AppConfig>;
  /** Source of truth for the `dnc` flag on Leads (see docs/SPEC.md §6.5). */
  getDoNotContactList(): Promise<DoNotContactEntry[]>;
}

export function createSheetsClient(
  _spreadsheetId: string,
  _serviceAccountKeyPath: string
): SheetsClient {
  throw new Error(
    "createSheetsClient is not yet implemented. See docs/SPEC.md §3 and docs/RECIPE.md §2.1 before implementing."
  );
}
