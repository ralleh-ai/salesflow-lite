/**
 * SalesFlow-Lite — model/token-budget awareness (recommendation layer, not a throttle).
 * Mirrors docs/SPEC.md §19. Pure functions only — no I/O, no provider SDKs — so
 * routing precedence has a dedicated, unit-testable seam independent of any
 * cron's control flow.
 *
 * Hard rule (SPEC §19.4): the operator's explicit `modelOverride` for a task
 * type always wins. This module only ever *recommends* a tier/model; it must
 * never be wired to silently swap models mid-run or throttle a cron based on
 * cost. Budget-ceiling crossings are surfaced as advisory warnings only (see
 * `evaluateBudgetWarning`), never as an in-run abort/delay.
 */
import type {
  LlmTaskRouting,
  LlmTaskType,
  ModelTierMap,
  TaskComplexityTier,
  TokenBudgetConfig
} from "../config/schema.js";

/**
 * Shipped default recommendation per task type, based on each task's
 * inherent complexity (not the operator's budget posture — see SPEC §19.1
 * for the rationale behind each pick). Operators can override any entry via
 * `Config.tokenBudget.taskRouting`.
 */
export const DEFAULT_TASK_ROUTING: Record<LlmTaskType, TaskComplexityTier> = {
  lead_categorization: "standard",
  research_summary: "economy",
  draft_composition: "premium",
  digest_rendering: "economy"
};

export interface ResolvedModelForTask {
  taskType: LlmTaskType;
  tier: TaskComplexityTier;
  modelId: string;
  wasOperatorOverride: boolean;
  /** Human-readable trail of why this model was chosen, for logging/debugging — not for display logic. */
  rationale: string;
}

/**
 * Resolves the actual model to use for a given task type, in strict
 * precedence order:
 *   1. An explicit `modelOverride` configured for this task type (always wins).
 *   2. The tier this task type is routed to (operator-configured tier if set,
 *      else the shipped `DEFAULT_TASK_ROUTING` recommendation) mapped through
 *      the operator's `tierModelMap` for their chosen posture.
 *   3. If no `tierModelMap` entry exists for the resolved tier, throws —
 *      this is a real configuration gap the installing agent must fill in
 *      (SPEC §19.2), not something this function should silently paper over
 *      with an invented model id.
 */
export function resolveModelForTask(
  taskType: LlmTaskType,
  config: TokenBudgetConfig
): ResolvedModelForTask {
  const routing = config.taskRouting.find((r) => r.taskType === taskType);

  if (routing?.modelOverride) {
    return {
      taskType,
      tier: routing.recommendedTier,
      modelId: routing.modelOverride,
      wasOperatorOverride: true,
      rationale: `Operator-configured override for ${taskType} (${routing.rationale ?? "no rationale given"}).`
    };
  }

  const tier = routing?.recommendedTier ?? DEFAULT_TASK_ROUTING[taskType];

  if (!config.tierModelMap) {
    throw new Error(
      `No tierModelMap configured for posture "${config.posture}" — the installing agent must populate Config.tokenBudget.tierModelMap with real model ids available on this OpenClaw install before ${taskType} can run. See docs/SPEC.md §19.2.`
    );
  }

  const modelId = config.tierModelMap[tier];
  return {
    taskType,
    tier,
    modelId,
    wasOperatorOverride: false,
    rationale: `Recommended tier "${tier}" (${routing ? "operator-configured" : "shipped default"}) mapped via "${config.posture}" posture.`
  };
}

/**
 * Pure helper: given a task-routing table, returns the effective tier for a
 * task type without needing a full TokenBudgetConfig — useful for docs/UI
 * rendering (e.g. an onboarding preview) where no concrete model mapping
 * exists yet.
 */
export function effectiveTierForTask(
  taskType: LlmTaskType,
  taskRouting: LlmTaskRouting[]
): TaskComplexityTier {
  return (
    taskRouting.find((r) => r.taskType === taskType)?.recommendedTier ??
    DEFAULT_TASK_ROUTING[taskType]
  );
}

export interface BudgetWarningInput {
  tokensUsedToday: number;
  estimatedCostUsdToday: number;
  maxTokensPerDay?: number;
  maxEstimatedCostPerDayUsd?: number;
}

export interface BudgetWarningResult {
  /** true if either configured soft ceiling has been crossed today. Advisory only — see module docstring. */
  warningTriggered: boolean;
  reasons: string[];
}

/**
 * Evaluates whether today's usage has crossed either configured soft
 * ceiling. Pure — the caller (a cron) is responsible for actually logging a
 * `model_budget_warning` History event and/or notifying via §7.1 routing;
 * this function never performs I/O and never signals "stop the run."
 */
export function evaluateBudgetWarning(input: BudgetWarningInput): BudgetWarningResult {
  const reasons: string[] = [];

  if (input.maxTokensPerDay !== undefined && input.tokensUsedToday > input.maxTokensPerDay) {
    reasons.push(
      `Token usage today (${input.tokensUsedToday}) exceeds the configured soft ceiling (${input.maxTokensPerDay}).`
    );
  }

  if (
    input.maxEstimatedCostPerDayUsd !== undefined &&
    input.estimatedCostUsdToday > input.maxEstimatedCostPerDayUsd
  ) {
    reasons.push(
      `Estimated cost today ($${input.estimatedCostUsdToday.toFixed(2)}) exceeds the configured soft ceiling ($${input.maxEstimatedCostPerDayUsd.toFixed(2)}).`
    );
  }

  return { warningTriggered: reasons.length > 0, reasons };
}

/**
 * Validates a tier→model map has an entry for every tier. Used by the
 * doctor CLI and at config-load time so a partially-filled `tierModelMap`
 * fails loudly (SPEC §19.2) rather than throwing deep inside a cron run
 * the first time an uncommon tier is requested.
 */
export function findMissingTierMappings(
  tierModelMap: Partial<ModelTierMap> | undefined
): TaskComplexityTier[] {
  const tiers: TaskComplexityTier[] = ["economy", "standard", "premium"];
  if (!tierModelMap) return tiers;
  return tiers.filter((tier) => !tierModelMap[tier]);
}
