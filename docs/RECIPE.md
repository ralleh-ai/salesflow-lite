# SalesFlow-Lite — Install Recipe (Agent-Executable Prompt)

Status: v1.0, derived from `SPEC.md` v1.0 (approved 2026-09-07).
Purpose: This document is the **operational prompt** an OpenClaw agent (any agent, any operator's instance) follows to onboard, configure, and stand up a SalesFlow-Lite install for a new business, end to end.

This is written to be pasted into an agent as its task brief, or run as a `sessions_spawn` task body. It assumes the agent has: `read`/`write`/`edit`/`exec`, `cron`, `message`, and network access (web_fetch/browser) tools, and eventually the `salesflow-lite` codebase already checked out or installable.

---

## 0. Agent Operating Rules For This Recipe

- **Never invent credentials.** If a required API key/credential is missing, stop and ask the operator — do not fabricate placeholder values and proceed silently.
- **Never enable email sending.** SalesFlow-Lite is Drafts-only by hard design (see SPEC §6.3). If at any point during install you find yourself about to configure or test a "send" codepath for outbound email, stop — that is out of scope and against spec. This applies regardless of which email provider is chosen (see §1.6a).
- **Credentials go into the OpenClaw environment only — never Sheets, Docs, chat, or git.** Every credential (Google service account key, AgentMail/Gmail/Graph API key, spreadsheet ID if treated as sensitive) is written exclusively into that install's `.env` (or the OpenClaw config secret store if the deployment uses one). See SPEC §12 and §2.6 below — this is a mandatory, checked step, not a best-effort note.
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
6. **AgentMail credentials (or alternative email provider)**
   - Do you have an AgentMail account and API key?
   - If no: direct them to https://console.agentmail.to to sign up and generate an API key. Confirm they understand: **this app only ever creates drafts, never sends** — the inbox is for drafting outreach and receiving replies, not autosending.
6a. **If the operator prefers not to use AgentMail** (per SPEC §6.4), offer these alternatives and ask which they want:
   - **Gmail API** (if they already run Google Workspace/Gmail) — drafts via `users.drafts.create`, kept fully separate from send. Reuses the same Google Cloud project as Sheets/Places, but requires OAuth consent setup (different from the Sheets/Places service-account flow) since it acts on a real mailbox.
   - **Microsoft Graph API** (if they're on Microsoft 365/Outlook) — native drafts folder support.
   - **A transactional email API they already use** (SendGrid/Postmark/Mailgun) — only if they explicitly prefer not to add a new provider; flag to them that these lack native drafting and the install will instead store composed drafts in `Comms_Threads`/Drive only, never calling the provider until they separately trigger sending outside this app.
   - Whichever is chosen, confirm the same hard rule applies: **only draft/compose-capable endpoints are ever called, send endpoints are never implemented for this install.**
7. **Notification channels & routing**
   - Which channel(s) do they want to use? Any combination of: Telegram, Discord, Slack, email (direct send — not a draft, see SPEC §7.4), SMS (requires their own provider, e.g. Twilio), webhook (their own alerting/Zapier/PagerDuty endpoint), or "none" per event type.
   - For each channel they want, get the actual target (chat id, channel id, email address, phone number, or webhook URL) and a short name for it (e.g. "owner-telegram", "sales-team-slack") — these become named `notificationDestinations` entries.
   - Which event types go where? (new qualified lead, research failed permanently, follow-up due, lead won, quota/budget warning) — each can route to a different destination, or `none`.
   - Any quiet hours to respect for per-event notifications?
7a. **Digest notification** (optional, ask even if they configured per-event notifications above — the two are complementary, not exclusive)
   - Do they want a periodic rollup instead of/in addition to real-time pings? If yes:
     - Cadence: cron expression (default weekly, Monday 8am) — ask in plain language ("every Monday morning", "daily at 8am") and translate to a cron expression, don't make them write one themselves.
     - Which destination(s) should receive it? (reuse names from the notificationDestinations set above)
     - Which sections do they care about? (pipeline funnel, leads by category, response rate, drafts pending review, guardrail usage, new leads since last digest) — default to funnel + drafts-pending + guardrail-usage if they're unsure, these three cover "is the pipeline healthy" at a glance.
     - Should the digest itself respect quiet hours? (default no — a Monday-morning digest rarely needs the same urgency suppression as a real-time ping, but some operators will still want it)
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
1.8. **Model/token-budget preferences** (seeds SPEC §19 — defaults exist, only ask if operator wants to change them)
   - Overall budget posture: `economy`, `balanced` (default), or `quality`? Explain in plain terms: this shifts which model tier the app reaches for by default, not the underlying task complexity logic — a `lead_categorization` pass stays "standard tier" either way, `balanced` just fills that tier with a different concrete model than `economy` would.
   - **You (the installing agent) must populate `Config.tokenBudget.tierModelMap`** with real, currently-available model ids for the operator's OpenClaw install for all three tiers (`economy`/`standard`/`premium`) matching their chosen posture — this app does not hardcode provider/model names since that list changes. Check what's actually available via the operator's OpenClaw setup before filling this in; don't guess or invent a model id.
   - Does the operator want to override the recommended tier or pin a specific model for any individual task type (`lead_categorization`, `research_summary`, `draft_composition`, `digest_rendering`)? Default recommendations (SPEC §19.1 table) cover most operators fine — only dig into this if they have a specific reason (e.g. "I want the cheapest possible categorization even if it's occasionally wrong, I'll just fix the sheet by hand").
   - Optional soft daily ceilings: max tokens/day and/or max estimated USD/day? These only trigger an advisory notification (via the same multi-channel routing as §1.7) — they never stop, delay, or downgrade an in-flight cron run. Leave unset if the operator has no strong preference; nothing breaks without them.
10. **Sales collateral (Google Docs/Drive)** — seeds SPEC §3.7
    - Do you already have email templates, brochures, rate sheets, sample proposals, or invoice templates in Google Docs/Drive? If yes, get sharing access set up (§2.6a) and note which product category or pipeline stage each belongs to.
    - If no: offer to help them create at minimum one basic intro-email template per product category before going live — an install with zero templates has nothing to draft from.

Do not proceed to Section 2 until questions 1–7 have answers (8–9 can use defaults silently if operator has no preference).

---

## 2. Provisioning Steps

### 2.1 Google Sheets workbook
1. Create a new Google Sheet ("`<Business Name>` SalesFlow-Lite Workbook").
2. Create tabs exactly per `SPEC.md` §3: `Leads`, `History`, `Config`, `Categories_Reference`, `Errors`, `Comms_Threads`.
3. Populate header rows per the column definitions in SPEC §3.1–3.6.
4. Populate `Config` tab from questionnaire answers (business profile, geography, target business types, cadences, guardrails, notification routing, and the Template & Collateral Map from §2.6a).
5. Populate `Categories_Reference` from the operator's product/service catalog (questionnaire §1.2).
6. Share the sheet with the service account email (Editor role) from the operator's Google Cloud key.
7. Record the spreadsheet ID in the install's `.env` / config file — **never in the sheet itself or in chat** (see §2.6).

### 2.2 Google Cloud API access
1. Confirm Places API and Sheets API are enabled on the operator's project (ask them to check, or verify via API if credentials allow a lightweight test call).
2. Store the service account JSON key path securely in the install's `.env` (never commit to git, never paste into Sheets).
3. Run one lightweight test call to each API (e.g. a single Places nearby-search call and a single Sheets read) to confirm credentials work before wiring up cron jobs.

### 2.3 AgentMail (or chosen alternative provider, per §1.6a)
1. Confirm API key is valid with a lightweight test call (e.g. list inboxes or create-then-verify a single test draft in a throwaway thread).
2. Configure the install to use the provider's **draft/compose endpoint only**. Explicitly do not implement or call any send endpoint — for Gmail this means only ever calling `users.drafts.create`, never `users.messages.send`; for Graph, only ever writing to the drafts folder; for AgentMail, only its draft/compose endpoint.
3. If the provider supports scoped API keys/OAuth scopes (send permission separable from draft/compose permission), request the operator use a draft-only-scoped credential if available. If only one all-or-nothing credential exists, proceed but keep send codepaths absent from the codebase — this is enforced in code, not by trusting the credential's scope.
4. Set up the inbound-reply mechanism (webhook endpoint or polling, per implementation decided during build) so replies can be matched to leads and logged to `Comms_Threads` (SPEC §3.6).

### 2.4 Cron jobs (OpenClaw `cron` tool)
Four separate jobs, each an isolated `agentTurn` job (or systemEvent if the task is simple enough to not need a full agent turn — use judgment), each with an explicit delivery path per SPEC's "every job must have delivery" rule:

1. **`salesflow-lite-discovery`** — schedule per Config `discovery_cron_interval` (default every 4h). Task: run the discovery sweep (SPEC §4) for this operator's install. Delivery: notify configured destination(s) for the `discovered` event type on new-lead-batch summary, or `none` if operator opted out of per-run pings (but still log to History regardless).
2. **`salesflow-lite-research`** — schedule per Config `research_cron_interval` (default every 20min). Task: run the enrichment pass (SPEC §5) for pending/in_progress leads. Delivery: notify on newly-`completed` or newly-`failed_permanent` leads per their configured routes; otherwise best-effort/quiet.
3. **`salesflow-lite-pipeline`** — schedule per Config `pipeline_cron_interval` (default every 30min). Task: run pipeline stage transitions and draft-creation (SPEC §6). Delivery: notify on stage transitions the operator should know about (qualified, engaged, won, lost) and on any draft created (so they know to go review/send it), per their configured routes.
4. **`salesflow-lite-digest`** — only created if the operator enabled a digest (questionnaire §7a). Schedule per `digest.cronExpr` (default weekly, Monday 8am). Task: run the digest sweep (SPEC §7.2) — read the `Dashboard` tab, render the configured sections, dispatch to the configured destination(s). Delivery: the digest itself *is* the delivery — this job's `delivery.mode` in the cron job spec should be `none` (the agentTurn payload dispatches directly via the configured notification destinations, not via cron's own announce mechanism), since digest routing already goes through `notificationDestinations`, not the calling session's default channel.

All four jobs notify through `src/notifications/notifier.ts`'s destination routing (SPEC §7.1) rather than a single hardcoded channel — confirm during dry run (§2.5) that each configured destination actually receives a test notification, not just the first one configured.

Before enabling: check `cron action=list` to avoid duplicate jobs for the same operator/install (per AGENTS.md cron protocol). Log each created `jobId` to the install's own memory/log, not the agent's personal memory.

### 2.5 Dry run
Before leaving jobs enabled on their live schedule:
1. Run `npm run doctor` (or `npm run doctor:fix` if any repairable issue is flagged) and resolve every `fail` before proceeding — this mechanizes most of the credential/config hygiene checks below instead of doing them by hand.
2. Force-run each of the three jobs once (`cron action=run runMode=force`) in sequence: discovery → research → pipeline.
3. Verify: new lead rows appeared in `Leads`, `History` got corresponding entries, no unexpected rows in `Errors`, a draft was created in the chosen email provider — not sent — and a matching `outbound` row appeared in `Comms_Threads` (if a lead reached that stage).
4. Report results to the operator before considering the install "live."

### 2.6 Credential security verification (mandatory, not optional)
Per SPEC §12 — before considering any install complete. Start with `npm run doctor`, which automates checks 1–4 below (and can auto-repair a permissive key file or an incomplete `.gitignore` via `npm run doctor:fix`); still walk through all five by hand as the final sign-off, since a script cannot judge conversational leakage in check 2 on its own:
1. Confirm every credential (Google service account key path, AgentMail/Gmail/Graph API key or OAuth token, any other secret) exists **only** in that install's `.env` (or OpenClaw-managed environment/config secret store) — nowhere else.
2. Grep/scan the Sheets `Config` tab, any Docs/Drive files touched during setup, and the conversation/chat log used for onboarding to confirm no credential value was accidentally pasted or echoed anywhere outside `.env`.
3. Confirm `.gitignore` (or equivalent) covers `.env` and any credential/key files for this install's working copy — do not assume the template repo's `.gitignore` was preserved if the install was created by copying files manually.
4. Confirm file permissions on credential files are restricted where the OS supports it (e.g. `chmod 600` on the service account JSON key).
5. If at any point during install a credential was exposed somewhere it shouldn't have been (chat, Sheets, a log), **rotate it immediately** at the provider before proceeding — do not treat a later deletion as sufficient remediation.

### 2.6a Google Docs/Drive collateral setup (SPEC §3.7)
1. Create a dedicated Drive folder for this install ("SalesFlow-Lite — `<Business Name>` — Collateral"), shared with the same service account (or the operator's own account if templates are meant to stay under their direct control — confirm which with the operator).
2. For each product category in `Categories_Reference`, create or import at least one email template Doc with the standard placeholder syntax (`{{business_name}}`, `{{product_fit_category}}`, etc.) — do not go live with a category that has zero template.
3. Import/link any existing brochures, rate sheets, proposal templates, RFP response templates, or invoice templates the operator already has.
4. Populate the `Config` tab's **Template & Collateral Map** section: `product_fit_category` → `template_doc_id`, and `collateral_name` → `drive_file_id` → `attach_to_stage`.
5. Advise the operator: templates/collateral are edited directly in Google Docs/Drive going forward — no code change or redeploy needed to update messaging, and this is the recommended way to keep outreach current (seasonal offers, updated pricing, new brochures) without touching the app itself.
6. Confirm via a dry-run draft (§2.5) that a template renders correctly with placeholders substituted and any mapped collateral is correctly linked/attached.

---

## 3. Post-Install Verification Checklist

Report this checklist, filled in, back to the operator as the install completion summary:

- [ ] Google Sheet created, all 6 tabs present with correct headers (`Leads`, `History`, `Config`, `Categories_Reference`, `Errors`, `Comms_Threads`)
- [ ] `npm run doctor` reports HEALTHY (or all remaining warnings understood and accepted by the operator)
- [ ] Service account has Editor access confirmed
- [ ] Places API test call succeeded
- [ ] Sheets API test call succeeded
- [ ] Email provider (AgentMail or chosen alternative) test draft created successfully (and confirmed **not** sent)
- [ ] All three cron jobs created, `jobId`s recorded
- [ ] Dry-run pass completed for all three jobs with no unexpected `Errors` rows, and a matching `Comms_Threads` row confirmed for any draft created
- [ ] Notification channel confirmed working (test message delivered)
- [ ] Google Drive collateral folder created, at least one email template per product category populated, Template & Collateral Map filled in `Config`
- [ ] Credential security verification (§2.6) completed — all credentials confirmed to live only in `.env`/environment config, none found in Sheets/Docs/chat, `.gitignore` coverage confirmed
- [ ] Operator has been shown: where leads live, where drafts live, where comms history lives (`Comms_Threads`), where templates/collateral live (Drive folder), how to change Config values, how to mark a lead `lost`/`won` manually if desired

---

## 4. Known Gaps / Things To Decide During First Real Build

(Carried over from SPEC.md open items — resolve these while building the reference San Antonio print shop instance, then fold learnings back into this recipe.)

- Exact AgentMail (or chosen alternative provider) draft/compose API call shape (SDK vs raw REST) — pin down during build.
- Inbound-reply matching mechanism (webhook receiver vs OpenClaw-side polling) — pin down during build.
- Whether a `draft_pending_send` pipeline sub-state is worth adding once we see real operator behavior around reviewing/sending drafts.
- Exact attachment mechanism for Drive collateral (shareable link in draft body vs. binary attachment via provider API) — link is the current default recommendation per SPEC §3.7; confirm this holds up during real use.
- San Antonio radius and top 3–5 target business types — pin down with Rick when Google Cloud key is in hand.

---

## 5. Relationship To SPEC.md

This recipe operationalizes `SPEC.md` — it does not redefine data model or business logic. If anything here conflicts with `SPEC.md`, `SPEC.md` wins and this file should be corrected to match.
