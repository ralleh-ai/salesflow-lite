import { afterEach, describe, expect, it, vi } from "vitest";
import { runDiscoverySweep } from "../../src/discovery/sweep.js";
import type { AppConfig } from "../../src/config/schema.js";
import type { DoNotContactEntry, Lead } from "../../src/types/domain.js";
import type { SheetsClient } from "../../src/sheets/client.js";

function config(): AppConfig {
  return {
    businessName: "Acme Print Shop",
    businessDescription: "Local printer",
    geographies: [{ label: "Downtown", zipCode: "78205" }],
    discoveryTargetBusinessTypes: ["restaurants"],
    researchCompletionThreshold: 70,
    maxResearchAttempts: 3,
    guardrails: {
      maxPlacesApiCallsPerDay: 5,
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
    templateCollateralMap: []
  };
}

class FakeSheets implements SheetsClient {
  readonly leads: Lead[] = [];
  readonly errors: Parameters<SheetsClient["appendError"]>[0][] = [];
  readonly history: Parameters<SheetsClient["appendHistoryEvent"]>[0][] = [];

  async getLeads(): Promise<Lead[]> {
    return this.leads;
  }

  async upsertLead(lead: Lead): Promise<void> {
    this.leads.push({ ...lead });
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
    return config();
  }

  async getDoNotContactList(): Promise<DoNotContactEntry[]> {
    return [];
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runDiscoverySweep", () => {
  it("fetches Place Details for website/phone before inserting a lead", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const text = String(url);
      if (text.includes("textsearch")) {
        return new Response(
          JSON.stringify({
            status: "OK",
            results: [
              {
                place_id: "place-1",
                name: "River Cafe",
                formatted_address: "123 River Walk, San Antonio, TX 78205",
                geometry: { location: { lat: 29.42, lng: -98.49 } },
                types: ["restaurant"]
              }
            ]
          })
        );
      }

      return new Response(
        JSON.stringify({
          status: "OK",
          result: {
            place_id: "place-1",
            name: "River Cafe",
            formatted_address: "123 River Walk, San Antonio, TX 78205",
            geometry: { location: { lat: 29.42, lng: -98.49 } },
            types: ["restaurant"],
            formatted_phone_number: "(210) 555-0100",
            website: "https://river.example"
          }
        })
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const sheets = new FakeSheets();
    const summary = await runDiscoverySweep({
      sheets,
      placesApiKey: "places-key",
      nowIso: () => "2026-09-08T01:00:00.000Z"
    });

    expect(summary.newLeads).toBe(1);
    expect(summary.placesApiCallsUsed).toBe(2);
    expect(sheets.leads[0]?.phone).toBe("(210) 555-0100");
    expect(sheets.leads[0]?.website).toBe("https://river.example");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
