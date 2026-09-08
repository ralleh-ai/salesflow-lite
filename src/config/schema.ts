/**
 * SalesFlow-Lite — install configuration schema.
 * Validated with zod at startup so a misconfigured Config tab or .env fails
 * loudly and early rather than silently misbehaving mid-cron-run.
 * Mirrors docs/SPEC.md §3.3 (Config tab), §9.1 (cost guardrails), and
 * §9.2 (backup retention).
 */
import { z } from "zod";

export const GuardrailsSchema = z.object({
  maxPlacesApiCallsPerDay: z.number().int().positive().default(50),
  /** May be 0 for the Phase 1 zero-LLM keyword-categorization default. */
  maxResearchLlmCallsPerDay: z.number().int().nonnegative().default(100),
  maxScrapeFetchesPerDay: z.number().int().nonnegative().default(150),
  /** May be 0 until Phase 4 CRM-lite outreach drafts are explicitly enabled. */
  maxAgentMailDraftsPerDay: z.number().int().nonnegative().default(25),
  discoveryCronIntervalMinutes: z.number().int().positive().default(240),
  researchCronIntervalMinutes: z.number().int().positive().default(20),
  pipelineCronIntervalMinutes: z.number().int().positive().default(30),
  backupRetentionSnapshots: z.number().int().positive().default(8)
});
export type Guardrails = z.infer<typeof GuardrailsSchema>;

export const GeographySchema = z.object({
  label: z.string(),
  /** US ZIP/postal code used as the discovery search anchor. Radius is a fixed operational default (see docs/SPEC.md §3.3), not operator-tunable per geography, to keep discovery cost predictable across installs. */
  zipCode: z.string().regex(/^\d{5}(-\d{4})?$/, "Expected a 5-digit (or ZIP+4) US ZIP code")
});
export type Geography = z.infer<typeof GeographySchema>;

export const NotificationChannelSchema = z.enum([
  "telegram",
  "email",
  "sms",
  "discord",
  "slack",
  "webhook",
  "none"
]);
export type NotificationChannelKind = z.infer<typeof NotificationChannelSchema>;

export const NotificationRouteSchema = z.object({
  eventType: z.string(),
  channel: NotificationChannelSchema,
  target: z.string().optional()
});
export type NotificationRoute = z.infer<typeof NotificationRouteSchema>;

/** One configured destination an operator can route event types or the digest to. See docs/SPEC.md §7.1. */
export const NotificationDestinationSchema = z.object({
  name: z.string(),
  channel: NotificationChannelSchema,
  target: z.string(),
  enabled: z.boolean().default(true)
});
export type NotificationDestinationConfig = z.infer<typeof NotificationDestinationSchema>;

/** Configurable digest job: pulls from the Dashboard tab's live formulas, not a re-derivation. See docs/SPEC.md §7.2. */
export const DigestConfigSchema = z.object({
  enabled: z.boolean().default(false),
  cronExpr: z.string().default("0 8 * * 1"),
  timezone: z.string().default("America/Chicago"),
  destinationNames: z.array(z.string()).min(1),
  sections: z
    .array(
      z.enum([
        "pipeline_funnel",
        "category_volume",
        "response_rate",
        "drafts_pending",
        "guardrail_usage",
        "new_leads_since_last_digest"
      ])
    )
    .default(["pipeline_funnel", "drafts_pending", "guardrail_usage"]),
  respectQuietHours: z.boolean().default(false)
});
export type DigestConfig = z.infer<typeof DigestConfigSchema>;

/**
 * Model/token-budget awareness (SPEC §19). The app never silently picks a
 * model on the operator's behalf mid-run — it recommends a tier per task
 * type based on task complexity + configured budget posture, and the
 * operator's explicit `modelOverride` (if set) always wins. Recommendations
 * are informational only unless the operator has left a task on "auto".
 */
export const TaskComplexityTierSchema = z.enum(["economy", "standard", "premium"]);
export type TaskComplexityTier = z.infer<typeof TaskComplexityTierSchema>;

export const LlmTaskTypeSchema = z.enum([
  "lead_categorization",
  "research_summary",
  "draft_composition",
  "digest_rendering"
]);
export type LlmTaskType = z.infer<typeof LlmTaskTypeSchema>;

/**
 * One entry in the operator-visible model recommendation table.
 * `recommendedTier` is what the app suggests based on the task's inherent
 * complexity; the operator can pin an explicit `modelOverride` (a real
 * model id/string, app-agnostic — whatever their OpenClaw install exposes)
 * that always wins over the recommendation. Leaving `modelOverride` unset
 * means "use my budget posture's default model for this tier" (see
 * `ModelBudgetPostureSchema`/`ModelTierMapSchema`).
 */
export const LlmTaskRoutingSchema = z.object({
  taskType: LlmTaskTypeSchema,
  recommendedTier: TaskComplexityTierSchema,
  modelOverride: z.string().optional(),
  rationale: z.string().optional()
});
export type LlmTaskRouting = z.infer<typeof LlmTaskRoutingSchema>;

/**
 * Maps a complexity tier to an actual model id/string per budget posture.
 * "economy"/"balanced"/"quality" are the operator's overall stance, not a
 * per-task setting — the *tier* mapping already reflects task complexity;
 * the *posture* only shifts which concrete model fills each tier (e.g. an
 * economy posture's "premium" tier model is still cheaper than a quality
 * posture's "premium" tier model).
 */
export const ModelBudgetPostureSchema = z.enum(["economy", "balanced", "quality"]);
export type ModelBudgetPosture = z.infer<typeof ModelBudgetPostureSchema>;

export const ModelTierMapSchema = z.object({
  economy: z.string(),
  standard: z.string(),
  premium: z.string()
});
export type ModelTierMap = z.infer<typeof ModelTierMapSchema>;

export const TokenBudgetConfigSchema = z.object({
  /** Overall stance; changes which concrete model each tier maps to by default. Operator can still override any individual task. */
  posture: ModelBudgetPostureSchema.default("balanced"),
  /** Explicit model id per tier for the chosen posture; lets an operator customize even within "balanced" without switching posture. */
  tierModelMap: ModelTierMapSchema.optional(),
  /** Per-task-type routing table; app ships sane recommended tiers, operator can override per task. Recommendation-only — never auto-applied without the operator having set it (or accepted the shipped default). */
  taskRouting: z.array(LlmTaskRoutingSchema).default([]),
  /** Soft daily token ceiling across all LLM-using crons combined — informational/alerting only, does not hard-stop a run mid-lead (finishing a small in-flight batch and flagging it next run beats a run aborting halfway through). */
  maxTokensPerDay: z.number().int().positive().optional(),
  /** Soft daily USD-cost ceiling; same informational/alerting posture as maxTokensPerDay, both may be set together. */
  maxEstimatedCostPerDayUsd: z.number().positive().optional()
});
export type TokenBudgetConfig = z.infer<typeof TokenBudgetConfigSchema>;

export const CollateralMappingSchema = z.object({
  productFitCategory: z.string().optional(),
  collateralName: z.string(),
  driveFileId: z.string(),
  attachToStage: z.array(z.string()).optional()
});
export type CollateralMappingConfig = z.infer<typeof CollateralMappingSchema>;

export const AppConfigSchema = z.object({
  businessName: z.string(),
  businessDescription: z.string(),
  /** Product/service catalog + target business categories now live in a local `categories.md` file (see docs/SPEC.md §3.4), not this field — kept only as an optional operator-facing label override for the Config tab's summary display. */
  geographies: z.array(GeographySchema).min(1),
  /** Explicit Google Places query terms for discovery. Keep this short (3-5 terms) for low-cost batch runs; do not infer discovery terms from collateral mappings. */
  discoveryTargetBusinessTypes: z.array(z.string().min(1)).default([]),
  researchCompletionThreshold: z.number().min(0).max(100).default(70),
  maxResearchAttempts: z.number().int().positive().default(3),
  guardrails: GuardrailsSchema.default({}),
  notifications: z.array(NotificationRouteSchema).default([]),
  notificationDestinations: z.array(NotificationDestinationSchema).default([]),
  digest: DigestConfigSchema.optional(),
  tokenBudget: TokenBudgetConfigSchema.optional(),
  templateCollateralMap: z.array(CollateralMappingSchema).default([]),
  quietHours: z
    .object({
      startHourLocal: z.number().int().min(0).max(23),
      endHourLocal: z.number().int().min(0).max(23),
      timezone: z.string()
    })
    .optional()
});
export type AppConfig = z.infer<typeof AppConfigSchema>;
