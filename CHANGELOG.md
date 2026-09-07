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

### Known gaps (tracked, not yet built)
- No real Google Sheets API implementation yet (blocked on Google Cloud
  credentials — see `docs/GOOGLE_CLOUD_SETUP.md`).
- No real AgentMail API implementation yet.
- No real Places API discovery implementation yet.
- Reference instance (San Antonio print shop) not yet configured.
