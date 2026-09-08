import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createKeywordCategorizer } from "../../src/models/categorize.js";
import { runResearchPass } from "../../src/research/pass.js";
import type { AppConfig } from "../../src/config/schema.js";
import type { Lead } from "../../src/types/domain.js";
import type { SheetsClient } from "../../src/sheets/client.js";

function baseConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    businessName: "Acme Print Shop",
    businessDescription: "Local printer",
    geographies: [{ label: "Downtown", zipCode: "78205" }],
    discoveryTargetBusinessTypes: ["restaurants"],
    researchCompletionThreshold: 70,
    maxResearchAttempts: 2,
    guardrails: {
      maxPlacesApiCallsPerDay: 20,
      maxResearchLlmCallsPerDay: 0,
      maxScrapeFetchesPerDay: 0,
      maxAgentMailDraftsPerDay: 0,
      discoveryCronIntervalMinutes: 1440,
      researchCronIntervalMinutes: 1440,
      pipelineCronIntervalMinutes: 1440,
      backupRetentionSnapshots: 8
    },
    notifications: [],
    notificationDestinations: [],
    templateCollateralMap: [],
    ...overrides
  };
}

function lead(overrides: Partial<Lead> = {}): Lead {
  return {
    leadId: "lead-1",
    placeId: "place-1",
    businessName: "River Cafe",
    categoryRaw: "restaurant, food",
    address: "123 River Walk, San Antonio, TX 78205",
    lat: 29.42,
    lng: -98.49,
    researchScore: 0,
    researchStatus: "pending",
    pipelineStage: "new",
    pipelineStageSince: "2026-09-08T00:00:00.000Z",
    sourceQuery: "restaurants near 78205",
    source: "discovery",
    discoveredAt: "2026-09-08T00:00:00.000Z",
    lastTouchedAt: "2026-09-08T00:00:00.000Z",
    dnc: false,
    ...overrides
  };
}

function repoWithCatalog(): string {
  const cwd = mkdtempSync(join(tmpdir(), "salesflow-lite-research-"));
  writeFileSync(
    join(cwd, "categories.md"),
    "## Menus & Signage\n\n**Typical business types**: restaurants, cafes, bars\n\n**Pitch notes**: Menus and signage.\n",
    "utf8"
  );
  return cwd;
}

class FakeSheets implements SheetsClient {
  readonly upserts: Lead[] = [];
  readonly errors: Parameters<SheetsClient["appendError"]>[0][] = [];
  readonly history: Parameters<SheetsClient["appendHistoryEvent"]>[0][] = [];

  constructor(
    private readonly config: AppConfig,
    private readonly leads: Lead[]
  ) {}

  async getLeads(): Promise<Lead[]> {
    return this.leads;
  }

  async upsertLead(lead: Lead): Promise<void> {
    this.upserts.push({ ...lead });
  }

  async appendHistoryEvent(
    event: Parameters<SheetsClient["appendHistoryEvent"]>[0]
  ): Promise<void> {
    this.history.push(event);
  }

  async appendError(error: Parameters<SheetsClient["appendError"]>[0]): Promise<void> {
    this.errors.push(error);
  }

  async appendCommsThreadEvent(): Promise<void> {
    throw new Error("not used");
  }

  async getConfig(): Promise<AppConfig> {
    return this.config;
  }

  async getDoNotContactList(): Promise<[]> {
    return [];
  }
}

describe("runResearchPass", () => {
  it("runs the zero-LLM keyword categorizer even when LLM budget is 0", async () => {
    const sheets = new FakeSheets(baseConfig(), [lead()]);
    const summary = await runResearchPass({
      sheets,
      categorizer: createKeywordCategorizer(),
      repoRoot: repoWithCatalog(),
      nowIso: () => "2026-09-08T01:00:00.000Z"
    });

    expect(summary.processedLeads).toBe(1);
    expect(summary.categorizationRuns).toBe(1);
    expect(summary.llmCallsUsed).toBe(0);
    expect(sheets.upserts[0]?.productFitCategory).toBe("Menus & Signage");
  });

  it("counts repeated research attempts from existing notes before failing permanently", async () => {
    const sheets = new FakeSheets(baseConfig(), [
      lead({ researchStatus: "in_progress", notes: "[research_attempt] score=0" })
    ]);
    const summary = await runResearchPass({
      sheets,
      categorizer: createKeywordCategorizer(),
      repoRoot: repoWithCatalog(),
      nowIso: () => "2026-09-08T01:00:00.000Z"
    });

    expect(summary.failedPermanentLeads).toBe(1);
    expect(sheets.upserts[0]?.researchStatus).toBe("failed_permanent");
    expect(sheets.upserts[0]?.notes).toContain("[research_failed_permanent]");
  });
});
