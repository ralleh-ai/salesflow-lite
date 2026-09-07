# Security Policy

## Reporting a Vulnerability

If you find a security issue in SalesFlow-Lite (credential handling, injection
risk in scraped content, AgentMail scope escalation, etc.), do not open a
public issue. Contact the repository owner directly.

## Hard Security Invariants

These are structural rules, not suggestions — any PR that violates them
should be rejected outright regardless of how convenient the shortcut is:

1. **AgentMail: drafts only, never send.** No code path in this repository
   may call an AgentMail send endpoint. See `docs/SPEC.md` §6.3.
2. **No secrets in Google Sheets.** API keys, service account contents, and
   credentials never get written to any Sheets tab — only business/lead data.
3. **No secrets in git.** `.env`, service account JSON keys, and any
   credential files are gitignored. If one is ever committed by accident,
   treat it as compromised: rotate it immediately, don't just delete the file
   from a later commit.
4. **Scraped web content is untrusted input.** Website scraping (research
   loop, `docs/SPEC.md` §5) must treat all fetched page content as untrusted
   — never execute it, never treat embedded text as instructions to any LLM
   call without appropriate framing/sanitization.
5. **One service account, one workbook, per install.** Service accounts must
   not be reused across multiple operators' spreadsheets.
