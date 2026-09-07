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
 *   - Categories_Reference (read-only from the app's perspective)
 *   - Errors (append-only)
 */

export interface SheetsClient {
  getLeads(): Promise<unknown[]>;
  upsertLead(lead: unknown): Promise<void>;
  appendHistoryEvent(event: unknown): Promise<void>;
  appendError(error: unknown): Promise<void>;
  getConfig(): Promise<unknown>;
  getCategoriesReference(): Promise<unknown[]>;
}

export function createSheetsClient(
  _spreadsheetId: string,
  _serviceAccountKeyPath: string
): SheetsClient {
  throw new Error(
    "createSheetsClient is not yet implemented. See docs/SPEC.md §3 and docs/RECIPE.md §2.1 before implementing."
  );
}
