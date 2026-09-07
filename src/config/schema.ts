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
  maxResearchLlmCallsPerDay: z.number().int().positive().default(100),
  maxScrapeFetchesPerDay: z.number().int().positive().default(150),
  maxAgentMailDraftsPerDay: z.number().int().positive().default(25),
  discoveryCronIntervalMinutes: z.number().int().positive().default(240),
  researchCronIntervalMinutes: z.number().int().positive().default(20),
  pipelineCronIntervalMinutes: z.number().int().positive().default(30),
  backupRetentionSnapshots: z.number().int().positive().default(8)
});
export type Guardrails = z.infer<typeof GuardrailsSchema>;

export const GeographySchema = z.object({
  label: z.string(),
  lat: z.number(),
  lng: z.number(),
  radiusMeters: z.number().int().positive()
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
  targetBusinessTypes: z.array(z.string()).min(1),
  geographies: z.array(GeographySchema).min(1),
  researchCompletionThreshold: z.number().min(0).max(100).default(70),
  maxResearchAttempts: z.number().int().positive().default(3),
  guardrails: GuardrailsSchema.default({}),
  notifications: z.array(NotificationRouteSchema).default([]),
  notificationDestinations: z.array(NotificationDestinationSchema).default([]),
  digest: DigestConfigSchema.optional(),
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
