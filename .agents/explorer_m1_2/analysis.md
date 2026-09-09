# Detailed TypeScript Compilation Audit & Analysis — Explorer 2 (Milestone 1)

## Summary
- **Workspace Target:** `apps/web`
- **Command Executed:** `npx tsc --noEmit` (cwd: `D:\1_NSC MAP APP\apps\web`)
- **Total TS Errors Identified:** 21 compilation errors across 4 component files.

---

## 1. Full Error Log (`npx tsc --noEmit` Output)

```
src/features/drawing/ObjectDetailsCard.tsx(871,28): error TS2339: Property 'ziplyAiSuggested' does not exist on type 'DrawingStyle'.
src/features/drawing/ObjectDetailsCard.tsx(1028,40): error TS2339: Property 'ziplyTailLengthFt' does not exist on type 'DrawingStyle'.
src/features/drawing/ObjectDetailsCard.tsx(1029,53): error TS2353: Object literal may only specify known properties, and 'ziplyTailLengthFt' does not exist in type 'Partial<DrawingStyle>'.
src/features/drawing/ObjectDetailsCard.tsx(1049,40): error TS2339: Property 'ziplyLashedOrConduitFt' does not exist on type 'DrawingStyle'.
src/features/drawing/ObjectDetailsCard.tsx(1050,53): error TS2353: Object literal may only specify known properties, and 'ziplyLashedOrConduitFt' does not exist in type 'Partial<DrawingStyle>'.
src/features/drawing/ObjectDetailsCard.tsx(1072,33): error TS2339: Property 'ziplyServedAddressesList' does not exist on type 'DrawingStyle'.
src/features/drawing/ObjectDetailsCard.tsx(1072,184): error TS7006: Parameter 'addr' implicitly has an 'any' type.
src/features/drawing/ObjectDetailsCard.tsx(1072,190): error TS7006: Parameter 'idx' implicitly has an 'any' type.
src/features/drawing/ObjectDetailsCard.tsx(1076,54): error TS2339: Property 'ziplyServedAddressesList' does not exist on type 'DrawingStyle'.
src/features/drawing/ObjectDetailsCard.tsx(1077,59): error TS7006: Parameter '_' implicitly has an 'any' type.
src/features/drawing/ObjectDetailsCard.tsx(1077,62): error TS7006: Parameter 'i' implicitly has an 'any' type.
src/features/drawing/ObjectDetailsCard.tsx(1078,40): error TS2353: Object literal may only specify known properties, and 'ziplyServedAddressesList' does not exist in type 'Partial<DrawingStyle>'.
src/features/drawing/ObjectDetailsCard.tsx(1104,54): error TS2339: Property 'ziplyServedAddressesList' does not exist on type 'DrawingStyle'.
src/features/drawing/ObjectDetailsCard.tsx(1106,40): error TS2353: Object literal may only specify known properties, and 'ziplyServedAddressesList' does not exist in type 'Partial<DrawingStyle>'.
src/features/drawing/ObjectDetailsCard.tsx(1138,40): error TS2339: Property 'ziplyFiberCount' does not exist on type 'DrawingStyle'.
src/features/drawing/ObjectDetailsCard.tsx(1141,38): error TS2353: Object literal may only specify known properties, and 'ziplyFiberCount' does not exist in type 'Partial<DrawingStyle>'.
src/features/jobs-map/JobsMap.tsx(53,15): error TS2305: Module '"@nsc/types"' has no exported member 'ZiplyPrintSheetOverlay'.
src/features/jobs-map/JobsMap.tsx(671,43): error TS7006: Parameter 'prev' implicitly has an 'any' type.
src/features/ziply/ZiplyPlantInventoryTab.tsx(165,38): error TS2339: Property 'ziplyFiberCount' does not exist on type 'DrawingStyle'.
src/features/ziply/ZiplyPlantInventoryTab.tsx(165,69): error TS2339: Property 'ziplyFiberCount' does not exist on type 'DrawingStyle'.
src/features/ziply/ZiplyPrintStudioOverlay.tsx(3,20): error TS2305: Module '"@nsc/types"' has no exported member 'ZiplyPrintSheetOverlay'.
```

---

## 2. Component Inspection & Root Cause Analysis

### Component 1: `ObjectDetailsCard.tsx` (`src/features/drawing/ObjectDetailsCard.tsx`)
- **Errors:** 16 errors (TS2339, TS2353, TS7006).
- **Affected Properties:**
  - `ziplyAiSuggested` (line 871)
  - `ziplyTailLengthFt` (lines 1028, 1029)
  - `ziplyLashedOrConduitFt` (lines 1049, 1050)
  - `ziplyServedAddressesList` (lines 1072, 1076, 1078, 1104, 1106)
  - `ziplyFiberCount` (lines 1138, 1141)
- **Root Cause:** All these properties exist in `packages/types/src/index.ts` under `DrawingStyle` interface, but are missing from `packages/types/dist/index.d.ts` because `packages/types` was not rebuilt after new Ziply fields were added.

### Component 2: `ZiplyPlantInventoryTab.tsx` (`src/features/ziply/ZiplyPlantInventoryTab.tsx`)
- **Errors:** 2 errors (TS2339 on line 165).
- **Affected Property:** `ziplyFiberCount` on `obj.style`.
- **Root Cause:** Same root cause — `DrawingStyle` definition in `packages/types/dist/index.d.ts` lacks `ziplyFiberCount`.

### Component 3: `ZiplyPrintStudioOverlay.tsx` (`src/features/ziply/ZiplyPrintStudioOverlay.tsx`)
- **Errors:** 1 error (TS2305 on line 3).
- **Affected Import:** `type { ZiplyPrintSheetOverlay } from "@nsc/types"`.
- **Root Cause:** `ZiplyPrintSheetOverlay` interface was added to `packages/types/src/index.ts` (line 316), but `packages/types/dist` was not rebuilt.

### Component 4: `JobsMap.tsx` (`src/features/jobs-map/JobsMap.tsx`)
- **Errors:** 2 errors:
  1. Line 53: TS2305 — Module `@nsc/types` has no exported member `ZiplyPrintSheetOverlay`.
  2. Line 671: TS7006 — Parameter `prev` implicitly has an `any` type.

---

## 3. Specific Analysis: `JobsMap.tsx:671` (Parameter `prev` implicit `any`)

### Code Context:
```tsx
// JobsMap.tsx lines 341 & 670-672
341: const [activeStudioSheet, setActiveStudioSheet] = useState<ZiplyPrintSheetOverlay | null>(null);

670: onSaveTransform={(sheetId, updates) => {
671:   setActiveStudioSheet((prev) => prev ? { ...prev, ...updates } : null);
672: }}
```

### Analysis & Mechanism:
- At line 341, state is declared with generic type `useState<ZiplyPrintSheetOverlay | null>(null)`.
- Because `@nsc/types` dist bundle is stale and does NOT export `ZiplyPrintSheetOverlay`, `ZiplyPrintSheetOverlay` resolves as an error type / `any`.
- In `setActiveStudioSheet((prev) => ...)`, TypeScript cannot infer the type of callback parameter `prev` when the state's type is invalid or when no explicit annotation is present under strict `noImplicitAny`.
- **Exact Fix Required:**
  1. Rebuild `packages/types` package (`npm run build -w packages/types`).
  2. In `JobsMap.tsx` line 671, provide explicit type annotation to `prev`:
     ```tsx
     setActiveStudioSheet((prev: ZiplyPrintSheetOverlay | null) => prev ? { ...prev, ...updates } : null);
     ```

---

## 4. Rebuilding & Resolution Plan
1. Execute `npm run build -w packages/types` from repo root `D:\1_NSC MAP APP`.
2. Verify `packages/types/dist/index.d.ts` contains `ZiplyPrintSheetOverlay` and `DrawingStyle` fields (`ziplyAiSuggested`, `ziplyTailLengthFt`, `ziplyLashedOrConduitFt`, `ziplyServedAddressesList`, `ziplyFiberCount`).
3. Apply explicit type annotation `(prev: ZiplyPrintSheetOverlay | null)` at `JobsMap.tsx:671`.
4. Re-run `npx tsc --noEmit` in `apps/web` to confirm zero compilation errors.
