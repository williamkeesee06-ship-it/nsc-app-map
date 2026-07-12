# Project instructions

## Workspace (required)

- **Canonical project root:** `D:\1 MAP APP NEW GROK\nsc-app-map`
- **All reads, edits, builds, tests, commits, and saves for this project MUST use this D: path.**
- **Do not write project files** under `C:\Users\willi\.grok\worktrees\...` or any other C: copy of this app.
- Prefer absolute `D:\...` paths so work does not land in a Grok C: worktree by accident.
- Grok session/plan metadata under `C:\Users\willi\.grok\sessions\...` is system-owned and is not project source.

## Access (solo lock)

- App login is **Firebase Auth Email/Password**, not a typed name whitelist.
- API requires `Authorization: Bearer <Firebase ID token>` on all routes except health + crons.
- Allowlist emails via `AUTH_ALLOWED_EMAILS` + `VITE_AUTH_ALLOWED_EMAILS`.
- Solo operator profile after login: **Billy Keesee** until multi-user mapping is added.
- Do **not** rotate ITIC/Smartsheet passwords unless the user explicitly asks.

## 811 filing (Roadmap C)

- Adaptive UI: if **NSC 811 Autofill** (`chrome-extension/`) is detected → Autofill primary;
  if not (work-managed Chrome) → **cloud bot** primary.
- Only extension folder: `chrome-extension/`. See `README-811-DEPLOY.md`.

## Related folders (leave alone unless the user asks)

- `D:\1_NSC MAP APP`
- `D:\Map_App`
- C: Grok worktrees of this repo
