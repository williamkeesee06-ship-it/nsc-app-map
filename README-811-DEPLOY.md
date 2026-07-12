# 811 Dig Tickets — Official path & deploy

## Operator workflow (Roadmap C — single path)

```
1. MAP / TOOLS  →  draw dig boundary with the 3 dig tools
2. 811 tab      →  create ticket (scope of work, work-for, dates, etc.)
3. Ticket detail →  "File 811 with Autofill (official)"
4. ITIC tab      →  extension autofills; YOU draw/confirm shape; submit
5. Locate #      →  saves on the ticket (auto or paste)
6. App manages   →  utility responses, active window, expiry (sweep + check)
```

### Official Chrome extension

| | |
|--|--|
| **Folder** | `chrome-extension/` |
| **Name** | **NSC 811 Autofill** |
| **Protocol** | `NSC_811_JOB_DATA` → ITIC autofill → `NSC_811_FILED_SUCCESS` |

Install: `chrome://extensions` → Developer mode → **Load unpacked** → select `chrome-extension/`.

**Do not install** `apps/extension/` (deprecated ITIC Copilot — see `apps/extension/DEPRECATED.md`).

### Advanced only

| Path | When |
|------|------|
| **Cloud bot** (`fileTicketBot`) | Ticket UI → Advanced → auto-submits with server ITIC secrets |
| Clipboard helpers | Manual ITIC typing if extension unavailable |

Bookmarklet is **no longer** a first-class UI path (API auth lock broke unauthenticated bookmarklet calls).

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
| `confirmAndSubmit` | callable | **Deprecated no-op** (kept for old clients) |
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
