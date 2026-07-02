# 811 Automation — Deployment

The 811 Locate & Dig Ticket Manager has two runtimes:

| Runtime | What runs there | Deploy |
| --- | --- | --- |
| **Vercel** (`apps/web`, `apps/api`) | UI, ticket CRUD, Gemini marking-instruction generation | existing Vercel pipeline (auto on push) |
| **Firebase Functions** (`functions/`) | ITIC Playwright bot, Smartsheet write-back, daily sweep, notifications | `firebase deploy --only functions` |

Playwright + headless Chromium are too heavy for Vercel's 60s serverless limit, so
all browser automation lives in Firebase Functions Gen2 (2 GiB / 540 s).

## Functions

| Function | Trigger | Purpose |
| --- | --- | --- |
| `fileTicketBot` | callable | Log into ITIC, fill the ticket form, capture a **review** screenshot, move ticket → `Review`. Does not submit. |
| `confirmAndSubmit` | callable | After operator sign-off, re-fill and **submit** to ITIC, record the locate number, move ticket → `Filed`. |
| `checkUtilityResponses` | callable | Scrape member responses for one filed ticket and update `utilityStatuses` / `readyToDig`. |
| `dailySweep` | schedule `0 6 * * *` `America/Los_Angeles` | Expire/renew tickets and poll open tickets for responses. |
| `onTicketFiled` | Firestore `digTickets/{id}` update | On the transition into `Filed`, write the locate number + expiration back to Smartsheet and notify. |

`fileTicketBot` and `confirmAndSubmit` are split so a human can approve the review
screenshot before anything is filed. Because Cloud Functions are stateless
between invocations, `confirmAndSubmit` re-fills the form in a fresh browser
session rather than resuming the review session.

## One-time setup

1. **Install the Firebase CLI** and log in:
   ```bash
   npm i -g firebase-tools
   firebase login
   firebase use <your-project-id>
   ```
2. **Set secrets** (Secret Manager — never committed):
   ```bash
   ITIC_USERNAME=wkeesee@northskyComm.com \
   ITIC_PASSWORD='<password>' \
   GEMINI_API_KEY='<key>' \
   SMARTSHEET_ACCESS_TOKEN='<token>' \
   PUSHOVER_TOKEN='<optional>' PUSHOVER_USER='<optional>' \
   ./scripts/set-811-secrets.sh
   ```
   `GEMINI_API_KEY` is consumed by `apps/api` (set it in Vercel too); the rest are
   consumed by the functions.
3. **Enable Cloud Storage** in the Firebase console — bot screenshots are written
   to `dig-tickets/{ticketId}/…` in the default bucket.

## Deploy

Deployment is **automatic**. A GitHub Actions workflow
(`.github/workflows/deploy-functions.yml`) redeploys the functions on every push
to `main` that touches `functions/**` or `firebase.json`, and can also be run
on demand from the Actions tab ("Run workflow"). You do **not** need the Firebase
CLI on your machine. The only one-time step is adding two GitHub secrets
(`FIREBASE_SERVICE_ACCOUNT` and `FIREBASE_PROJECT_ID`) — see
[Auto-deploy setup (one-time, browser-only)](#auto-deploy-setup-one-time-browser-only).

The manual CLI path is still available if you ever need it:

```bash
npm --prefix functions install   # first time only
npm --prefix functions run deploy
```

or from the repo root: `firebase deploy --only functions`.

## Auto-deploy setup (one-time, browser-only)

Do this once from your browser — no command line required. After that, every push
to `main` deploys the functions automatically.

### 1. Create a Firebase service account key

1. Open <https://console.firebase.google.com> and select the **nsc-app-map** project.
2. Click the **gear icon** (top-left) → **Project Settings**.
3. Open the **Service accounts** tab.
4. Click **Generate new private key** → **Generate key** to confirm. A `.json`
   file downloads to your computer.
5. Open that `.json` file in **Notepad**, press **Ctrl+A** to select all, then
   **Ctrl+C** to copy the entire contents.

### 2. Get your Firebase project ID

1. On the same **Project Settings** page, open the **General** tab.
2. Find **Project ID** (looks like `nsc-app-map-xxxxx`).
3. Copy it.

### 3. Add both to GitHub Secrets

1. Go to <https://github.com/williamkeesee06-ship-it/nsc-app-map/settings/secrets/actions>.
2. Click **New repository secret**.
   - **Name:** `FIREBASE_SERVICE_ACCOUNT`
   - **Value:** paste the **entire JSON** you copied in step 1.
   - Click **Add secret**.
3. Click **New repository secret** again.
   - **Name:** `FIREBASE_PROJECT_ID`
   - **Value:** the project ID from step 2.
   - Click **Add secret**.

> Never commit the service account `.json` to the repo — it lives only in GitHub
> Secrets.

### 4. Trigger the first deploy

1. Go to <https://github.com/williamkeesee06-ship-it/nsc-app-map/actions>.
2. Click **Deploy Firebase Functions** in the left sidebar.
3. Click **Run workflow** → **Run workflow**.
4. Wait ~3–5 minutes. The run should turn **green ✓**.

### 5. Get the deployed function URLs

1. Once green, click into the workflow run.
2. Expand the **Deploy Functions** step.
3. Copy the base URL from the output
   (e.g. `https://us-central1-nsc-app-map.cloudfunctions.net`).

## Verifying ITIC selectors

ITIC's form markup (`itic.occinc.com`) is not publicly documented and changes
over time. All selectors live in one place — `ITIC_SELECTORS` in
`functions/src/itic.ts`. Before the first production run, log into ITIC manually,
inspect the New Ticket form, and confirm each selector (login, work type, depth,
duration, start date, remarks, the four checkboxes, review/submit buttons, and
the response-lookup table). The control flow does not change; only the selectors
may need updating. Run the emulator to iterate:

```bash
npm --prefix functions run serve
```

## Smartsheet mapping

Write-back targets the Master Schedule sheet `1833739362822020`:

- Work Order (match key) — col `4680657223346052`
- Locate # (written) — col `7141137686783876`
- Locate Expiration (written) — col `1511638152570756`
- Address / Zip — fallback match keys when Work Order is blank

If no row matches, the write-back logs a warning and no-ops rather than failing
the file flow.
