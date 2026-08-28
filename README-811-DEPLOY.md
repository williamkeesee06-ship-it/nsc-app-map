# 811 Dig Tickets — Official path & deploy

## Operator workflow (adaptive)

Same prep for every machine:

```
1. MAP / TOOLS  →  draw dig boundary with the 3 dig tools
2. 811 tab      →  create ticket (scope of work, work-for, dates, etc.)
3. Ticket detail →  File (button depends on whether Autofill extension is installed)
4. Locate #      →  saved on the ticket
5. App manages   →  utility responses, active window, expiry (sweep + check)
```

### Which button is primary?

| Chrome situation | Primary button | Secondary |
|------------------|----------------|-----------|
| **NSC 811 Autofill installed** (personal PC, or IT allows Load unpacked) | **File 811 with Autofill** | Cloud bot |
| **No extension** (typical work-managed Chrome) | **File 811 with cloud bot** | Guided ITIC tab + manual clipboard |

The UI detects the extension automatically (`NSC_PING_811` / `NSC_PONG_811`).

### Chrome extension (when allowed)

| | |
|--|--|
| **Folder** | `chrome-extension/` |
| **Name** | **NSC 811 Autofill** |
| **Protocol** | `NSC_811_JOB_DATA` → ITIC autofill → `NSC_811_FILED_SUCCESS` |

Install: `chrome://extensions` → Developer mode → **Load unpacked** → `chrome-extension/`.

### Cloud bot (work PCs)

| | |
|--|--|
| **Callable** | `fileTicketBot` |
| **Needs** | Signed-in Firebase user + Firebase secrets `ITIC_USERNAME` / `ITIC_PASSWORD` |
| **Behavior** | Auto-submits end-to-end (no human draw on ITIC) |

Bookmarklet is **not** a first-class UI path (API auth lock).

---

## Runtimes

| Runtime | What | Deploy |
|---------|------|--------|
| **Vercel** (`apps/web`, `apps/api`) | UI, ticket CRUD, Gemini marking text | Auto on push to `main` |
| **Firebase Functions** (`functions/`) | Playwright bot, utility scrape, dailySweep, Smartsheet write-back on Filed | Auto on `functions/**` changes or `firebase deploy --only functions` |

Callables require a **signed-in Firebase user** (solo lock).

---

## Functions (current behavior)

| Function | Trigger | Purpose |
|----------|---------|---------|
| `fileTicketBot` | callable | Full auto-file on ITIC (login → fill → **auto-submit** → Filed) |
| `checkUtilityResponses` | callable | Scrape utility responses for one ticket |
| `dailySweep` | schedule 6am PT | Active/Expiring/Expired + poll responses |
| `onTicketFiled` | Firestore | Smartsheet locate write-back + notify |

---

## Secrets (Firebase Functions)

```bash
ITIC_USERNAME=... \
ITIC_PASSWORD=... \
SMARTSHEET_ACCESS_TOKEN=... \
./scripts/set-811-secrets.sh
```

Do not commit credentials. `GEMINI_API_KEY` for marking instructions lives on **Vercel** (API).

---

## Local / prod app origins for the extension

`chrome-extension/manifest.json` allows:

- `https://nsc-app-map.vercel.app/*`
- `http://localhost:5173/*`
- `http://127.0.0.1:5173/*`
- `https://wa.itic.occinc.com/*`
