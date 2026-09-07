/**
 * Loads and validates runtime configuration from environment variables.
 * The business-logic Config (guardrails, geographies, catalog) lives in the
 * `Config` Google Sheets tab (see docs/SPEC.md §3.3) and is read separately
 * by src/sheets — this module is strictly for process-level secrets/env.
 */
import "dotenv/config";

export interface EnvConfig {
  googleServiceAccountKeyPath: string;
  googleSheetsSpreadsheetId: string;
  googleCloudProjectId?: string | undefined;
  /** Which email provider this install uses — AgentMail is the sole supported provider (drafts-only, see docs/SPEC.md §6.3). */
  emailProvider: "agentmail";
  agentMailApiKey: string;
  agentMailInboxId?: string | undefined;
  notificationChannel: "telegram" | "email" | "none";
  notificationTarget?: string | undefined;
  nodeEnv: "development" | "production" | "test";
  logLevel: "debug" | "info" | "warn" | "error";
}

const NOTIFICATION_CHANNELS = ["telegram", "email", "none"] as const;
const NODE_ENVS = ["development", "production", "test"] as const;
const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. See .env.example and docs/GOOGLE_CLOUD_SETUP.md.`
    );
  }
  return value;
}

/**
 * Validates a raw env string against an allowed literal set instead of an
 * unchecked `as` cast, so a typo/stale value in `.env` fails loudly at
 * startup (this module's stated purpose) instead of surfacing as an
 * inexplicable runtime error deep inside a cron run hours later.
 */
function parseEnum<T extends readonly string[]>(
  name: string,
  allowed: T,
  fallback: T[number]
): T[number] {
  const raw = process.env[name];
  if (!raw) return fallback;
  if (!(allowed as readonly string[]).includes(raw)) {
    throw new Error(`Invalid value for ${name}: "${raw}". Expected one of: ${allowed.join(", ")}.`);
  }
  return raw as T[number];
}

export function loadEnvConfig(): EnvConfig {
  // AgentMail is the sole supported email provider (Rick's decision,
  // 2026-09-07) — drafts-only rule applies regardless, see SPEC.md §6.3.
  const agentMailApiKey = requireEnv("AGENTMAIL_API_KEY");

  return {
    googleServiceAccountKeyPath: requireEnv("GOOGLE_SERVICE_ACCOUNT_KEY_PATH"),
    googleSheetsSpreadsheetId: requireEnv("GOOGLE_SHEETS_SPREADSHEET_ID"),
    googleCloudProjectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
    emailProvider: "agentmail",
    agentMailApiKey,
    agentMailInboxId: process.env.AGENTMAIL_INBOX_ID,
    notificationChannel: parseEnum("NOTIFICATION_CHANNEL", NOTIFICATION_CHANNELS, "none"),
    notificationTarget: process.env.NOTIFICATION_TARGET,
    nodeEnv: parseEnum("NODE_ENV", NODE_ENVS, "development"),
    logLevel: parseEnum("LOG_LEVEL", LOG_LEVELS, "info")
  };
}
