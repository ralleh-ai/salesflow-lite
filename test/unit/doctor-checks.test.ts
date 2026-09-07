import { describe, expect, it } from "vitest";
import { checkGuardrailSanity } from "../../src/doctor/checks.js";

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
