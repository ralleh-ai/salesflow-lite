# SalesFlow-Lite — Code Review (2026-09-07)

Status: findings applied. Scope: the full initial scaffold under `src/` and `test/`, reviewed against `docs/SPEC.md` after the third round of feature additions (duplicate detection, manual entry, dashboard, DNC list, backup/versioning, rate-limit hardening, snooze override).

Reviewer stance: blunt, no participation trophies. Stub code is fine to be unimplemented (the bodies are `throw new Error(...)` on purpose per `docs/RECIPE.md` — nothing here should fabricate behavior before real credentials exist), but **the types, contracts, and invariants around those stubs must already be correct**, because that's the one thing that's cheap to fix now and expensive to fix after three modules depend on a sloppy interface. This review only cares about things that are actually wrong, not style preferences.

---

## Findings

### 1. `src/config/env.ts` — hardcoded AgentMail requirement contradicted the project's own provider-agnostic decision (Severity: **High** — real bug, not polish)

We spent an entire round of spec work (SPEC §6.4) establishing that AgentMail is the *default*, not a *hard dependency* — Gmail API and Microsoft Graph are equally valid. But `loadEnvConfig()` still called `requireEnv("AGENTMAIL_API_KEY")` unconditionally. An install that chose Gmail per the recipe's own §1.6a questionnaire would fail to boot, demanding a credential for a provider it isn't using. The env loader was out of sync with the spec the moment §6.4 was written, and nobody closed the loop until this review.

**Fix applied**: `env.ts` now reads an `EMAIL_PROVIDER` variable (`agentmail` | `gmail` | `graph`, default `agentmail`) and only requires the credential that provider actually needs (`AGENTMAIL_API_KEY`, `GMAIL_OAUTH_CREDENTIALS_PATH`, or `GRAPH_CLIENT_CREDENTIALS_PATH` respectively). `.env.example` needs a follow-up pass to document the new variable set (tracked below).

**Update (2026-09-07, Rick's decision):** AgentMail was subsequently locked in as the sole supported email provider. `env.ts` now requires `AGENTMAIL_API_KEY` unconditionally again — this is intentional, not a regression of this finding; the provider-agnostic `EmailDraftClient` interface is retained in case a future alternative provider is added, but the multi-provider env-selection logic this finding fixed has been simplified away along with it.

### 2. `src/config/env.ts` — unchecked `as` casts on every enum-like env var (Severity: **Medium** — defeats the module's own stated purpose)

The module's header comment says config should "fail loudly and early rather than silently misbehaving mid-cron-run." The implementation did the opposite: `(process.env.NOTIFICATION_CHANNEL as EnvConfig["notificationChannel"]) ?? "none"` accepts *any* string and blindly casts it. Set `NOTIFICATION_CHANNEL=telegrm` (typo) in `.env` and the app boots fine, then does nothing useful the first time a notification tries to fire three hours into a cron run — exactly the failure mode the comment claims to prevent.

**Fix applied**: added a small `parseEnum()` helper that validates against an explicit allowed-values array and throws a clear error naming the bad variable and the valid options, applied to `notificationChannel`, `nodeEnv`, `logLevel`, and the new `emailProvider`. No casts left in the file.

### 3. `src/sheets/client.ts`, `src/discovery/sweep.ts`, `src/research/pass.ts`, `src/pipeline/sweep.ts` — domain types existed and were unused (Severity: **Medium** — wasted the entire point of strict TypeScript)

`src/types/domain.ts` defines `Lead`, `HistoryEvent`, `ErrorRecord`, `CommsThreadEvent`, `CategoryReference`, `DoNotContactEntry` — a real, fairly careful contract mirroring the Sheets schema. But `SheetsClient`'s methods were typed `Promise<unknown[]>` / `unknown` on both read and write paths, and the sweep functions took no typed arguments at all. That's not "appropriately minimal for a stub" — it's a stub that silently disables the compiler for the one thing (cross-module data contracts) that TypeScript strict mode exists to catch. The moment someone implements `runPipelineSweep` and passes a lead object with a typo'd field name to `upsertLead(lead: unknown)`, it compiles fine and breaks in Sheets at 2am.

**Fix applied**:
- `SheetsClient` interface now returns/accepts `Lead`, `HistoryEvent`, `ErrorRecord`, `CommsThreadEvent`, `CategoryReference`, `DoNotContactEntry`, `AppConfig` — no `unknown` left in its surface.
- Added `SheetsClient.appendCommsThreadEvent()` and `SheetsClient.getDoNotContactList()`, which were entirely missing despite both tabs being fully specified (§3.6, §6.5) and required by the pipeline logic that's supposed to write to them.
- `runDiscoverySweep`, `runResearchPass`, `runPipelineSweep` now import and reference `Lead` and (for the pipeline sweep) `EmailDraftClient` in their signatures, so the eventual real implementation is guided by a compiler-checked contract, not just prose comments.

### 4. No shared duplicate-detection function — spec described one code path, scaffold had none (Severity: **Medium**, pre-empted before it became a real bug)

SPEC §4.2 explicitly requires that discovery-sourced and manually-entered leads run through *the same* duplicate check — "same function, same rules, no special-casing by source." Nothing in the scaffold enforced or even stubbed this, which is exactly how a codebase ends up with two copies of "same" logic that quietly diverge over a few PRs.

**Fix applied**: added `checkForDuplicateLead()` as an exported, independently-typed function in `src/discovery/sweep.ts`, with a doc comment directing any future manual/import entry point to call it rather than re-implement matching logic.

### 5. No pure, independently-testable core logic — everything was one opaque `run*()` async function (Severity: **Low/Medium** — a design smell worth fixing while it's cheap)

Each sweep module had exactly one exported function, an `async () => Promise<void>` that throws. That's fine for "not implemented yet," but it also means the *eventual* real implementation has no natural seam for unit tests — `research_score` calculation, duplicate matching, and the DNC/snooze skip check are all pure functions of data (per spec) that should never need to mock Sheets, Places, or an email client to test.

**Fix applied**: pulled three pure-logic seams out as separate exported stubs, matching functions the spec already implies exist conceptually:
- `computeResearchScore()` in `src/research/pass.ts` (SPEC §5.2 weights, no I/O).
- `checkForDuplicateLead()` in `src/discovery/sweep.ts` (SPEC §4.2, no I/O).
- `shouldSkipAutoAdvance()` in `src/pipeline/sweep.ts` (SPEC §6.2a snooze + §6.5 DNC, no I/O).

None of these are implemented yet (still `throw`), but the *shape* now exists so the real implementation has an obvious, testable seam instead of one monolithic function that has to be tested end-to-end against a live Sheets mock.

### 6. Nothing enforces the append-only / single-writer invariants beyond prose (Severity: **Low**, flagged not fixed — see Known Gaps)

SPEC.md repeatedly states hard invariants — "pipeline_cron is the only writer of `pipeline_stage`," "`History`/`Comms_Threads`/`Errors` are append-only, no update/delete calls" — but nothing in the type system or a lint rule actually stops another module from calling `SheetsClient.upsertLead()` with a changed `pipelineStage` field, or adding an `updateHistoryEvent()` method later out of convenience. This is a real gap, but fixing it properly (e.g. splitting `Lead` into a pipeline-owned subset type, or a custom ESLint rule restricting which files may import which client methods) is real design work, not a five-minute review fix — doing it hastily here risked introducing a worse, half-finished abstraction. Documented as a known gap instead of rushed.

---

## Known Gaps (not fixed in this pass, tracked deliberately)

- ~~`.env.example` needs updating for the new `EMAIL_PROVIDER`, `GMAIL_OAUTH_CREDENTIALS_PATH`, `GRAPH_CLIENT_CREDENTIALS_PATH` variables~~ — moot as of 2026-09-07: AgentMail was locked in as the sole supported email provider, so these multi-provider variables were never added to `.env.example` in the end.
- **Invariant enforcement (finding #6)** — worth a real design pass (likely a lightweight custom lint rule or a branded/opaque type for `pipelineStage` writes) once there's a second real contributor to police, rather than solved unilaterally here.
- **`AgentMailClient` deprecated alias** in `src/agentmail/client.ts` is a compatibility shim from the mid-project rename to `EmailDraftClient` — fine to keep short-term, but should be deleted once nothing in the codebase or its history depends on the old name (nothing currently does; it can be removed any time).
- This review did not re-audit `docs/` prose for accuracy beyond what changed in this same session — a full documentation-vs-code drift audit is worth doing again once the real Sheets/Places implementation lands, since that's when stub signatures will actually get exercised and any remaining mismatch will surface.

---

## Verification

All of the following were run clean after applying the fixes above:
- `npm run typecheck` — 0 errors.
- `npm run lint` — 0 errors, 0 warnings.
- `npm run format` — no diffs after auto-format.
- `npm test` — 2/2 passing (guardrail defaults + validation).

No behavior changed for the passing test (it only covers `GuardrailsSchema`, untouched in substance). No new tests were added in this pass because the fixes are type/contract-level on functions that still intentionally throw — real unit tests land with the real implementations of `computeResearchScore`, `checkForDuplicateLead`, and `shouldSkipAutoAdvance`.
