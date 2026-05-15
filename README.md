# NSC APP MAP

Live as-built mapping tool for North Sky Communications telecom/construction jobs.
Combines Google Maps + Street View + Smartsheet job data + persistent as-built markup.

**Status:** Phase 1 — foundation only.
See `nsc-app-map-computer-mode-build-spec-v1.docx` for the master spec.

## Stack

- Frontend: React 18 + TypeScript + Vite + `@vis.gl/react-google-maps`
- Backend: Node 20 + Express on Vercel serverless (ESM)
- Database: Firestore via Firebase Admin SDK
- Hosting: Vercel (single project, same-origin `/api/*` rewrites — no CORS)

## Local dev

```bash
cp .env.example .env       # fill in values
npm install
npm run dev                # web on :5173, api on :3001
```

## Phase 1 acceptance

- [ ] App boots without crashes
- [ ] Google Map renders in main shell
- [ ] Firestore round-trip works for `jobs/sample`
- [ ] PLACED polyline can be drawn → saved → reloaded
- [ ] Jobs Map view + sample Job Workspace route exist
- [ ] Vercel deploy stable with env vars
