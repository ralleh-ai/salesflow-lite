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
  agentMailApiKey: string;
  agentMailInboxId?: string | undefined;
  notificationChannel: "telegram" | "email" | "none";
  notificationTarget?: string | undefined;
  nodeEnv: "development" | "production" | "test";
  logLevel: "debug" | "info" | "warn" | "error";
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. See .env.example and docs/GOOGLE_CLOUD_SETUP.md.`
    );
  }
  return value;
}

export function loadEnvConfig(): EnvConfig {
  return {
    googleServiceAccountKeyPath: requireEnv("GOOGLE_SERVICE_ACCOUNT_KEY_PATH"),
    googleSheetsSpreadsheetId: requireEnv("GOOGLE_SHEETS_SPREADSHEET_ID"),
    googleCloudProjectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
    agentMailApiKey: requireEnv("AGENTMAIL_API_KEY"),
    agentMailInboxId: process.env.AGENTMAIL_INBOX_ID,
    notificationChannel:
      (process.env.NOTIFICATION_CHANNEL as EnvConfig["notificationChannel"]) ?? "none",
    notificationTarget: process.env.NOTIFICATION_TARGET,
    nodeEnv: (process.env.NODE_ENV as EnvConfig["nodeEnv"]) ?? "development",
    logLevel: (process.env.LOG_LEVEL as EnvConfig["logLevel"]) ?? "info"
  };
}
