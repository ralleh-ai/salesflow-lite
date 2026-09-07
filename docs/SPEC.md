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
| `source` | enum | `discovery` \| `manual` \| `import` — see §4.1. Distinguishes Places-sourced leads from operator-entered ones. |
| `discovered_at` | datetime | First seen. |
| `last_touched_at` | datetime | Last write of any kind. |
| `notes` | text | Free-form operator notes. |
| `dnc` | boolean | Do-not-contact flag, see §6.5. If true, no automated outreach draft is ever created for this lead regardless of pipeline stage. |
| `snooze_until` | datetime (nullable) | Operator-set override, see §6.6. If set and in the future, pipeline cron skips this lead's auto follow-up entirely (but does not alter `pipeline_stage`) until the date passes. |
| `dup_of_lead_id` | text (nullable) | FK to another `Leads` row, see §4.2. Set by the duplicate-detection check when this row is suspected to be a re-discovery of an existing lead under a different `place_id`. Not auto-merged — flagged for operator review. |

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

### 3.6 Tab: `Comms_Threads` (client communication history)

A dedicated, queryable log of every communication touchpoint with a lead — distinct from `History` (which logs *system/pipeline events*) and distinct from the AgentMail inbox itself (which is the actual message store). This tab is the CRM-style "conversation view" an operator can scan per-lead without opening AgentMail. One row per message/touchpoint (not per lead — a lead will have many rows over its lifecycle).

| Column | Type | Notes |
|---|---|---|
| `thread_event_id` | text (UUID) | Primary key. |
| `lead_id` | text | FK to `Leads`. |
| `channel` | enum | `email` \| `call` \| `sms` \| `in_person` \| `other` — extensible; email is the only channel the app itself automates in v1 (as drafts), others are operator-logged manually. |
| `direction` | enum | `outbound` \| `inbound`. |
| `timestamp` | datetime | When the message/touchpoint occurred. |
| `subject` | text | Email subject, or a short label for non-email touchpoints (e.g. "Follow-up call"). |
| `summary` | text | Short human/LLM-generated summary of the message content — kept short deliberately so the tab stays scannable; full body lives in the `body_ref` link, not duplicated here. |
| `body_ref` | text | Link/reference to the full message — an AgentMail thread/message URL or id for email; free text for manually logged touchpoints. |
| `external_thread_id` | text | AgentMail thread id (or other provider's thread id) for programmatic correlation — this is what inbound-reply matching (§6.3) keys off of. |
| `logged_by` | text | `pipeline_cron` \| `operator` \| `system`. |
| `sentiment` | text (optional) | Optional LLM-assessed tone (`positive`/`neutral`/`negative`/`unclear`) — nice-to-have for prioritization, not required for v1 core logic. |

Rules:
- **Every** outbound draft created (§6.3) gets a corresponding `outbound` row here at draft-creation time (not at send time, since the app can't observe sends) — so the operator sees a full timeline even before manually hitting send.
- **Every** inbound reply detected (via AgentMail webhook/polling) gets an `inbound` row, and is what drives the `pipeline_stage` advance toward `engaged` (§6.3).
- Manual touchpoints (a phone call, an in-person visit) are logged by the operator directly into this tab, or via a future lightweight logging affordance — out of scope to automate in v1 beyond making the tab exist and be easy to hand-fill.
- This tab, like `History`, is append-only from the app's perspective — corrections happen by adding a new row referencing the old one in `summary`/`body_ref`, not by editing history.

### 3.7 Google Docs: templates, brochures, and sales collateral

Google Sheets is the data store; **Google Docs (and Drive generally) is the collateral store.** Operators need somewhere to keep the actual content they send/attach — email templates, brochures, rate sheets, sample proposals/RFP responses, invoices — that's reusable across leads and easy for a non-technical operator to edit without touching code or the Sheets schema.

Design:
- A dedicated **Drive folder** per install (e.g. "SalesFlow-Lite — `<Business Name>` — Collateral"), shared with the same service account used for Sheets, holds:
  - **Email templates** (Google Docs), one per `product_fit_category` at minimum (e.g. a "banners" intro template, a "menus_signage" intro template), referenced by `product_fit_category` name so the pipeline cron can look up the right template when composing a draft (§6.3).
  - **Brochures / sales collateral** (Docs, Slides, or PDFs uploaded to Drive) — attachable to outreach drafts.
  - **Invoices / proposals / RFP responses** — same folder, or clearly named subfolders, so they're discoverable per engagement stage.
- A new `Config` section, **Template & Collateral Map**, records: `product_fit_category` → `template_doc_id`, plus a general-purpose list of `collateral_name` → `drive_file_id` → `attach_to_stage` (which pipeline stage(s) this collateral is relevant for, e.g. attach the brochure at `qualified`, attach a proposal template at `proposal_sent`).
- **Placeholder syntax in templates**: Doc-based templates use the same `{{business_name}}`, `{{product_fit_category}}` etc. placeholder convention as the existing template mechanism (§6.3) — the pipeline cron fetches the Doc's content (Docs API, or exported plaintext/HTML), performs placeholder substitution, and uses the result as the draft body. This keeps templates operator-editable in a familiar tool (Google Docs) rather than buried in Sheets cells or code.
- **Attachments**: when the pipeline cron creates a draft (§6.3) and the current stage/category has mapped collateral, the relevant Drive file(s) are attached to the draft (exact mechanism — Drive file export + AgentMail/provider attachment API vs. a shareable Drive link embedded in the body — is an implementation detail decided during build; a shareable link is the simpler/safer default since it avoids binary attachment handling and keeps the operator in control of Drive sharing permissions).
- This is still governed by the drafts-only hard rule (§6.3): attaching collateral to a draft is not sending it. No new send risk is introduced.
- Recorded in `Comms_Threads` (§3.6): the `summary`/`body_ref` for a draft that used a template + attached collateral should note which template/collateral was used, so the operator can audit what a lead was actually sent (once they hit send) without re-opening the draft.

This is intentionally a thin, Drive-native layer rather than a document-generation engine — SalesFlow-Lite does not generate brochures/invoices from scratch; it helps operators reuse and correctly attach documents they already have or create directly in Google Docs/Sheets/Slides.

---

## 4. Discovery Loop (Lead Sourcing)

**Cron: `discovery_cron`** — configurable interval (e.g. every 2–6 hours), configurable per-run budget.

Process per run:
1. Read `Config` (areas × target business types not yet exhausted this cycle).
2. Call Google Places API (Nearby Search / Text Search) per area+type combination, paginated.
3. For each result:
   - Dedupe on `place_id` against existing `Leads` rows.
   - If new: run the **duplicate/conflict check** (§4.2) before inserting.
   - If new and not a suspected duplicate: create row with `research_status=pending`, `pipeline_stage=new`, `source=discovery`, fill in what Places already gives us (name, address, phone, website, category, lat/lng).
   - If new but suspected duplicate: still create the row (no drops), but set `dup_of_lead_id` to the suspected match and log a `possible_duplicate` event to `History` — surfaced to the operator for manual review/merge decision, never auto-merged or auto-discarded.
   - Log `discovered` event to `History`.
4. Respect configured daily API call budget (cost guard) — stop early and resume next run if hit.
5. Track which area+type combos were swept and when, to rotate coverage instead of hammering the same query every run.
6. **Rate-limit/backoff handling**: if Google returns a quota/rate-limit error (HTTP 429 or `OVER_QUERY_LIMIT`), back off with exponential delay (configurable base/max, default e.g. 1s→32s) and log a `rate_limited` event to `Errors`, not `History` (it's operational, not business data). If the daily budget would be exceeded by continuing, stop the run cleanly — do not retry into the budget ceiling. A run that ends early due to rate-limiting or budget exhaustion is not a failure state; it resumes next scheduled run.

This loop **never** enriches beyond what Places returns inline — that's the research loop's job. Keeps discovery fast and cheap.

### 4.1 Manual lead entry / import

Not every lead comes from Places. Operators have referrals, trade-show contacts, or an existing client list. SalesFlow-Lite supports this without a code change:

- An operator (or the installing agent, during onboarding) can add a row directly to `Leads` with `source=manual` (or `source=import` for a bulk paste/CSV-derived batch) and whatever fields they already know (name, phone, email, website — skip what's unknown).
- `place_id` is optional for manual/import rows (it may not exist, e.g. a referral with no Google Business Profile) — dedupe for these rows falls back to the name+phone/name+zip fuzzy check in §4.2 rather than `place_id` matching.
- `research_status` starts at `pending` as normal *unless* the operator already has enough info to skip research — in that case they may set `research_status=completed` directly and the research cron will leave it alone (it never re-researches a `completed` row). This is an explicit operator override, not an automated decision.
- `pipeline_stage` starts at `new` as normal; the pipeline cron treats manual/import leads identically to discovery leads from that point forward. No special-casing downstream — `source` is metadata, not a different code path.
- This keeps discovery "one more input channel" rather than "the only door in," which matters for real-world adoption — no small business runs 100% of its pipeline through automated discovery.

### 4.2 Duplicate/conflict detection

Google Place ID dedupe (existing, §4) only catches exact re-discovery of the same Places entry. It misses:
- The same business appearing under a **different** Place ID (moved location, re-listed, franchise location vs. corporate listing).
- A **manually-entered** lead that's actually the same business already discovered automatically.

Before inserting any new row (from discovery or manual/import), run a lightweight fuzzy match against existing `Leads`:
- **Primary signal**: normalized phone number match (strip formatting, compare last-10-digits for US numbers).
- **Secondary signal**: normalized business name (lowercase, strip "LLC"/"Inc"/punctuation) + matching zip/postal code.
- If either signal matches an existing row: do **not** silently merge or silently skip. Insert the new row as usual (no drops), set `dup_of_lead_id` to the matched row's `lead_id`, and log `possible_duplicate` to `History` with both lead ids in `detail`.
- The operator resolves duplicates manually (e.g. mark one `lost` with reason `duplicate`, or ignore if it's a legitimately distinct franchise location) — this check is a **warning surface**, not an automated merge/delete, because auto-merging business records has a high cost when wrong (lost research, wrong pipeline stage inherited) and a fuzzy match is not proof of identity.
- This check runs in the discovery loop's insert path (§4 step 3) and in the manual/import path (§4.1) — same function, same rules, no special-casing by source.

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

### 6.2a Manual snooze override

Operators need to say "I've got this, don't auto-follow-up for a while" on a specific lead without touching the state machine's `next_action_at` bookkeeping (which the pipeline cron owns) or faking a stage change.

- The `snooze_until` column (§3.1) is the **only** column on `Leads` an operator sets directly to influence pipeline cron behavior (everything else pipeline-related is cron-owned).
- Each pipeline cron run: for any lead with `snooze_until` set and in the future, **skip** the normal follow-up/auto-advance logic for that lead entirely this run — `pipeline_stage` and `next_action_at` are left untouched. Log a `snoozed_skip` event to `History` (not `Errors` — this is expected, operator-directed behavior) so the audit trail shows why a lead didn't move.
- Once `snooze_until` passes, the lead re-enters normal pipeline cron processing on the next run — no special "resume" step needed, no field to clear (a past `snooze_until` is simply inert).
- This is deliberately dumb/simple: one nullable datetime column, one skip check, one log line. No new pipeline stage, no separate snooze queue/table.

### 6.3 Outreach actions (v1 scope) — AgentMail integration (Drafts-only)

V1 uses [AgentMail](https://agentmail.to) — an API-first email provider built for AI agents (programmatic inbox creation, send/receive with threading, webhooks, Python/TS SDKs, MCP server available) — but **the app is only ever permitted to create drafts, never to send.** This is a hard safety rule, not a configurable option.

Design:
- Each SalesFlow-Lite install provisions **one AgentMail inbox** (e.g. `sales@<operator-domain>` or an AgentMail-hosted address) dedicated to outbound lead outreach. Inbox credentials/API key live in the install's `.env`, never in Sheets.
- The `pipeline_cron`, when a lead's `next_action_type` is an outreach action (e.g. `send_intro_email`, `send_follow_up_email`), calls the AgentMail API to **write a draft only** (AgentMail's draft/compose endpoint, not its send endpoint), using a template selected by `product_fit_category` (templates configurable in `Config`, with `{{business_name}}`, `{{product_fit_category}}` etc. placeholders).
- **The app's AgentMail API credentials must never be granted send scope/permission if AgentMail's API supports scoping keys that narrowly; if only one all-or-nothing key is available, the send codepath is simply never implemented/called — draft-creation only, enforced in code, not just by convention.**
- The operator reviews drafts in the AgentMail inbox (or connected mail client) and sends manually. This is a deliberate human-in-the-loop gate on all outbound business communication — no automated system emails a real business on this operator's behalf without a human pressing send.
- Every draft creation is logged to `History` (`event_type=outreach_draft_created`) with the AgentMail draft/thread id stored in `detail`, so the operator can locate it and so replies can be correlated back to the lead later. **It is also logged as an `outbound` row in `Comms_Threads` (§3.6)** — `History` records the pipeline-level event; `Comms_Threads` records the actual communication content/thread for the operator's client-facing view.
- **Inbound replies**: AgentMail supports webhooks for incoming mail. A lightweight webhook receiver (or polling fallback if webhooks aren't wired up yet) matches inbound messages to a lead (by thread id or sender email) and advances `pipeline_stage` toward `engaged`, logging the reply to `History` **and appending an `inbound` row to `Comms_Threads`**. Exact receiver mechanism (webhook endpoint vs. OpenClaw-side polling) is an implementation detail decided during build, not this spec.
- **Safety rails**: draft-creation volume is still capped by a configurable daily limit (same cost-guardrail pattern as Places/LLM calls, see §9.1) to avoid runaway API usage, even though drafts carry no send risk to third parties.
- This still respects the "no drops" principle: if AgentMail draft creation fails (bad address, API error), that's logged to `Errors` and the lead's `next_action_at` is rescheduled for retry — never silently marked done.
- `pipeline_stage` only advances to `outreach_attempted` once a draft is confirmed created — not once it's sent, since the app has no visibility into or control over the manual send step. A future stage/flag (e.g. `draft_pending_send`) may be added if the operator wants the pipeline to distinguish "drafted" from "actually sent"; out of scope for v1 unless requested.

### 6.4 Email provider options (if not using AgentMail)

AgentMail is the default recommendation because it's purpose-built for agent-driven email (API-first inbox provisioning, native draft/compose + send separation, threading, webhooks) — but it is **not** a hard dependency of the architecture. Any provider that exposes a **create-draft-without-sending** API call can satisfy §6.3's hard rule. Alternatives, roughly ordered by fit:

| Provider | Fit for drafts-only automation | Notes |
|---|---|---|
| **Gmail API** (operator's own Google Workspace/Gmail account) | Strong | `users.drafts.create` is a first-class, well-documented endpoint completely separate from `users.messages.send` — very easy to enforce the hard rule in code (simply never call the send method). Natural fit if the operator already runs Google Workspace, since the same Google Cloud project used for Sheets/Places can also hold Gmail API OAuth credentials. Requires OAuth consent (not a service account) since it acts on a real mailbox — slightly more setup than a service account. |
| **Microsoft Graph API** (Outlook/Microsoft 365) | Strong | `POST /users/{id}/messages` with `isDraft` semantics / the drafts folder is well-supported; good option if the operator is on Microsoft 365 instead of Google Workspace. |
| **AgentMail** | Strong, purpose-built | Default recommendation — see §6.3. Best fit when the operator doesn't want to touch their real business mailbox at all and prefers a dedicated agent-facing inbox. |
| **SendGrid / Postmark / Mailgun (transactional email APIs)** | Weak for drafts-only | These are built around *sending*, not drafting — most don't have a native "draft" concept at all. Using one here would require faking drafts (e.g. storing the composed email only in `Comms_Threads`/Sheets and never calling the provider until a human explicitly triggers a separate send step outside the API's normal flow). Only recommend this path if the operator already has a transactional-email relationship with one of these and doesn't want to add AgentMail/Gmail/Graph — treat as a fallback, not a preferred option. |

Whichever provider is used, the codebase must isolate it behind the same `AgentMailClient`-shaped interface (`createDraft`, `listInboundMessages`) defined in `src/agentmail/client.ts`, so swapping providers doesn't ripple through `pipeline_cron` logic. The **drafts-only hard rule (§6.3, `SECURITY.md`) applies regardless of provider** — it is a project invariant, not an AgentMail-specific one.

### 6.5 Do-not-contact / opt-out list

A `DoNotContact` tab: `dnc_id`, `matched_field` (`phone`\|`email`\|`domain`\|`business_name`), `matched_value`, `reason` (`operator_added`\|`unsubscribe_request`\|`bounced_hard`\|`legal_request`), `added_at`, `added_by`.

Rules:
- Checked at **two** points, both mandatory: (1) discovery insert path (§4) — a newly-discovered business matching an entry here still gets a `Leads` row (no drops — the operator may want to see it exists) but is created with `dnc=true` and `pipeline_stage` frozen at `new` with no `next_action_type` ever assigned; (2) pipeline cron's draft-creation step (§6.3) — before calling the email provider's draft endpoint, re-check `dnc` on the lead (and re-check the `DoNotContact` list itself, in case it was added after the lead already existed) and refuse to create a draft if either check hits, logging `dnc_blocked` to `History` instead.
- The `dnc` column on `Leads` (§3.1) is a cached/denormalized flag for fast checking; the `DoNotContact` tab is the source of truth an operator edits. A sync step (part of the pipeline cron's per-run pass, cheap since it's just a lookup) keeps `Leads.dnc` in sync with `DoNotContact` for any lead whose phone/email/domain/name matches an entry.
- An operator adds to this list directly (unsubscribe request received via a reply, a legal request, or simply "stop contacting this one") — this is manual by design; the app never auto-adds to the DNC list on its own inference (e.g. a terse reply is not the same as an opt-out request).
- This is deliberately a hard block, not a pipeline stage: a `dnc` lead can still be `won` manually if the operator has a different, legitimate relationship with them (e.g. they opted out of cold outreach but became a client through another channel) — DNC blocks *automated outreach specifically*, not the pipeline model generally.

### 6.6 Basic reporting (`Dashboard` tab)

A `Dashboard` tab, built entirely from Sheets-native formulas over `Leads`/`History`/`Comms_Threads` — **no new code, no new cron.** Populated once during install (§2.1 of RECIPE.md) and left for the operator/Sheets to keep live automatically (`QUERY`/`COUNTIF`/`SUMIFS` formulas recalculate on every edit).

Minimum viable panels:
- **Pipeline funnel**: count of leads per `pipeline_stage`, updated live.
- **Leads per `product_fit_category`**: which categories are generating volume.
- **Response rate**: count of leads that reached `engaged` divided by count that reached `outreach_attempted`, over a rolling window (e.g. last 30 days by `pipeline_stage_since`/`Comms_Threads` timestamps).
- **Drafts pending review**: count of `Comms_Threads` `outbound` rows with no corresponding `inbound` reply and no operator-logged "sent" confirmation — i.e. things sitting in the provider's draft folder the operator hasn't acted on yet. (This is a proxy, not a perfect signal, since the app can't observe the manual send — documented as a known limitation on the tab itself via a cell comment.)
- **Guardrail usage today**: today's Places/LLM/scrape/draft counts vs. the configured daily maximums (§9.1) — gives the operator an at-a-glance sense of whether they're near a ceiling.

This tab is optional to keep updated by the operator (it's just formulas, nothing writes to it programmatically) but is created and pre-populated during install so day one already has a working view, not an empty tab the operator has to build themselves.

---

## 7. Notifications

### 7.1 Multi-channel routing

Notifications are no longer Telegram-only. The operator configures one or more **named destinations** (`notificationDestinations` in `Config`/`AppConfig`), each a `{ name, channel, target, enabled }` tuple. Supported channels: `telegram`, `discord`, `slack` (all routed through OpenClaw's `message` tool — never hand-rolled HTTP), `email` (direct send, not a draft — see §7.4 for why this is not a drafts-only violation), `sms` (requires an operator-configured SMS provider, e.g. Twilio), `webhook` (generic POST, for operators wiring their own alerting/Zapier/PagerDuty), and `none`.

Per-event-type routing (`notifications: NotificationRoute[]`) maps an event type (new qualified lead, `research failed_permanent`, follow-up due, lead won, quota/budget warning) to a channel, optionally naming a specific destination. An event type with no configured route, or explicitly routed to `none`, is a valid silent-by-design outcome — distinct from a delivery failure. Multiple destinations may share a channel (e.g. Telegram to the owner and Slack to a sales manager for the same event type).

Design in code: `src/notifications/notifier.ts` defines a `NotificationChannelAdapter` interface (one `send(target, message)` method) and one adapter per channel, mirroring the `EmailDraftClient` pattern already used for outreach. `resolveDestinationsForEvent()` is a pure function resolving event type + routing table + destinations list → the actual destinations to notify, kept separate from dispatch so routing logic has an I/O-free test seam.

### 7.2 Configurable digest

In addition to per-event notifications, the operator can enable a **digest** — a periodic rollup sent on its own configurable cron schedule (`digest.cronExpr`, default weekly Monday 8am), independent of the three existing crons (discovery/research/pipeline), per the project's "independent loops" design principle (§2). The digest pulls from the `Dashboard` tab's existing formulas (§6.6) — it never re-derives funnel/response metrics itself, so a human looking at the Sheet and a digest message can never disagree.

Configurable digest sections (`digest.sections`, operator picks any subset): `pipeline_funnel`, `category_volume`, `response_rate`, `drafts_pending`, `guardrail_usage`, `new_leads_since_last_digest`. The digest is sent to one or more named destinations (`digest.destinationNames`), can optionally respect quiet hours (`digest.respectQuietHours` — off by default, since a Monday-morning digest is rarely actually urgent/disruptive but an operator may still want strict quiet-hours discipline).

Design in code: `src/notifications/digest.ts` defines `renderDigestMessage()` (pure — DashboardSnapshot → NotificationMessage, respecting configured sections) and `resolveDigestDestinations()` (pure — digest config + destinations + quiet-hours flag → actual recipients this run), with `runDigestSweep()` as the (currently stub) cron entry point wiring both together with an actual Sheets read + dispatch.

### 7.3 Delivery audit trail

Every notification and digest dispatch attempt — sent, skipped (quiet hours), or failed — is logged via a `NotificationLogEntry` (new `src/types/domain.ts` type): timestamp, kind (`event`/`digest`), event type, destination name, channel, status, detail. This closes the same "no silent drops" gap that `History`/`Errors`/`Comms_Threads` already close for lead data — a failed Slack webhook must be as visible as a failed Sheets write, not swallowed by a try/catch. Reference implementation may either append these to a small `Notification_Log` tab (append-only, same discipline as `History`) or fold into `History` with `event_type=notification_sent`/`digest_sent` — left open pending the reference instance's actual notification volume; either choice must not silently drop entries.

### 7.4 Why email notifications aren't drafts-only

The drafts-only hard rule (§6.3/SECURITY.md) applies to **outreach to a lead** — content going to a prospect/customer. Operator-facing notifications (e.g. "new qualified lead discovered", "daily digest") go *to the operator themselves*, about their own business, not to a third party on their behalf. There is no reputational/consent risk analogous to unsolicited outreach, so `EmailNotificationAdapter` may send directly rather than draft. This distinction must be kept sharp in code: `EmailNotificationAdapter` (this module) and `EmailDraftClient` (`src/agentmail/client.ts`) are different classes with different capabilities, and neither should ever be substituted for the other. A future contributor must not "simplify" by merging them.

Quiet hours are respected for per-event notifications the same way as before; SMS/phone-adjacent channels in particular should never fire outside quiet hours unless the operator explicitly opts an event type out of quiet-hours suppression (not currently exposed as a per-route override — global quiet hours apply to all event-type notifications; only the digest currently has its own independent `respectQuietHours` toggle, since a weekly digest and a real-time "lead replied!" ping have different urgency profiles).

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

### 9.2 Backup / versioning safety net

Google Sheets has built-in version history (File > Version history), which covers accidental single-cell edits, but does not protect against an application-level bug (e.g. a bad cron write that mass-updates hundreds of rows before anyone notices) as cheaply as a point-in-time export does.

- **Weekly export**: a lightweight scheduled job (can piggyback on the pipeline cron's schedule or run as its own low-frequency cron — implementation detail) exports each tab to CSV and saves it into a dated subfolder in the install's Drive folder (§3.7) or a dedicated `Backups` Drive folder, e.g. `backups/2026-09-07/Leads.csv`.
- This is intentionally **not** a restore mechanism the app implements automatically — restoring from a CSV snapshot is a manual, deliberate operator action (copy data back in, or ask the installing agent to help), so a bad restore can't itself become a silent-drop or silent-overwrite risk.
- Retention: keep the last N snapshots (config, default 8 — roughly 2 months at weekly cadence) and let older ones age out, so Drive storage doesn't grow unbounded.
- This is cheap insurance, not a full backup/DR story — acceptable for v1 given Sheets' own version history already covers most day-to-day accidental-edit cases.

---

## 10. Decisions Locked (2026-09-07)

1. **Outreach sending**: AgentMail API integration in v1, **Drafts-only — the app never sends email itself.** All outbound messages are created as drafts for the operator to review and send manually (see §6.3). This is a hard rule, not configurable.
2. **Google Cloud project**: deferred. Rick will obtain Google Cloud project + Places API + Sheets API + service account key separately. Build proceeds on the recipe/spec side in the meantime; local instance stand-up waits on the key.
3. **Reference instance geography**: **San Antonio, Texas** (print shop). Radius and exact target business types (top 3–5) still to be pinned down when we configure the real instance — not blocking spec approval.
4. **Cost guardrails**: approved as tunable, defaults proposed in §9.1.
5. **Naming**: `salesflow-lite` confirmed.

---

## 12. Credential Security (OpenClaw environment)

Applies to every install, every provider choice (AgentMail, Gmail, Graph, etc.) and every API (Google Cloud, Places, Sheets). See also `SECURITY.md` for the project-wide hard invariants this section operationalizes.

- **Never store real credentials in Google Sheets, in chat, in `docs/`, or in code.** Credentials live in exactly one place: the OpenClaw environment's secret/config mechanism for that install (OpenClaw-managed `.env` under the install's own workspace directory, or the OpenClaw config secret store if the deployment uses one) — never hardcoded, never committed.
- **`.env` is gitignored by default in this repo** (see `.gitignore`) — verify this holds for every install's actual working copy, not just the template repo.
- **Google service account JSON keys** are treated as bearer credentials to the operator's entire Google Cloud project scope granted to that account. Store the key file path in `.env` (`GOOGLE_SERVICE_ACCOUNT_KEY_PATH`), store the file itself outside version control (the `credentials/` path is gitignored), and restrict file permissions on the host (e.g. `chmod 600`) where the OS supports it.
- **AgentMail (or Gmail/Graph) API keys** follow the same rule: `.env` reference only, never in Sheets/Docs/Drive, never pasted into a chat/log that gets persisted insecurely.
- **One credential set per install.** Do not reuse a service account, AgentMail inbox, or API key across multiple operators' installs — a compromised credential in one install must not expose another operator's data.
- **Recipe enforcement**: `docs/RECIPE.md` §2 (Provisioning Steps) must always instruct the installing agent to place every credential exclusively into that install's OpenClaw-managed environment configuration, confirm no credential value was echoed into Sheets/Docs/chat during setup, and confirm `.gitignore` coverage before the install is considered complete. This is a mandatory step in the recipe, not an optional hardening note.
- **Rotation**: if a credential is ever suspected exposed (accidental commit, chat paste, log leak), rotate it immediately at the provider (Google Cloud service account key regeneration + old key deletion; AgentMail/Gmail/Graph key revocation + reissue) rather than assuming a deleted file/message fully remediates exposure.

---

## 13. Decisions Locked (2026-09-07, second round)

6. **Client communications history**: added as a new `Comms_Threads` tab (§3.6) — a per-lead, per-touchpoint communication log distinct from the system-event `History` tab, giving operators a scannable conversation view without opening the email provider directly.
7. **Email provider flexibility**: AgentMail remains the default recommendation, but §6.4 documents Gmail API and Microsoft Graph API as strong alternatives (both have clean native draft-only endpoints), with transactional-email APIs (SendGrid/Postmark/Mailgun) noted as weak/fallback options since they lack native drafting. All providers must sit behind the same client interface and honor the drafts-only hard rule.
8. **Google Docs/Drive for collateral**: added §3.7 — a Drive folder per install holds email templates, brochures, invoices, proposals, and RFP responses; a new Config "Template & Collateral Map" section links these to `product_fit_category` and pipeline stages so the pipeline cron can select and attach (or link) the right collateral when creating drafts.
9. **Credential security**: formalized in §12 — all credentials live only in OpenClaw-managed environment config per install, never in Sheets/Docs/chat/git; `RECIPE.md` must explicitly instruct and verify this during every install.

---

## 15. Decisions Locked (2026-09-07, third round — MVP hardening features)

All seven of the following were proposed and approved in the same round; two additional ideas were added by the assistant as part of the same review:

10. **Duplicate/conflict detection**: added §4.2 — fuzzy match (phone, then name+zip) on every discovery/manual insert; suspected duplicates are flagged via `dup_of_lead_id` and a `possible_duplicate` History event, never auto-merged or auto-dropped.
11. **Manual lead entry / import**: added §4.1 — `source` column (`discovery`\|`manual`\|`import`) on `Leads`; manual/import rows flow through the identical pipeline from `new` onward, no special-casing downstream.
12. **Basic reporting**: added §6.6 — a formula-only `Dashboard` tab (funnel counts, category volume, response rate, pending-drafts proxy, guardrail usage today), pre-populated at install, no new code or cron.
13. **Do-not-contact / opt-out list**: added §6.5 — a `DoNotContact` tab as source of truth, a cached `dnc` column on `Leads` for fast checks, checked at both discovery-insert and pre-draft-creation time. Manual-add only; the app never infers an opt-out.
14. **Backup/versioning safety net**: added §9.2 — weekly CSV export per tab to a dated Drive subfolder, retained N snapshots (default 8), manual-restore-only (no automated restore path, to avoid a new silent-overwrite risk).
15. **Rate-limit/backoff hardening**: added to §4 step 6 — exponential backoff on Google API 429/`OVER_QUERY_LIMIT`, logged to `Errors` (not `History`), clean early-stop on budget exhaustion rather than retrying into the ceiling.
16. **Manual snooze override**: added §6.2a — a single `snooze_until` column; pipeline cron skips (not alters) a snoozed lead's auto-follow-up logic until the date passes, logged as `snoozed_skip` (expected, not an error).
17. **New idea (assistant-proposed, approved with the rest): DNC/`Dashboard`/backup are Sheets-and-Drive-native** — explicitly re-confirmed as a design constraint while adding these: none of items 10–16 introduce a new database, a new external service, or a new cron job beyond the existing three (backup piggybacks on an existing schedule; Dashboard is pure formulas). This keeps the "golden standard, still simple" framing the operator asked for — seven new capabilities, zero new infrastructure surface.
18. **New idea (assistant-proposed, approved with the rest): `Leads` schema additions are additive-only.** `source`, `dnc`, `snooze_until`, `dup_of_lead_id` are all new nullable/defaulted columns appended to the existing schema (§3.1) — no existing column was renamed, retyped, or removed, so this round of features requires no migration story for anyone who had already stood up a workbook from v1.0's schema (in practice: no one has yet, since the reference instance is still blocked on Google Cloud credentials, but the principle holds going forward).

---

## 16. Code Review (2026-09-07)

A full review of the initial scaffold's stub code (`src/`) against this spec, written in the style of a blunt, no-sacred-cows senior engineering review. See `docs/CODE_REVIEW.md` for the complete findings, severity ratings, and the specific fixes applied as a result. Summary of what changed as a direct result of the review is logged there and cross-referenced from `CHANGELOG.md`.

---

## 17. Diagnostic & repair tooling: `doctor` (2026-09-07)

Added `npm run doctor` / `npm run doctor:fix` (`src/doctor/`, `bin/doctor.ts`) — a CLI that inspects a live install's health and, in `--fix` mode, applies a narrow set of safe mechanical repairs. This exists because an install has real ways to silently drift unhealthy between the questionnaire (RECIPE §1) and go-live (RECIPE §2.5), and "re-read the recipe by hand" is not an acceptable diagnostic method for a non-technical operator or a future agent picking up someone else's install.

**What it checks**: `.env` presence, required environment variables for whichever email provider is configured (not just AgentMail — respects §6.4), Google service account key file validity/shape/permissions, `.gitignore` secret coverage (§12), and a best-effort static scan of tracked docs for obvious leaked-credential patterns. A pure, I/O-free `checkGuardrailSanity()` helper additionally catches a configuration class of bug that zod's field-level validation can't: individually-positive guardrail values that are nonetheless mutually inconsistent (e.g. a daily Places API budget lower than the number of discovery cron runs/day, which would starve every single run).

**Hard rule carried over from RECIPE §0**: `doctor --fix` may only perform safe, mechanical, reversible repairs — tightening a credential file's permissions, appending a missing `.gitignore` pattern. It must never delete data, rotate/regenerate a credential, or guess at business configuration (target categories, geography, guardrail values) on the operator's behalf. Those stay explicit operator/agent decisions, exactly as RECIPE.md's "never invent" rule already requires elsewhere.

RECIPE.md §2.5 (dry run) and §2.6 (credential security verification) should both open with `npm run doctor` going forward — it mechanizes checks that were previously manual-only checklist items, without replacing the parts of those checklists (business-logic verification, human judgment calls) that a script genuinely cannot do.

---

## 18. Next Steps

1. ~~Spec review~~ — **done, v1.0 approved.**
2. ~~Write the recipe/prompt document~~ — **done, updated through three rounds of additions.**
3. ~~Scaffold the `salesflow-lite` repo~~ — **done; updated for `Comms_Threads`/collateral types, provider-agnostic email client, and this round's schema additions (`source`, `dnc`, `snooze_until`, `dup_of_lead_id`).**
4. ~~Code review of the scaffold~~ — **done, see §16 / `docs/CODE_REVIEW.md`.**
5. ~~Doctor/diagnostic tooling~~ — **done, see §17 / `src/doctor/`.**
6. ~~Multi-channel notifications + configurable digest~~ — **done, see §7 / `src/notifications/`.**
7. ~~Model/token-budget awareness~~ — **done, see §19 / `src/models/router.ts`.**
8. Once Rick has Google Cloud credentials: provision service account, stand up the San Antonio print shop reference instance, pin down radius + target business types at that point.
9. Implement the stub modules for real per their embedded spec references, including this round's additions (duplicate check, DNC check, snooze skip, backup export, Dashboard formulas).
10. Local build validation using the reference instance as the dogfood test of the recipe itself.

---

## 19. Model & Token-Budget Awareness (2026-09-07, fourth round)

**Rationale**: The app makes multiple LLM calls per lead per cron run (categorization in the research loop, digest rendering, draft composition), and different operators have very different cost tolerances — a solo print-shop owner processing 20 leads/week has different needs than someone running a higher-volume operation. Rather than hardcode one model choice, the app should *recommend* an appropriately-sized model per task type based on the task's actual complexity, track estimated usage, and let the operator see and override every recommendation. **The app never silently swaps a model mid-run or auto-throttles based on cost** — all of this is advisory, with configuration and final say resting entirely with the operator.

### 19.1 Task complexity tiers, not raw model names

The app reasons about three abstract tiers — `economy`, `standard`, `premium` — rather than hardcoding specific model identifiers, since available models and their relative cost/quality change over time and vary by OpenClaw install. Each LLM-using task type ships a **recommended tier** based on its inherent complexity, not the operator's budget:

| Task type | Recommended tier | Why |
|---|---|---|
| `lead_categorization` | `standard` | Needs real judgment (matching a business description against the category catalog) but is a bounded, structured classification task — doesn't need the strongest available model. |
| `research_summary` | `economy` | Mostly extraction/formatting of already-scraped text — low reasoning load. |
| `draft_composition` | `premium` | Client-facing text the operator will actually send after review — quality matters most here, this is the one place worth spending more. |
| `digest_rendering` | `economy` | Pure formatting of already-computed Dashboard numbers into prose — no real reasoning required. |

These are the shipped defaults (`src/models/router.ts`'s `DEFAULT_TASK_ROUTING`) — an operator can change the recommended tier for any task type, or pin an explicit model id that always wins regardless of tier/posture (`taskRouting[].modelOverride` in Config, §19.4).

### 19.2 Budget posture

Separately from per-task tiers, the operator picks an overall **budget posture** — `economy`, `balanced` (default), or `quality` — which determines which *actual* model fills each tier. The tier mapping (§19.1) already encodes task complexity; posture only shifts which concrete model an install uses to fill each tier bucket. E.g. a `quality`-postured install's `economy` tier might still map to a perfectly capable but cheap model — posture shifts the whole ladder up or down, it doesn't collapse the tiers into one model.

The concrete tier→model mapping per posture (`tierModelMap` in Config) is left to the installing agent to populate with real model ids available on the operator's OpenClaw install at setup time — this app deliberately does not hardcode provider/model names, since that list changes and varies by install (see RECIPE.md §1.8).

### 19.3 Usage tracking (advisory, not a throttle)

Every LLM call across any cron logs a `ModelUsageLogEntry` (`src/types/domain.ts`): timestamp, task type, tier, model actually used, whether it was an operator override, optional per-lead reference, and estimated token/cost figures (best-effort — providers don't uniformly expose exact costs). This is purely a record, mirroring the "no silent drops" auditability the app already applies to lead data and notifications (§7.3) — an operator (or the digest, §7.2, via a new optional `llm_usage` section) can see what was actually spent without the app ever needing to act on that number itself mid-run.

Two **soft, informational-only** daily ceilings can be set (`TokenBudgetConfig.maxTokensPerDay`, `maxEstimatedCostPerDayUsd`): if a day's logged usage crosses either, the app logs a `model_budget_warning` History event and can notify the operator through the existing multi-channel routing (§7.1) — it does **not** stop, downgrade, or delay any in-flight cron run. Finishing the current batch and flagging the crossing for the operator's attention next run is safer than a run aborting mid-lead and leaving a lead in an inconsistent state.

### 19.4 Operator override always wins

`Config.tokenBudget.taskRouting[].modelOverride`, when set for a task type, is used verbatim — the recommended tier and posture-derived model are not consulted at all for that task type. This is a hard rule, mirroring the drafts-only and never-auto-merge patterns already established elsewhere in this spec: **the app recommends, the operator decides.** `src/models/router.ts`'s `resolveModelForTask()` is a pure function (task type + config → model id + tier + whether it was an override) specifically so this precedence order has a dedicated, unit-tested seam rather than being buried inside a cron's control flow.

### 19.5 Boundaries

- This is not a live cost-optimization engine — no dynamic model-swapping based on lead complexity, no bidding between providers, no A/B testing of model choice. It's a configuration and visibility layer.
- Not responsible for provider rate-limit handling — that's already covered for Google APIs (§4 step 9) and would need its own per-provider treatment if added for LLM providers later; out of scope for this round.
- Recommendation tiers and defaults live in code (`DEFAULT_TASK_ROUTING`) as a maintained, documented starting point — not meant to be the final word for every install; the questionnaire (RECIPE.md §1.8) explicitly invites the operator to change any of it.

---
