# Project: NSC Map App Audit & Reconciliation

## Architecture
- Monorepo structure:
  - `packages/types`: Shared TypeScript definitions (`@nsc/types`)
  - `apps/web`: React/TypeScript Vite frontend
  - `apps/api`: Node API backend

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | Exploration & Contract Verification | Audit TS errors, verify cross-boundary contracts | None | DONE |
| 2 | Types Rebuild & TS Error Fixes | Run `npm run build -w packages/types`, fix web/api TS errors | M1 | DONE |
| 3 | Verification & Review | Run `npx tsc --noEmit` on all packages, reviewer validation | M2 | DONE |
| 4 | Forensic Audit | Verify integrity of all changes and fixes | M3 | DONE |
| 5 | Git Commit & Push | Commit with fix message and push to remote | M4 | DONE |

## Interface Contracts
### `@nsc/types` ↔ `apps/web` (`JobsMap.tsx`, `ZiplyPrintStudioOverlay.tsx`, `ObjectDetailsCard.tsx`, `ZiplyPlantInventoryTab.tsx`)
- `ZiplyPrintSheetOverlay` exported from `@nsc/types`
- `DrawingStyle` fields: `ziplyAiSuggested`, `ziplyTailLengthFt`, `ziplyLashedOrConduitFt`, `ziplyServedAddressesList`, `ziplyFiberCount`
- `DrawingObject` union: `ziply_flower_pot`, `flower_pot_new`, `flower_pot_removed`
