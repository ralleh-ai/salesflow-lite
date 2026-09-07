# Contributing to SalesFlow-Lite

## Before you write code

This project is spec-first. `docs/SPEC.md` is the source of truth for data
model, pipeline stages, and guardrail defaults — if your change touches any
of those, update `SPEC.md` in the same PR (or before it) rather than letting
code and spec drift apart.

## Local setup

```bash
npm install
cp .env.example .env   # fill in real values — never commit .env
npm run typecheck
npm run lint
npm test
```

## Code standards

- TypeScript, strict mode. No `any` without a comment explaining why.
- All Sheets access goes through `src/sheets/client.ts` — no direct
  `googleapis` calls elsewhere.
- All AgentMail access goes through `src/agentmail/client.ts` — **and that
  module must never implement a send endpoint call.** See `SECURITY.md`.
- New modules that touch `pipeline_stage` must not exist outside
  `src/pipeline/` — see `docs/SPEC.md` §6 ("only writer allowed to change
  pipeline_stage").
- Run `npm run format` before committing.

## Commit / PR conventions

- Reference the relevant `docs/SPEC.md` section in your PR description.
- Fill out `.github/PULL_REQUEST_TEMPLATE.md` checklist honestly.
- Keep PRs scoped to one module/concern where possible — this makes spec
  cross-referencing easier for reviewers.

## Testing

- Unit tests live in `test/unit/`, mirroring `src/` structure.
- Fixtures (sample Places API responses, sample scraped HTML, etc.) live in
  `test/fixtures/`.
- Prefer testing pure logic (scoring, state transitions, schema validation)
  over mocking Google/AgentMail APIs end-to-end; keep API-boundary code thin
  enough that it doesn't need heavy mocking to be confident in.

## Questions

Open an issue using the appropriate template in `.github/ISSUE_TEMPLATE/`.
