# North Sky As-Built — Render + Billing Spec
## The "All-In-One" Rule: Every drawn element generates both a visual AND billing output simultaneously.

---

## COLOR CONVENTION (Industry Standard As-Built)
| Status     | Color     | Hex       |
|------------|-----------|-----------|
| NEW        | Red       | #FF0000   |
| EXISTING   | Black     | #000000   |
| REMOVE     | Green     | #00AA00   |
| TRANSFER   | Blue      | #0000FF   |
| TEMP       | Orange    | #FF8800   |

---

## AERIAL CATEGORY

### POLE
- **Render**: Circle with X inside. A-Tag label below. Height label optional.
  - NEW = Red circle+X
  - EXISTING = Black circle+X
  - REMOVE = Green circle+X
  - TRANSFER (Xfer) = Blue circle+X
- **Modal fields**: Status | A-Tag (text) | Height (30/35/40/45/50/55ft) | Class (2/3/4/5) | Set Type (Standard / Hand Set / In Power / In Rock)
- **Billing output**:
  - NEW: Labor = `POLE WOOD <= 40ft` (if ht<=40) OR `POLE WOOD > 40-55ft` (if ht>40) + variants (IN POWER, IN ROCK)
  - NEW: Material = `POLE [ht]-[class] DF` (e.g. `POLE 35-5 DF`)
  - REMOVE: Labor = `RMV POLE - CTL OWNED` or `RMV POLE - FOREIGN`
  - EXISTING: No billing (reference only)
- **Unit type**: EA

### STRAND
- **Render**: Thick dashed line (dash-gap pattern). Black=NEW, Green=REMOVE.
  - Label along line: "10M" or "16M" or "6M"
- **Modal fields**: Status (NEW/REMOVE) | Size (6M/6.6M/10M/16M) | Footage (number, auto-measured)
- **Billing output**:
  - NEW: `STRAND 10M` (or 16M/6M) per FT
  - REMOVE: `RMV STRAND - BARE` per FT
- **Unit type**: FT

### DE/RELASH
- **Render**: Wavy/zigzag purple line. Label: "DE&RE"
- **Modal fields**: Footage (auto-measured)
- **Billing output**: `AERIAL DELASH - RELASH` per FT
- **Unit type**: FT

### RE-TENSION
- **Render**: Red arrow →. Label: "RE-TEN"
- **Modal fields**: Qty (number of spans)
- **Billing output**: `AERIAL SPAN RE-TENSION` per EA (qty entered)
- **Unit type**: EA

### DOWN GUY
- **Render**: Diagonal arrow pointing down-toward-ground. Color by status.
  - NEW = Red, REMOVE = Green
- **Modal fields**: Status (NEW/REMOVE) | Strand Size (6M/10M/16M) | Qty
- **Billing output**:
  - NEW: Labor = `DOWN GUY` (EA) + Material = `DOWN GUY [size]` (EA) + `DOWN GUY GUARD` (EA)
  - REMOVE: `DOWN GUY` removal (discuss — no specific removal code in contract)
- **Unit type**: EA

### ANCHOR
- **Render**: Arrow with perpendicular base bar (→|). Color by status.
- **Modal fields**: Status (NEW/REMOVE) | Type (SCREW/ROCK/EXPAND-BUST/SWAMP/MANTA RAY/PLATE) | Size (6M/10M/16M)
- **Billing output**:
  - NEW: Labor = `ANCHOR - SCREW` (or ROCK/EXPAND etc.) + Material = `ANCHOR SCREW 10M` (or variant)
  - REMOVE: (No specific removal code — flag for supervisor review)
- **Unit type**: EA

### LASH / OVERLASH (add to Aerial panel)
- **Render**: Solid line with "LASH" or "O/L" label. Black=LASH, Purple=OVERLASH
- **Modal fields**: Type (LASH/OVERLASH/OVERLASH ADDL) | Cable Type (COPPER/FIBER) | Cable Size | Footage
- **Billing output**:
  - LASH FIBER: `LASH FIBER` per FT
  - LASH COPPER <=400pr: `LASH COPPER <= 400pr` per FT
  - LASH COPPER >400pr: `LASH COPPER > 400pr` per FT
  - OVERLASH FIBER: `OVERLASH FIBER` per FT
  - OVERLASH COPPER: `OVERLASH COPPER <= 400pr` or `> 400pr` per FT

---

## CABLE CATEGORY

### COPPER CABLE (Aerial)
- **Render**: Solid black line. "C" markers every ~200px along line. Size label.
  - NEW=Red line, EXISTING=Black, REMOVE=Green
- **Modal fields**: Condition (NEW/EXISTING/REMOVE) | Pair Size (25/50/100/200/300/400/600/900/1200) | Footage | Method (LASH/OVERLASH/OVERLASH ADDL/UG CONDUIT)
- **Billing output** (NEW):
  - Material: `COP CABLE [size] ANMW` per FT (e.g. `COP CABLE 200 ANMW`)
  - Labor: `LASH COPPER <= 400pr` or `LASH COPPER > 400pr` per FT (based on pair size)
  - If UG: `COPPER PL IN CONDUIT <= 300pr` or appropriate tier per FT
- **Billing output** (REMOVE):
  - `RMV AERIAL COPPER <= 400pr` or `> 400pr` per FT
- **Unit type**: FT

### FIBER CABLE (Aerial)
- **Render**: Solid black line. "F" markers every ~200px. Count label.
  - NEW=Red, EXISTING=Black, REMOVE=Green
- **Modal fields**: Condition (NEW/EXISTING/REMOVE) | Count (12/24/48/72/96/144/216/288) | Footage | Start Foot Mark | End Foot Mark | Method (LASH/OVERLASH/ADSS/UG) | Rack/Slack footage
- **Billing output** (NEW):
  - Material: `FIB [count] 1JKT 1ARMOR LT` per FT (e.g. `FIB 144 1JKT 1ARMOR LT`)
  - Labor: `LASH FIBER` or `OVERLASH FIBER` per FT
  - If UG: `FIBER PL IN CONDUIT` per FT
  - If slack storage: `AERIAL FIBER SNOWSHOE` per EA
- **Billing output** (REMOVE):
  - `RMV AERIAL FIBER` per FT
- **Unit type**: FT (material and labor both per foot)

### COAX CABLE
- **Render**: Brown solid line. Size label.
- **Modal fields**: Size (.500/.625/.750/.875) | Footage | Method
- **Billing output**: No specific coax code in contract — flag for special quote
- **Unit type**: FT

---

## UNDERGROUND CATEGORY

### TRENCH
- **Render**: Red solid thick line. Label shows depth/width. "TRENCH" text.
- **Modal fields**: Cover Depth (30in/36in/48in) | Conduit Size (<=2.5in / 3-6in / >6in) | Type (Standard/Stick/Metal) | Footage
- **Billing output**: Correct code = `TRENCH [depth]in CVR [conduit size]` per FT
  - e.g. `TRENCH 30in CVR <= 2.5in`, `TRENCH 36in CVR 3-6in`, `TRENCH 48in CVR STICK <= 2.5in`
  - Open cut (no conduit): `OPEN TRENCH <= 2.5in` or `OPEN TRENCH 3-6in`
- **Unit type**: FT

### BORE
- **Render**: Brown dashed thick line. Label: "BORE [diameter]""
- **Modal fields**: Diameter (1.25/2/4 in) | Footage
- **Billing output**: No standard bore unit — maps to `SPECIAL QUOTE - BORE - LE` with supervisor flag
  - OR use open trench equivalent if applicable
- **Unit type**: FT (flagged)

### HANDHOLE (HH)
- **Render**: Rectangle divided by center vertical line, "H" on each side. Color by status.
- **Modal fields**: Status (NEW/EXISTING/REMOVE) | Dimensions (select from real sizes) | Lid Type (Standard/Split Lid) | Grounding (Y/N)
- **HH Size options** (real codes):
  - Small: `HH 13x24x18`, `HH 17x30x24`
  - Medium: `HH 30x48x36`, `HH 30x48x36 SPLIT LID`, `HH 30x60x30`
  - Large: `HH 36x60x36`, `HH 48x48x48`, `HH 48x60x36`
  - XL: `HH 48x72x48`, `HH 48x96x50`
- **Billing output**:
  - NEW: `HH [dimensions]` per EA (e.g. `HH 30x48x36`)
  - NEW+Grounding: also add `HH 13x24x18 GROUNDING` or `GROUND POLE ASSEMBLY`
  - REMOVE: `RMV HH` per EA
  - Grade adjust: `HH GRADE ADJUSTMENT` per EA
- **Unit type**: EA

### VAULT / MANHOLE (MH)
- **Render**: Larger rectangle with "V" or "MH" label.
- **Modal fields**: Status | Type (HH/MH) | Dimensions
- **MH codes**: `MH 48x72x84in`, `MH 72x72x72in`, `MH 72x144x84in`
- **Billing output**: MH size code per EA
- **Unit type**: EA

### SPLICE PIT
- **Render**: Square with X inside. Color by status.
- **Modal fields**: Status (NEW/REMOVE) | Size (SMALL/MEDIUM/LARGE)
- **Billing output**: `PIT SMALL 6x4x5ft`, `PIT MEDIUM 12x6x5ft`, or `PIT LARGE 12x12x6ft` per EA
- **Unit type**: EA

### PEDESTAL
- **Render**: Small rectangle with dot inside. "PED" label.
- **Modal fields**: Status | Type (Copper/Fiber) | Size (6/8/10/12/14in) | Mount (Stake/Pole/Integral Stake)
- **Billing output**:
  - Copper: `PED [size]in [mount type]` e.g. `PED 10in STAKE MOUNT`
  - Fiber: `PED FIB [size]in [mount type]` e.g. `PED FIB 10in STAKE MOUNT`
  - Sizes map: SMALL=6-12in, MEDIUM=14-24in, LARGE=36-42in
  - REMOVE: `RMV PEDESTAL` per EA
- **Unit type**: EA

### CONDUIT
- **Render**: Dashed gray line. Size label. "CDUT" text.
- **Modal fields**: Size (1in/2in/3in/4in) | Schedule (SCH40/SCH80/HDPE) | Footage | Location (Aerial/UG)
- **Billing output**:
  - Material: `CONDUIT 2in SCH40 20ft GRY` or `CONDUIT 2in SCH40 20ft GRY UG` per EA (per stick)
  - Labor placement: `HDPE PL IN CONDUIT <= 2in` or `FIBER IN CONDUIT ISP` per FT
- **Unit type**: EA (material per stick) + FT (labor)

---

## SPLICING CATEGORY

### SPLICE CASE
- **Render**: Diamond shape. Color by status. Case ID label.
- **Modal fields**: Status (NEW/EXISTING) | Location (AERIAL/BURIED/UG) | Cable Type (COPPER/FIBER) | Case Size (from dropdown of real codes) | Pressure (Pressurized/Non-pressure/Free Breathing)
- **Billing output**:
  - NEW FIBER: `CASE FIBER NEW` (labor) + specific case material code per EA
  - NEW COPPER: `CASE COPPER NEW PRESSURE` or `CASE COPPER NEW NON-PRESSURE` (labor) + case material
  - RE-ENTER: `RE-ENTER EXIST FIBER CASE` or `RE-ENTER EXIST COPPER CASE`
  - Always add: `SPL SETUP-TEARDOWN [location]-[type]` per EA
    - e.g. `SPL SETUP-TEARDOWN AERIAL-FIB`, `SPL SETUP-TEARDOWN HH-COP`
- **Unit type**: EA

### SPLICE ACTIVITY (Fiber)
- **Render**: Small circle/dot on splice case. Count label.
- **Modal fields**: Type (FUSION/RIBBON/MECHANICAL) | Count (number of fibers/pairs)
- **Billing output** (Fiber Fusion):
  - 1-4 fibers: `SPLICE FIBER FUSION 1-4`
  - 5-12: `SPLICE FIBER FUSION 5-12`
  - 13-24: `SPLICE FIBER FUSION 13-24`
  - 25-48: `SPLICE FIBER FUSION 25-48`
  - 49-144: `SPLICE FIBER FUSION 49-144`
  - 145-288: `SPLICE FIBER FUSION 145-288`
  - 289-432: `SPLICE FIBER FUSION 289-432`
  - 433-864: `SPLICE FIBER FUSION 433-864`
- **Billing output** (Ribbon):
  - <=2 ribbons: `SPLICE FIBER RIBBONS <=2`
  - 3-12: `SPLICE FIBER RIBBONS 3-12`, etc.
- **Unit type**: EA (per splice count tier)

### SPLICE ACTIVITY (Copper)
- **Billing output**:
  - Mechanical 1-25pr: `SPLICE COPPER MECHANICAL 1-25pr`
  - Mechanical 26-100pr: `SPLICE COPPER MECHANICAL 26-100pr`
  - Mechanical >100pr: `SPLICE COPPER MECHANICAL > 100pr`
  - Module <=300pr: `SPLICE COPPER MODULE <= 300pr`
  - Module 301-900pr: `SPLICE COPPER MODULE 301-900pr`
  - Module 901-1800pr: `SPLICE COPPER MODULE 901-1800pr`
  - Module >1800pr: `SPLICE COPPER MODULE > 1800pr`
- **Unit type**: EA

### TERMINAL
- **Render**: Small square. Label with pair count.
- **Modal fields**: Type | Pair count
- **Billing output**: Terminal-specific codes (part of case install)

### MPOP
- **Render**: Rectangle with "MPOP" label.
- **Modal fields**: Label text
- **Billing output**: Reference only / Special Quote

### RISER
- **Render**: Vertical rectangle at pole base. Size label.
- **Modal fields**: Diameter (2in/3in/4in) | Material (Plastic/Steel) | Height
- **Billing output**:
  - Material: `RISER PIPE POLE 2in PLASTIC` or `2in STEEL` or `3in PLASTIC` etc.
  - Guard: `RISER U-GUARD 2 in PLASTIC` or `3in PLASTIC` etc.
  - Removal: `RMV POLE RISER OR U-GUARD`
- **Unit type**: EA

### GROUND ROD
- **Render**: Small circle with downward bar.
- **Modal fields**: Size (5/8in-8ft / 5/8in-20ft / 1/2in-5ft)
- **Billing output**:
  - `GROUND ROD 5/8in-8ft` (most common)
  - `GROUND ROD 5/8in-20ft THREADED`
  - `GROUND ROD 1/2in-5ft`
  - Also: `GROUND POLE ASSEMBLY` (for HH grounding)
- **Unit type**: EA

---

## X-FERS (TRANSFER) CATEGORY
All transfer items render in BLUE (#0000FF).

### XFER POLE
- Same as POLE but blue. Means the pole and its attachments are being transferred (rearranged).
- **Billing**: `REARRANGE XFER POLE ATTACHMENT` (EA) + `REARRANGE XFER POLE ATTACHMENT ADDL` for each additional attachment
- Also: `REARRANGE POLE` (EA)

### XFER ANCHOR
- Blue anchor symbol.
- **Billing**: No specific transfer anchor code — use supervisor review flag

### XFER EQUIP
- Blue rectangle/symbol.
- **Billing**: `REARRANGE XFER POLE MOUNT SMALL FAC` or `REARRANGE XFER POLE MOUNT LARGE FAC`

---

## REMOVALS CATEGORY
All removals render in GREEN (#00AA00).

| Tool | Visual | Billing Code |
|------|--------|-------------|
| RMV AER COPPER | Green line + "X-AC-X" markers | `RMV AERIAL COPPER <= 400pr` or `> 400pr` |
| RMV UG COPPER | Green line + "X-UC-X" markers | `RMV COPPER FROM CONDUIT <= 400pr` or `> 400pr` |
| RMV AER FIBER | Green line + "X-AF-X" markers | `RMV AERIAL FIBER` |
| RMV UG FIBER | Green line + "X-UF-X" markers | `RMV FIBER FROM CONDUIT` |
| RMV POLE | Green circle-X | `RMV POLE - CTL OWNED` or `RMV POLE - FOREIGN` |
| RMV STRAND | Green dashed line | `RMV STRAND - BARE` |
| RMV ANCHOR | Green anchor arrow | (supervisor flag) |
| RMV HH | Green HH symbol | `RMV HH` |
| RMV PED | Green ped symbol | `RMV PEDESTAL` |

---

## SURFACE RESTORATION (add-on items, not drawn — entered in sidebar)
These don't render as drawn lines but are added as billable items from a checklist:
- `ASPHALT RMV & RESTORE <= 6in` (SF)
- `ASPHALT RMV & RESTORE > 6-12in` (SF)
- `ASPHALT TEMPORARY COLD PATCH` (SF)
- `CONCRETE RMV-RESTORE <= 6in` (SF)
- `SELECT BACKFILL SAND`, `SELECT BACKFILL PEA GRAVEL` (CY)
- `POTHOLE HARD SURFACE`, `POTHOLE SOFT SURFACE` (EA)

---

## BILLING DASHBOARD DISPLAY FORMAT
UNIT CODE              | QTY  | UNIT
-----------------------|------|-----
POLE WOOD <= 40ft      |  3   | EA
POLE 35-5 DF           |  3   | EA
STRAND 10M             | 850  | FT
LASH FIBER             | 850  | FT
FIB 48 1JKT 1ARMOR LT  | 850  | FT
HH 30x48x36            |  2   | EA
CASE FIBER NEW         |  1   | EA
SPLICE FIBER FUSION 49-144 | 1 | EA
SPL SETUP-TEARDOWN AERIAL-FIB | 1 | EA

---

## SUPERVISOR / BILLING WORKFLOW
1. Foreman draws the job in the field (phone/tablet)
2. Supervisor reviews sketch, fixes any missing elements
3. Billing dashboard auto-populates with correct unit codes
4. **Billing team exports**: PDF (sketch + header + unit table) ready for Lumen submittal
5. Optional: Export unit codes as CSV for direct entry into billing system


===== FILE: EXTRACTED: state object initial value =====
const state = {
  activeTool:      'SELECT',
  activeCategory:  null,
  activeKey:       null,
  activeType:      null,      // POINT | LINE | ARROW | ANCHOR | ARROW_CALLOUT | MODAL_ONLY
  drawingLine:     false,
  lineStart:       null,
  previewLine:     null,
  calloutStep:     0,
  calloutLeaderPt: null,
  calloutDragging: false,    // Change 4: track drag state for callout
  drawingRect:     false,
  rectStart:       null,
  previewRect:     null,
  drawingCircle:   false,
  circleStart:     null,
  previewCircle:   null,

  // grubbing rect draw
  drawingGrubbing:   false,
  drawingRmvBuried:  false,
  rmvBuriedStart:    null,
  previewRmvBuried:  null,
  grubbingStart:   null,
  previewGrubbing: null,
  // rod & proof / locate sonde — multi-segment polyline
  polyLineTool:    null,   // 'ROD_PROOF' | 'LOC_SONDE' | null
  polyPoints:      [],     // array of {x,y} clicked so far
  polySegments:    [],     // fabric.Line preview segments on canvas
  polyPreview:     null,   // current rubber-band segment
  // two-click transfer arrow
  xferStep:        0,
  xferStart:       null,
  xferAttrs:       null,
  // New unified XFERS tool
  xfersMode:       false,  // waiting for pole click
  xfersDot:        null,
  isPanning:       false,
  lastPanPoint:    null,
  spaceDown:       false,
  history:         [],
  historyLocked:   false,
  toolColor:       '#000000',
  toolStroke:      2,
  toolLinestyle:   'solid',
  billableData:    [],
  unitMap:         new Map(),   // objectId => [billing entries]
};

===== FILE: EXTRACTED: setTelecomTool calls + tele-btn data-keys =====
function setTelecomTool(category, key, type) {
        <button class="tool-btn tele-btn" data-category="misc" data-key="TNE" data-type="MODAL_ONLY">T&amp;E</button>
        <button class="tool-btn tele-btn" data-category="misc" data-key="DOWNTIME" data-type="MODAL_ONLY">DOWNTIME</button>
        <button class="tool-btn tele-btn" data-category="misc" data-key="SPLICER_FIBER" data-type="MODAL_ONLY">SPLICER FIBER</button>
        <button class="tool-btn tele-btn" data-category="misc" data-key="SPLICER_COPPER" data-type="MODAL_ONLY">SPLICER COPPER</button>
        <button class="tool-btn tele-btn" data-category="misc" data-key="EMERGENCY_TRAVEL" data-type="MODAL_ONLY">EMG TRAVEL TIME</button>
        <button class="tool-btn tele-btn" data-category="misc" data-key="VAC_TRUCK" data-type="MODAL_ONLY">VAC TRUCK</button>
        <button class="tool-btn tele-btn" data-category="underground" data-key="GRUBBING" data-type="RECT">GRUBBING</button>
    // Buttons with data-tool (e.g. XFERS) go through setTool, not setTelecomTool
        setTelecomTool(clone.dataset.category, clone.dataset.key, clone.dataset.type);



Contains: js/contract_units.json (746 Lumen unit codes)
