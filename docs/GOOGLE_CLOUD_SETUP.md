# Getting Google Cloud Credentials for SalesFlow-Lite

Status: reference doc, for Rick (operator) to follow manually.
Produces: a service account JSON key with access to **Places API** and **Google Sheets API**, plus a target Google Sheet shared with that service account.

This is a one-time setup per install (each operator/business does this once for their own instance).

---

## Step 1 — Create a Google Cloud Project

1. Go to https://console.cloud.google.com/
2. Sign in with the Google account that should own this project (can be a personal or business Google account — use whichever you want billing/ownership tied to).
3. Click the project dropdown (top left, next to "Google Cloud") → **New Project**.
4. Name it something identifiable, e.g. `salesflow-lite-<business-name>` (e.g. `salesflow-lite-printshop-satx`).
5. Leave "Organization"/"Location" as default unless you have a specific Google Workspace org to attach it to.
6. Click **Create**. Wait for the notification that the project is ready, then select it from the project dropdown.

## Step 2 — Enable Billing

Places API requires a billing account, even within the free-tier usage.

1. In the left sidebar (or search bar), go to **Billing**.
2. Link an existing billing account or create a new one (requires a payment method).
3. Confirm the new project is linked to that billing account.

*Note: Google gives Maps Platform APIs a recurring monthly credit ($200 as of last general knowledge, but check current terms at https://mapsplatform.google.com/pricing/ since this changes). Our cost guardrails (default 50 Places calls/day) are intentionally conservative to stay well inside typical free-tier usage, but you should still keep an eye on the Billing dashboard for the first month.*

## Step 3 — Enable Required APIs

With the project selected:

1. Go to **APIs & Services → Library** (or https://console.cloud.google.com/apis/library).
2. Search for and enable, one at a time:
   - **Places API** (sometimes shown as "Places API (New)" — enable the current/new version)
   - **Google Sheets API**
3. Each will show "Enable" → click it → wait for confirmation.

## Step 4 — Create a Service Account

A service account is a non-human identity the app uses to authenticate — this is what lets the cron jobs read/write your Sheet and call Places API without your personal login.

1. Go to **APIs & Services → Credentials** (https://console.cloud.google.com/apis/credentials).
2. Click **Create Credentials → Service Account**.
3. Name it, e.g. `salesflow-lite-service`.
4. Click **Create and Continue**.
5. Role assignment (optional at project level): you can skip granting a project-wide IAM role here — access to the actual Sheet is granted separately in Step 6 by sharing the sheet directly with the service account's email, which is the more precise/least-privilege approach. Click **Continue**, then **Done**.

## Step 5 — Generate the JSON Key

1. Back on the **Credentials** page, find your new service account under "Service Accounts" and click into it.
2. Go to the **Keys** tab.
3. Click **Add Key → Create new key**.
4. Choose **JSON**, click **Create**.
5. A `.json` file downloads automatically — this is the credential file. **Treat this like a password.** Do not commit it to git, do not paste its contents into chat, do not put it in the Google Sheet.
6. Note the service account's **email address** (visible on its details page, looks like `salesflow-lite-service@<project-id>.iam.gserviceaccount.com`) — you'll need this for Step 6.

## Step 6 — Create and Share the Target Google Sheet

1. Go to https://sheets.google.com and create a new blank spreadsheet.
2. Name it, e.g. `SalesFlow-Lite - <Business Name>`.
3. Click **Share** (top right).
4. Paste in the service account's email address (from Step 5.6).
5. Set its permission to **Editor**.
6. Uncheck "Notify people" (it's a service account, not a person) and click **Share**.
7. Copy the spreadsheet's ID from its URL: `https://docs.google.com/spreadsheets/d/<THIS-PART>/edit` — you'll need this ID for install configuration.

## Step 7 — Restrict the API Key / Service Account (Recommended Hardening)

1. Back in **APIs & Services → Credentials**, confirm no separate unrestricted API key was auto-created for Places API. If one exists (sometimes prompted when enabling Maps-family APIs via certain flows), either delete it or restrict it: **Application restrictions: None needed for server-side use** but **API restrictions: limit to Places API only**.
2. The service account itself should only ever be shared (Step 6) with the one SalesFlow-Lite sheet for this install — don't reuse the same service account across multiple businesses' sheets.

## What To Hand Off / Store

Once done, you should have:
- The downloaded **service account JSON key file** (keep private, store securely — e.g. a password manager or restricted-permission file location, not shared chat)
- The **Google Cloud project ID**
- The **spreadsheet ID** from Step 6.7
- Confirmation that **Places API** and **Sheets API** both show as enabled under APIs & Services → Enabled APIs

These four items are what the SalesFlow-Lite install process (`RECIPE.md` §2.1–2.2) needs to proceed.

---

## Reference Links

- Google Cloud Console: https://console.cloud.google.com/
- APIs & Services Library: https://console.cloud.google.com/apis/library
- Credentials page: https://console.cloud.google.com/apis/credentials
- Maps Platform pricing (verify current terms): https://mapsplatform.google.com/pricing/
- Sheets API overview: https://developers.google.com/sheets/api
- Places API overview: https://developers.google.com/maps/documentation/places/web-service/overview
