# SalesFlow-Lite

**OpenClaw-native lead packs and lightweight CRM for small businesses.**

SalesFlow-Lite helps a small business owner turn a plain-language target market into a reviewable pack of prospects: discovered from Google Places, enriched from public websites, scored against the business's offer, and prepared for human-reviewed outreach. It is intentionally **batch-first**: prove that the leads are worth contacting before enabling recurring automation or CRM follow-up.

The design bias is simple: deterministic code moves data and enforces budgets; OpenClaw models handle judgment, explanation, and drafting only where they add value.

## What this is

SalesFlow-Lite is a repo and operating recipe for building low-cost lead-generation workflows on OpenClaw:

1. **Find** businesses in configured ZIP codes using explicit Google Places search terms.
2. **Enrich** those businesses with public website/contact/social signals.
3. **Score** fit against the repo-root `categories.md` product/service catalog (the only runtime default).
4. **Deliver** a human-reviewable lead pack in Google Sheets.
5. **Optionally draft** outreach for operator review — never automatic sending.
6. **Optionally recur** on a schedule once the batch workflow proves valuable.
7. **Optionally manage** a lightweight CRM pipeline on top of the same Sheet.

## The four-phase product ladder

You can stop at any phase. That is the point.

### Phase 1 — Batch Lead Scout

Best for: “Find me 25 good leads this week.”

- One bounded run.
- Hard API-call limits.
- Google Sheet output.
- Zero-LLM keyword categorization available by default.
- No email provider required.
- No cron required.
- No autonomous sending, ever.

### Phase 2 — OpenClaw Recipe / Skill Pattern

Best for: repeatable installs by an OpenClaw agent.

- Short onboarding questionnaire.
- Deterministic doctor checks.
- Agent-safe operating rules.
- Clear cost and credential boundaries.
- A portable recipe that future agents can follow without inventing glue.

### Phase 3 — Recurring Mode

Best for: “Send me a fresh lead pack every Monday.”

- OpenClaw cron/TaskFlow orchestration.
- Scheduled batch runs.
- Run summaries and failure alerts.
- Optional digest.
- Still bounded by per-run and per-day budgets.

### Phase 4 — CRM-Lite

Best for: lightweight follow-up tracking after the lead-pack flow proves value.

- Pipeline stages.
- Do-not-contact enforcement.
- Snooze/manual review controls.
- Communication history.
- AgentMail draft creation for human review.
- Optional collateral/template links.

## Current implementation status

Phase 1 MVP is: a small business can configure one Sheet, one root `categories.md` offer catalog, and explicit Places search terms; run a bounded batch; receive reviewable leads with fit categories; and decide what to do next. It is **not** autonomous growth hacking, bulk email, or a full CRM.

Implemented and passing local gates:

- TypeScript strict project scaffold.
- Google Sheets client for core tabs.
- Google Places discovery sweep using Text Search plus Place Details for insertable leads.
- Website research/enrichment pass.
- Zero-LLM keyword categorizer for Phase 1, compatible with `maxResearchLlmCallsPerDay: 0`.
- LLM categorization interface for future higher-quality passes.
- Pipeline state-machine module for CRM-lite mode.
- AgentMail drafts-only client.
- Doctor checks for local install hygiene.
- CLI entrypoints for lead-pack and CRM sweeps, including JSON and human-readable run summaries.
- Unit tests for config, routing, digest rendering, notifications, doctor helpers, env loading, discovery, research, and categorization.

Still requires live install credentials before claiming production readiness:

- A real Google Cloud project with Sheets API + Places API enabled.
- A restricted Places API key.
- A Google service-account JSON key shared to the target Sheet.
- Optional AgentMail credentials only if CRM outreach draft creation is enabled.

## Quick start for developers

```bash
npm install
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
```

Create local env:

```bash
cp .env.example .env
# Fill in GOOGLE_SERVICE_ACCOUNT_KEY_PATH, GOOGLE_SHEETS_SPREADSHEET_ID, GOOGLE_PLACES_API_KEY
npm run lead:doctor
```

Phase 1 lead-pack commands:

```bash
npm run lead:discover -- --json
npm run lead:research -- --json
npm run lead:batch -- --json
```

CRM-lite outreach mode, only after AgentMail is configured:

```bash
EMAIL_PROVIDER=agentmail npm run lead:pipeline -- --json
npm run lead:batch -- --with-outreach --json
```

## Configuration model

SalesFlow-Lite deliberately separates secrets, operator config, and model grounding.

### `.env` — credentials and runtime secrets

Required for Phase 1:

- `GOOGLE_SERVICE_ACCOUNT_KEY_PATH` — service account JSON key for Sheets.
- `GOOGLE_SHEETS_SPREADSHEET_ID` — target workbook.
- `GOOGLE_PLACES_API_KEY` — restricted Places API key.

Optional for Phase 4:

- `EMAIL_PROVIDER=agentmail`
- `AGENTMAIL_API_KEY`
- `AGENTMAIL_INBOX_ID`

Secrets never go into Sheets, docs, chat, or git.

### Google Sheet `Config` tab — business/run config

The current implementation reads an AppConfig JSON blob from a `json_config` row in the `Config` tab. Important fields include:

- `businessName`
- `businessDescription`
- `geographies` — ZIP-code search anchors.
- `discoveryTargetBusinessTypes` — explicit Places query terms. Keep this short: 3–5 terms is a good starting point.
- `guardrails` — Places/scrape/LLM/draft budgets and cadence defaults.
- `notifications`, `digest`, `templateCollateralMap` — used by later phases.

### `categories.md` — product/service fit catalog

`./categories.md` at the repo root is the **only runtime catalog**. Research/categorization reads that file by default; `docs/examples/` contains named examples only, such as `categories.print-shop-satx.md`. Avoid creating another plain `docs/examples/categories.md` because operators may edit the example and wonder why live categorization did not change.

This catalog is prompt/context material, not secret data. Keep it concise because longer category files increase model cost when LLM categorization is enabled.

Best default for a first run:

1. Pick 3–5 products/services the business can sell confidently now.
2. For each one, list matching **Typical business types** using Google Places-style terms.
3. Add short **Pitch notes** explaining the fit; these become outreach grounding later.
4. Mirror the highest-priority target terms in `Config.discoveryTargetBusinessTypes` so discovery and categorization stay aligned.

The default file is a template. For a live install, replace its `Example — ...` headings with the operator's real product/service categories before running `npm run lead:research` or `npm run lead:batch`.

## Data model

The default workbook uses these tabs:

- `Leads` — one row per discovered/manual/imported business.
- `History` — append-only system/business event log.
- `Errors` — operational failures and retry context.
- `Comms_Threads` — optional CRM communication timeline.
- `DoNotContact` — source of truth for outreach suppression.
- `Config` — validated app config.

Later phases may add formula-only Dashboard panels and optional usage/notification ledgers.

## Safety invariants

These are non-negotiable:

- **No automatic outreach sending.** The app may create drafts; a human sends.
- **No invented credentials.** Missing credentials stop the run.
- **No broad discovery fallback.** Empty target terms do not trigger “local business” spam searches.
- **No silent drops.** Failures are logged; leads are not discarded invisibly.
- **DNC before drafts.** Do-not-contact checks run before any outreach draft is created.
- **Models are advisory.** The Sheet remains inspectable and editable by the operator.

## Business-practice bar

SalesFlow-Lite is designed for credible B2B prospecting, not spam.

- Start with a narrow ideal customer profile: specific buyer types, geography, and immediate offer.
- Use products/services the business can fulfill now, not speculative future offers.
- Prefer small, high-fit lead packs over large generic lists.
- Treat `Pitch notes` as factual fit rationale, not manipulative copy.
- Review every lead before outreach. Wrong-fit leads should be marked DNC, snoozed, or left alone.
- Drafting is a later-phase helper; sending remains a human business decision.

## Why OpenClaw?

OpenClaw is the right runtime because this product is partly deterministic automation and partly operator judgment:

- CLI/code performs bounded, testable data movement.
- OpenClaw agents ask onboarding questions, choose sensible defaults, summarize results, and help the operator decide what to do next.
- OpenClaw cron/TaskFlow can schedule recurring lead packs without turning every run into a free-form reasoning exercise.
- Messaging tools can notify the operator after a run without hand-rolled provider glue.

The model is the orchestrator and reviewer. It is not the database.

## Documentation

| Document | Purpose |
|---|---|
| [`docs/RECIPE.md`](./docs/RECIPE.md) | Agent-executable install and operating recipe, phase-tagged. |
| [`docs/SPEC.md`](./docs/SPEC.md) | Product/technical spec mapped to the four-phase roadmap. |
| [`docs/GOOGLE_CLOUD_SETUP.md`](./docs/GOOGLE_CLOUD_SETUP.md) | Google Cloud, Sheets, service account, and Places API key setup. |
| [`docs/examples/`](./docs/examples/) | Named example category catalogs. Copy ideas from these; the runtime default remains root `categories.md`. |
| [`SECURITY.md`](./SECURITY.md) | Security invariants and credential rules. |
| [`CONTRIBUTING.md`](./CONTRIBUTING.md) | Development standards and test expectations. |
| [`CHANGELOG.md`](./CHANGELOG.md) | What changed and what remains open. |

## Development standards

- Strict TypeScript.
- No `any` without justification.
- All Sheets access through `src/sheets/client.ts`.
- All Places discovery through `src/discovery/sweep.ts`.
- Outreach draft providers behind `EmailDraftClient`.
- Prefer pure functions for scoring, routing, matching, and rendering.
- Run the full gate before PRs:

```bash
npm run typecheck && npm run lint && npm run format:check && npm test && npm run build
```

## License

MIT — see [`LICENSE`](./LICENSE).
