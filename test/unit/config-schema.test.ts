import { describe, expect, it } from "vitest";
import { AppConfigSchema, GuardrailsSchema } from "../../src/config/schema.js";

describe("GuardrailsSchema", () => {
  it("applies documented defaults when no overrides are given", () => {
    const parsed = GuardrailsSchema.parse({});
    expect(parsed.maxPlacesApiCallsPerDay).toBe(50);
    expect(parsed.maxResearchLlmCallsPerDay).toBe(100);
    expect(parsed.maxScrapeFetchesPerDay).toBe(150);
    expect(parsed.maxAgentMailDraftsPerDay).toBe(25);
    expect(parsed.discoveryCronIntervalMinutes).toBe(240);
    expect(parsed.researchCronIntervalMinutes).toBe(20);
    expect(parsed.pipelineCronIntervalMinutes).toBe(30);
  });

  it("rejects impossible negative values so a bad Config tab entry fails loudly", () => {
    expect(() => GuardrailsSchema.parse({ maxPlacesApiCallsPerDay: 0 })).toThrow();
    expect(() => GuardrailsSchema.parse({ maxAgentMailDraftsPerDay: -5 })).toThrow();
  });

  it("allows zero LLM and draft budgets for the Phase 1 cheapest-useful default", () => {
    const parsed = GuardrailsSchema.parse({
      maxResearchLlmCallsPerDay: 0,
      maxAgentMailDraftsPerDay: 0,
      maxScrapeFetchesPerDay: 0
    });
    expect(parsed.maxResearchLlmCallsPerDay).toBe(0);
    expect(parsed.maxAgentMailDraftsPerDay).toBe(0);
    expect(parsed.maxScrapeFetchesPerDay).toBe(0);
  });
});

describe("AppConfigSchema", () => {
  it("defaults discoveryTargetBusinessTypes to an empty explicit list", () => {
    const parsed = AppConfigSchema.parse({
      businessName: "Acme",
      businessDescription: "Local printer",
      geographies: [{ label: "Downtown", zipCode: "78205" }]
    });
    expect(parsed.discoveryTargetBusinessTypes).toEqual([]);
  });
});
