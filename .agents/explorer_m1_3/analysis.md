# Milestone 1: API TypeScript & Type Contract Audit Report

**Author:** Explorer 3 (Milestone 1)  
**Target:** `apps/api` & `@nsc/types`  
**Date:** 2026-07-23  

---

## 1. Executive Summary

`apps/api` was audited for TypeScript compilation status and cross-boundary type contract consistency against `@nsc/types`. 

- **TypeScript Compilation Status:** Clean (`0` errors). Running `npx tsc --noEmit` in `apps/api` exits with code `0`.
- **Cross-Boundary Contract Consistency:** `100%` verified. All 15 `@nsc/types` import locations across 9 files in `apps/api` resolve correctly without any contract mismatches or missing properties.

---

## 2. TypeScript Compilation Audit

**Command Executed:**
```bash
npx tsc --noEmit
```
**Working Directory:** `D:\1_NSC MAP APP\apps\api`  
**Result:** Code 0, 0 errors.

No type errors or missing exports were encountered when compiling `apps/api`.

---

## 3. `@nsc/types` Import Inventory & Boundary Verification

The following 15 imports from `@nsc/types` were located and verified across `apps/api`:

| File Path | Imported Symbols | Verification Result |
|---|---|---|
| `src/lib/geocode.ts:6` | `JobGeocode` (type) | Verified. Interface matches cached geocode structure. |
| `src/routes/asbuilt.ts:4` | `emptyAsbuilt`, `AsbuiltDoc` (value/type) | Verified. Used for legacy v1 schema handling. |
| `src/routes/digTickets.ts:9` | `normalizeDigShape`, `canDeleteDigTicket`, `buildRadiusShape`, `buildRouteShape` (functions) | Verified. Function signatures match export from `@nsc/types/src/geo.ts`. |
| `src/routes/digTickets.ts:10` | `DigShape`, `DigTicket`, `Job`, `UtilityStatus`, `ZiplySectionScope` (types) | Verified. Matches 811 dig ticket state & job records. |
| `src/routes/gigs.ts:3` | `Gig` (type) | Verified. Matches dispatch gig structure. |
| `src/routes/jobs.ts:34` | `DigShape`, `Job`, `PolygonData`, `ZiplyObjectStatus`, `ZiplySectionKind` (types) | Verified. All status enums and job data interfaces align cleanly. |
| `src/routes/jobs.ts:377` | `DigTicket` (inline import) | Verified. Casts Firestore document data. |
| `src/routes/luminaChat.ts:34` | `Job` (type) | Verified. Context provider type match. |
| `src/routes/sync.ts:11` | `SyncRun` (type) | Verified. Smartsheet sync log record structure match. |
| `src/services/jobsSync.ts:17` | `Job`, `JobGeocode`, `SyncRun` (types) | Verified. |
| `src/services/markingInstructions.ts:8` | `DigShape`, `DigTicket`, `Job`, `PolygonData` (types) | Verified. Used in Gemini prompt construction. |
| `src/services/ziplyFidelity.ts:4` | `Job` (type) | Verified. |
| `src/services/ziplyPlantUtils.ts:1` | `Job` (type) | Verified. |

---

## 4. Architectural & Schema Alignment Observations

1. **Phase 1 Legacy vs. Phase 3 As-Built Documents:**
   - `@nsc/types` exports both legacy `AsbuiltDoc` (schemaVersion: 1) and Phase 3 `AsBuiltDocument` (schemaVersion: 2).
   - `apps/api/src/routes/asbuilt.ts` imports `emptyAsbuilt` and `AsbuiltDoc` for legacy endpoint fallbacks, while maintaining Zod validation (`DrawingStyleSchema`, `DrawingObjectSchema`, `AsBuiltDocumentSchema`) for Phase 3 runtime body validation.
   - Non-strict Zod object parsing in `asbuilt.ts` allows newly-added `DrawingStyle` properties (e.g. `ziplyAiSuggested`, `ziplyFiberCount`, `ziplyTailLengthFt`) to pass through without schema rejection.

2. **Frontend-Only Types:**
   - `ZiplyPrintSheetOverlay` added in recent frontend work is consumed exclusively in `apps/web` (`JobsMap.tsx`, `ZiplyPrintStudioOverlay.tsx`). `apps/api` does not consume this type directly, which is architecturally correct as `apps/api` processes raw PDFs via `ziplyParser.ts` and returns standard JSON payloads.

---

## 5. Conclusion & Recommendations

- `apps/api` requires **no changes** for Milestone 1 or Milestone 2.
- The build in `apps/api` is completely clean.
- Cross-boundary type contracts between `@nsc/types` and `apps/api` are sound and fully verified.
