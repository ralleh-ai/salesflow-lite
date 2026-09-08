# Security Policy

## Reporting a vulnerability

If you find a security issue in SalesFlow-Lite — credential handling, prompt-injection exposure, Places API key leakage, Sheet clobbering, or outreach-safety drift — do not open a public issue containing sensitive details. Contact the repository owner directly.

## Hard security invariants

These are structural rules, not suggestions:

1. **Prospect outreach is drafts-only.** No code path may automatically send prospect/customer outreach. AgentMail is optional CRM-lite infrastructure and may only be used through draft/compose endpoints.
2. **Phase 1 requires no email provider.** A lead-pack run should not require AgentMail or any mailbox credential.
3. **No secrets in Google Sheets.** API keys, service account contents, and credentials never go into any Sheet tab.
4. **No secrets in git.** `.env`, service account JSON keys, API keys, and credential directories are gitignored. If a secret is committed or pasted somewhere persistent, rotate it.
5. **Separate Google credentials by purpose.** Sheets uses a service account JSON key; Places uses a restricted API key. Do not use unrestricted Places keys for recurring jobs.
6. **Scraped web content is untrusted input.** Never execute it. Never treat it as model instructions. Extract/summarize it as data.
7. **DNC before drafts.** Do-not-contact checks must run immediately before any draft creation.
8. **No broad discovery fallback.** Empty target terms must stop discovery, not trigger expensive generic searches.
9. **One operator, one workbook, one credential set.** Do not reuse service accounts, API keys, AgentMail inboxes, or Sheets across unrelated businesses.
10. **Human approval before recurring or outreach mode.** OpenClaw cron and AgentMail draft creation are opt-in upgrades, not default Phase 1 behavior.

## Credential locations

Allowed:

- `.env` in the install workspace.
- Approved OpenClaw secret/config storage.
- Restricted local files under ignored paths such as `credentials/`.

Not allowed:

- Google Sheets cells.
- Google Docs collateral.
- Markdown docs.
- Chat messages.
- Git commits.
- Logs that may be shared or retained insecurely.

## If exposure happens

1. Stop the affected workflow.
2. Rotate the exposed key/token at the provider.
3. Remove the value from the exposed location.
4. Audit recent runs for unexpected API usage or Sheet writes.
5. Record the incident privately for follow-up.

Deletion without rotation is not enough.
