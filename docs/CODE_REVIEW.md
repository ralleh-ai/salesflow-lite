# SalesFlow-Lite Code Review Notes

Status: historical review log.

The repo was refactored on 2026-09-08 from a CRM-first design into the four-phase OpenClaw-native product ladder documented in `README.md`, `docs/SPEC.md`, and `docs/RECIPE.md`:

1. Batch Lead Scout.
2. OpenClaw Recipe / Skill Pattern.
3. Recurring Mode.
4. CRM-Lite.

This file now records review lessons rather than serving as the product source of truth.

## 2026-09-08 review outcome

Major findings addressed in the phase refactor:

- README/spec/recipe now describe the same product shape.
- Phase 1 no longer requires AgentMail or cron.
- Places API auth is explicit via `GOOGLE_PLACES_API_KEY`.
- Discovery target terms are explicit via `Config.discoveryTargetBusinessTypes`.
- Runtime `dotenv` dependency is present.
- Root `categories.md` is a reusable template; San Antonio print-shop content moved to `docs/examples/`.
- Pipeline no longer upserts every lead on every run due to an always-true dirty condition.
- Pipeline DNC matching now uses shared normalization helpers.
- A zero-LLM keyword categorizer exists for low-cost Phase 1 lead packs.
- CLI entrypoints exist for doctor/discover/research/pipeline/batch workflows.

## Remaining high-value review targets

These are the next areas a serious reviewer should pressure-test:

1. **Persistent budget ledger** — recurring mode needs durable daily usage accounting, not in-memory per-run counters.
2. **Sheet write concurrency** — whole-row `upsertLead()` should become field-scoped or optimistic-locking updates before multiple crons/operators can safely write at once.
3. **Live doctor checks** — doctor should validate Sheet tabs, headers, Config JSON, and credentials with lightweight API calls.
4. **Scrape hardening** — website fetches need timeouts, response-size caps, and better no-website fallback behavior.
5. **Notification reality** — notification adapters and digest should either be implemented or remain clearly later-phase.
6. **Outreach compliance** — draft templates should include operator identity and opt-out language appropriate to the operator's jurisdiction and use case.
7. **OpenClaw skill packaging** — after the recipe stabilizes, package the operating procedure as a real OpenClaw skill/proposal rather than only docs.

## Historical lesson

The original design tried to ship the full CRM loop as v1. The better engineering/product shape is to make the first useful unit a bounded lead pack, then add automation and CRM behavior only after the operator has validated lead quality.
