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
- Billy always allowed in code: `wkeesee@northskycomm.com` + `williamkeesee06@gmail.com` (both must exist as Firebase Email/Password users).
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

## Testing and Previews

- The user does **not** do local previews.
- Do not ask the user to "check their local preview" or test something locally.
- The user only reviews changes once pushed to git (which triggers a Vercel rebuild).
- **CRITICAL**: Before pushing to git, ALWAYS run a TypeScript compilation check (e.g. `npx tsc --noEmit` in the web app directory) to ensure there are no syntax or type errors that will silently fail the Vercel build. You must monitor and verify that your changes compile successfully before declaring a task complete and pushing.

## Engineering Standards & Proactive Ideation

- **Proactive Excellence:** Do not just build what is asked; anticipate what is *needed*. If a requested feature would benefit from micro-animations, better error handling, optimistic UI updates, or keyboard shortcuts, implement or suggest them proactively.
- **Design Aesthetics:** Every UI element must feel premium, intuitive, and modern (adhering to the Light Mode/Cyan constraint). Never settle for a basic layout if a refined, interactive, and polished design is achievable.
- **Refactoring for Scale:** When touching a file, if you notice tightly coupled code, duplicate logic, or missing types, take the initiative to clean it up (within reason) to ensure the codebase remains maintainable and scalable.
- **Holistic Problem Solving:** When debugging or building, trace the data flow from end-to-end. Don't just patch a symptom; find and resolve the root cause. Always consider edge cases (e.g., what happens if the network is offline? What if the AI ingestion fails?).
- **Continuous Self-Correction:** Before submitting a plan or pushing code, critically review your own work. Ask yourself: 'Is this the absolute best way to solve this?', 'Does this meet the highest engineering standards?', and 'Have I tested this thoroughly via TypeScript and logic checks?'
- **Over-Communication of Value:** When summarizing your work, explain *why* the design decisions you made are superior and how they improve the app's overall quality and user experience.
