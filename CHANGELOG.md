# Changelog

All notable changes to this project are documented here.
Format loosely follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Changed (2026-09-08, phase-based product refactor)

- Repositioned SalesFlow-Lite from an always-on autonomous CRM-first project to a four-phase OpenClaw-native product ladder:
  1. Phase 1 — Batch Lead Scout.
  2. Phase 2 — OpenClaw Recipe / Skill Pattern.
  3. Phase 3 — Recurring Mode.
  4. Phase 4 — CRM-Lite.
- Rewrote `README.md` around the phase ladder, current implementation state, developer quick start, configuration model, safety invariants, and OpenClaw operating model.
- Rewrote `docs/SPEC.md` to make batch-first lead packs the default product shape, mark recurring/CRM behavior as later-phase capability rather than mandatory day-one scope, and define the business-practice bar for credible outreach.
- Rewrote `docs/RECIPE.md` into a phase-tagged agent-executable recipe with a short Phase 1 onboarding flow, exact Sheet headers, a business-practice filter, and clear stop conditions before recurring or CRM-lite upgrades.
- Rewrote `docs/GOOGLE_CLOUD_SETUP.md` to explicitly separate Sheets service-account auth from Places API-key auth and require provider-side billing/budget alerts.
- Restored root `categories.md` as a generic template and moved the San Antonio print-shop example into `docs/examples/categories.print-shop-satx.md`.
- Clarified that root `categories.md` is the only runtime product/service catalog, documented the best Phase 1 default, and added a doctor check to flag confusing duplicate example catalogs or an uncustomized template.

### Added

- `GOOGLE_PLACES_API_KEY` runtime config and doctor required-env validation. Places discovery now has an explicit credential path instead of relying on ambiguous service-account wording.
- Optional `EMAIL_PROVIDER=none|agentmail` runtime mode. Phase 1 lead packs no longer require AgentMail; CRM-lite outreach drafts require `EMAIL_PROVIDER=agentmail` and `AGENTMAIL_API_KEY`.
- `discoveryTargetBusinessTypes` in `AppConfigSchema`, making discovery targeting explicit and avoiding collateral-derived Places searches.
- Shared normalization helpers in `src/util/normalize.ts` for phone, business name, email, domain, and ZIP matching.
- Zero-LLM `createKeywordCategorizer()` for low-cost Phase 1 categorization from `categories.md`.
- CLI entrypoint `bin/salesflow-lite.ts` plus npm scripts:
  - `lead:doctor`
  - `lead:discover`
  - `lead:research`
  - `lead:pipeline`
  - `lead:batch`
- Structured discovery/research summaries in CLI output so a Phase 1 run reports new leads, API calls, categorization runs, budget stops, DNC matches, duplicate candidates, and errors.
- Unit tests for environment loading, Phase 1 keyword categorization, and AppConfig discovery-target defaults.

### Fixed

- Added missing `dotenv` runtime dependency so `src/config/env.ts` can actually load.
- Upgraded `googleapis` and removed the redundant direct `google-auth-library` dependency; Sheets auth now uses `google.auth.JWT` from the same dependency tree as `googleapis`.
- Removed the vulnerable direct `uuid` dependency; the code uses `node:crypto` `randomUUID()`.
- Discovery now refuses to run broad fallback searches when target terms are empty; it logs `missing_discovery_targets` instead.
- Discovery now fetches Place Details for insertable leads so Phase 1 captures website/phone data that Text Search often omits, while counting Text Search pages and Details calls against the Places call budget.
- Discovery rotation now respects the injected clock, improving deterministic tests/dry-runs.
- Phase 1's zero-LLM promise is now enforced in code: the keyword categorizer does not consume LLM budget, and Config guardrails allow `maxResearchLlmCallsPerDay: 0` / `maxAgentMailDraftsPerDay: 0`.
- Research attempt counting now uses existing `[research_attempt]` markers correctly before marking a lead `failed_permanent`.
- CI now runs `npm run build` in addition to typecheck/lint/format/test, matching the documented quality gate.
- Runtime env parsing now accepts every fallback notification channel documented in `.env.example` and doctor checks.
- Pipeline DNC matching now normalizes phone/email/domain/business-name values consistently.
- Pipeline no longer writes every lead on every run due to the always-true `lead.dnc !== undefined` condition; writes now depend on explicit dirty/stage-change state.
- Pipeline rescheduling now uses the sweep's captured `now` value instead of fresh `Date.now()` calls.

### Removed (cleanup)

- Removed the duplicate legacy `bin/doctor.ts` entrypoint; `npm run doctor`, `npm run doctor:fix`, and `npm run lead:doctor` now route through the unified `bin/salesflow-lite.ts` CLI.
- Removed generated local `dist/` build output from the working tree; it remains ignored.
- Removed empty placeholder ADR/test/source directories and the stale historical `docs/CODE_REVIEW.md` file now covered by git history and this changelog.
- Removed the unused placeholder `src/index.ts` barrel/entrypoint so the repo has one clear executable surface: the CLI plus directly imported modules.

### Known hardening items

- Add a persistent usage ledger before trusting Phase 3 recurring mode.
- Replace whole-row `upsertLead()` writes with field-scoped/optimistic updates to reduce Sheet clobber risk.
- Add live Sheet tab/header validation to doctor.
- Add website fetch timeout and response-size limits.
- Add optional web-search fallback for leads without websites.
- Implement at least one real notification adapter before advertising live notifications.
- Implement digest only after Dashboard/usage ledgers are real.
- Package a formal OpenClaw skill after the recipe stabilizes.

## 2026-09-07

### Added / changed

- Initial TypeScript project scaffold, docs, domain types, config schema, doctor CLI, notification/digest pure helpers, model routing helpers, and core sweep modules.
- Implemented real code paths for Google Sheets access, AgentMail draft creation, Google Places discovery, website research, LLM categorization interface, and CRM-lite pipeline sweep.
- Added `Comms_Threads`, `DoNotContact`, snooze, duplicate detection, model/token-budget awareness, and draft-only outreach invariants.

See git history for the detailed pre-refactor review notes from the original CRM-first design arc.
