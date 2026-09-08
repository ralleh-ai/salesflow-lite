import { afterEach, describe, expect, it } from "vitest";
import { loadEnvConfig } from "../../src/config/env.js";

const ENV_KEYS = [
  "GOOGLE_SERVICE_ACCOUNT_KEY_PATH",
  "GOOGLE_SHEETS_SPREADSHEET_ID",
  "GOOGLE_PLACES_API_KEY",
  "EMAIL_PROVIDER",
  "AGENTMAIL_API_KEY",
  "AGENTMAIL_INBOX_ID",
  "NOTIFICATION_CHANNEL",
  "NOTIFICATION_TARGET",
  "NODE_ENV",
  "LOG_LEVEL"
] as const;

const original = new Map<string, string | undefined>();
for (const key of ENV_KEYS) original.set(key, process.env[key]);

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = original.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function setBaseEnv(): void {
  process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH = "./credentials/service-account.json";
  process.env.GOOGLE_SHEETS_SPREADSHEET_ID = "sheet-id";
  process.env.GOOGLE_PLACES_API_KEY = "places-key";
  delete process.env.EMAIL_PROVIDER;
  delete process.env.AGENTMAIL_API_KEY;
}

describe("loadEnvConfig", () => {
  it("loads Phase 1 lead-pack config without requiring AgentMail", () => {
    setBaseEnv();
    const config = loadEnvConfig();
    expect(config.emailProvider).toBe("none");
    expect(config.googlePlacesApiKey).toBe("places-key");
    expect(config.agentMailApiKey).toBeUndefined();
  });

  it("requires AgentMail key only when CRM outreach mode is enabled", () => {
    setBaseEnv();
    process.env.EMAIL_PROVIDER = "agentmail";
    expect(() => loadEnvConfig()).toThrow(/AGENTMAIL_API_KEY/);

    process.env.AGENTMAIL_API_KEY = "agentmail-key";
    expect(loadEnvConfig().agentMailApiKey).toBe("agentmail-key");
  });

  it("fails loudly without a Places API key", () => {
    setBaseEnv();
    delete process.env.GOOGLE_PLACES_API_KEY;
    expect(() => loadEnvConfig()).toThrow(/GOOGLE_PLACES_API_KEY/);
  });
});
