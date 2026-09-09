# Original User Request

## Initial Request — 2026-07-22T18:43:33Z

> **Goal:** Audit + reconcile all recently-merged agent branches in `D:\1_NSC MAP APP`

The NSC Map App (a React/TypeScript Vite + Node API on Vercel) has had multiple agents working in parallel on different feature areas and pushing individual commits. The mission is to ensure every change coincides cleanly — type contracts are honored, imports resolve, no regressions exist, and the build is clean.

Working directory: `D:\1_NSC MAP APP`

---

## Background — What Each Agent Built (July 20-22, 2026)

| Commit | Author | Area | Work Done |
|--------|--------|------|-----------|
| `37cefeb` | williamkeesee06 | `drawing/` + `jobs-map/` | Fix Google Maps SVG scaling tiled poles; Doppelrand labels |
| `d937821` | wkeesee | `ziply/` + `drawing/` + `packages/types` | GPU hardware accel, memoized SVG URLs, new `ZiplyPrintStudioOverlay`, `ZiplyPrintTray`, `PrintCropperModal`, `ZiplyPlantInventoryTab`, new `ZiplyPrintSheetOverlay` type |
| `55eef0d` | wkeesee | UI / design system | Premium design upgrades, font additions, Lumina tools fix |
| `9c8da6c` | williamkeesee06 | `drawing/DrawingOverlayLabels` | Light-mode labels upgrade |
| `a1f68b6` | williamkeesee06 | Ziply 2-point alignment PDF viewer | Zoom/pan support |

## Known Critical Issue (Root Cause Identified)

**`packages/types` was never rebuilt after new fields were added to `DrawingStyle` and `ZiplyPrintSheetOverlay` was added to `index.ts`.** The stale `packages/types/dist/index.d.ts` does NOT include these fields, causing 21 TypeScript compilation errors in the web app. Vercel builds will silently fail.

### Errors (from `npx tsc --noEmit` in `apps/web`):
```
ObjectDetailsCard.tsx(871): Property 'ziplyAiSuggested' does not exist on type 'DrawingStyle'
ObjectDetailsCard.tsx(1028): Property 'ziplyTailLengthFt' does not exist on type 'DrawingStyle'
ObjectDetailsCard.tsx(1049): Property 'ziplyLashedOrConduitFt' does not exist on type 'DrawingStyle'
ObjectDetailsCard.tsx(1072): Property 'ziplyServedAddressesList' does not exist on type 'DrawingStyle'
ObjectDetailsCard.tsx(1138): Property 'ziplyFiberCount' does not exist on type 'DrawingStyle'
JobsMap.tsx(53):  Module '@nsc/types' has no exported member 'ZiplyPrintSheetOverlay'
JobsMap.tsx(671): Parameter 'prev' implicitly has an 'any' type
ZiplyPlantInventoryTab.tsx(165): Property 'ziplyFiberCount' does not exist on type 'DrawingStyle'
ZiplyPrintStudioOverlay.tsx(3): Module '@nsc/types' has no exported member 'ZiplyPrintSheetOverlay'
```

---

## Requirements

### R1. Rebuild `@nsc/types` package
Run `npm run build -w packages/types` from the repo root to regenerate `packages/types/dist/index.d.ts` and `packages/types/dist/index.js` with all the new fields. This should resolve the majority of TS errors.

### R2. Fix remaining TypeScript errors
After the types rebuild, run `npx tsc --noEmit` in `apps/web`. For any remaining errors:
- **`JobsMap.tsx:671` — `Parameter 'prev' implicitly has an 'any' type`**: Add the proper type annotation to the `prev` parameter in the `setState` callback.
- Fix any other errors that persist after the rebuild.

### R3. Fix `apps/api` TypeScript errors (if any)
Run `npx tsc --noEmit` in `apps/api`. Fix any errors found.

### R4. Verify cross-boundary type contract consistency
Confirm these contracts between recent agent work are consistent:
- `ZiplyPrintSheetOverlay` interface in `@nsc/types` matches exactly what `ZiplyPrintStudioOverlay.tsx` and `JobsMap.tsx` consume (props, field names, types)
- `DrawingStyle` fields used by `ObjectDetailsCard.tsx` and `ZiplyPlantInventoryTab.tsx` all exist in `@nsc/types/src/index.ts`
- The `DrawingObject` union in `@nsc/types` includes `ziply_flower_pot` and `flower_pot_new`/`flower_pot_removed` tools that appear in `ObjectDetailsCard.tsx`

### R5. Push a clean commit
Once all TypeScript errors are zero, commit with message:
```
fix(types): rebuild @nsc/types dist and resolve cross-agent TS type errors
```
and push to git so Vercel triggers a clean rebuild.

---

## Acceptance Criteria

### TypeScript Compilation Clean
- [ ] `npx tsc --noEmit` in `apps/web` exits with code 0 (zero errors)
- [ ] `npx tsc --noEmit` in `apps/api` exits with code 0 (zero errors)
- [ ] `npx tsc --noEmit` in `packages/types` exits with code 0 (zero errors)

### Types Package Rebuilt
- [ ] `packages/types/dist/index.d.ts` contains `ZiplyPrintSheetOverlay`
- [ ] `packages/types/dist/index.d.ts` contains `ziplyFiberCount`, `ziplyAiSuggested`, `ziplyTailLengthFt`, `ziplyLashedOrConduitFt`, `ziplyServedAddressesList`
- [ ] `packages/types/dist/index.d.ts` is newer than `packages/types/src/index.ts`

### Git
- [ ] A commit exists with message containing "rebuild @nsc/types dist"
- [ ] The commit is pushed to the remote

### No Regressions
- [ ] `ZiplyPrintSheetOverlay` is correctly consumed in both `JobsMap.tsx` and `ZiplyPrintStudioOverlay.tsx`
- [ ] All 21 previously-failing TS errors are gone
