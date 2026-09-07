import { describe, expect, it } from "vitest";
import { checkGuardrailSanity, checkTierModelMapCompleteness } from "../../src/doctor/checks.js";

describe("checkGuardrailSanity", () => {
  it("passes when daily budgets comfortably exceed cron run frequency", () => {
    const result = checkGuardrailSanity({
      maxPlacesApiCallsPerDay: 50,
      discoveryCronIntervalMinutes: 240,
      maxResearchLlmCallsPerDay: 100,
      researchCronIntervalMinutes: 20
    });
    expect(result.status).toBe("pass");
  });

  it("warns when the places budget can't cover one call per discovery run", () => {
    const result = checkGuardrailSanity({
      maxPlacesApiCallsPerDay: 3,
      discoveryCronIntervalMinutes: 60,
      maxResearchLlmCallsPerDay: 100,
      researchCronIntervalMinutes: 20
    });
    expect(result.status).toBe("warn");
    expect(result.detail).toContain("maxPlacesApiCallsPerDay");
  });

  it("warns when the research LLM budget can't cover one call per research run", () => {
    const result = checkGuardrailSanity({
      maxPlacesApiCallsPerDay: 50,
      discoveryCronIntervalMinutes: 240,
      maxResearchLlmCallsPerDay: 10,
      researchCronIntervalMinutes: 5
    });
    expect(result.status).toBe("warn");
    expect(result.detail).toContain("maxResearchLlmCallsPerDay");
  });
});

describe("checkTierModelMapCompleteness", () => {
  it("skips (not fails) when no tierModelMap is configured yet", () => {
    const result = checkTierModelMapCompleteness(undefined);
    expect(result.status).toBe("skipped");
  });

  it("skips when an empty object is passed", () => {
    const result = checkTierModelMapCompleteness({});
    expect(result.status).toBe("skipped");
  });

  it("fails when one or more tiers are missing a model id", () => {
    const result = checkTierModelMapCompleteness({ economy: "gpt-5.4-mini" });
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("standard");
    expect(result.detail).toContain("premium");
  });

  it("passes when all three tiers have a model id", () => {
    const result = checkTierModelMapCompleteness({
      economy: "gpt-5.4-mini",
      standard: "claude-sonnet-4.6",
      premium: "claude-sonnet-5"
    });
    expect(result.status).toBe("pass");
  });
});
