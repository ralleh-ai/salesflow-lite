/**
 * Thin wrapper around the Google Sheets API v4, scoped to the SalesFlow-Lite
 * schema (docs/SPEC.md §3). All reads/writes to the workbook go through this
 * module — no other code should call googleapis directly, so the schema
 * contract stays enforceable in one place.
 *
 * Tab layout this client supports (see docs/SPEC.md §3):
 *   - Leads (read/update by lead_id, never delete rows)
 *   - History (append-only — no update/delete calls issued against it)
 *   - Config (read-only from the app's perspective; operator edits directly)
 *   - Errors (append-only)
 *   - Comms_Threads (append-only, see docs/SPEC.md §3.6)
 *   - DoNotContact (read-only from the app's perspective, see docs/SPEC.md §6.5)
 *
 * Typed against src/types/domain.ts rather than `unknown` — the whole point
 * of these domain types is a compiler-enforced contract between this client
 * and its callers (discovery/research/pipeline).
 */
import { google, type sheets_v4 } from "googleapis";
import { JWT } from "google-auth-library";
import { readFileSync } from "node:fs";
import type {
  DoNotContactEntry,
  CommsThreadEvent,
  ErrorRecord,
  HistoryEvent,
  Lead
} from "../types/domain.js";
import { AppConfigSchema, type AppConfig } from "../config/schema.js";

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

/** Column order for the `Leads` tab. Single source of truth for row<->object mapping in this module. */
const LEADS_COLUMNS = [
  "lead_id",
  "place_id",
  "business_name",
  "category_raw",
  "address",
  "lat",
  "lng",
  "phone",
  "website",
  "email",
  "socials",
  "research_score",
  "research_status",
  "product_fit_category",
  "product_fit_confidence",
  "product_fit_rationale",
  "pipeline_stage",
  "pipeline_stage_since",
  "next_action_at",
  "next_action_type",
  "owner",
  "source_query",
  "source",
  "discovered_at",
  "last_touched_at",
  "notes",
  "dnc",
  "snooze_until",
  "dup_of_lead_id"
] as const;

const HISTORY_COLUMNS = [
  "event_id",
  "lead_id",
  "timestamp",
  "actor",
  "event_type",
  "from_value",
  "to_value",
  "detail"
] as const;

const ERRORS_COLUMNS = [
  "timestamp",
  "component",
  "lead_id",
  "error_type",
  "message",
  "retry_count"
] as const;

const COMMS_THREADS_COLUMNS = [
  "thread_event_id",
  "lead_id",
  "channel",
  "direction",
  "timestamp",
  "subject",
  "summary",
  "body_ref",
  "external_thread_id",
  "logged_by",
  "sentiment"
] as const;

const DNC_COLUMNS = [
  "dnc_id",
  "matched_field",
  "matched_value",
  "reason",
  "added_at",
  "added_by"
] as const;

const TAB = {
  leads: "Leads",
  history: "History",
  config: "Config",
  errors: "Errors",
  commsThreads: "Comms_Threads",
  doNotContact: "DoNotContact"
} as const;

/** Converts a possibly-undefined field to the string Sheets expects, using "" for absent values so column alignment never shifts. */
function cell(value: string | number | boolean | undefined | null): string {
  if (value === undefined || value === null) return "";
  return String(value);
}

function rowToLead(row: string[]): Lead {
  const get = (col: (typeof LEADS_COLUMNS)[number]): string =>
    row[LEADS_COLUMNS.indexOf(col)] ?? "";
  const num = (col: (typeof LEADS_COLUMNS)[number]): number => {
    const raw = get(col);
    return raw === "" ? 0 : Number(raw);
  };
  const opt = (col: (typeof LEADS_COLUMNS)[number]): string | undefined => {
    const raw = get(col);
    return raw === "" ? undefined : raw;
  };
  const optNum = (col: (typeof LEADS_COLUMNS)[number]): number | undefined => {
    const raw = get(col);
    return raw === "" ? undefined : Number(raw);
  };

  const lead: Lead = {
    leadId: get("lead_id"),
    placeId: get("place_id"),
    businessName: get("business_name"),
    categoryRaw: get("category_raw"),
    address: get("address"),
    lat: num("lat"),
    lng: num("lng"),
    researchScore: num("research_score"),
    researchStatus: get("research_status") as Lead["researchStatus"],
    pipelineStage: get("pipeline_stage") as Lead["pipelineStage"],
    pipelineStageSince: get("pipeline_stage_since"),
    sourceQuery: get("source_query"),
    source: get("source") as Lead["source"],
    discoveredAt: get("discovered_at"),
    lastTouchedAt: get("last_touched_at"),
    dnc: get("dnc") === "true" || get("dnc") === "TRUE"
  };
  const phone = opt("phone");
  if (phone !== undefined) lead.phone = phone;
  const website = opt("website");
  if (website !== undefined) lead.website = website;
  const email = opt("email");
  if (email !== undefined) lead.email = email;
  const socials = opt("socials");
  if (socials !== undefined) lead.socials = socials;
  const productFitCategory = opt("product_fit_category");
  if (productFitCategory !== undefined) lead.productFitCategory = productFitCategory;
  const productFitConfidence = optNum("product_fit_confidence");
  if (productFitConfidence !== undefined) lead.productFitConfidence = productFitConfidence;
  const productFitRationale = opt("product_fit_rationale");
  if (productFitRationale !== undefined) lead.productFitRationale = productFitRationale;
  const nextActionAt = opt("next_action_at");
  if (nextActionAt !== undefined) lead.nextActionAt = nextActionAt;
  const nextActionType = opt("next_action_type");
  if (nextActionType !== undefined) lead.nextActionType = nextActionType;
  const owner = opt("owner");
  if (owner !== undefined) lead.owner = owner;
  const notes = opt("notes");
  if (notes !== undefined) lead.notes = notes;
  const snoozeUntil = opt("snooze_until");
  if (snoozeUntil !== undefined) lead.snoozeUntil = snoozeUntil;
  const dupOfLeadId = opt("dup_of_lead_id");
  if (dupOfLeadId !== undefined) lead.dupOfLeadId = dupOfLeadId;

  return lead;
}

function leadToRow(lead: Lead): string[] {
  const map: Record<(typeof LEADS_COLUMNS)[number], string> = {
    lead_id: cell(lead.leadId),
    place_id: cell(lead.placeId),
    business_name: cell(lead.businessName),
    category_raw: cell(lead.categoryRaw),
    address: cell(lead.address),
    lat: cell(lead.lat),
    lng: cell(lead.lng),
    phone: cell(lead.phone),
    website: cell(lead.website),
    email: cell(lead.email),
    socials: cell(lead.socials),
    research_score: cell(lead.researchScore),
    research_status: cell(lead.researchStatus),
    product_fit_category: cell(lead.productFitCategory),
    product_fit_confidence: cell(lead.productFitConfidence),
    product_fit_rationale: cell(lead.productFitRationale),
    pipeline_stage: cell(lead.pipelineStage),
    pipeline_stage_since: cell(lead.pipelineStageSince),
    next_action_at: cell(lead.nextActionAt),
    next_action_type: cell(lead.nextActionType),
    owner: cell(lead.owner),
    source_query: cell(lead.sourceQuery),
    source: cell(lead.source),
    discovered_at: cell(lead.discoveredAt),
    last_touched_at: cell(lead.lastTouchedAt),
    notes: cell(lead.notes),
    dnc: cell(lead.dnc),
    snooze_until: cell(lead.snoozeUntil),
    dup_of_lead_id: cell(lead.dupOfLeadId)
  };
  return LEADS_COLUMNS.map((col) => map[col]);
}

function rowToDncEntry(row: string[]): DoNotContactEntry {
  const get = (col: (typeof DNC_COLUMNS)[number]): string => row[DNC_COLUMNS.indexOf(col)] ?? "";
  return {
    dncId: get("dnc_id"),
    matchedField: get("matched_field") as DoNotContactEntry["matchedField"],
    matchedValue: get("matched_value"),
    reason: get("reason") as DoNotContactEntry["reason"],
    addedAt: get("added_at"),
    addedBy: get("added_by")
  };
}

/**
 * Parses the `Config` tab's sectioned key/value layout (docs/SPEC.md §3.3)
 * into a single JSON blob cell, then validates it against AppConfigSchema.
 * The reference install keeps the entire config as one JSON document in
 * cell B1 of a dedicated "json_config" row — this keeps the Sheets-native
 * human-editable sections (documented in SPEC §3.3) as the operator-facing
 * view while giving the app one unambiguous, schema-validated source cell
 * to parse, rather than hand-rolling a sectioned-key/value parser for a
 * spreadsheet layout that's still likely to evolve. See docs/RECIPE.md §2.1
 * step 4 for how this cell is populated at install time.
 */
function parseConfigSheet(values: string[][]): AppConfig {
  const jsonRow = values.find((row) => row[0] === "json_config");
  const raw = jsonRow?.[1];
  if (!raw) {
    throw new Error(
      "Config tab is missing its json_config row (column A = 'json_config', column B = the JSON-encoded AppConfig). See docs/RECIPE.md §2.1."
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Config tab's json_config cell is not valid JSON: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  return AppConfigSchema.parse(parsed);
}

class GoogleSheetsClient implements SheetsClient {
  constructor(
    private readonly api: sheets_v4.Sheets,
    private readonly spreadsheetId: string
  ) {}

  async getLeads(): Promise<Lead[]> {
    const res = await this.api.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: `${TAB.leads}!A2:AB`
    });
    const rows = res.data.values ?? [];
    return rows.filter((row) => row[0]).map((row) => rowToLead(row.map((v) => String(v ?? ""))));
  }

  async upsertLead(lead: Lead): Promise<void> {
    const res = await this.api.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: `${TAB.leads}!A2:A`
    });
    const ids = (res.data.values ?? []).map((row) => row[0]);
    const existingIndex = ids.findIndex((id) => id === lead.leadId);
    const row = leadToRow(lead);

    if (existingIndex === -1) {
      await this.api.spreadsheets.values.append({
        spreadsheetId: this.spreadsheetId,
        range: `${TAB.leads}!A2:AB`,
        valueInputOption: "RAW",
        requestBody: { values: [row] }
      });
      return;
    }

    const sheetRowNumber = existingIndex + 2; // +1 for header, +1 for 1-indexing
    await this.api.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range: `${TAB.leads}!A${sheetRowNumber}:AB${sheetRowNumber}`,
      valueInputOption: "RAW",
      requestBody: { values: [row] }
    });
  }

  async appendHistoryEvent(event: HistoryEvent): Promise<void> {
    const row = HISTORY_COLUMNS.map((col) => {
      const map: Record<(typeof HISTORY_COLUMNS)[number], string> = {
        event_id: cell(event.eventId),
        lead_id: cell(event.leadId),
        timestamp: cell(event.timestamp),
        actor: cell(event.actor),
        event_type: cell(event.eventType),
        from_value: cell(event.fromValue),
        to_value: cell(event.toValue),
        detail: cell(event.detail)
      };
      return map[col];
    });
    await this.api.spreadsheets.values.append({
      spreadsheetId: this.spreadsheetId,
      range: `${TAB.history}!A2:H`,
      valueInputOption: "RAW",
      requestBody: { values: [row] }
    });
  }

  async appendError(error: ErrorRecord): Promise<void> {
    const row = ERRORS_COLUMNS.map((col) => {
      const map: Record<(typeof ERRORS_COLUMNS)[number], string> = {
        timestamp: cell(error.timestamp),
        component: cell(error.component),
        lead_id: cell(error.leadId),
        error_type: cell(error.errorType),
        message: cell(error.message),
        retry_count: cell(error.retryCount)
      };
      return map[col];
    });
    await this.api.spreadsheets.values.append({
      spreadsheetId: this.spreadsheetId,
      range: `${TAB.errors}!A2:F`,
      valueInputOption: "RAW",
      requestBody: { values: [row] }
    });
  }

  async appendCommsThreadEvent(event: CommsThreadEvent): Promise<void> {
    const row = COMMS_THREADS_COLUMNS.map((col) => {
      const map: Record<(typeof COMMS_THREADS_COLUMNS)[number], string> = {
        thread_event_id: cell(event.threadEventId),
        lead_id: cell(event.leadId),
        channel: cell(event.channel),
        direction: cell(event.direction),
        timestamp: cell(event.timestamp),
        subject: cell(event.subject),
        summary: cell(event.summary),
        body_ref: cell(event.bodyRef),
        external_thread_id: cell(event.externalThreadId),
        logged_by: cell(event.loggedBy),
        sentiment: cell(event.sentiment)
      };
      return map[col];
    });
    await this.api.spreadsheets.values.append({
      spreadsheetId: this.spreadsheetId,
      range: `${TAB.commsThreads}!A2:K`,
      valueInputOption: "RAW",
      requestBody: { values: [row] }
    });
  }

  async getConfig(): Promise<AppConfig> {
    const res = await this.api.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: `${TAB.config}!A1:B200`
    });
    const values = (res.data.values ?? []).map((row) => row.map((v) => String(v ?? "")));
    return parseConfigSheet(values);
  }

  async getDoNotContactList(): Promise<DoNotContactEntry[]> {
    const res = await this.api.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: `${TAB.doNotContact}!A2:F`
    });
    const rows = res.data.values ?? [];
    return rows
      .filter((row) => row[0])
      .map((row) => rowToDncEntry(row.map((v) => String(v ?? ""))));
  }
}

export function createSheetsClient(
  spreadsheetId: string,
  serviceAccountKeyPath: string
): SheetsClient {
  const keyFile = JSON.parse(readFileSync(serviceAccountKeyPath, "utf8")) as {
    client_email: string;
    private_key: string;
  };
  const auth = new JWT({
    email: keyFile.client_email,
    key: keyFile.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });
  const api = google.sheets({ version: "v4", auth });
  return new GoogleSheetsClient(api, spreadsheetId);
}
