#!/usr/bin/env tsx
import { createAgentMailClient } from "../src/agentmail/client.js";
import { loadEnvConfig } from "../src/config/env.js";
import { runDoctor } from "../src/doctor/run.js";
import { type DiscoverySweepSummary, runDiscoverySweep } from "../src/discovery/sweep.js";
import { createKeywordCategorizer } from "../src/models/categorize.js";
import { runPipelineSweep } from "../src/pipeline/sweep.js";
import { type ResearchPassSummary, runResearchPass } from "../src/research/pass.js";
import { createSheetsClient } from "../src/sheets/client.js";

type Command = "doctor" | "discover" | "research" | "pipeline" | "run-batch" | "help";

interface CliOptions {
  command: Command;
  repoRoot: string;
  json: boolean;
  withOutreach: boolean;
  applyFixes: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const [rawCommand = "help", ...rest] = argv;
  const command =
    rest.includes("--help") || rest.includes("-h")
      ? "help"
      : ["doctor", "discover", "research", "pipeline", "run-batch", "help"].includes(rawCommand)
        ? (rawCommand as Command)
        : "help";
  const repoRootIndex = rest.indexOf("--repo-root");
  const repoRoot =
    repoRootIndex === -1 ? process.cwd() : (rest[repoRootIndex + 1] ?? process.cwd());
  return {
    command,
    repoRoot,
    json: rest.includes("--json"),
    withOutreach: rest.includes("--with-outreach"),
    applyFixes: rest.includes("--fix")
  };
}

function printHelp(): void {
  console.log(`SalesFlow-Lite — OpenClaw-native lead scout

Usage:
  npm run lead:doctor [-- --fix]
  npm run lead:discover -- [--json]
  npm run lead:research -- [--json]
  npm run lead:pipeline -- [--json]
  npm run lead:batch -- [--json] [--with-outreach]

Commands:
  doctor       Validate local install hygiene before spending API calls.
  discover     Run one bounded Google Places discovery sweep.
  research     Run one enrichment pass using the zero-LLM keyword categorizer.
  pipeline     Run CRM-lite pipeline/draft creation. Requires EMAIL_PROVIDER=agentmail.
  run-batch    Phase 1 lead-pack flow: discover + research. Outreach is skipped unless --with-outreach.

Environment:
  GOOGLE_SERVICE_ACCOUNT_KEY_PATH, GOOGLE_SHEETS_SPREADSHEET_ID, GOOGLE_PLACES_API_KEY are required.
  EMAIL_PROVIDER=agentmail and AGENTMAIL_API_KEY are only required for pipeline/--with-outreach.
`);
}

function render(result: unknown, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (typeof result === "string") console.log(result);
  else console.log(JSON.stringify(result, null, 2));
}

function renderLeadPackSummary(params: {
  mode: "lead-pack" | "lead-pack-plus-crm-outreach";
  startedAt: string;
  finishedAt: string;
  discovery?: DiscoverySweepSummary;
  research?: ResearchPassSummary;
  outreachAttempted: boolean;
}): string {
  const lines = [
    "SalesFlow-Lite run complete.",
    `Mode: ${params.mode}`,
    `Started: ${params.startedAt}`,
    `Finished: ${params.finishedAt}`
  ];

  if (params.discovery) {
    lines.push(
      `Discovery: ${params.discovery.newLeads} new lead(s), ${params.discovery.searchedQueries} query/queries, ${params.discovery.placesApiCallsUsed} Places API call(s), ${params.discovery.duplicateCandidates} duplicate candidate(s), ${params.discovery.dncMatches} DNC match(es), ${params.discovery.errors} error(s).`
    );
    if (params.discovery.skippedBecauseMissingTargets) {
      lines.push("Discovery stopped: Config.discoveryTargetBusinessTypes is empty.");
    } else if (params.discovery.stoppedBecauseBudgetHit) {
      lines.push("Discovery stopped early: Places API call budget was hit.");
    }
  }

  if (params.research) {
    lines.push(
      `Research: ${params.research.processedLeads} processed, ${params.research.completedLeads} completed, ${params.research.failedPermanentLeads} failed permanent, ${params.research.scrapeFetchesUsed} scrape fetch(es), ${params.research.categorizationRuns} categorization run(s), ${params.research.llmCallsUsed} LLM call(s), ${params.research.errors} error(s).`
    );
    if (params.research.stoppedBecauseScrapeBudgetHit) {
      lines.push("Research note: scrape budget was hit.");
    }
    if (params.research.stoppedBecauseLlmBudgetHit) {
      lines.push("Research note: LLM budget was hit.");
    }
  }

  lines.push(
    params.outreachAttempted
      ? "Outreach: draft creation was requested; review provider drafts before sending anything."
      : "Outreach: skipped. Phase 1 never sends or creates drafts by default."
  );

  return lines.join("\n");
}

async function withSheets() {
  const env = loadEnvConfig();
  const sheets = createSheetsClient(env.googleSheetsSpreadsheetId, env.googleServiceAccountKeyPath);
  return { env, sheets };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.command === "help") {
    printHelp();
    return;
  }

  if (options.command === "doctor") {
    const report = runDoctor({ cwd: options.repoRoot, applyFixes: options.applyFixes });
    render(report, options.json);
    process.exitCode = report.healthy ? 0 : 1;
    return;
  }

  const startedAt = new Date().toISOString();
  const { env, sheets } = await withSheets();

  if (options.command === "discover") {
    const discovery = await runDiscoverySweep({ sheets, placesApiKey: env.googlePlacesApiKey });
    render(
      {
        command: options.command,
        startedAt,
        finishedAt: new Date().toISOString(),
        ok: true,
        discovery
      },
      options.json
    );
    return;
  }

  if (options.command === "research") {
    const research = await runResearchPass({
      sheets,
      categorizer: createKeywordCategorizer(),
      repoRoot: options.repoRoot
    });
    render(
      {
        command: options.command,
        startedAt,
        finishedAt: new Date().toISOString(),
        ok: true,
        research
      },
      options.json
    );
    return;
  }

  if (options.command === "pipeline") {
    if (env.emailProvider !== "agentmail" || !env.agentMailApiKey) {
      throw new Error(
        "pipeline requires EMAIL_PROVIDER=agentmail and AGENTMAIL_API_KEY. Phase 1 lead packs do not need pipeline outreach."
      );
    }
    await runPipelineSweep({
      sheets,
      emailClient: createAgentMailClient(env.agentMailApiKey, env.agentMailInboxId)
    });
    render(
      { command: options.command, startedAt, finishedAt: new Date().toISOString(), ok: true },
      options.json
    );
    return;
  }

  const discovery = await runDiscoverySweep({ sheets, placesApiKey: env.googlePlacesApiKey });
  const research = await runResearchPass({
    sheets,
    categorizer: createKeywordCategorizer(),
    repoRoot: options.repoRoot
  });

  if (options.withOutreach) {
    if (env.emailProvider !== "agentmail" || !env.agentMailApiKey) {
      throw new Error("--with-outreach requires EMAIL_PROVIDER=agentmail and AGENTMAIL_API_KEY.");
    }
    await runPipelineSweep({
      sheets,
      emailClient: createAgentMailClient(env.agentMailApiKey, env.agentMailInboxId)
    });
  }

  const mode: "lead-pack" | "lead-pack-plus-crm-outreach" = options.withOutreach
    ? "lead-pack-plus-crm-outreach"
    : "lead-pack";
  const result = {
    command: options.command,
    mode,
    startedAt,
    finishedAt: new Date().toISOString(),
    ok: true,
    discovery,
    research
  };

  render(
    options.json
      ? result
      : renderLeadPackSummary({
          mode: result.mode,
          startedAt: result.startedAt,
          finishedAt: result.finishedAt,
          discovery,
          research,
          outreachAttempted: options.withOutreach
        }),
    options.json
  );
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
