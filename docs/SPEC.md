# SalesFlow-Lite — Product & Technical Specification (v1.0 — Approved)

Status: **v1.0 — approved 2026-09-07, pending Google Cloud credential provisioning (deferred, see §10.2).**
Author: Ralleh, for Rick
Date: 2026-09-07
Repo (planned): `salesflow-lite` (new, separate from `sales-channel-manager` / SalesFlow)

---

## 0. Relationship to existing work

- `sales-channel-manager` ("SalesFlow") is a separate, paused project (Postgres + n8n + VAPI, barely started). Left as-is. We only borrow conventions from it where useful (naming discipline, decision log, invariants-first thinking). No shared code, no shared data store.
- SalesFlow-Lite is the active project going forward. It is designed from day one to be **packageable and resold/reused by other small businesses**, not just for the print shop.

---

## 1. Product Summary

SalesFlow-Lite is a lightweight, self-hostable lead-generation and sales-pipeline CRM built on OpenClaw, using **Google Sheets as the system of record** and **Google Maps (Places API)** as the primary lead-sourcing engine.

It continuously:
1. Searches a configured geography for businesses matching configured target categories.
2. Saves raw leads immediately (cheap, fast, no drops).
3. Separately researches each lead in the background (website, email, phone, socials, business signals) until a "research completeness score" threshold is hit.
4. Categorizes each lead against the operator's product/service catalog (e.g. "school → banners", "restaurant → menus/signage").
5. Runs those leads through a configurable sales pipeline (state machine) with scheduled follow-ups and no silent drops.
6. Keeps full history/audit trail of every state change, contact attempt, and research update.
7. Notifies the operator via a configurable channel (Telegram, email, etc.) at meaningful events.

The whole thing is meant to be describable as a **recipe/prompt** that an operator can hand to an OpenClaw agent to have it install, configure, and stand up this app for their own business — turning it into a repeatable product, not a one-off build for the print shop.

---

## 2. Core Design Principles

- **Sheets as database, but disciplined.** Google Sheets is the storage layer, not a scratchpad. Every tab has an explicit schema, header row, data-validation rules where Sheets supports them, and is written to only through defined operations (never ad hoc cell edits by automation).
- **No drops.** Every lead that enters the system gets a row and a status. Nothing is found and silently discarded. Failed/rejected leads get an explicit terminal status with a reason, not a deletion.
- **Two independent cron loops, not one big one.** Lead *discovery* (Maps search) and lead *research* (enrichment) run on separate schedules so a slow enrichment pass never blocks new-lead intake, and so research can retry/backoff independently.
- **State machine sales pipeline.** Every lead has exactly one `pipeline_stage` at a time. Transitions are logged. No stage is skipped silently; every transition has a reason and timestamp.
- **Configurable, not hardcoded.** Target categories, product/service catalog, geography, follow-up cadence, notification channel, and scoring thresholds all live in a config tab/file — not in code — so the same app serves a print shop or a landscaper without a rebuild.
- **Idempotent, resumable.** Re-running discovery for the same area/category should not create duplicate rows (dedupe on Google Place ID). Research cron picks up exactly where it left off after restarts.
- **Auditable.** Every automated write includes a timestamp and an actor tag (`discovery_cron`, `research_cron`, `pipeline_cron`, `operator`) so the history tab can reconstruct exactly what happened and why.

---

## 3. Data Model — Google Sheets Layout

One spreadsheet ("SalesFlow-Lite Workbook"), multiple tabs. Google Sheets API v4 access via a service account.

### 3.1 Tab: `Leads` (primary table, one row per business)

| Column | Type | Notes |
|---|---|---|
| `lead_id` | text (UUID) | Primary key, generated at creation. Never reused. |
| `place_id` | text | Google Places `place_id`. Unique. Dedupe key for discovery. |
| `business_name` | text | From Places. |
| `category_raw` | text | Google Places category/type(s), comma-joined. |
| `address` | text | Formatted address from Places. |
| `lat` / `lng` | number | For map-based re-querying / distance calcs. |
| `phone` | text | From Places initially; overwritten by research if better source found. |
| `website` | text | From Places initially; overwritten/confirmed by research. |
| `email` | text | Populated by research only (Places doesn't provide this). |
| `socials` | text | JSON-ish semicolon list: `instagram:@x; facebook:url; linkedin:url`. |
| `research_score` | number (0–100) | Completeness score, see §5.2. |
| `research_status` | enum | `pending` \| `in_progress` \| `completed` \| `failed_permanent` |
| `product_fit_category` | text | From operator's product/service catalog config (e.g. `banners`, `menus`). |
| `product_fit_confidence` | number (0–1) | LLM confidence in the categorization. |
| `product_fit_rationale` | text | Short LLM-generated reason (1–2 sentences), for operator trust/QA. |
| `pipeline_stage` | enum | See §6. |
| `pipeline_stage_since` | datetime | When it entered the current stage. |
| `next_action_at` | datetime | When the pipeline cron should next touch this lead. |
| `next_action_type` | text | e.g. `send_intro_email`, `follow_up_call`, `none`. |
| `owner` | text | Free text; supports multi-user/future team use. |
| `source_query` | text | Which discovery search (category+area+date) produced this row. |
| `discovered_at` | datetime | First seen. |
| `last_touched_at` | datetime | Last write of any kind. |
| `notes` | text | Free-form operator notes. |

### 3.2 Tab: `History` (append-only log, one row per event)

| Column | Notes |
|---|---|
| `event_id` | UUID |
| `lead_id` | FK to Leads |
| `timestamp` | UTC |
| `actor` | `discovery_cron` \| `research_cron` \| `pipeline_cron` \| `operator` \| `system` |
| `event_type` | e.g. `discovered`, `research_updated`, `stage_transition`, `notification_sent`, `manual_edit` |
| `from_value` | prior value (e.g. prior stage) — blank if n/a |
| `to_value` | new value |
| `detail` | free text / short JSON |

This tab is the audit trail. Nothing overwrites it; it only grows. (Sheets doesn't enforce append-only, but our write layer never issues update/delete calls against this tab — only appends.)

### 3.3 Tab: `Config`

Key/value + structured sub-tables in one tab, sectioned by header rows. Holds:
- **Business profile**: operator name, product/service catalog (list of `category_name`, `trigger_business_types`, `pitch_blurb`).
- **Geography**: list of search areas (lat/lng + radius, or place names to geocode).
- **Target business types**: Google Places types/keywords to search per sweep.
- **Discovery cadence**: cron interval, max new leads per run, max Places API calls per day (cost guard).
- **Research cadence**: cron interval, max leads processed per run, backoff rules.
- **Scoring thresholds**: research completeness score required to mark `completed`.
- **Pipeline cadence rules**: follow-up intervals per stage (e.g. "no reply after 3 days → stage X").
- **Notification config**: channel (`telegram`/`email`/`none` per event type), destination, quiet hours.
- **Rate/volume targets**: target new leads per day/week (operator-set, referenced by discovery cron for pacing).

Config is human-editable directly in Sheets; the app re-reads it each cron run (no restart needed for most changes).

### 3.4 Tab: `Categories_Reference` (optional, supports product-fit logic)

Seed mapping table so the LLM categorizer has a grounded reference, editable by operator:

| `product_category` | `typical_business_types` | `pitch_notes` |
|---|---|---|
| `banners` | schools, gyms, construction, events | "Exterior banners for enrollment pushes, grand openings, sales events" |
| `menus_signage` | restaurants, cafes | "Laminated menus, window decals, sandwich boards" |
| ... | ... | ... |

This is print-shop-flavored by default but fully replaceable per install — this is the primary "make it generic" lever.

### 3.5 Tab: `Errors` (operational, not business data)

Captures API failures, quota hits, scrape failures, malformed data — separate from `History` so business audit trail stays clean. Columns: `timestamp`, `component`, `lead_id` (nullable), `error_type`, `message`, `retry_count`.

---

## 4. Discovery Loop (Lead Sourcing)

**Cron: `discovery_cron`** — configurable interval (e.g. every 2–6 hours), configurable per-run budget.

Process per run:
1. Read `Config` (areas × target business types not yet exhausted this cycle).
2. Call Google Places API (Nearby Search / Text Search) per area+type combination, paginated.
3. For each result:
   - Dedupe on `place_id` against existing `Leads` rows.
   - If new: create row with `research_status=pending`, `pipeline_stage=new`, fill in what Places already gives us (name, address, phone, website, category, lat/lng).
   - Log `discovered` event to `History`.
4. Respect configured daily API call budget (cost guard) — stop early and resume next run if hit.
5. Track which area+type combos were swept and when, to rotate coverage instead of hammering the same query every run.

This loop **never** enriches beyond what Places returns inline — that's the research loop's job. Keeps discovery fast and cheap.

---

## 5. Research Loop (Enrichment)

**Cron: `research_cron`** — separate, shorter interval (e.g. every 15–30 min), separate per-run budget (this is the more expensive step: scraping + LLM calls).

### 5.1 Process per lead (status `pending` or `in_progress`, oldest first)
1. If `website` present: fetch site (home page + `/contact`, `/about` if discoverable), extract:
   - Email (mailto: links, obfuscated patterns, contact-page text).
   - Phone (cross-check/improve on Places number).
   - Social links (footer/header link scan for known domains: facebook.com, instagram.com, linkedin.com, twitter.com/x.com, tiktok.com).
   - Business description text (for categorization input).
2. If no website: attempt a web search for `"<business_name>" "<address/city>"` to find one; if still nothing, mark that sub-check as exhausted (not a failure — some businesses just don't have one).
3. Run LLM categorization pass using: business name, Places category, scraped description, and the `Categories_Reference` catalog → produces `product_fit_category`, `product_fit_confidence`, `product_fit_rationale`.
4. Recompute `research_score` (see 5.2).
5. Update `Leads` row (fields only — never touch `pipeline_stage` from this loop).
6. Log `research_updated` event to `History` with what changed.
7. If `research_score >= completion_threshold` (config, default e.g. 70): set `research_status=completed`, log event, and this is the trigger condition the **pipeline cron** watches for to advance `new → qualifying`.
8. If repeated attempts (config, default 3) fail to move the score (e.g. site unreachable, no info findable anywhere): set `research_status=failed_permanent` with reason — **not deleted, not hidden** — surfaced to operator as "needs manual research" rather than silently dropped.

### 5.2 Research Completeness Score (0–100, weights configurable)
Suggested default weights:
- Website found: 20
- Email found: 25
- Phone confirmed/found: 15
- At least one social profile found: 15
- Business description sufficient for categorization: 15
- Product-fit categorization completed with confidence ≥ 0.6: 10

This score is a **research completeness** signal, distinct from any future "lead quality" score — kept separate so operators can later layer their own qualification scoring without conflating the two.

---

## 6. Sales Pipeline (State Machine)

**Cron: `pipeline_cron`** — runs on its own schedule (e.g. every 15–60 min), only touches `pipeline_stage`/`next_action_at`/`next_action_type`, and is the **only** writer allowed to change `pipeline_stage` (mirrors the "no direct stage writes" invariant from SalesFlow, adapted for Sheets).

### 6.1 Default stages (configurable/extendable per install)

```
new
  → qualifying        (auto, once research_status=completed)
  → qualified         (auto or manual, based on product_fit_confidence threshold)
  → outreach_attempted (after first contact action logged)
  → engaged           (lead responded)
  → meeting_scheduled
  → proposal_sent
  → won
  → lost              (explicit reason required)
  → nurture           (not ready now, scheduled long-term follow-up — the "no drops" safety net)
```

`lost` and `nurture` are both terminal-ish but distinct from deletion: `lost` requires a reason code (config-defined list, e.g. `no_budget`, `not_interested`, `unreachable`, `wrong_fit`), `nurture` requires a `next_action_at` re-check date (never indefinite/no date).

### 6.2 Follow-up / no-drop logic

- Every non-terminal stage has a configured max-dwell time and a default `next_action_type`. If `next_action_at` passes with no operator action logged, the pipeline cron auto-advances to a defined next step (e.g. auto follow-up message queued, or auto-drop to `nurture` after N attempts) — **it never just sits with a stale `next_action_at` doing nothing.**
- A lead can only reach `lost` through an explicit reason; the cron itself won't invent one — if a lead times out repeatedly with no reason available, it goes to `nurture`, not `lost`. This enforces the "no drops" requirement structurally.
- All stage transitions, whether cron-driven or operator-driven, log to `History`.

### 6.3 Outreach actions (v1 scope) — AgentMail integration (Drafts-only)

V1 uses [AgentMail](https://agentmail.to) — an API-first email provider built for AI agents (programmatic inbox creation, send/receive with threading, webhooks, Python/TS SDKs, MCP server available) — but **the app is only ever permitted to create drafts, never to send.** This is a hard safety rule, not a configurable option.

Design:
- Each SalesFlow-Lite install provisions **one AgentMail inbox** (e.g. `sales@<operator-domain>` or an AgentMail-hosted address) dedicated to outbound lead outreach. Inbox credentials/API key live in the install's `.env`, never in Sheets.
- The `pipeline_cron`, when a lead's `next_action_type` is an outreach action (e.g. `send_intro_email`, `send_follow_up_email`), calls the AgentMail API to **write a draft only** (AgentMail's draft/compose endpoint, not its send endpoint), using a template selected by `product_fit_category` (templates configurable in `Config`, with `{{business_name}}`, `{{product_fit_category}}` etc. placeholders).
- **The app's AgentMail API credentials must never be granted send scope/permission if AgentMail's API supports scoping keys that narrowly; if only one all-or-nothing key is available, the send codepath is simply never implemented/called — draft-creation only, enforced in code, not just by convention.**
- The operator reviews drafts in the AgentMail inbox (or connected mail client) and sends manually. This is a deliberate human-in-the-loop gate on all outbound business communication — no automated system emails a real business on this operator's behalf without a human pressing send.
- Every draft creation is logged to `History` (`event_type=outreach_draft_created`) with the AgentMail draft/thread id stored in `detail`, so the operator can locate it and so replies can be correlated back to the lead later.
- **Inbound replies**: AgentMail supports webhooks for incoming mail. A lightweight webhook receiver (or polling fallback if webhooks aren't wired up yet) matches inbound messages to a lead (by thread id or sender email) and advances `pipeline_stage` toward `engaged`, logging the reply to `History`. Exact receiver mechanism (webhook endpoint vs. OpenClaw-side polling) is an implementation detail decided during build, not this spec.
- **Safety rails**: draft-creation volume is still capped by a configurable daily limit (same cost-guardrail pattern as Places/LLM calls, see §9.1) to avoid runaway API usage, even though drafts carry no send risk to third parties.
- This still respects the "no drops" principle: if AgentMail draft creation fails (bad address, API error), that's logged to `Errors` and the lead's `next_action_at` is rescheduled for retry — never silently marked done.
- `pipeline_stage` only advances to `outreach_attempted` once a draft is confirmed created — not once it's sent, since the app has no visibility into or control over the manual send step. A future stage/flag (e.g. `draft_pending_send`) may be added if the operator wants the pipeline to distinguish "drafted" from "actually sent"; out of scope for v1 unless requested.

---

## 7. Notifications

Configurable per event type in `Config` tab. Each event type (new qualified lead, research failed_permanent, follow-up due, lead won, quota/budget warning) maps to a channel + destination, or `none`. Uses OpenClaw's `message` tool / `cron` delivery — Telegram, email, or others as available. Quiet hours respected (no 3am pings unless explicitly configured to ignore them).

---

## 8. Packaging as a Reusable "Recipe"

Per your direction, the very first build deliverable (after this spec is approved) is:

**A recipe/prompt document** that an OpenClaw agent (any agent, any operator) can be given to:
1. Ask the operator a short structured onboarding questionnaire (business type, product/service catalog, target geography, target business types, notification preference, Google API credential status).
2. Create the Google Sheet from a template (via Sheets API, using a service account the operator provisions) with all tabs/schemas/config pre-populated from their answers.
3. Set up the three cron jobs (discovery/research/pipeline) via OpenClaw's `cron` tool, scoped to that operator's workspace.
4. Verify the install (test API calls, test sheet write, confirm notification delivery) and report status back to the operator.

This recipe is the productized artifact — the actual print-shop instance we build locally afterward is both our dogfood test and the reference implementation the recipe is built from.

---

## 9. Non-Goals (v1)

- Not doing paid data enrichment (Hunter.io/Clearbit/ZoomInfo) — scrape-only per your direction; can be added later as a pluggable enrichment source.
- Not building a UI — Google Sheets *is* the UI for v1.
- Not multi-tenant in one spreadsheet — one workbook per operator/business (packaging model handles multiple installs, not one shared sheet).
- Not doing outbound SMS or voice in v1 — email via AgentMail only; SMS/voice are candidate fast-follow phases.

### 9.1 Cost Guardrails (tunable defaults)

All of the following live in the `Config` tab and are operator-tunable per install — the numbers below are sane starting defaults, not hard limits:

| Guardrail | Default | Notes |
|---|---|---|
| Max Places API calls/day | 50 | Discovery cron cost guard. |
| Max research LLM calls/day | 100 | Research cron cost guard (categorization + scoring passes). |
| Max website scrape fetches/day | 150 | Separate from LLM calls since scraping is cheap but can still hit rate limits/blocks. |
| Max AgentMail drafts created/day | 25 | Draft-creation volume guard; drafts carry no third-party risk but still bounded to avoid runaway API usage. |
| Discovery cron interval | every 4 hours | Configurable; tighter for high-volume ops, looser for small single-city runs. |
| Research cron interval | every 20 minutes | Independent of discovery so backlog doesn't block new intake. |
| Pipeline cron interval | every 30 minutes | Drives follow-up timing granularity. |

All values configurable without redeploying — edit `Config` tab, cron reads fresh each run.

---

## 10. Decisions Locked (2026-09-07)

1. **Outreach sending**: AgentMail API integration in v1, **Drafts-only — the app never sends email itself.** All outbound messages are created as drafts for the operator to review and send manually (see §6.3). This is a hard rule, not configurable.
2. **Google Cloud project**: deferred. Rick will obtain Google Cloud project + Places API + Sheets API + service account key separately. Build proceeds on the recipe/spec side in the meantime; local instance stand-up waits on the key.
3. **Reference instance geography**: **San Antonio, Texas** (print shop). Radius and exact target business types (top 3–5) still to be pinned down when we configure the real instance — not blocking spec approval.
4. **Cost guardrails**: approved as tunable, defaults proposed in §9.1.
5. **Naming**: `salesflow-lite` confirmed.

---

## 11. Next Steps

1. ~~Spec review~~ — **done, v1.0 approved.**
2. Write the **recipe/prompt document** (the installer artifact) per §8 — **next task.**
3. Scaffold the `salesflow-lite` repo per this spec (schema definitions, config templates, cron job definitions, AgentMail integration stub).
4. Once Rick has Google Cloud credentials: provision service account, stand up the San Antonio print shop reference instance, pin down radius + target business types at that point.
5. Local build validation using the reference instance as the dogfood test of the recipe itself.
