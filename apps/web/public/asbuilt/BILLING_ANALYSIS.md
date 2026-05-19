# North Sky Communications — Contract Billing Unit Analysis
## Total Units: 746 (from CONTRACT-UNITS-DESCRIPTION.xlsx)

---

## KEY FINDINGS FOR APP INTEGRATION

### What the current `units.js` gets WRONG vs. the real contract:

#### POLES
- App uses: `POLE-WOOD ${size}`, `LAB-POLE-INSTALL` ❌
- Real codes:
  - **Labor**: `POLE WOOD <= 40ft` (also: IN POWER, IN ROCK variants)
  - **Labor**: `POLE WOOD > 40-55ft` (also: IN POWER, IN ROCK variants)
  - **Material**: `POLE 30-5 DF`, `POLE 35-5 DF`, `POLE 40-5 DF`, `POLE 45-5 DF`, `POLE 50-4 DF` etc.
  - Format: `POLE [height]-[class] DF`
  - Classes: 2, 3, 4, 5, 6
  - Heights: 30, 35, 40, 45, 50, 55
  - Removal: `RMV POLE - CTL OWNED` or `RMV POLE - FOREIGN`

#### STRAND
- App uses: `STRAND 10M` ✅ (correct!)
- Real codes: `STRAND 10M`, `STRAND 16M`, `STRAND 6M`, `STRAND 6.6M`
- Removal: `RMV STRAND - BARE`

#### DOWN GUY / ANCHOR
- Real labor: `DOWN GUY`
- Real material: `DOWN GUY 10M`, `DOWN GUY 16M`, `DOWN GUY 6M`
- Also: `DOWN GUY GUARD`, `DOWN GUY INSULATOR`
- Anchor labor: `ANCHOR - SCREW`, `ANCHOR - ROCK`, `ANCHOR - EXPAND / CROSSPLATE / BUST`, `ANCHOR - SWAMP`, `ANCHOR - MANTA RAY`
- Anchor material: `ANCHOR SCREW 10M`, `ANCHOR ROCK 10M`, etc.

#### AERIAL WORK
- De/Relash: `AERIAL DELASH - RELASH` (per foot) ✅
- Re-tension: `AERIAL SPAN RE-TENSION` ✅
- Lash fiber: `LASH FIBER`
- Lash copper: `LASH COPPER <= 400pr`, `LASH COPPER > 400pr`
- Overlash fiber: `OVERLASH FIBER`
- Overlash copper: `OVERLASH COPPER <= 400pr`, `OVERLASH COPPER > 400pr`
- Fiber snowshoe: `AERIAL FIBER SNOWSHOE`

#### COPPER CABLE (Material)
- App uses: `COP CABLE ${size} ANMW` ✅ (CORRECT format!)
- Real codes: `COP CABLE 25 ANMW`, `COP CABLE 50 ANMW`, `COP CABLE 100 ANMW`, `COP CABLE 200 ANMW`, `COP CABLE 300 ANMW`, `COP CABLE 400 ANMW`, `COP CABLE 600 ANMW`, `COP CABLE 900 ANMW`, `COP CABLE 1200 ANMW`, `COP CABLE 1500 ANMW`, `COP CABLE 1800 ANMW`
- Special: `COP CABLE 6pr-19g`, `COP CABLE 6pr-22g`, `COP CABLE 6pr-24g`, `COP CABLE 100 BHAP SS` (self-supporting)
- Labor for placing UG copper: `COPPER PL IN CONDUIT <= 300pr`, `COPPER PL IN CONDUIT 400-900pr`, `COPPER PL IN CONDUIT 1200-2400pr`, `COPPER PL IN CONDUIT > 2400pr`

#### FIBER CABLE (Material)
- Real codes: `FIB 12 1JKT 1ARMOR LT`, `FIB 24 1JKT 1ARMOR LT`, `FIB 48 1JKT 1ARMOR LT`, `FIB 72 1JKT 1ARMOR LT`, `FIB 96 1JKT 1ARMOR LT`, `FIB 144 1JKT 1ARMOR LT`, `FIB 216 1JKT 1ARMOR LT`
- App uses: `FIB ${size} 1 JKT 1 ARMR` ❌ (close but wrong — no spaces in 1JKT1ARMOR)
- **Correct format**: `FIB 48 1JKT 1ARMOR LT`
- Self-supporting: `FIB 12 SELF SUPPORT LT`
- Labor: `LASH FIBER`, `OVERLASH FIBER`, `FIBER PL IN CONDUIT`, `FIBER PL IN CONDUIT ADDL`

#### TRENCH
- App uses: `TRENCH - ${surface}` ❌
- Real codes are depth+width based:
  - `TRENCH 30in CVR <= 2.5in` (30in cover, up to 2.5in conduit)
  - `TRENCH 30in CVR 3-6in`
  - `TRENCH 36in CVR <= 2.5in`, `TRENCH 36in CVR 3-6in`
  - `TRENCH 48in CVR <= 2.5in`, `TRENCH 48in CVR 3-6in`
  - STICK variants: `TRENCH 30in CVR STICK <= 2.5in` etc.
  - Also: `OPEN TRENCH <= 2.5in`, `OPEN TRENCH 3-6in` (for open cut)

#### BORE
- App uses: `DIRECTIONAL BORE - ${diameter}in` ❌
- No specific bore labor code in contract — bore is part of OPEN TRENCH or separate quote
- SPECIAL: `SPECIAL QUOTE - BORE - LE`

#### HANDHOLES
- App uses: `VAULT - SET PRECAST ${size}` ❌
- Real codes (just HH size, no "SET PRECAST" prefix):
  - `HH 17x30x24`, `HH 30x48x36`, `HH 30x48x36 SPLIT LID`, `HH 30x60x30`, `HH 36x60x36` etc.
  - Format: `HH [width]x[length]x[depth]`
  - Grounding: `HH 13x24x18 GROUNDING`
  - Grade adj: `HH GRADE ADJUSTMENT`
  - Maintenance: `HH OR MH MAINTENANCE`
  - Removal: `RMV HH`

#### PEDESTAL
- Real codes: `PED 6in STAKE MOUNT`, `PED 8in STAKE MOUNT`, `PED 10in STAKE MOUNT`, `PED 12in STAKE MOUNT`
- Fiber ped: `PED FIB 8in SQ BASE HH MOUNT`, `PED FIB 10in STAKE MOUNT` etc.
- Sizes: SMALL (6-12in), MEDIUM (14-24in), LARGE (36-42in)

#### SPLICE CASES
- Aerial copper: `CASE AER COP [size] [type]` (201 variants)
- Aerial fiber: `CASE AER FIB [size] [tray info]`
- Buried: `CASE BUR COP/FIB ...`
- Underground: `CASE UG COP/FIB ...`
- High-level labor: `CASE COPPER NEW PRESSURE`, `CASE COPPER NEW NON-PRESSURE`, `CASE FIBER NEW`
- Re-enter: `RE-ENTER EXIST COPPER CASE`, `RE-ENTER EXIST FIBER CASE`

#### SPLICING LABOR
- Copper splicing: `SPLICE COPPER MECHANICAL 1-25pr`, `SPLICE COPPER MECHANICAL 26-100pr`, `SPLICE COPPER MECHANICAL > 100pr`
- Copper module: `SPLICE COPPER MODULE <= 300pr`, `SPLICE COPPER MODULE 301-900pr` etc.
- Fiber fusion: `SPLICE FIBER FUSION 1-4`, `SPLICE FIBER FUSION 5-12`, `SPLICE FIBER FUSION 13-24` ... up to 864
- Fiber ribbon: `SPLICE FIBER RIBBONS <=2`, `SPLICE FIBER RIBBONS 3-12` etc.
- Setup: `SPL SETUP-TEARDOWN AERIAL-FIB`, `SPL SETUP-TEARDOWN AERIAL-COP`, `SPL SETUP-TEARDOWN HH-FIB`, etc.

#### CONDUIT
- `CONDUIT 2in SCH40 20ft GRY`, `CONDUIT 3in SCH40 20ft GRY`, `CONDUIT 4in SCH40 20ft GRY` (material)
- Labor: `HDPE PL IN CONDUIT <= 2in`, `FIBER IN CONDUIT ISP`

#### SURFACE RESTORATION
- Asphalt: `ASPHALT RMV & RESTORE <= 6in`, `ASPHALT RMV & RESTORE > 6-12in`, `ASPHALT RMV & RESTORE > 12-18in`
- Concrete: `CONCRETE RMV-RESTORE <= 6in` etc.
- Cold patch: `ASPHALT TEMPORARY COLD PATCH`

#### REMOVALS (key ones)
- `RMV AERIAL COPPER <= 400pr`, `RMV AERIAL COPPER > 400pr`
- `RMV AERIAL FIBER`
- `RMV COPPER FROM CONDUIT <= 400pr`, `RMV COPPER FROM CONDUIT > 400pr`
- `RMV FIBER FROM CONDUIT`
- `RMV POLE - CTL OWNED`, `RMV POLE - FOREIGN`
- `RMV STRAND - BARE`
- `RMV HH`, `RMV MH`, `RMV PEDESTAL`
- `RMV BURIED FACILITY <= 48in`

---

## BILLING RULES (inferred from descriptions)

1. **Most labor units are PER FOOT** (cable, strand, trench, bore, conduit placement)
2. **Point items are PER EACH** (poles, handholes, splice cases, pedestals, anchors)
3. **Splicing is PER COUNT** (number of pairs or fiber count determines which tier)
4. **Many jobs have BOTH a labor unit AND a material unit** — e.g.:
   - Pole job = `POLE WOOD <= 40ft` (labor EA) + `POLE 35-5 DF` (material EA)
   - Strand job = `STRAND 10M` (labor FT)
   - Copper cable job = `COP CABLE 200 ANMW` (material FT) + `LASH COPPER <= 400pr` (labor FT)
5. **Removal jobs are labor only** (no material)
6. **"EXISTING" items = $0 billing**, reference only
7. **Trench depth and conduit size determine the correct trench code** — not surface type
8. **Splice setup codes are charged separately** from the splice labor itself

---

## RECOMMENDED UNIT CODE CORRECTIONS FOR APP

### Fiber cable material:
- OLD: `FIB 48 1 JKT 1 ARMR` → NEW: `FIB 48 1JKT 1ARMOR LT`

### Pole material:
- OLD: `POLE 35-5 DF` ✅ (already correct)

### Trench:
- OLD: `TRENCH - Asphalt` → NEW: `TRENCH 30in CVR <= 2.5in` (based on depth + conduit size)

### Bore:
- OLD: `DIRECTIONAL BORE - 2in` → NEW: `SPECIAL QUOTE - BORE - LE` (or use open trench codes)

### HH:
- OLD: `VAULT - SET PRECAST 1730` → NEW: `HH 17x30x24` (actual dimensions)

### Removal copper:
- OLD: `RMV AERIAL COPPER` → NEW: `RMV AERIAL COPPER <= 400pr` or `> 400pr`

### Lash/Overlash:
- OLD: `LASH COPPER` → NEW: `LASH COPPER <= 400pr` or `LASH COPPER > 400pr`
