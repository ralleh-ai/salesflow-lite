# SalesFlow-Lite

A lightweight, Google Sheets-backed lead generation and sales pipeline CRM
for small businesses — built to run on [OpenClaw](https://github.com/openclaw/openclaw).

SalesFlow-Lite continuously searches a target geography (via Google Maps
Places API) for businesses matching an operator's configured target
categories, researches each one (website, email, phone, socials), evaluates
product/service fit against the operator's own catalog, and runs qualified
leads through a configurable sales pipeline with scheduled follow-ups and a
strict no-drops policy — all stored in a single, human-readable Google Sheet.

It is designed to be **packaged and reused across many types of small
businesses**, not just the print shop it was originally built for.

> **Status: pre-implementation.** Specification and install recipe are
> complete and approved (v1.0). Source modules are scaffolded but not yet
> implemented — see [`CHANGELOG.md`](./CHANGELOG.md) for exact state.

---

## Why Sheets, not a database?

Because the target user is a small business owner, not a DevOps team. A
Google Sheet is inspectable, editable, shareable, and requires zero
infrastructure to operate or hand off. See
[`docs/SPEC.md` §2](./docs/SPEC.md#2-core-design-principles) for the full
rationale and the discipline (schemas, append-only history, single-writer
rules) that makes "Sheets as database" actually reliable instead of a mess.

## Core safety rule: Drafts only

SalesFlow-Lite **never sends email automatically.** All outreach is created
as a draft (via [AgentMail](https://agentmail.to) or an alternative provider,
see [`docs/SPEC.md` §6.4](./docs/SPEC.md#64-email-provider-options-if-not-using-agentmail))
for the operator to review and send manually. This is a hard, non-configurable
rule, enforced by a provider-agnostic `EmailDraftClient` interface — see
[`docs/SPEC.md` §6.3](./docs/SPEC.md#63-outreach-actions-v1-scope--agentmail-integration-drafts-only)
and [`SECURITY.md`](./SECURITY.md).

## Diagnose and repair an install: `npm run doctor`

Every install accumulates ways to drift out of a healthy state — a missing
`.env`, an overly-permissive credential file, a `.gitignore` that no longer
covers secrets, guardrail values that can't actually be satisfied by the
configured cron cadence. Rather than debugging that by hand, run:

```bash
npm run doctor        # read-only diagnostic report
npm run doctor:fix     # same report, then applies safe/mechanical repairs
```

`doctor` checks (and `--fix` can repair): presence of `.env`, required
environment variables for the configured email provider, service account key
validity/permissions, `.gitignore` secret coverage, and a best-effort scan for
leaked credentials in tracked docs. It deliberately never invents credentials,
never deletes data, and never guesses at business config — those stay the
operator's/agent's call, per `docs/RECIPE.md` §0. See
[`src/doctor/checks.ts`](./src/doctor/checks.ts) for the full, growing list of
checks and the ground rules for adding new ones.

## Documentation

Start here, in this order:

| Document | Purpose |
|---|---|
| [`docs/SPEC.md`](./docs/SPEC.md) | The full product & technical specification — data model, cron design, pipeline state machine, guardrails. **Source of truth.** |
| [`docs/RECIPE.md`](./docs/RECIPE.md) | The agent-executable install recipe — how an OpenClaw agent onboards a new operator and stands up an instance end to end. |
| [`docs/GOOGLE_CLOUD_SETUP.md`](./docs/GOOGLE_CLOUD_SETUP.md) | Step-by-step guide to provisioning the Google Cloud project, APIs, service account, and shared Sheet a new install needs. |
| [`CONTRIBUTING.md`](./CONTRIBUTING.md) | Code standards, local setup, testing conventions. |
| [`SECURITY.md`](./SECURITY.md) | Hard security invariants (drafts-only rule, credential handling, scraped-content trust boundary). |
| [`CHANGELOG.md`](./CHANGELOG.md) | What's built vs. scaffolded vs. planned. |

## Architecture at a glance

Three independent scheduled loops, all reading/writing one Google Sheets
workbook, sharing nothing but the data:

```
┌────────────────┐     ┌────────────────┐     ┌────────────────┐
│  Discovery      │     │  Research       │     │  Pipeline       │
│  (Places API)   │     │  (scrape + LLM) │     │  (state machine)│
│  every ~4h      │     │  every ~20min   │     │  every ~30min   │
└───────┬─────────┘     └───────┬─────────┘     └───────┬─────────┘
        │                       │                        │
        └───────────────────────┴────────────────────────┘
                                 │
                        ┌────────▼─────────┐
                        │  Google Sheets    │
                        │  Leads / History  │
                        │  Config / Errors  │
                        │  Categories_Ref   │
                        └───────────────────┘
```

Full rationale for the three-loop split (why discovery, research, and
pipeline must not share a schedule) is in
[`docs/SPEC.md` §2](./docs/SPEC.md#2-core-design-principles).

## Project structure

```
salesflow-lite/
├── docs/                     Specification, recipe, setup guides, ADRs
│   └── adr/                  Architecture decision records (as they accumulate)
├── src/
│   ├── discovery/             Lead sourcing (Google Places API)
│   ├── research/               Enrichment (scrape + LLM categorization/scoring)
│   ├── pipeline/                Sales state machine + AgentMail draft creation
│   ├── sheets/                    Google Sheets API client (single point of access)
│   ├── agentmail/                  AgentMail client (drafts-only, hard rule)
│   ├── config/                       Env + business config schema (zod-validated)
│   ├── cron/                           Cron job wiring (OpenClaw `cron` tool)
│   ├── types/                            Shared domain types (mirrors Sheets schema)
│   └── util/
├── test/
│   ├── unit/                 Unit tests, mirrors src/ structure
│   └── fixtures/             Sample API responses / scraped HTML for tests
├── .github/                  CI workflow, issue/PR templates
├── .env.example              Environment variable template
└── package.json
```

## Getting started (once implementation lands)

```bash
npm install
cp .env.example .env      # fill in credentials — see docs/GOOGLE_CLOUD_SETUP.md
npm run typecheck
npm test
```

Standing up a real instance for an operator follows
[`docs/RECIPE.md`](./docs/RECIPE.md) end to end — onboarding questionnaire,
provisioning, dry run, and a post-install verification checklist.

## Relationship to `sales-channel-manager` ("SalesFlow")

This is a separate, independent project. An earlier, heavier-weight spec
(Postgres + n8n + VAPI) exists under `sales-channel-manager` in this
workspace but is paused/superseded for the small-business use case. No code
or data is shared between the two. See `docs/SPEC.md` §0 for the full note.

## License

MIT — see [`LICENSE`](./LICENSE).
