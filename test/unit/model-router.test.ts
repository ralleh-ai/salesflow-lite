import { describe, expect, it } from "vitest";
import {
  DEFAULT_TASK_ROUTING,
  effectiveTierForTask,
  evaluateBudgetWarning,
  findMissingTierMappings,
  resolveModelForTask
} from "../../src/models/router.js";
import type { TokenBudgetConfig } from "../../src/config/schema.js";

const baseConfig: TokenBudgetConfig = {
  posture: "balanced",
  tierModelMap: {
    economy: "gpt-5.4-mini",
    standard: "claude-sonnet-4.6",
    premium: "claude-sonnet-5"
  },
  taskRouting: [],
  maxTokensPerDay: undefined,
  maxEstimatedCostPerDayUsd: undefined
};

describe("resolveModelForTask", () => {
  it("uses the shipped default tier + tierModelMap when no operator routing exists", () => {
    const result = resolveModelForTask("research_summary", baseConfig);
    expect(result.tier).toBe(DEFAULT_TASK_ROUTING.research_summary);
    expect(result.modelId).toBe("gpt-5.4-mini");
    expect(result.wasOperatorOverride).toBe(false);
  });

  it("uses an operator-configured recommendedTier over the shipped default", () => {
    const config: TokenBudgetConfig = {
      ...baseConfig,
      taskRouting: [{ taskType: "research_summary", recommendedTier: "premium" }]
    };
    const result = resolveModelForTask("research_summary", config);
    expect(result.tier).toBe("premium");
    expect(result.modelId).toBe("claude-sonnet-5");
    expect(result.wasOperatorOverride).toBe(false);
  });

  it("always prefers an explicit modelOverride, even over an operator-set tier", () => {
    const config: TokenBudgetConfig = {
      ...baseConfig,
      taskRouting: [
        {
          taskType: "draft_composition",
          recommendedTier: "economy",
          modelOverride: "my-custom-model-v3",
          rationale: "Operator wants a specific fine-tuned model here."
        }
      ]
    };
    const result = resolveModelForTask("draft_composition", config);
    expect(result.modelId).toBe("my-custom-model-v3");
    expect(result.wasOperatorOverride).toBe(true);
    expect(result.rationale).toContain("Operator-configured override");
  });

  it("throws when no tierModelMap is configured at all (real config gap, not silently invented)", () => {
    const config: TokenBudgetConfig = { ...baseConfig, tierModelMap: undefined };
    expect(() => resolveModelForTask("lead_categorization", config)).toThrow(/tierModelMap/);
  });
});

describe("effectiveTierForTask", () => {
  it("falls back to the shipped default when no routing entry exists", () => {
    expect(effectiveTierForTask("digest_rendering", [])).toBe(
      DEFAULT_TASK_ROUTING.digest_rendering
    );
  });

  it("uses the operator-configured tier when a routing entry exists", () => {
    const tier = effectiveTierForTask("digest_rendering", [
      { taskType: "digest_rendering", recommendedTier: "standard" }
    ]);
    expect(tier).toBe("standard");
  });
});

describe("evaluateBudgetWarning", () => {
  it("does not trigger when no ceilings are configured", () => {
    const result = evaluateBudgetWarning({ tokensUsedToday: 999999, estimatedCostUsdToday: 999 });
    expect(result.warningTriggered).toBe(false);
    expect(result.reasons).toHaveLength(0);
  });

  it("does not trigger when usage is under both configured ceilings", () => {
    const result = evaluateBudgetWarning({
      tokensUsedToday: 100,
      estimatedCostUsdToday: 1,
      maxTokensPerDay: 1000,
      maxEstimatedCostPerDayUsd: 10
    });
    expect(result.warningTriggered).toBe(false);
  });

  it("triggers on token ceiling crossed", () => {
    const result = evaluateBudgetWarning({
      tokensUsedToday: 2000,
      estimatedCostUsdToday: 1,
      maxTokensPerDay: 1000
    });
    expect(result.warningTriggered).toBe(true);
    expect(result.reasons[0]).toContain("Token usage today");
  });

  it("triggers on cost ceiling crossed", () => {
    const result = evaluateBudgetWarning({
      tokensUsedToday: 100,
      estimatedCostUsdToday: 25,
      maxEstimatedCostPerDayUsd: 10
    });
    expect(result.warningTriggered).toBe(true);
    expect(result.reasons[0]).toContain("Estimated cost today");
  });

  it("includes both reasons when both ceilings are crossed", () => {
    const result = evaluateBudgetWarning({
      tokensUsedToday: 2000,
      estimatedCostUsdToday: 25,
      maxTokensPerDay: 1000,
      maxEstimatedCostPerDayUsd: 10
    });
    expect(result.reasons).toHaveLength(2);
  });
});

describe("findMissingTierMappings", () => {
  it("returns all three tiers when tierModelMap is undefined", () => {
    expect(findMissingTierMappings(undefined)).toEqual(["economy", "standard", "premium"]);
  });

  it("returns only the missing tiers for a partial map", () => {
    expect(findMissingTierMappings({ economy: "gpt-5.4-mini" })).toEqual(["standard", "premium"]);
  });

  it("returns an empty array when all tiers are present", () => {
    expect(findMissingTierMappings({ economy: "a", standard: "b", premium: "c" })).toEqual([]);
  });
});
