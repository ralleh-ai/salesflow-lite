/**
 * SalesFlow-Lite — install configuration schema.
 * Validated with zod at startup so a misconfigured Config tab or .env fails
 * loudly and early rather than silently misbehaving mid-cron-run.
 * Mirrors docs/SPEC.md §3.3 (Config tab) and §9.1 (cost guardrails).
 */
import { z } from "zod";

export const GuardrailsSchema = z.object({
  maxPlacesApiCallsPerDay: z.number().int().positive().default(50),
  maxResearchLlmCallsPerDay: z.number().int().positive().default(100),
  maxScrapeFetchesPerDay: z.number().int().positive().default(150),
  maxAgentMailDraftsPerDay: z.number().int().positive().default(25),
  discoveryCronIntervalMinutes: z.number().int().positive().default(240),
  researchCronIntervalMinutes: z.number().int().positive().default(20),
  pipelineCronIntervalMinutes: z.number().int().positive().default(30)
});
export type Guardrails = z.infer<typeof GuardrailsSchema>;

export const GeographySchema = z.object({
  label: z.string(),
  lat: z.number(),
  lng: z.number(),
  radiusMeters: z.number().int().positive()
});
export type Geography = z.infer<typeof GeographySchema>;

export const NotificationRouteSchema = z.object({
  eventType: z.string(),
  channel: z.enum(["telegram", "email", "none"]),
  target: z.string().optional()
});
export type NotificationRoute = z.infer<typeof NotificationRouteSchema>;

export const AppConfigSchema = z.object({
  businessName: z.string(),
  businessDescription: z.string(),
  targetBusinessTypes: z.array(z.string()).min(1),
  geographies: z.array(GeographySchema).min(1),
  researchCompletionThreshold: z.number().min(0).max(100).default(70),
  maxResearchAttempts: z.number().int().positive().default(3),
  guardrails: GuardrailsSchema.default({}),
  notifications: z.array(NotificationRouteSchema).default([]),
  quietHours: z
    .object({
      startHourLocal: z.number().int().min(0).max(23),
      endHourLocal: z.number().int().min(0).max(23),
      timezone: z.string()
    })
    .optional()
});
export type AppConfig = z.infer<typeof AppConfigSchema>;
