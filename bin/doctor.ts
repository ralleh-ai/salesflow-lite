#!/usr/bin/env node
/**
 * CLI entrypoint: `npm run doctor` / `npm run doctor -- --fix`.
 * Thin rendering layer over src/doctor/run.ts — keep logic there, not here.
 */
import { runDoctor } from "../src/doctor/run.js";

const applyFixes = process.argv.includes("--fix");

const STATUS_ICON: Record<string, string> = {
  pass: "✅",
  warn: "⚠️ ",
  fail: "❌",
  skipped: "⏭️ "
};

const report = runDoctor({ applyFixes });

console.log(
  `SalesFlow-Lite doctor ${applyFixes ? "(--fix mode)" : "(read-only — pass --fix to apply safe repairs)"}\n`
);

for (const r of report.results) {
  console.log(`${STATUS_ICON[r.status] ?? "?"} ${r.label}`);
  console.log(`   ${r.detail}`);
  if (r.fixed) console.log("   → fixed automatically");
  else if (r.fixable && !applyFixes) console.log("   → run with --fix to repair automatically");
}

console.log(
  `\n${report.summary.pass} passed, ${report.summary.warn} warnings, ${report.summary.fail} failed, ${report.summary.skipped} skipped` +
    (applyFixes ? `, ${report.summary.fixed} fixed` : "")
);

if (!report.healthy) {
  console.log(
    "\nStatus: UNHEALTHY — resolve the failures above before enabling/trusting live cron jobs."
  );
  process.exit(1);
}

if (report.summary.warn > 0) {
  console.log("\nStatus: OK with warnings — review above, safe to run but worth tidying up.");
  process.exit(0);
}

console.log("\nStatus: HEALTHY.");
