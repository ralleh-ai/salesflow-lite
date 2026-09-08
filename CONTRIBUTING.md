# Contributing to SalesFlow-Lite

SalesFlow-Lite is phase-based:

1. Batch Lead Scout.
2. OpenClaw Recipe / Skill Pattern.
3. Recurring Mode.
4. CRM-Lite.

Keep changes scoped to the phase they improve. Do not make Phase 1 depend on Phase 4 infrastructure.

## Before writing code

- Read `README.md`, `docs/SPEC.md`, and the relevant phase section in `docs/RECIPE.md`.
- If behavior changes, update docs in the same PR.
- If a change spends money, sends notifications, creates drafts, or touches credentials, state the safety/guardrail impact explicitly.

## Local setup

```bash
npm install
cp .env.example .env
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
```

## Code standards

- TypeScript strict mode.
- No `any` without an explanatory comment.
- Prefer pure functions for matching, scoring, routing, and rendering.
- All Sheets access goes through `src/sheets/client.ts`.
- All Places discovery goes through `src/discovery/sweep.ts`.
- All outreach draft providers go through `EmailDraftClient`.
- No prospect-send endpoint may be implemented without an explicit spec/security change.
- Phase 1 must not require AgentMail, cron, digest, or CRM pipeline setup.
- Use explicit target terms; never add broad fallback discovery.

## Testing expectations

Run before submitting:

```bash
npm run typecheck && npm run lint && npm run format:check && npm test && npm run build
```

Add tests for:

- config/env changes,
- dedupe/DNC normalization,
- budget/cost behavior,
- pipeline transitions,
- Sheet row mapping,
- model-output parsing,
- CLI smoke behavior where practical.

## PR checklist

- [ ] Phase impact is clear.
- [ ] Docs updated.
- [ ] Tests added/updated.
- [ ] Full local gate passes.
- [ ] No credentials or live business data committed.
- [ ] Drafts-only invariant preserved.
- [ ] Phase 1 remains runnable without email-provider setup.
