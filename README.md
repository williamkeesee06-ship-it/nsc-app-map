# NSC APP MAP

Live as-built mapping tool for North Sky Communications telecom/construction jobs.
Combines Google Maps + Street View + Smartsheet job data + persistent as-built markup,
811 dig tickets, Ziply print layers, and Lumina (Gemini) assistant.

**Status:** Production ops app with **solo-user lock** (Billy only until multi-user rollout).
Includes jobs map, as-built drawing, 811 dig tickets, Ziply print layers, dashboard, and Lumina AI.

**Canonical project root:** `D:\1 MAP APP NEW GROK\nsc-app-map` (see `AGENTS.md`).

## Stack

- Frontend: React 18 + TypeScript + Vite + `@vis.gl/react-google-maps`
- Backend: Node 20 + Express on Vercel serverless (ESM)
- Database: Firestore via Firebase Admin SDK
- Auth: Firebase Auth (Email/Password) + server allowlist + ID tokens on `/api/*`
- Hosting: Vercel (SPA + same-origin `/api/*` rewrites)
- 811 bots: Firebase Cloud Functions (Playwright) — separate from Vercel

## Access control (solo lock)

Until other supervisors are invited:

1. **Firebase Console** → Authentication → enable **Email/Password**.
2. Create **one** user (your email + an app login password).  
   This is **not** your ITIC / Smartsheet password — leave those alone.
3. Set env (local `.env` and Vercel):
   - `AUTH_ALLOWED_EMAILS=your.email@example.com`
   - `VITE_AUTH_ALLOWED_EMAILS=your.email@example.com` (same list for the web app)
   - `APP_ORIGIN=https://nsc-app-map.vercel.app`
   - `CRON_SECRET=` long random string (required for daily cron routes)
4. Redeploy web/API. Redeploy Firebase functions so callables require sign-in.
5. Open the app → sign in with email/password → workspace runs as **Billy Keesee**.

**API:** every `/api/*` route except `GET /api/health` and the two cron paths requires  
`Authorization: Bearer <Firebase ID token>`.

**Later (other supervisors / bosses):** add their emails to both allowlist env vars and
map each email to a Smartsheet supervisor name (multi-user mapping not shipped yet).

## Local dev

```bash
cd "D:\1 MAP APP NEW GROK\nsc-app-map"
cp .env.example .env       # fill in values
npm install
npm run dev                # web on :5173, api on :3001
```

## Scripts

| Command | What |
|---------|------|
| `npm run dev` | Web + API together |
| `npm run build` | types → web → api typecheck |
| `npm run typecheck` | TypeScript across workspaces |

Firebase functions (separate package):

```bash
npm --prefix functions install
npm --prefix functions run deploy
```
