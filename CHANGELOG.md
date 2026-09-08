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
- Rewrote `docs/SPEC.md` to make batch-first lead packs the default product shape and mark recurring/CRM behavior as later-phase capability rather than mandatory day-one scope.
- Rewrote `docs/RECIPE.md` into a phase-tagged agent-executable recipe with a short Phase 1 onboarding flow and clear stop conditions before recurring or CRM-lite upgrades.
- Rewrote `docs/GOOGLE_CLOUD_SETUP.md` to explicitly separate Sheets service-account auth from Places API-key auth and require provider-side billing/budget alerts.
- Restored root `categories.md` as a generic template and moved the San Antonio print-shop example into `docs/examples/categories.print-shop-satx.md`.

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
- Unit tests for environment loading, Phase 1 keyword categorization, and AppConfig discovery-target defaults.

### Fixed

- Added missing `dotenv` runtime dependency so `src/config/env.ts` can actually load.
- Upgraded `googleapis` and removed the redundant direct `google-auth-library` dependency; Sheets auth now uses `google.auth.JWT` from the same dependency tree as `googleapis`.
- Removed the vulnerable direct `uuid` dependency; the code uses `node:crypto` `randomUUID()`.
- Discovery now refuses to run broad fallback searches when target terms are empty; it logs `missing_discovery_targets` instead.
- Discovery rotation now respects the injected clock, improving deterministic tests/dry-runs.
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
