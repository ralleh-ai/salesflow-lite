# Changelog

All notable changes to this project are documented here.
Format loosely follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added
- Initial repository scaffold: TypeScript project structure, ESLint/Prettier,
  Vitest, CI workflow, issue/PR templates.
- `docs/SPEC.md` v1.0 — full product/technical specification.
- `docs/RECIPE.md` v1.0 — agent-executable install recipe.
- `docs/GOOGLE_CLOUD_SETUP.md` — Google Cloud credential provisioning guide.
- Domain types (`src/types/domain.ts`) mirroring the Sheets schema.
- Config schema with zod validation and documented guardrail defaults.
- Stub modules for discovery, research, pipeline, Sheets client, and
  AgentMail client (drafts-only) — not yet implemented, scoped and
  documented per `docs/SPEC.md`.
- `Comms_Threads` tab/type (`CommsThreadEvent`) — per-lead communication
  history distinct from the system-event `History` tab (SPEC §3.6).
- Provider-agnostic email draft interface (`EmailDraftClient`) — AgentMail
  remains the default, Gmail API and Microsoft Graph API documented as
  drafts-only alternatives (SPEC §6.4); `src/agentmail/client.ts` renamed
  from a hardcoded `AgentMailClient` accordingly.
- Google Docs/Drive collateral integration (SPEC §3.7) — per-install Drive
  folder for email templates, brochures, invoices, proposals, RFP
  responses, linked via a `Config` "Template & Collateral Map"
  (`CollateralMapping` type, `templateCollateralMap` config field).
- Formal credential security policy (SPEC §12) — all credentials live only
  in OpenClaw-managed environment config, never Sheets/Docs/chat/git;
  `docs/RECIPE.md` §2.6 makes verification a mandatory install step.
- Seven MVP-hardening features (SPEC §15, third round): duplicate/conflict
  detection (§4.2, `dupOfLeadId`), manual lead entry/import (§4.1,
  `source` field), a formula-only `Dashboard` tab (§6.6), a
  `DoNotContact` opt-out list (§6.5, `dnc` field/`DoNotContactEntry`
  type), weekly CSV backup/versioning to Drive (§9.2,
  `backupRetentionSnapshots` config), Google API rate-limit/backoff
  hardening in the discovery loop (§4 step 9), and a manual snooze
  override (§6.2a, `snoozeUntil` field).
- `docs/CODE_REVIEW.md` — full review of the initial scaffold's stub code
  against the spec, with concrete fixes applied (see below).

### Fixed
- `src/config/env.ts` no longer hardcodes an `AGENTMAIL_API_KEY`
  requirement — reads a new `EMAIL_PROVIDER` variable and only requires
  the credential the configured provider actually needs, matching the
  provider-agnostic design in SPEC §6.4.
- `src/config/env.ts` no longer uses unchecked `as` casts for enum-like env
  vars (`NOTIFICATION_CHANNEL`, `NODE_ENV`, `LOG_LEVEL`, `EMAIL_PROVIDER`)
  — a new `parseEnum()` helper validates and fails loudly on a bad value
  instead of silently accepting a typo.
- `SheetsClient` and the discovery/research/pipeline stub signatures now
  use real domain types (`Lead`, `HistoryEvent`, `ErrorRecord`,
  `CommsThreadEvent`, `CategoryReference`, `DoNotContactEntry`,
  `AppConfig`) instead of `unknown`, and `SheetsClient` gained the
  previously-missing `appendCommsThreadEvent()`/`getDoNotContactList()`
  methods.
- Fixed a real `exactOptionalPropertyTypes` typecheck error in
  `src/config/env.ts` surfaced while validating the build.

### Known gaps (tracked, not yet built)
- No real Google Sheets API implementation yet (blocked on Google Cloud
  credentials — see `docs/GOOGLE_CLOUD_SETUP.md`).
- No real AgentMail/Gmail/Graph API implementation yet.
- No real Places API discovery implementation yet.
- Reference instance (San Antonio print shop) not yet configured.
- `.env.example` needs a follow-up update for `EMAIL_PROVIDER`,
  `GMAIL_OAUTH_CREDENTIALS_PATH`, `GRAPH_CLIENT_CREDENTIALS_PATH` (see
  `docs/CODE_REVIEW.md` Known Gaps).
- Append-only/single-writer invariants (History/Comms_Threads/Errors,
  pipeline_stage) are documented in SPEC.md but not yet enforced by the
  type system or a lint rule — flagged in `docs/CODE_REVIEW.md`, deferred
  as real design work rather than rushed.
