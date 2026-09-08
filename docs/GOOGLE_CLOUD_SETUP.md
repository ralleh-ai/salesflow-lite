# Google Cloud Setup for SalesFlow-Lite

Status: reference setup guide for Phase 1 lead packs.

SalesFlow-Lite uses two separate Google credentials:

1. **Google Sheets API** — service account JSON key.
2. **Google Places API** — restricted API key.

Do not confuse these. The service account is for Sheets. The Places API key is for discovery.

## Step 1 — Create a Google Cloud project

1. Go to <https://console.cloud.google.com/>.
2. Sign in with the Google account that should own billing and project access.
3. Create a new project, e.g. `salesflow-lite-<business-name>`.
4. Select the project after it is created.

## Step 2 — Enable billing and budget alerts

Places API requires billing even for low-volume usage.

1. Open **Billing**.
2. Link or create a billing account.
3. Add a budget alert for the project before running discovery.

Recommendation for first tests: set a low alert threshold. SalesFlow-Lite has software guardrails, but provider-side billing alerts are still the final safety net.

## Step 3 — Enable APIs

Go to **APIs & Services → Library** and enable:

- **Google Sheets API**
- **Places API** / **Places API (New)**, whichever is current for your Google Cloud project

## Step 4 — Create the Sheets service account

1. Go to **APIs & Services → Credentials**.
2. Click **Create Credentials → Service Account**.
3. Name it, e.g. `salesflow-lite-sheets`.
4. You can skip broad project-level roles; Sheet access is granted by sharing the specific spreadsheet.
5. Create the service account.

## Step 5 — Generate the service account JSON key

1. Open the service account.
2. Go to **Keys**.
3. Click **Add Key → Create new key → JSON**.
4. Download the file.
5. Store it outside git, commonly:

```text
./credentials/service-account.json
```

6. Restrict permissions where possible:

```bash
chmod 600 ./credentials/service-account.json
```

Never paste this file into chat, Sheets, docs, or commits.

## Step 6 — Create and share the target Google Sheet

1. Create a blank Sheet at <https://sheets.google.com>.
2. Name it, e.g. `SalesFlow-Lite - <Business Name>`.
3. Copy the spreadsheet ID from the URL.
4. Share the Sheet with the service account email as **Editor**.
5. Create the required tabs from `docs/RECIPE.md`.

## Step 7 — Create a restricted Places API key

1. Go to **APIs & Services → Credentials**.
2. Click **Create Credentials → API key**.
3. Rename it, e.g. `salesflow-lite-places`.
4. Under **API restrictions**, restrict it to **Places API** only.
5. Use application restrictions appropriate to your deployment. For a server-side OpenClaw host, IP restriction is preferred if you have a stable outbound IP.
6. Copy the key into `.env` as `GOOGLE_PLACES_API_KEY`.

Do not use an unrestricted API key for a recurring workflow.

## Step 8 — Populate `.env`

```dotenv
GOOGLE_SERVICE_ACCOUNT_KEY_PATH=./credentials/service-account.json
GOOGLE_SHEETS_SPREADSHEET_ID=<spreadsheet-id>
GOOGLE_PLACES_API_KEY=<restricted-places-api-key>
GOOGLE_CLOUD_PROJECT_ID=<project-id>
EMAIL_PROVIDER=none
```

AgentMail is not required for Phase 1 lead packs. Add it only for CRM-lite draft creation.

## Step 9 — Verify before spend

```bash
npm run lead:doctor
```

The first live discovery run should use narrow target terms and low guardrails.

## Hand-off checklist

- [ ] Project exists.
- [ ] Billing enabled.
- [ ] Budget alert configured.
- [ ] Sheets API enabled.
- [ ] Places API enabled.
- [ ] Service account JSON key downloaded and permission-restricted.
- [ ] Sheet shared with service account as Editor.
- [ ] Places API key created and restricted.
- [ ] `.env` populated.
- [ ] `npm run lead:doctor` has no failures.

## Reference links

- Google Cloud Console: <https://console.cloud.google.com/>
- Credentials: <https://console.cloud.google.com/apis/credentials>
- API Library: <https://console.cloud.google.com/apis/library>
- Maps Platform pricing: <https://mapsplatform.google.com/pricing/>
- Places API docs: <https://developers.google.com/maps/documentation/places/web-service/overview>
- Sheets API docs: <https://developers.google.com/sheets/api>
