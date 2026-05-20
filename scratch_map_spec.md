# NORTHSKY Map + Workspace + Layers UX Spec
Synthesized from convo.pdf (46 pages) ΓÇö every locked decision quoted/paraphrased faithfully.

## 1. Three-Level Product Architecture

The unified product has **three levels**, not two:

1. **Map View** ΓÇö quick visual overview of the job, just the gist (jobs map for discovery + filtering).
2. **Workspace (Focused Job Editor)** ΓÇö full rendered as-built picture for one job.
3. **Layer/Detail Controls** ΓÇö drill into specific dates or people inside one job.

> "Open on map ΓåÆ jobs filtered by signed-in user role ΓåÆ open a job and always render existing work ΓåÆ allow new as-built creation when nothing exists ΓåÆ support map/satellite views ΓåÆ support optional engineering print overlays ΓåÆ support layered daily records under one job ΓåÆ roll up billable units to the job level."

Primary user (for now): **supervisor / office or field lead**, NOT foreman. The UI stays rich/powerful; a stripped-down iPad-friendly foreman mode comes later on the same backend data model.

## 2. Data Model

- **Job** ΓÇö Smartsheet-backed record (the existing 191-job catalog).
- **Print overlays** ΓÇö optional reference layers tied to the job (PDF/image, manually aligned to the map).
- **As-built sessions / layers** ΓÇö dated work packages, one per foreman per date.
- **Features** ΓÇö lines, points, notes, photos, labels, units inside a specific as-built layer.

One job = many as-built layers. Each layer = one crew/day/phase/story of work.

Per-feature persistence example (MH):
```
toolType = MH
label
status
size (when status=NEW)
coordinates
layerId
jobId
createdBy
workDate
billingEntries
```

## 3. Engineering Print Overlay

- Allow one or more engineering print uploads per job.
- User manually aligns each print to the map (control points / stretch / rotate).
- Saved as toggleable overlay layers.
- **v1: print overlay is visual reference only ΓÇö NEVER the source of truth for measurements or billing.** Billing/geometry come from drawn as-built objects.
- **Engineering Print badge** ΓÇö only ONE active per job at a time. Reassignable to a revised print. Older prints remain attached unless deleted. UX: "Set as Engineering Print" button on a PDF attachment.
- Attachment system: supports PDFs and normal files, **blocks KMZ and GeoJSON**, auto-uploads/syncs to Smartsheet, can tag the relevant PDF as Engineering Print.

## 4. Map View (Jobs Map)

### 4.1 Job card on first click ΓÇö fields and layout
- **Top row:** Job # + status pill + sync state icon (status pill moved up next to job # to avoid overlap)
- **Second row:** Address, City
- **Main details:** Foreman/Crew, Schedule Date, Traffic Control
- **Notes block:** NSC Project Notes (collapsed to 2-3 lines unless expanded)
- **Footer actions:** Enter Workspace ┬╖ Sync Reference Layer ┬╖ minimize/close
- Engineering Print Attached indicator shown near top of card when applicable

### 4.2 What renders on the map
- The map shows the **Quick Reference Layer** by default ΓÇö NOT every granular as-built object.
- Quick Reference Layer = a simplified "gist" extracted automatically from the full as-built data.
- Two ways the Quick Ref Layer is populated:
  - **Quick Mode** (manual lightweight input, mostly for backfilling older jobs)
  - **Auto-extracted from As-Built Mode** (the primary path going forward)

### 4.3 Quick Mode (lightweight backfill capture)
- Visual only ΓÇö no footage, no billing units.
- Cable Quick-Mode prompt sequence:
  1. Status (NEW / REMOVED)
  2. Aerial or Underground (buttons)
  3. Cable family: Fiber / Copper / ASW / BSW
  4. Optional label
- Rendering rules (must match As-Built Mode visual language):
  - Aerial cable ΓåÆ **solid line**
  - Underground cable ΓåÆ **dashed line**
  - New / placed ΓåÆ **red**
  - Removed ΓåÆ **green**

### 4.4 Quick Reference Layer sync behavior
- First as-built saved for a job ΓåÆ **auto-generate the reference layer gist**.
- Later edits flag the gist as "out of date" until user manually syncs from the map-view job card.
- Job card sync icon states:
  - No reference layer yet ΓåÆ (auto-creates on first as-built save)
  - Out of date ΓåÆ red mark
  - Synced ΓåÆ green checkmark
- Map view always reads the saved reference layer, NOT the live newest as-built. No background recomputation.

## 5. Workspace (Focused Job Editor)

### 5.1 Entry behavior
- Triggered by "Enter Workspace" on the job card.
- Opens as a **focused single-job editor**.
- **Map auto-centers on the job's real location** when opened (random reset breaks flow ΓÇö explicit rule).
- Other jobs are hidden.
- Full toolset stays available.
- Layers and live totals shown immediately so the user is ready to work.

### 5.2 Layout
- **Top:** thin job context strip (work order, address, status) ΓÇö stays light.
- **Center:** the map, fully focused on this one job.
- **Left rail:** full drawing + editing tools (the same tools from the As-Built tool source: aerial / UG / cable / splicing / xfers / misc / tools).
- **Right panel:** layers, grouped objects, running totals.

Inspired by Google My Maps but tuned for telecom as-built.

### 5.3 First-10-seconds workflow
1. Confirm correct job from top strip.
2. See prior layers already loaded (rendered by default).
3. Pick or create today's layer.
4. Start drawing immediately with left-rail tools.

No setup dialog should block them unless an active-layer context is truly missing.

### 5.4 Layer workflow rules
- One as-built layer per foreman per date.
- New layers build on previous layers for the same job.
- **Previous layers are visible by default but can be hidden.**
- **Older layers are NOT editable by default** ΓÇö they become editable only when explicitly toggled (deliberate layer-edit mode).
- New objects are saved to the currently active daily layer.

## 6. Right-Side Layers Panel

Two jobs only: organize the job visually + show live billable rollups.

### 6.1 Panel structure (top ΓåÆ bottom)
1. **Top: Job totals / billable summary**
2. **Middle: Layer list by foreman + date**
3. **Under each layer: grouped map objects** (Cable, Removed Cable, Poles, MH, HH, PED, Notes, etc.) ΓÇö counts/footage shown beside each group name. Not a flat list of every feature.

### 6.2 Totals behavior
- Active Layer Totals (today's work)
- Job Totals (running grand total)
- Both visible at once ΓÇö user shouldn't flip views.

### 6.3 Per-layer row controls
- show/hide
- make active for editing
- rename date if needed
- explicit unlock for editing older layers

## 7. Tool Spec Framework (mental model for every tool)

Every tool spec captures: identity, visual render, input schema (with conditional fields), layer behavior, billing logic, persistence model, main map behavior, QA scenarios, build status.

Existing tools (already built ΓÇö DO NOT REBUILD): cable family, point tools (Pole, HH, MH, PED, Cabinet, Anchor), measure, edit, billable flow, persistence. Occupied conduit adder is already correct.

### 7.1 Locked label rules
- **Pole labels: required**, auto-format to `A-#####` if user doesn't include the prefix.
- **MH / HH / PED labels: optional.**
- **Line labels: optional**; if entered, the exact text becomes the rendered callout for that line.

### 7.2 Status ΓåÆ color (universal across both Quick and As-Built modes)
- NEW: red
- EXISTING: black (label only, no billing)
- REMOVED: green (with intermittent X marks along the line for removal lines)

### 7.3 Mode behavior
- **Quick Mode** = manual summary entry tool (visual only, no footage, no units).
- **As-Built Mode** = full production detail tool (footage, full fields, billing logic, unit generation).
- Same core tool family exists in both modes ΓÇö different prompt depth + behavior.

## 8. Production-Readiness Priorities (next phase, locked)

User explicitly closed out tool-building: *"i'm done with tools, i already have the main ones built in, they generate the appropriate billable unit, so i want to move on."*

Priority order for the merge work:
1. **Job lookup and map load** ΓÇö work order lookup, address fill, geocode, map capture always work.
2. **Canvas stability** ΓÇö draw, select, move, delete, undo/redo, zoom, pan, background image behavior.
3. **Billing integrity** ΓÇö every existing tool writes the right units into `state.unitMap`, removes stale entries on delete, preserves decimals (no Math.round).
4. **Export and persistence** ΓÇö save/load and PDF export produce clean, submission-ready output every time.

**Out of scope right now:** new fringe tools, SKU-level material pickers, rare contract exceptions, additional tool variations.

## 9. Sensitive Operational Detail Notice

The PDF spec contains an exposed Google Maps API key, Smartsheet sheet ID, Worker URL, and deployment identifiers. Treat as compromised; rotate outside this thread before production hardening or shared deployment.
