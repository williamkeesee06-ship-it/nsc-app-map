# DEPRECATED — do not install

**This folder is the old “NSC ITIC Copilot” extension.**

## Official 811 filing path (Roadmap C)

Use only:

```text
chrome-extension/   →  "NSC 811 Autofill"
```

That extension talks to the app via `NSC_811_JOB_DATA` / `NSC_811_FILED_SUCCESS`
and is the only path documented in the dig-ticket UI and `README-811-DEPLOY.md`.

## Why this folder still exists

Kept briefly for reference / git history. Do **not** Load unpacked from
`apps/extension` — it uses a different message protocol (`NSC_START_ITIC_AUTOMATION`)
and will confuse operators.

Safe to delete this folder in a future cleanup once no machines still load it.
