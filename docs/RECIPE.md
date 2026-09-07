# SalesFlow-Lite — Install Recipe (Agent-Executable Prompt)

Status: v1.0, derived from `SPEC.md` v1.0 (approved 2026-09-07).
Purpose: This document is the **operational prompt** an OpenClaw agent (any agent, any operator's instance) follows to onboard, configure, and stand up a SalesFlow-Lite install for a new business, end to end.

This is written to be pasted into an agent as its task brief, or run as a `sessions_spawn` task body. It assumes the agent has: `read`/`write`/`edit`/`exec`, `cron`, `message`, and network access (web_fetch/browser) tools, and eventually the `salesflow-lite` codebase already checked out or installable.

---

## 0. Agent Operating Rules For This Recipe

- **Never invent credentials.** If a required API key/credential is missing, stop and ask the operator — do not fabricate placeholder values and proceed silently.
- **Never enable email sending.** SalesFlow-Lite is Drafts-only by hard design (see SPEC §6.3). If at any point during install you find yourself about to configure or test a "send" codepath for outbound email, stop — that is out of scope and against spec.
- **Confirm before first live cron activation.** Once config is populated, do a dry-run pass (or as close to one as the tooling allows) before enabling the recurring cron jobs, so the operator's first real experience isn't an uncontrolled batch of API calls.
- **One operator, one workbook, one repo checkout (or config directory) per install.** Do not share Sheets/config across businesses.
- **Ask, don't assume, on ambiguous business specifics** (target categories, geography radius, notification preferences). Section 1 below is a structured questionnaire for exactly this reason — use it, don't skip it because answers seem "obvious."

---

## 1. Onboarding Questionnaire (ask the operator, in order)

1. **Business identity**
   - Business name?
   - One-line description of what you sell/do?
2. **Product/service catalog** (this seeds `Categories_Reference`)
   - List your products/services.
   - For each, which types of businesses typically need it? (e.g. "banners → schools, gyms, construction, event venues")
3. **Target geography**
   - City/region to search for leads?
   - Approximate radius (miles/km) or list of neighborhoods/zip codes, if more precise than "whole city"?
4. **Target business types** (top priority list — Google Places types/keywords)
   - What kinds of businesses do you most want to reach first? (top 3–5, can expand later)
5. **Google Cloud credentials**
   - Do you have a Google Cloud project with **Places API** and **Sheets API** enabled, and a **service account JSON key** downloaded?
   - If no: pause here. Provide the operator with (or point them to) Google's official setup docs for: creating a project, enabling both APIs, creating a service account, generating a JSON key, and sharing the target Google Sheet with the service account's email address (Editor access). **Do not proceed past this step without the key file in hand.**
6. **AgentMail credentials**
   - Do you have an AgentMail account and API key?
   - If no: direct them to https://console.agentmail.to to sign up and generate an API key. Confirm they understand: **this app only ever creates drafts, never sends** — the inbox is for drafting outreach and receiving replies, not autosending.
7. **Notification channel**
   - Where should lead alerts / follow-up reminders / errors go? (Telegram chat, email address, other OpenClaw-supported channel, or "none" per event type)
   - Any quiet hours to respect?
8. **Cost guardrail preferences** (defaults exist — only ask if operator wants to change them)
   - Max Places API calls/day (default 50)
   - Max research LLM calls/day (default 100)
   - Max website scrape fetches/day (default 150)
   - Max AgentMail drafts/day (default 25)
   - Discovery cron interval (default every 4 hours)
   - Research cron interval (default every 20 minutes)
   - Pipeline cron interval (default every 30 minutes)
9. **Sales pipeline customization** (defaults exist — only ask if operator wants non-default stages/reasons)
   - Any custom pipeline stages beyond the default set (`new → qualifying → qualified → outreach_attempted → engaged → meeting_scheduled → proposal_sent → won/lost/nurture`)?
   - Any custom `lost` reason codes beyond the default list (`no_budget`, `not_interested`, `unreachable`, `wrong_fit`)?

Do not proceed to Section 2 until questions 1–7 have answers (8–9 can use defaults silently if operator has no preference).

---

## 2. Provisioning Steps

### 2.1 Google Sheets workbook
1. Create a new Google Sheet ("`<Business Name>` SalesFlow-Lite Workbook").
2. Create tabs exactly per `SPEC.md` §3: `Leads`, `History`, `Config`, `Categories_Reference`, `Errors`.
3. Populate header rows per the column definitions in SPEC §3.1–3.5.
4. Populate `Config` tab from questionnaire answers (business profile, geography, target business types, cadences, guardrails, notification routing).
5. Populate `Categories_Reference` from the operator's product/service catalog (questionnaire §1.2).
6. Share the sheet with the service account email (Editor role) from the operator's Google Cloud key.
7. Record the spreadsheet ID in the install's `.env` / config file.

### 2.2 Google Cloud API access
1. Confirm Places API and Sheets API are enabled on the operator's project (ask them to check, or verify via API if credentials allow a lightweight test call).
2. Store the service account JSON key path securely in the install's `.env` (never commit to git, never paste into Sheets).
3. Run one lightweight test call to each API (e.g. a single Places nearby-search call and a single Sheets read) to confirm credentials work before wiring up cron jobs.

### 2.3 AgentMail
1. Confirm API key is valid with a lightweight test call (e.g. list inboxes or create-then-verify a single test draft in a throwaway thread).
2. Configure the install to use AgentMail's **draft/compose endpoint only**. Explicitly do not implement or call any send endpoint.
3. If AgentMail supports scoped API keys (send permission separable from draft/compose permission), request the operator use a draft-only-scoped key if available. If only one all-or-nothing key exists, proceed but keep send codepaths absent from the codebase — this is enforced in code, not by trusting the key's scope.
4. Set up the inbound-reply mechanism (webhook endpoint or polling, per implementation decided during build) so replies can be matched to leads.

### 2.4 Cron jobs (OpenClaw `cron` tool)
Three separate jobs, each an isolated `agentTurn` job (or systemEvent if the task is simple enough to not need a full agent turn — use judgment), each with an explicit delivery path per SPEC's "every job must have delivery" rule:

1. **`salesflow-lite-discovery`** — schedule per Config `discovery_cron_interval` (default every 4h). Task: run the discovery sweep (SPEC §4) for this operator's install. Delivery: `announce` to configured notification channel on new-lead-batch summary, or `none` if operator opted out of per-run pings (but still log to History regardless).
2. **`salesflow-lite-research`** — schedule per Config `research_cron_interval` (default every 20min). Task: run the enrichment pass (SPEC §5) for pending/in_progress leads. Delivery: `announce` on newly-`completed` or newly-`failed_permanent` leads; otherwise best-effort/quiet.
3. **`salesflow-lite-pipeline`** — schedule per Config `pipeline_cron_interval` (default every 30min). Task: run pipeline stage transitions and draft-creation (SPEC §6). Delivery: `announce` on stage transitions the operator should know about (qualified, engaged, won, lost) and on any draft created (so they know to go review/send it).

Before enabling: check `cron action=list` to avoid duplicate jobs for the same operator/install (per AGENTS.md cron protocol). Log each created `jobId` to the install's own memory/log, not the agent's personal memory.

### 2.5 Dry run
Before leaving jobs enabled on their live schedule:
1. Force-run each of the three jobs once (`cron action=run runMode=force`) in sequence: discovery → research → pipeline.
2. Verify: new lead rows appeared in `Leads`, `History` got corresponding entries, no unexpected rows in `Errors`, and (if pipeline reached a lead ready for outreach) a draft was created in AgentMail — not sent.
3. Report results to the operator before considering the install "live."

---

## 3. Post-Install Verification Checklist

Report this checklist, filled in, back to the operator as the install completion summary:

- [ ] Google Sheet created, all 5 tabs present with correct headers
- [ ] Service account has Editor access confirmed
- [ ] Places API test call succeeded
- [ ] Sheets API test call succeeded
- [ ] AgentMail test draft created successfully (and confirmed **not** sent)
- [ ] All three cron jobs created, `jobId`s recorded
- [ ] Dry-run pass completed for all three jobs with no unexpected `Errors` rows
- [ ] Notification channel confirmed working (test message delivered)
- [ ] Operator has been shown: where leads live, where drafts live, how to change Config values, how to mark a lead `lost`/`won` manually if desired

---

## 4. Known Gaps / Things To Decide During First Real Build

(Carried over from SPEC.md open items — resolve these while building the reference San Antonio print shop instance, then fold learnings back into this recipe.)

- Exact AgentMail draft/compose API call shape (SDK vs raw REST) — pin down during build.
- Inbound-reply matching mechanism (webhook receiver vs OpenClaw-side polling) — pin down during build.
- Whether a `draft_pending_send` pipeline sub-state is worth adding once we see real operator behavior around reviewing/sending drafts.
- San Antonio radius and top 3–5 target business types — pin down with Rick when Google Cloud key is in hand.

---

## 5. Relationship To SPEC.md

This recipe operationalizes `SPEC.md` — it does not redefine data model or business logic. If anything here conflicts with `SPEC.md`, `SPEC.md` wins and this file should be corrected to match.
