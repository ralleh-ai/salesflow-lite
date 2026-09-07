# SalesFlow-Lite

**An autonomous revenue-operations engine, disguised as a spreadsheet.**

Most pipeline tooling fails small businesses for one of two reasons: it's
built for enterprise sales teams and demands a headcount to administer, or
it's a glorified contact list with no actual intelligence behind it.
SalesFlow-Lite is neither. It is a fully autonomous, closed-loop
lead-generation and pipeline-management system — sourcing, research,
qualification, and structured follow-up run continuously, in the
background, without a human touching a keyboard until a decision actually
requires human judgment.

Think of it as hiring a tireless SDR who never forgets a follow-up, never
lets a lead go cold, and never sends an email without your sign-off first.

**What it actually does, end to end:**

1. **Sources** — continuously scans a target geography via the Google Maps
   Places API for businesses matching your configured ideal-customer
   categories. This is always-on top-of-funnel generation, not a one-time
   list pull.
2. **Qualifies** — enriches every prospect (website, contact info, socials)
   and scores product/service fit against *your* catalog, so your funnel is
   never diluted with leads that don't convert.
3. **Advances** — runs every qualified lead through a configurable pipeline
   state machine with scheduled, no-drop follow-ups. No lead silently
   disappears; every terminal state is explicit and auditable.
4. **Reports** — a live Dashboard and configurable digest give you funnel
   visibility without you having to ask for it.

All of it lives in one inspectable, human-readable Google Sheet — the
system of record every stakeholder can already read, with zero new
infrastructure to operate or hand off. It runs on
[OpenClaw](https://github.com/openclaw/openclaw).

It is engineered to be **packaged and redeployed across any small-business
vertical** — the pipeline logic, guardrails, and reporting are configuration,
not code, for the business you're actually running.

> **Status: pre-implementation.** Specification and install recipe are
> complete and approved (v1.0). Source modules are scaffolded but not yet
> implemented — see [`CHANGELOG.md`](./CHANGELOG.md) for exact state.

---

## How to actually get the most out of this: think like a Chief Sales Officer, not a spreadsheet clerk

The single biggest lever you control is **category and geography precision**
in your onboarding config. A CRM is only as good as the funnel it's fed —
garbage targeting produces a Dashboard full of vanity metrics and a pipeline
of leads that were never going to close. Before you flip this on:

- **Define your ideal customer narrowly, then widen.** "Schools that need
  banners" converts. "Any business that might need printing" does not.
  Start narrow, watch the response-rate section of your digest, then widen
  categories only where the data justifies it.
- **Treat the research-completeness threshold as a qualification gate, not
  a formality.** A lead that hasn't cleared a real research bar (working
  contact info, verifiable fit) is not a lead — it is unqualified noise
  competing for your outreach attention. Tune the threshold, don't just
  accept the default.
- **Read the guardrails as a budget, not a limit to max out.** Every daily
  cap (API calls, LLM calls, drafts) is a lever between volume and quality.
  Running at your ceiling every day means you've stopped tuning; running
  meaningfully under it means you're leaving pipeline on the table.
- **The digest is your weekly board meeting with yourself.** Read it like
  one. Funnel counts moving the wrong direction week over week is a signal
  to revisit targeting or messaging — not something to let accumulate
  silently.
- **You are the close, not the system.** SalesFlow-Lite's entire design
  philosophy is to compress the expensive, repetitive parts of prospecting
  (finding, researching, following up) down to zero marginal effort, so your
  time is spent exclusively on the highest-leverage sales activity that
  exists: talking to a qualified human being who already knows why you're
  calling.

Operated with discipline, this isn't a CRM you check. It's a funnel that
feeds itself, and it compounds — every week of continuous, no-drop
follow-up is pipeline a manual process would have silently lost.

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

## License

MIT — see [`LICENSE`](./LICENSE).
