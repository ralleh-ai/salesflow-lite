# SalesFlow-Lite Specification

Status: **phase-based refactor, 2026-09-08**.

SalesFlow-Lite is an OpenClaw-native lead-generation and lightweight CRM toolkit for small businesses. It is intentionally built as a product ladder rather than a monolith: start with low-cost batch lead packs, then add OpenClaw recipe reuse, recurring automation, and CRM-lite follow-up only when each earlier layer has proven useful.

## 1. Product promise

Given a business offer, target geography, and ideal-customer terms, SalesFlow-Lite produces a reviewable lead pack:

- businesses discovered from Google Places,
- public contact/website signals,
- fit category and confidence,
- rationale a human can audit,
- optional draft outreach that is never automatically sent.

The system should help a small business ask:

> “Who should I contact this week, why are they a fit, and what should I say first?”

## 2. Phase roadmap

### Phase 1 — Batch Lead Scout

Default and recommended starting mode.

- On-demand run, not always-on automation.
- Requires Google Sheets and Places credentials only.
- Writes reviewable leads into a Google Sheet.
- Uses explicit Places query terms from config.
- Uses deterministic enrichment and zero-LLM keyword categorization by default.
- May use LLM categorization/drafting only when an operator opts in.
- No email provider required.
- No cron required.

Success criterion: produce a useful pack of leads under a known budget.

### Phase 2 — OpenClaw Recipe / Skill Pattern

- A portable agent-executable recipe.
- Short onboarding flow.
- Safe credential handling.
- Doctor checks before spend.
- Clear run summaries.
- Model chooses sensible defaults but does not invent credentials, targets, or budgets.

Success criterion: a future OpenClaw model can install/run Phase 1 without making up missing glue.

### Phase 3 — Recurring Mode

- Optional scheduled lead-pack runs via OpenClaw cron/TaskFlow.
- Coarse cadence first: daily/weekly, not every-few-minutes by default.
- Run summaries and failure alerts.
- Optional digest.
- Persistent usage tracking before recurring spend is trusted.

Success criterion: recurring runs do not surprise the operator or exceed configured budgets.

### Phase 4 — CRM-Lite

- Pipeline stages.
- Follow-up timers.
- Do-not-contact enforcement.
- Snooze/manual review controls.
- Communication history.
- AgentMail draft creation for human review.
- Optional collateral/template links.

Success criterion: help manage follow-up without becoming a heavyweight CRM.

## 3. Core design principles

### 3.1 Deterministic code owns state

Code handles:

- API calls,
- dedupe,
- normalization,
- budget checks,
- Sheet writes,
- event/error logs.

Models handle:

- target-market interpretation,
- fit judgment,
- rationale,
- summarization,
- draft language.

A model must not be the database or the scheduler.

### 3.2 Batch-first beats cron-first

The first useful product is a bounded lead pack. Recurring automation is a later wrapper around the same deterministic commands.

### 3.3 Sheets are the default operator UI

Google Sheets is used because small businesses can inspect, edit, export, and share it without new infrastructure. It is not an excuse for sloppy writes. Automation should prefer field-scoped updates and append-only logs over whole-row clobbering.

### 3.4 Drafts only

No code path may automatically send prospect outreach. AgentMail or any future provider may only create drafts/compose records for human review.

### 3.5 Explicit targets only

Discovery must use operator-approved target terms. If `discoveryTargetBusinessTypes` is empty, discovery stops and logs an error rather than running a broad expensive search such as “local business.”

### 3.6 No silent drops

Every found lead gets a row unless the write fails. Errors are logged. Duplicate/DNC/snooze states suppress automation, not visibility.

## 4. Configuration

### 4.1 Runtime environment

Required for Phase 1:

- `GOOGLE_SERVICE_ACCOUNT_KEY_PATH` — service account JSON key used for Sheets API access.
- `GOOGLE_SHEETS_SPREADSHEET_ID` — target workbook ID.
- `GOOGLE_PLACES_API_KEY` — restricted Google Places API key.

Optional for Phase 4:

- `EMAIL_PROVIDER=agentmail`
- `AGENTMAIL_API_KEY`
- `AGENTMAIL_INBOX_ID`

### 4.2 AppConfig in Sheet `Config`

The implementation currently reads a `json_config` row from the `Config` tab. The value is parsed with `AppConfigSchema`.

Core fields:

- `businessName: string`
- `businessDescription: string`
- `geographies: { label: string; zipCode: string }[]`
- `discoveryTargetBusinessTypes: string[]`
- `researchCompletionThreshold: number`
- `maxResearchAttempts: number`
- `guardrails`
- `notifications`
- `notificationDestinations`
- `digest`
- `tokenBudget`
- `templateCollateralMap`
- `quietHours`

### 4.3 `categories.md`

The repo-root `./categories.md` file is the only runtime product/service catalog used to categorize lead fit. The implementation reads this path directly during research. Documentation examples must use descriptive names under `docs/examples/` (for example `categories.print-shop-satx.md`), never a second plain `docs/examples/categories.md`.

Format:

```markdown
## Product or Service Category

**Typical business types**: restaurants, cafes, schools

**Pitch notes**: Short notes about why this category needs the offer.
```

Best default for Phase 1 is 3–5 offer categories with 3–5 aligned Places-style discovery terms. The catalog answers which product/service fits a lead; `Config.discoveryTargetBusinessTypes` answers what businesses to search for. Keep both aligned and intentionally narrow.

Keep it short. Large catalogs increase token cost when model-based categorization is enabled. The zero-LLM Phase 1 categorizer reads `Typical business types`; LLM categorization/drafting can also use `Pitch notes` as outreach grounding.

## 5. Data model

### `Leads`

One row per business.

Required logical fields:

- lead id,
- place id,
- business name,
- category/address/location,
- phone/website/email/socials where known,
- research score/status,
- product fit category/confidence/rationale,
- pipeline stage and next action fields for Phase 4,
- source and timestamps,
- notes,
- DNC/snooze/duplicate flags.

### `History`

Append-only business/system events:

- discovered,
- research updated,
- stage transition,
- outreach draft created,
- notification/digest/model-budget events.

### `Errors`

Append-only operational errors:

- API failures,
- malformed data,
- missing config,
- rate limits,
- draft creation failures.

### `DoNotContact`

Source of truth for outreach suppression:

- phone,
- email,
- domain,
- business name.

### `Comms_Threads`

Phase 4 communication timeline. One row per touchpoint/draft/reply.

## 6. Phase 1 flow

1. Run `npm run lead:doctor`.
2. Read config from Sheet and catalog from `categories.md`.
3. For each ZIP × target business type, call Places within the configured guardrail.
4. Dedupe by place id, then normalized phone, then normalized name + ZIP.
5. Write new leads.
6. Fetch public websites where present.
7. Extract email/phone/social/basic description.
8. Categorize with keyword baseline or configured LLM categorizer.
9. Score research completeness.
10. Return a run summary to the operator.

## 7. Guardrails and budget policy

Current config defaults:

- Places calls/day: 50.
- Research LLM calls/day: 100.
- Website scrape fetches/day: 150.
- AgentMail drafts/day: 25.

Required hardening before Phase 3 recurring mode is trusted:

- persistent usage ledger,
- count each Places page request, not just each query,
- per-run and per-day enforcement,
- visible cost/run summary,
- failure alert when a job exits early due to budget.

For Phase 1, bounded manual runs plus explicit query terms are acceptable. For recurring mode, in-memory counters are not enough.

## 8. Outreach and CRM-lite

Phase 4 may create outreach drafts through `EmailDraftClient`. Rules:

- create drafts only,
- never call send endpoints,
- DNC check immediately before draft creation,
- log draft to `History` and `Comms_Threads`,
- reschedule or log errors on failure,
- human reviews and sends manually.

AgentMail is the only implemented provider today. Other providers are architectural possibilities, not currently supported implementation paths.

## 9. OpenClaw operating model

Best practice for OpenClaw:

- Use CLI commands for deterministic work.
- Use agents for onboarding, interpretation, summarization, and review.
- Use cron/TaskFlow only to schedule already-bounded commands.
- Do not ask a model to reinvent the workflow every scheduled run.

Recommended recurring job payload:

> Run a bounded SalesFlow-Lite lead-pack command, collect JSON output, summarize results, and ask the operator whether to review/draft outreach.

## 10. Quality bar

Before a change is trusted:

```bash
npm run typecheck && npm run lint && npm run format:check && npm test && npm run build
```

Before a live install is trusted:

- doctor healthy,
- credentials confirmed private,
- Sheet tabs/header layout verified,
- one small discovery run verified,
- one research pass verified,
- no unexpected Errors rows,
- run summary reviewed by operator,
- no outreach automation enabled without explicit confirmation.

## 11. Known hardening items

- Add persistent usage ledger before recurring mode.
- Replace whole-row lead upserts with field-scoped/optimistic writes.
- Implement live Sheet header/tab validation in doctor.
- Add website fetch timeout and response-size limits.
- Add optional web-search fallback for leads without websites.
- Implement at least one real notification adapter before advertising live notifications.
- Implement digest only after Dashboard/usage ledgers are real.
- Add a formal OpenClaw skill package after the recipe stabilizes.
