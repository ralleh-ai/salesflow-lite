/**
 * Doctor check registry — pure, independently-testable check functions.
 * Each check inspects one aspect of an install and returns a structured
 * result; `src/doctor/run.ts` orchestrates them and the CLI renders output.
 *
 * Design rules for adding a check:
 *   - A check must never throw for an expected "unhealthy" condition — it
 *     reports a `fail`/`warn` result instead. Throwing is reserved for
 *     genuine bugs in the check itself.
 *   - A check may optionally provide a `fix()` — but `fix()` must only ever
 *     perform safe, mechanical, reversible repairs (e.g. create a missing
 *     tab header row, chmod a key file, write a missing .gitignore line).
 *     It must NEVER delete data, rotate/regenerate credentials, or guess at
 *     business config (target categories, geography, etc.) — those require
 *     the operator, per docs/RECIPE.md's "never invent" rule.
 *   - Checks are read-only by default; `doctor --fix` is required to run
 *     any fix() at all, and each fix is still reported individually.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

export type CheckStatus = "pass" | "warn" | "fail" | "skipped";

export interface CheckResult {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  /** Present only when a safe automatic repair exists and was not (yet) applied. */
  fixable?: boolean;
  /** Set by the runner after a --fix pass actually applies fix(). */
  fixed?: boolean;
}

export interface CheckContext {
  cwd: string;
  env: Record<string, string | undefined>;
  /** True when invoked as `doctor --fix`; individual checks must gate any mutation on this. */
  applyFixes: boolean;
}

export interface Check {
  id: string;
  label: string;
  run: (ctx: CheckContext) => CheckResult;
}

const REQUIRED_ENV_VARS = [
  "GOOGLE_SERVICE_ACCOUNT_KEY_PATH",
  "GOOGLE_SHEETS_SPREADSHEET_ID",
  "GOOGLE_PLACES_API_KEY"
] as const;

const REQUIRED_SHEET_TABS = [
  "Leads",
  "History",
  "Config",
  "Errors",
  "Comms_Threads",
  "DoNotContact"
] as const;

const RUNTIME_CATALOG_PATH = "categories.md";
const EXAMPLE_CATALOG_GLOB_NOTE = "docs/examples/categories.<business-or-niche>.md";

/** Loads .env into a plain map without mutating process.env, so doctor can run alongside a live process safely. */
function readDotEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const rawLine of readFileSync(path, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}

/**
 * Check: .env file exists and is not accidentally the committed .env.example.
 * Does not validate secret *values* (doctor should never echo secrets), only
 * presence/shape.
 */
export const envFileExistsCheck: Check = {
  id: "env-file-exists",
  label: ".env file present",
  run: (ctx) => {
    const path = join(ctx.cwd, ".env");
    if (!existsSync(path)) {
      return {
        id: "env-file-exists",
        label: "env file present",
        status: "fail",
        detail:
          ".env not found. Copy .env.example to .env and fill in real values (never commit .env). See docs/GOOGLE_CLOUD_SETUP.md.",
        fixable: false
      };
    }
    return {
      id: "env-file-exists",
      label: "env file present",
      status: "pass",
      detail: `.env found at ${path}`
    };
  }
};

/** Check: required env vars are present (values not printed — presence only). */
export const requiredEnvVarsCheck: Check = {
  id: "required-env-vars",
  label: "Required environment variables set",
  run: (ctx) => {
    const fromDotEnv = readDotEnvFile(join(ctx.cwd, ".env"));
    const merged = { ...fromDotEnv, ...ctx.env };
    const missing = REQUIRED_ENV_VARS.filter((name) => !merged[name]);
    if (missing.length > 0) {
      return {
        id: "required-env-vars",
        label: "required environment variables set",
        status: "fail",
        detail: `Missing: ${missing.join(", ")}. See .env.example and docs/GOOGLE_CLOUD_SETUP.md.`,
        fixable: false
      };
    }

    if ((merged.EMAIL_PROVIDER ?? "none") === "agentmail" && !merged.AGENTMAIL_API_KEY) {
      return {
        id: "required-env-vars",
        label: "required environment variables set",
        status: "fail",
        detail:
          "EMAIL_PROVIDER=agentmail but AGENTMAIL_API_KEY is not set. Phase 1 lead packs can use EMAIL_PROVIDER=none; CRM outreach drafts require AgentMail.",
        fixable: false
      };
    }
    return {
      id: "required-env-vars",
      label: "required environment variables set",
      status: "pass",
      detail: "All required variables present."
    };
  }
};

/**
 * Check: service account key file exists, is valid JSON, and has restrictive
 * permissions. Fixable: file permission tightening only (SPEC §12) — never
 * touches file contents.
 */
export const serviceAccountKeyCheck: Check = {
  id: "service-account-key",
  label: "Google service account key file",
  run: (ctx) => {
    const fromDotEnv = readDotEnvFile(join(ctx.cwd, ".env"));
    const keyPath =
      ctx.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH ?? fromDotEnv.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
    if (!keyPath) {
      return {
        id: "service-account-key",
        label: "google service account key file",
        status: "skipped",
        detail: "GOOGLE_SERVICE_ACCOUNT_KEY_PATH not set — skipping (see required-env-vars check)."
      };
    }
    const resolved = keyPath.startsWith("/") ? keyPath : join(ctx.cwd, keyPath);
    if (!existsSync(resolved)) {
      return {
        id: "service-account-key",
        label: "google service account key file",
        status: "fail",
        detail: `Key file not found at ${resolved}. See docs/GOOGLE_CLOUD_SETUP.md.`,
        fixable: false
      };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(resolved, "utf8"));
    } catch {
      return {
        id: "service-account-key",
        label: "google service account key file",
        status: "fail",
        detail: `Key file at ${resolved} is not valid JSON — re-download from Google Cloud Console.`,
        fixable: false
      };
    }
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("client_email" in parsed) ||
      !("private_key" in parsed)
    ) {
      return {
        id: "service-account-key",
        label: "google service account key file",
        status: "fail",
        detail: `Key file at ${resolved} is missing client_email/private_key — this doesn't look like a service account key.`,
        fixable: false
      };
    }

    const mode = statSync(resolved).mode & 0o777;
    if (mode !== 0o600) {
      if (ctx.applyFixes) {
        // Actual chmod happens in run.ts (Node fs.chmodSync) — see runChecks().
        return {
          id: "service-account-key",
          label: "google service account key file",
          status: "warn",
          detail: `Key file permissions are ${mode.toString(8)}, expected 600 (SPEC §12).`,
          fixable: true
        };
      }
      return {
        id: "service-account-key",
        label: "google service account key file",
        status: "warn",
        detail: `Key file permissions are ${mode.toString(8)}, expected 600 (SPEC §12). Run with --fix to chmod it.`,
        fixable: true
      };
    }
    return {
      id: "service-account-key",
      label: "google service account key file",
      status: "pass",
      detail: `Valid JSON, correct shape, permissions 600 at ${resolved}.`
    };
  }
};

/** Check: .gitignore covers .env and credential files (SPEC §12 / RECIPE §2.6). Fixable: append missing lines only, never remove/rewrite existing ones. */
export const gitignoreCoverageCheck: Check = {
  id: "gitignore-coverage",
  label: ".gitignore covers secrets",
  run: (ctx) => {
    const path = join(ctx.cwd, ".gitignore");
    if (!existsSync(path)) {
      return {
        id: "gitignore-coverage",
        label: ".gitignore covers secrets",
        status: "fail",
        detail: ".gitignore not found at repo root — credentials could be committed accidentally.",
        fixable: true
      };
    }
    const content = readFileSync(path, "utf8");
    const requiredPatterns = [".env", "*service-account*.json", "credentials/"];
    const missing = requiredPatterns.filter((p) => !content.includes(p));
    if (missing.length > 0) {
      return {
        id: "gitignore-coverage",
        label: ".gitignore covers secrets",
        status: "fail",
        detail: `.gitignore is missing pattern(s): ${missing.join(", ")}.`,
        fixable: true
      };
    }
    return {
      id: "gitignore-coverage",
      label: ".gitignore covers secrets",
      status: "pass",
      detail: ".gitignore covers .env and credential files."
    };
  }
};

/** Check: no obvious secret material committed/tracked in the working tree (best-effort static scan, not a substitute for a real secret scanner). */
export const noLeakedSecretsCheck: Check = {
  id: "no-leaked-secrets",
  label: "No obvious secrets in tracked docs",
  run: (ctx) => {
    const suspects: string[] = [];
    const filesToScan = ["docs/SPEC.md", "docs/RECIPE.md", "README.md", "CHANGELOG.md"];
    const patterns = [/AIza[0-9A-Za-z_-]{20,}/, /-----BEGIN PRIVATE KEY-----/, /"private_key_id"/];
    for (const rel of filesToScan) {
      const path = join(ctx.cwd, rel);
      if (!existsSync(path)) continue;
      const content = readFileSync(path, "utf8");
      if (patterns.some((re) => re.test(content))) suspects.push(rel);
    }
    if (suspects.length > 0) {
      return {
        id: "no-leaked-secrets",
        label: "no obvious secrets in tracked docs",
        status: "fail",
        detail: `Possible credential material found in: ${suspects.join(", ")}. Rotate immediately per SPEC §12 if confirmed, then scrub history.`,
        fixable: false
      };
    }
    return {
      id: "no-leaked-secrets",
      label: "no obvious secrets in tracked docs",
      status: "pass",
      detail: `Scanned ${filesToScan.length} doc file(s), no obvious secret patterns found. Not a substitute for a real secret scanner (e.g. gitleaks) before public pushes.`
    };
  }
};

/**
 * Check: the runtime product/service catalog has one unambiguous default path.
 *
 * The application intentionally reads only the repo-root `categories.md` file.
 * Examples may live under docs/examples, but they must be named descriptively
 * (e.g. categories.print-shop-satx.md) rather than another plain
 * `categories.md`, otherwise operators can easily edit the wrong file before
 * running a live lead pack.
 */
export const categoryCatalogSanityCheck: Check = {
  id: "category-catalog-sanity",
  label: "Product/service category catalog is unambiguous",
  run: (ctx) => {
    const runtimePath = join(ctx.cwd, RUNTIME_CATALOG_PATH);
    const confusingExamplePath = join(ctx.cwd, "docs", "examples", "categories.md");

    if (!existsSync(runtimePath)) {
      return {
        id: "category-catalog-sanity",
        label: "product/service category catalog is unambiguous",
        status: "fail",
        detail:
          "Runtime catalog missing: create repo-root categories.md from the template before running research/categorization.",
        fixable: false
      };
    }

    if (existsSync(confusingExamplePath)) {
      return {
        id: "category-catalog-sanity",
        label: "product/service category catalog is unambiguous",
        status: "fail",
        detail: `Found a second plain categories.md at docs/examples/categories.md. Keep the root ${RUNTIME_CATALOG_PATH} as the only runtime default and rename examples like ${EXAMPLE_CATALOG_GLOB_NOTE}.`,
        fixable: false
      };
    }

    const content = readFileSync(runtimePath, "utf8");
    if (/^##\s+Example\s+—/m.test(content) || content.includes("Replace before a live install")) {
      return {
        id: "category-catalog-sanity",
        label: "product/service category catalog is unambiguous",
        status: "warn",
        detail:
          "Root categories.md is still the template. Replace Example headings with the operator's real product/service categories before a live lead pack.",
        fixable: false
      };
    }

    return {
      id: "category-catalog-sanity",
      label: "product/service category catalog is unambiguous",
      status: "pass",
      detail: `Runtime catalog found at ${RUNTIME_CATALOG_PATH}; examples should use descriptive names such as ${EXAMPLE_CATALOG_GLOB_NOTE}.`
    };
  }
};

/**
 * Check: guardrail values in a supplied AppConfig-shaped object are internally
 * sane (not just individually positive, which zod already enforces at load
 * time) — e.g. cron intervals aren't so tight they'd blow the daily call
 * budget, and the daily budget divided by interval count is at least 1.
 * Pure function, no I/O — callers pass the already-parsed config.
 */
export function checkGuardrailSanity(guardrails: {
  maxPlacesApiCallsPerDay: number;
  discoveryCronIntervalMinutes: number;
  maxResearchLlmCallsPerDay: number;
  researchCronIntervalMinutes: number;
}): CheckResult {
  const runsPerDay = (intervalMinutes: number): number => Math.floor((24 * 60) / intervalMinutes);
  const discoveryRuns = runsPerDay(guardrails.discoveryCronIntervalMinutes);
  const researchRuns = runsPerDay(guardrails.researchCronIntervalMinutes);

  const problems: string[] = [];
  if (guardrails.maxPlacesApiCallsPerDay < discoveryRuns) {
    problems.push(
      `maxPlacesApiCallsPerDay (${guardrails.maxPlacesApiCallsPerDay}) is less than the number of discovery cron runs/day (${discoveryRuns}) — every run would immediately hit budget with zero calls to spend.`
    );
  }
  if (guardrails.maxResearchLlmCallsPerDay < researchRuns) {
    problems.push(
      `maxResearchLlmCallsPerDay (${guardrails.maxResearchLlmCallsPerDay}) is less than the number of research cron runs/day (${researchRuns}) — same issue for research.`
    );
  }

  if (problems.length > 0) {
    return {
      id: "guardrail-sanity",
      label: "guardrail values are internally consistent",
      status: "warn",
      detail: problems.join(" "),
      fixable: false
    };
  }
  return {
    id: "guardrail-sanity",
    label: "guardrail values are internally consistent",
    status: "pass",
    detail: "Daily call budgets comfortably exceed cron run frequency for discovery and research."
  };
}

/** Check: NOTIFICATION_CHANNEL (fallback single-destination env vars) is a recognized value and has a target when not "none". Full multi-destination routing lives in Config/AppConfig and isn't validated by this env-only check. */
export const notificationEnvSanityCheck: Check = {
  id: "notification-env-sanity",
  label: "Fallback notification env vars sane",
  run: (ctx) => {
    const fromDotEnv = readDotEnvFile(join(ctx.cwd, ".env"));
    const merged = { ...fromDotEnv, ...ctx.env };
    const channel = merged.NOTIFICATION_CHANNEL ?? "none";
    const validChannels = ["telegram", "discord", "slack", "email", "sms", "webhook", "none"];
    if (!validChannels.includes(channel)) {
      return {
        id: "notification-env-sanity",
        label: "fallback notification env vars sane",
        status: "fail",
        detail: `NOTIFICATION_CHANNEL=${channel} is not one of: ${validChannels.join(", ")}.`,
        fixable: false
      };
    }
    if (channel !== "none" && !merged.NOTIFICATION_TARGET) {
      return {
        id: "notification-env-sanity",
        label: "fallback notification env vars sane",
        status: "warn",
        detail: `NOTIFICATION_CHANNEL=${channel} but NOTIFICATION_TARGET is empty — this fallback route won't deliver anything. Configure notificationDestinations in Config for real multi-channel routing (see SPEC §7.1).`,
        fixable: false
      };
    }
    return {
      id: "notification-env-sanity",
      label: "fallback notification env vars sane",
      status: "pass",
      detail:
        channel === "none"
          ? "NOTIFICATION_CHANNEL=none (fallback route disabled; check Config tab notificationDestinations for real routing)."
          : `Fallback route: ${channel} -> configured target present.`
    };
  }
};

/**
 * Check: if a tierModelMap is present in the operator's Config (passed in
 * via env override for local/dry-run testing, since real Config lives in
 * Sheets, not .env), it has an entry for every tier. Pure input, no I/O
 * beyond the already-loaded env — mirrors checkGuardrailSanity()'s pattern
 * of validating cross-field consistency zod's schema alone can't catch.
 * Skips (not fails) when no tier map is supplied — this is expected before
 * the installing agent has populated Config.tokenBudget (SPEC §19.2).
 */
export function checkTierModelMapCompleteness(
  tierModelMap: Partial<{ economy: string; standard: string; premium: string }> | undefined
): CheckResult {
  if (!tierModelMap || Object.keys(tierModelMap).length === 0) {
    return {
      id: "tier-model-map-completeness",
      label: "model tier map fully populated",
      status: "skipped",
      detail:
        "No tierModelMap configured yet — the installing agent must populate Config.tokenBudget.tierModelMap with real model ids before LLM-using crons can run. See docs/SPEC.md §19.2."
    };
  }
  const tiers: Array<"economy" | "standard" | "premium"> = ["economy", "standard", "premium"];
  const missing = tiers.filter((tier) => !tierModelMap[tier]);
  if (missing.length > 0) {
    return {
      id: "tier-model-map-completeness",
      label: "model tier map fully populated",
      status: "fail",
      detail: `Config.tokenBudget.tierModelMap is missing entries for: ${missing.join(", ")}. Every task type resolves to one of these three tiers, so an incomplete map will throw the first time an uncovered tier is requested (see src/models/router.ts resolveModelForTask()).`,
      fixable: false
    };
  }
  return {
    id: "tier-model-map-completeness",
    label: "model tier map fully populated",
    status: "pass",
    detail: "All three tiers (economy/standard/premium) have a configured model id."
  };
}

export { REQUIRED_ENV_VARS, REQUIRED_SHEET_TABS, dirname };
