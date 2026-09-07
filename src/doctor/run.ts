/**
 * Doctor orchestrator — runs all registered checks, optionally applies safe
 * fixes, and returns a structured report. The CLI in bin/doctor.ts renders
 * this; keep this module free of console.log/process.exit so it stays
 * testable and reusable (e.g. from a future `salesflow-lite doctor` cron
 * job or health-check endpoint).
 */
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CheckResult, CheckContext } from "./checks.js";
import {
  envFileExistsCheck,
  requiredEnvVarsCheck,
  serviceAccountKeyCheck,
  gitignoreCoverageCheck,
  noLeakedSecretsCheck,
  notificationEnvSanityCheck
} from "./checks.js";

export interface DoctorReport {
  results: CheckResult[];
  summary: { pass: number; warn: number; fail: number; skipped: number; fixed: number };
  /** True if any check is still `fail` after fixes were (optionally) applied — CLI uses this for exit code. */
  healthy: boolean;
}

const REGISTRY = [
  envFileExistsCheck,
  requiredEnvVarsCheck,
  serviceAccountKeyCheck,
  gitignoreCoverageCheck,
  noLeakedSecretsCheck,
  notificationEnvSanityCheck
];

/**
 * Applies the one mechanical fix each fixable check currently supports.
 * Deliberately not generalized into a per-check fix() callback yet — with
 * only two fixable checks, an explicit switch is easier to audit for "does
 * this ever do something unsafe" than an abstraction would be. Revisit if
 * a third fixable check needs this.
 */
function applyFix(result: CheckResult, cwd: string): CheckResult {
  if (!result.fixable) return result;

  if (result.id === "service-account-key") {
    const path =
      process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH ??
      readDotEnv(cwd).GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
    if (!path) return result;
    const resolved = path.startsWith("/") ? path : join(cwd, path);
    if (!existsSync(resolved)) return result;
    chmodSync(resolved, 0o600);
    return {
      ...result,
      status: "pass",
      detail: `${result.detail} Fixed: chmod 600 applied.`,
      fixed: true
    };
  }

  if (result.id === "gitignore-coverage") {
    const path = join(cwd, ".gitignore");
    const required = [".env", "*service-account*.json", "credentials/"];
    const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
    const missing = required.filter((p) => !existing.includes(p));
    if (missing.length === 0) return result;
    const addition = `\n# Added by \`salesflow-lite doctor --fix\` (secret hygiene, SPEC \u00a712)\n${missing.join("\n")}\n`;
    writeFileSync(path, existing + addition, "utf8");
    return {
      ...result,
      status: "pass",
      detail: `${result.detail} Fixed: appended ${missing.length} missing pattern(s) to .gitignore.`,
      fixed: true
    };
  }

  return result;
}

function readDotEnv(cwd: string): Record<string, string> {
  const path = join(cwd, ".env");
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

export function runDoctor(options: { cwd?: string; applyFixes?: boolean } = {}): DoctorReport {
  const cwd = options.cwd ?? process.cwd();
  const applyFixes = options.applyFixes ?? false;
  const ctx: CheckContext = { cwd, env: process.env, applyFixes };

  let results = REGISTRY.map((check) => check.run(ctx));
  if (applyFixes) {
    results = results.map((r) => applyFix(r, cwd));
  }

  const summary = {
    pass: results.filter((r) => r.status === "pass").length,
    warn: results.filter((r) => r.status === "warn").length,
    fail: results.filter((r) => r.status === "fail").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    fixed: results.filter((r) => r.fixed).length
  };

  return {
    results,
    summary,
    healthy: summary.fail === 0
  };
}
