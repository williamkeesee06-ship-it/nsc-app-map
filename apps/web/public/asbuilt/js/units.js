/**
 * units.js — NSC Smart Unit Dictionary
 * North Sky Communications As-Built Tool
 * Full rebuild per spec + 7 upgrades.
 */

// ============================================================
// THEME / COLOR CONSTANTS
// ============================================================
export const ASBUILT_THEME = {
  NEW:      '#FF0000',   // red
  EXISTING: '#000000',   // black
  REMOVE:   '#00AA00',   // green
  XFER:     '#0000FF',   // blue
  DE_RELASH:'#A020F0',   // purple
  TRENCH:   '#8B4513',   // brown
  BORE:     '#8B4513',   // brown
};

// ============================================================
// SMART UNIT DICTIONARY
// ============================================================
export const SMART_UNIT_DICTIONARY = {

  // ──────────────────────────────────────────────────────────
  // TAB: aerial
  // ──────────────────────────────────────────────────────────
  aerial: {
    label: 'Aerial',
    symbols: [
      { key: 'POLE',       icon: '⊗',  label: 'Pole',       type: 'POINT', shape: 'POLE_X' },
      { key: 'STRAND_10M', icon: '---', label: 'Strand 10M', type: 'LINE'  },
      { key: 'DE_RE',      icon: '~',   label: 'De/Relash',  type: 'LINE'  },
      { key: 'RE_TENSION', icon: '➔',  label: 'Re-Tension', type: 'ARROW' },
      { key: 'DOWN_GUY',   icon: '↘',  label: 'Down Guy',   type: 'ARROW' },
      { key: 'ANCHOR',     icon: '◆',  label: 'Anchor',     type: 'POINT', shape: 'DIAMOND_FILL' },
    ],
    logic: {
      POLE: {
        attributes: [
          { key: 'Status',  label: 'Status',          type: 'toggle-group', options: ['NEW', 'EXISTING', 'REMOVE'], _default: 'EXISTING' },
          { key: 'ATAG',    label: 'A-Tag #',          type: 'text',         placeholder: 'e.g. 12345' },
          { key: 'Height',  label: 'Pole Height (ft)', type: 'select',       options: ['30', '35', '40', '45', '50'], showWhen: { key: 'Status', values: ['NEW'] } },
          { key: 'Class',   label: 'Pole Class',       type: 'select',       options: ['2', '3', '4', '5', '6'],    showWhen: { key: 'Status', values: ['NEW'] } },
          { key: 'HandSet', label: 'Hand Set',         type: 'checkbox',     defaultChecked: false,                  showWhen: { key: 'Status', values: ['NEW'] } },
          { key: 'GPS',     label: 'GPS Coordinates',  type: 'text',         placeholder: 'e.g. 47.12345, -122.12345', showWhen: { key: 'Status', values: ['NEW'] } },
          { key: 'Owner',   label: 'Owner',            type: 'select',       options: ['CTL Owned', 'Foreign'],      showWhen: { key: 'Status', values: ['REMOVE'] } },
        ],
        mapping: (input) => {
          const status = input.Status || 'EXISTING';
          const height = parseInt(input.Height) || 35;
          const cls    = input.Class  || '5';
          // Always prefix A-tag with "A" if not already
          const rawTag = (input.ATAG || '').toString().trim();
          const atag   = rawTag ? (rawTag.toUpperCase().startsWith('A') ? rawTag : `A-${rawTag}`) : '';

          if (status === 'EXISTING') {
            // Existing: show A-tag only, no height or class
            return { color: '#000000', label: atag || 'EXIST', units: [] };
          }

          if (status === 'NEW') {
            const handSet = input.HandSet === true || input.HandSet === 'true';
            const gps     = (input.GPS || '').trim();
            let laborCode;
            if (handSet) {
              laborCode = 'POLE WOOD <= 40ft HAND SET';
            } else {
              laborCode = height <= 40 ? 'POLE WOOD <= 40ft' : 'POLE WOOD > 40-55ft';
            }
            const materialCode = `POLE ${height}-${cls} DF`;
            const units = [
              { code: laborCode,    type: 'LABOR',    qty: 1, unit: 'EA' },
              { code: materialCode, type: 'MATERIAL', qty: 1, unit: 'EA' },
            ];
            if (gps) {
              units.push({ code: 'GPS COORDINATES', type: 'LABOR', qty: 1, unit: 'EA' });
            }
            return {
              color: '#FF0000',
              label: atag ? `${atag} ${height}'` : `${height}'`,
              units,
            };
          }

          if (status === 'REMOVE') {
            const owner  = input.Owner || 'CTL Owned';
            const rmvCode = owner === 'Foreign'
              ? 'RMV POLE - FOREIGN'
              : 'RMV POLE - CTL OWNED';
            return {
              color: '#00AA00',
              label: atag || 'RMV',
              units: [
                { code: rmvCode,                     type: 'LABOR',    qty: 1,   unit: 'EA' },
                { code: 'SELECT BACKFILL 3/4in MINUS ABC', type: 'MATERIAL', qty: 0.5, unit: 'CY' },
              ],
            };
          }

          return { color: '#000000', units: [] };
        },
      },

      STRAND_10M: {
        attributes: [
          { key: 'Status',  label: 'Status',  type: 'toggle-group', options: ['NEW', 'REMOVE'] },
          { key: 'Footage', label: 'Footage', type: 'number', placeholder: 'ft' },
        ],
        mapping: (input) => {
          const status  = input.Status  || 'NEW';
          const footage = parseFloat(input.Footage) || 0;

          if (status === 'REMOVE') {
            return {
              color: '#00AA00',
              removeXMarks: true,
              units: [{ code: 'RMV STRAND - BARE', type: 'LABOR', qty: footage, unit: 'FT' }],
            };
          }
          // NEW — always black per spec
          return {
            color: '#000000',
            dashArray: [12, 6],
            units: [{ code: 'STRAND 10M', type: 'LABOR', qty: footage, unit: 'FT' }],
          };
        },
      },

      DE_RE: {
        attributes: [
          { key: 'Footage', label: 'Footage', type: 'number', placeholder: 'ft' },
        ],
        mapping: (input) => {
          const footage = parseFloat(input.Footage) || 0;
          return {
            color: '#A020F0',
            units: [{ code: 'AERIAL DELASH - RELASH', type: 'LABOR', qty: footage, unit: 'FT' }],
          };
        },
      },

      RE_TENSION: {
        attributes: [
          { key: 'Qty', label: 'Qty', type: 'number', placeholder: '1' },
        ],
        mapping: (input) => {
          const qty = parseFloat(input.Qty) || 1;
          return {
            color: '#FF0000',
            units: [{ code: 'AERIAL SPAN RE-TENSION', type: 'LABOR', qty, unit: 'EA' }],
          };
        },
      },

      DOWN_GUY: {
        attributes: [
          { key: 'Status', label: 'Status', type: 'toggle-group', options: ['NEW', 'REMOVE'] },
          { key: 'Size',   label: 'Size',   type: 'select', options: ['10M', '16M'] },
          { key: 'Qty',    label: 'Qty',    type: 'number', placeholder: '1' },
        ],
        mapping: (input) => {
          const status = input.Status || 'NEW';
          const size   = input.Size   || '10M';
          const qty    = parseFloat(input.Qty) || 1;

          if (status === 'REMOVE') {
            return {
              color: '#00AA00',
              units: [{ code: 'RMV POLE ANCHOR ROD', type: 'LABOR', qty, unit: 'EA' }],
            };
          }
          return {
            color: '#FF0000',
            units: [
              { code: 'DOWN GUY',             type: 'LABOR',    qty, unit: 'EA' },
              { code: `DOWN GUY ${size}`,      type: 'MATERIAL', qty, unit: 'EA' },
              { code: 'DOWN GUY GUARD',        type: 'MATERIAL', qty, unit: 'EA' },
            ],
          };
        },
      },

      ANCHOR: {
        attributes: [
          { key: 'Status', label: 'Status', type: 'toggle-group', options: ['NEW', 'REMOVE'] },
          { key: 'Type',   label: 'Type',   type: 'select', options: ['Screw', 'Bust/Expansion'] },
          { key: 'Size',   label: 'Size',   type: 'select', options: ['10M', '16M'] },
        ],
        mapping: (input) => {
          const status = input.Status || 'NEW';
          const type   = input.Type   || 'Screw';
          const size   = input.Size   || '10M';

          if (status === 'REMOVE') {
            return {
              color: '#00AA00',
              units: [{ code: 'RMV POLE ANCHOR ROD', type: 'LABOR', qty: 1, unit: 'EA' }],
            };
          }
          const matCode = type === 'Screw'
            ? `ANCHOR SCREW ${size}`
            : `ANCHOR EXPANSION / BUST ${size}`;
          return {
            color: '#FF0000',
            units: [{ code: matCode, type: 'MATERIAL', qty: 1, unit: 'EA' }],
          };
        },
      },
    },
  },

  // ──────────────────────────────────────────────────────────
  // TAB: underground
  // ──────────────────────────────────────────────────────────
  underground: {
    label: 'Underground',
    symbols: [
      { key: 'HH',          icon: 'HH',  label: 'Handhole',      type: 'POINT', shape: 'HH_RECT' },
      { key: 'MH',          icon: 'MH',  label: 'Manhole',       type: 'POINT', shape: 'MH_CIRCLE' },
      { key: 'PEDESTAL',    icon: 'PED', label: 'Pedestal',      type: 'POINT', shape: 'PED_SQUARE_X' },
      { key: 'TRENCH',      icon: '━━━', label: 'Trench',        type: 'LINE'  },
      { key: 'BORE',        icon: '╌╌╌', label: 'Bore',          type: 'LINE'  },
      { key: 'SPLICE_PIT',  icon: '▦',  label: 'Splice Pit',    type: 'POINT', shape: 'SPLICE_PIT' },
      { key: 'MH_GRADE_ADJ',icon: '↗',  label: 'MH Grade Adj',  type: 'POINT', shape: 'CALLOUT_ARROW' },
      { key: 'POTHOLE',      icon: 'Ⓟ',  label: 'Potholing',     type: 'POINT', shape: 'POTHOLE_CIRCLE' },
    ],
    logic: {
      HH: {
        attributes: [
          { key: 'Status',      label: 'Status', type: 'toggle-group', options: ['NEW', 'EXISTING', 'REMOVE'] },
          { key: 'Size',        label: 'Size',   type: 'select', options: ['17x30x24', '30x48x36', '24x36x24', '48x48x48'] },
          { key: 'StructLabel', label: 'HH Label (optional)', type: 'text', placeholder: 'e.g. HH-7' },
        ],
        mapping: (input) => {
          const status = input.Status || 'EXISTING';
          const size   = input.Size   || '17x30x24';

          if (status === 'EXISTING') {
            return { color: '#000000', label: 'HH', units: [] };
          }
          if (status === 'NEW') {
            return {
              color: '#FF0000',
              label: 'HH',
              units: [{ code: `HH ${size}`, type: 'LABOR', qty: 1, unit: 'EA' }],
            };
          }
          // REMOVE
          return {
            color: '#00AA00',
            label: 'RMV HH',
            units: [{ code: 'RMV HH', type: 'LABOR', qty: 1, unit: 'EA' }],
          };
        },
      },

      MH: {
        attributes: [
          { key: 'Status',      label: 'Status', type: 'toggle-group', options: ['NEW', 'EXISTING', 'REMOVE'] },
          { key: 'Size',        label: 'Size',   type: 'select', options: ['48x72x84', '72x72x72', '72x144x84'] },
          { key: 'CrewEntered', label: 'Crew entered MH', type: 'checkbox', defaultChecked: false },
          { key: 'Dewatering',  label: 'Dewatering required', type: 'checkbox', defaultChecked: false },
          { key: 'StructLabel', label: 'MH Label (optional)', type: 'text', placeholder: 'e.g. MH-35' },
        ],
        mapping: (input) => {
          const status      = input.Status      || 'EXISTING';
          const size        = input.Size        || '48x72x84';
          const crewEntered = input.CrewEntered === true || input.CrewEntered === 'true' || input.CrewEntered === '1';
          const dewatering  = input.Dewatering  === true || input.Dewatering  === 'true' || input.Dewatering  === '1';

          const extras = [];
          if (crewEntered) extras.push({ code: 'VAULT - TEST PURGE & VENTILATE', type: 'LABOR', qty: 1, unit: 'EA' });
          if (dewatering)  extras.push({ code: 'DEWATERING BASIC',               type: 'LABOR', qty: 1, unit: 'EA' });

          if (status === 'EXISTING') {
            return { color: '#000000', label: 'MH', units: extras };
          }
          if (status === 'NEW') {
            return {
              color: '#FF0000',
              label: `MH ${size}`,
              units: [
                { code: `MH ${size}in`, type: 'LABOR', qty: 1, unit: 'EA' },
                ...extras,
              ],
            };
          }
          // REMOVE
          return {
            color: '#00AA00',
            label: 'RMV MH',
            units: [{ code: 'RMV MH', type: 'LABOR', qty: 1, unit: 'EA' }],
          };
        },
      },

      PEDESTAL: {
        attributes: [
          { key: 'Status',      label: 'Status', type: 'toggle-group', options: ['NEW', 'EXISTING', 'REMOVE'] },
          { key: 'Type',        label: 'Type',   type: 'select', options: ['Copper', 'Fiber'] },
          { key: 'Size',        label: 'Size',   type: 'select', options: ['6in', '8in', '10in', '12in', '14in'] },
          { key: 'Mount',       label: 'Mount',  type: 'select', options: ['Stake Mount', 'Integral Stake', 'Pole Mount'] },
          { key: 'StructLabel', label: 'Ped Label (optional)', type: 'text', placeholder: 'e.g. BD5' },
        ],
        mapping: (input) => {
          const status = input.Status || 'EXISTING';
          const type   = input.Type   || 'Copper';
          const size   = input.Size   || '10in';
          const mount  = (input.Mount || 'Stake Mount').toUpperCase();

          if (status === 'EXISTING') {
            return { color: '#000000', label: 'PED', units: [] };
          }
          if (status === 'NEW') {
            const code = type === 'Fiber'
              ? `PED FIB ${size} ${mount}`
              : `PED ${size} ${mount}`;
            return {
              color: '#FF0000',
              label: code,
              units: [{ code, type: 'LABOR', qty: 1, unit: 'EA' }],
            };
          }
          return {
            color: '#00AA00',
            label: 'RMV PEDESTAL',
            units: [{ code: 'RMV PEDESTAL', type: 'LABOR', qty: 1, unit: 'EA' }],
          };
        },
      },

      // TRENCH — Change 6: updated modal fields
      TRENCH: {
        attributes: [
          { key: 'Status',     label: 'Status',          type: 'toggle-group', options: ['NEW', 'EXISTING', 'REMOVE'] },
          { key: 'Length',     label: "Length (ft)",     type: 'text', placeholder: "e.g. 35'" },
          { key: 'Width',      label: "Width (ft)",      type: 'text', placeholder: "e.g. 2'" },
          { key: 'Depth',      label: "Depth (ft)",      type: 'text', placeholder: "e.g. 3'" },
          { key: 'Backfill',   label: 'Backfill (yds)',  type: 'text', placeholder: 'optional' },
          { key: 'Spoils',     label: 'Spoils (yds)',    type: 'text', placeholder: 'optional' },
          { key: 'ColdMix',    label: 'Cold Mix (yds)',  type: 'text', placeholder: 'optional' },
          { key: 'MatNotes',   label: 'Other Materials', type: 'text', placeholder: 'optional' },
          { key: 'CoverDepth',  label: 'Cover Depth',    type: 'select',   options: ['30in', '36in', '48in'] },
          { key: 'HasConduit',  label: 'Conduit placed?', type: 'checkbox', defaultChecked: false },
          { key: 'ConduitSize', label: 'Conduit Size',   type: 'select',   options: ['1in', '2in', '2.5in', '3in', '4in'] },
          { key: 'ConduitSched',label: 'Conduit Schedule', type: 'select', options: ['SCH40', 'SCH80', 'Type-C', 'HDPE'] },
          { key: 'ConduitFt',   label: 'Conduit Footage', type: 'number',  placeholder: 'ft' },
          { key: 'NumConduits', label: 'Number of Conduits', type: 'number', placeholder: '1' },
          { key: 'Sweeps90',    label: 'Sweeps 90°',     type: 'number',   placeholder: '0' },
          { key: 'Sweeps45',    label: 'Sweeps 45°',     type: 'number',   placeholder: '0' },
          { key: 'Sweeps22',    label: 'Sweeps 22.5°',   type: 'number',   placeholder: '0' },
        ],
        mapping: (input) => {
          const lengthFt   = parseFloat(input.Length)    || 0;
          const depth      = input.CoverDepth            || '30in';
          const hasConduit = input.HasConduit === true || input.HasConduit === 'true' || input.HasConduit === '1';
          const condSz     = input.ConduitSize           || '2in';
          const condSched  = input.ConduitSched          || 'SCH40';
          const condFt     = parseFloat(input.ConduitFt) || 0;
          const numCond    = parseInt(input.NumConduits) || 1;
          const sw90       = parseInt(input.Sweeps90)    || 0;
          const sw45       = parseInt(input.Sweeps45)    || 0;
          const sw22       = parseInt(input.Sweeps22)    || 0;

          // Conduit size bracket
          const bracket = ['1in','2in','2.5in'].includes(condSz) ? '<= 2.5in' : '3-6in';

          const units = [];

          if (!hasConduit) {
            units.push({ code: `TRENCH ${depth} CVR <= 2.5in`, type: 'LABOR', qty: lengthFt, unit: 'FT' });
          } else {
            // First conduit run
            units.push({ code: `TRENCH ${depth} CVR STICK ${bracket}`, type: 'LABOR', qty: lengthFt, unit: 'FT' });
            // Additional conduits
            if (numCond > 1) {
              units.push({ code: `TRENCH ${depth} CVR STICK ${bracket} ADDL`, type: 'LABOR', qty: lengthFt * (numCond - 1), unit: 'FT' });
            }
            // Conduit material: sold in 20ft sticks
            const sticks = Math.ceil(condFt / 20);
            units.push({ code: `CONDUIT ${condSz} ${condSched} 20ft GRY`, type: 'MATERIAL', qty: sticks, unit: 'EA' });
            // Sweeps
            if (sw90 > 0) units.push({ code: `SWEEP ${condSz} 90x36 PLASTIC BELL`,        type: 'MATERIAL', qty: sw90, unit: 'EA' });
            if (sw45 > 0) units.push({ code: `SWEEP ${condSz} 45x36 PLASTIC BELL`,        type: 'MATERIAL', qty: sw45, unit: 'EA' });
            if (sw22 > 0) units.push({ code: `SWEEP ${condSz} 22.5x60 C PLASTIC BELL`,    type: 'MATERIAL', qty: sw22, unit: 'EA' });
          }

          return {
            color: '#8B4513',
            label: `TRENCH ${lengthFt}ft`,
            trenchDetail: {
              Length:   input.Length   || '',
              Width:    input.Width    || '',
              Depth:    input.Depth    || '',
              Backfill: input.Backfill || '',
              Spoils:   input.Spoils   || '',
              ColdMix:  input.ColdMix  || '',
              MatNotes: input.MatNotes || '',
            },
            units,
          };
        },
      },

      BORE: {
        attributes: [
          { key: 'Footage',  label: 'Footage',  type: 'number', placeholder: 'ft' },
          { key: 'Diameter', label: 'Diameter', type: 'select', options: ['1.25in', '2in', '4in'] },
        ],
        mapping: (input) => {
          const footage  = parseFloat(input.Footage)  || 0;
          const diameter = input.Diameter || '2in';
          return {
            color: '#8B4513',
            dashArray: [4, 4],
            label: `BORE ${footage}ft`,
            units: [{ code: 'SPECIAL QUOTE - BORE - LE', type: 'LABOR', qty: footage, unit: 'FT' }],
          };
        },
      },

      POTHOLE: {
        attributes: [
          { key: 'SurfaceType',    label: 'Surface Type',     type: 'toggle-group', options: ['Hard Surface', 'Soft Surface'] },
          { key: 'SelectBackfill', label: 'Select Backfill',  type: 'checkbox', defaultChecked: false },
          { key: 'BackfillQty',    label: 'Backfill Qty (EA)', type: 'number', placeholder: 'qty',
            showWhen: { key: 'SelectBackfill', values: [true] } },
          { key: 'ColdMix',        label: 'Cold Mix Patch',   type: 'checkbox', defaultChecked: false,
            showWhen: { key: 'SurfaceType', values: ['Hard Surface'] } },
          { key: 'ColdMixSqft',    label: 'Cold Mix Sq Ft',   type: 'number', placeholder: 'sqft',
            showWhen: { key: 'ColdMix', values: [true] } },
        ],
        mapping: (input) => {
          const surface     = input.SurfaceType || 'Hard Surface';
          const hasBackfill = input.SelectBackfill === true || input.SelectBackfill === 'true';
          const backfillQty = parseFloat(input.BackfillQty) || 1;
          const hasColdMix  = (input.ColdMix === true || input.ColdMix === 'true') && surface === 'Hard Surface';
          const coldMixSqft = parseFloat(input.ColdMixSqft) || 0;

          const units = [];
          if (surface === 'Hard Surface') {
            units.push({ code: 'POTHOLE HARD SURFACE', type: 'LABOR', qty: 1, unit: 'EA' });
          } else {
            units.push({ code: 'POTHOLE SOFT SURFACE', type: 'LABOR', qty: 1, unit: 'EA' });
          }
          if (hasBackfill) {
            units.push({ code: 'SELECT BACKFILL', type: 'MATERIAL', qty: backfillQty, unit: 'EA' });
          }
          if (hasColdMix && coldMixSqft > 0) {
            units.push({ code: 'ASPHALT TEMPORARY COLD PATCH', type: 'MATERIAL', qty: coldMixSqft, unit: 'SQFT' });
          }
          return {
            color: '#8B4513',
            label: `PTH`,
            units,
          };
        },
      },

      SPLICE_PIT: {
        attributes: [
          { key: 'Size', label: 'Size', type: 'select', options: ['Small', 'Medium', 'Large'] },
        ],
        mapping: (input) => {
          const size = input.Size || 'Small';
          const codes = {
            Small:  'PIT SMALL 6x4x5ft',
            Medium: 'PIT MEDIUM 12x6x5ft',
            Large:  'PIT LARGE 12x12x6ft',
          };
          const code = codes[size] || 'PIT SMALL 6x4x5ft';
          return {
            color: '#FF0000',
            label: code,
            units: [{ code, type: 'LABOR', qty: 1, unit: 'EA' }],
          };
        },
      },

      MH_GRADE_ADJ: {
        attributes: [
          { key: 'Qty', label: 'Qty', type: 'number', placeholder: '1' },
        ],
        mapping: (input) => {
          const qty = parseFloat(input.Qty) || 1;
          return {
            color: '#FF0000',
            calloutText: `MH GRADE ADJUSTMENT x${qty}`,
            units: [{ code: 'HH GRADE ADJUSTMENT', type: 'LABOR', qty, unit: 'EA' }],
          };
        },
      },

      GRUBBING: {
        attributes: [
          { key: 'LF', label: 'Linear Footage (LF)', type: 'number', placeholder: '0' },
        ],
        mapping: (input) => {
          const lf = parseFloat(input.LF) || 0;
          return {
            color: '#008000',
            label: `${lf} LF`,
            units: [{ code: 'GRUBBING', type: 'LABOR', qty: lf, unit: 'LF' }],
          };
        },
      },

      ROD_PROOF: {
        attributes: [
          { key: 'Footage', label: 'Footage (LF)', type: 'number', placeholder: '0' },
          { key: 'ISP',     label: 'ISP (Inside Plant)', type: 'checkbox', defaultChecked: false },
        ],
        mapping: (input) => {
          const footage = parseFloat(input.Footage) || 0;
          const isISP   = input.ISP === true || input.ISP === 'true';
          const code    = isISP ? 'ROD & PROOF EXISTING CONDUIT ISP' : 'ROD & PROOF EXISTING CONDUIT UG';
          return {
            color: '#0000CC',
            label: 'R&P',
            units: [{ code, type: 'LABOR', qty: footage, unit: 'LF' }],
          };
        },
      },

      LOC_SONDE: {
        attributes: [
          { key: 'Footage', label: 'Footage (LF)', type: 'number', placeholder: '0' },
        ],
        mapping: (input) => {
          const footage = parseFloat(input.Footage) || 0;
          return {
            color: '#0000CC',
            label: 'LOC',
            units: [{ code: 'LOCATE CONDUIT USING A SONDE', type: 'LABOR', qty: footage, unit: 'LF' }],
          };
        },
      },
    },
  },

  // ──────────────────────────────────────────────────────────
  // TAB: cable
  // ──────────────────────────────────────────────────────────
  cable: {
    label: 'Cable',
    symbols: [
      { key: 'COPPER_CABLE', icon: '-C-',   label: 'Copper Cable',   type: 'LINE' },
      { key: 'FIBER_CABLE',  icon: '-F-',   label: 'Fiber Cable',    type: 'LINE' },
      { key: 'ASW',          icon: '-ASW-', label: 'ASW',            type: 'LINE' },
      { key: 'BSW',          icon: '-BSW-', label: 'BSW',            type: 'LINE' },
      { key: 'RMV_FIBER',   icon: 'X-F-X', label: 'Rmv Fiber',      type: 'LINE' },
      { key: 'RMV_COPPER',  icon: 'X-C-X', label: 'Rmv Copper',     type: 'LINE' },
      { key: 'RMV_ASW',     icon: 'X-A-X', label: 'Rmv ASW',        type: 'LINE' },
      { key: 'RMV_BSW',     icon: 'X-B-X', label: 'Rmv BSW',        type: 'LINE' },
    ],
    logic: {
      COPPER_CABLE: {
        attributes: [
          { key: 'Method',          label: 'Method',              type: 'toggle-group', options: ['Aerial', 'Underground'] },
          { key: 'Condition',       label: 'Condition',           type: 'toggle-group', options: ['New', 'Existing', 'Remove'] },
          { key: 'Size',            label: 'Size (pairs)',         type: 'select',       options: ['6','25','50','100','200','300','400','600','900','1200'], showWhen: { key: 'Condition', values: ['New','Remove'] } },
          { key: 'Footage',         label: 'Footage (ft)',         type: 'number',       placeholder: 'ft', showWhen: { key: 'Condition', values: ['New','Remove'] } },
          { key: 'LaborMethod',     label: 'Labor Method',        type: 'select',       options: ['LASH', 'OVERLASH'], showWhen: { key: 'Condition', values: ['New'] } },
          { key: 'OccupiedConduit', label: 'Occupied Conduit',    type: 'checkbox',     defaultChecked: false, showWhen: { key: 'Condition', values: ['New'] } },
          { key: 'ReelNum',         label: 'Reel #',              type: 'text',         placeholder: '730-XXXX-XXX' },
          { key: 'WallSeq',         label: 'Wall (start)',         type: 'text',         placeholder: 'e.g. 5024' },
          { key: 'TailSeq',         label: 'Tail (end)',           type: 'text',         placeholder: 'e.g. 5390' },
          { key: 'PoleSeqs',        label: 'Sequentials (one per line)', type: 'textarea', placeholder: 'A-001 = 5024\nA-002 = 5150\n...' },
          { key: 'FootageLabel',    label: 'Mid-Line Label (optional)', type: 'text',   placeholder: "e.g. 24C — 266'" },
        ],
        mapping: (input) => {
          const method   = input.Method        || 'Aerial';
          const cond     = input.Condition     || 'Existing';
          const size     = parseInt(input.Size) || 100;
          const lMethod  = input.LaborMethod   || 'LASH';
          const footage  = parseFloat(input.Footage)   || 0;
          const occupied = input.OccupiedConduit === true || input.OccupiedConduit === 'true';
          const occFt    = occupied ? footage : 0;
          const isUG     = method === 'Underground';

          if (cond === 'Existing') return { color: '#000000', units: [] };

          if (cond === 'Remove') {
            let rmvCode;
            if (isUG) {
              rmvCode = size <= 400 ? 'RMV UG COPPER <= 400pr' : 'RMV UG COPPER > 400pr';
            } else {
              rmvCode = size <= 400 ? 'RMV AERIAL COPPER <= 400pr' : 'RMV AERIAL COPPER > 400pr';
            }
            return { color: '#00AA00', removeXMarks: true, units: [{ code: rmvCode, type: 'LABOR', qty: footage, unit: 'FT' }] };
          }

          // New
          const matCode = `COP CABLE ${size} ANMW`;
          let laborCode;
          if (isUG) {
            laborCode = size <= 400 ? 'COPPER CABLE IN CONDUIT <= 400pr' : 'COPPER CABLE IN CONDUIT > 400pr';
          } else if (lMethod === 'OVERLASH') {
            laborCode = size <= 400 ? 'OVERLASH COPPER <= 400pr' : 'OVERLASH COPPER > 400pr';
          } else {
            laborCode = size <= 400 ? 'LASH COPPER <= 400pr' : 'LASH COPPER > 400pr';
          }
          const units = [
            { code: matCode,   type: 'MATERIAL', qty: footage, unit: 'FT' },
            { code: laborCode, type: 'LABOR',    qty: footage, unit: 'FT' },
          ];
          if (occupied && occFt > 0) {
            units.push({ code: 'OCCUPIED CONDUIT ADDER', type: 'LABOR', qty: occFt, unit: 'FT' });
          }
          return { color: '#FF0000', units };
        },
      },

      FIBER_CABLE: {
        attributes: [
          { key: 'Method',          label: 'Method',              type: 'toggle-group', options: ['Aerial', 'Underground'] },
          { key: 'Condition',       label: 'Condition',           type: 'toggle-group', options: ['New', 'Existing', 'Remove'] },
          { key: 'Size',            label: 'Size (fiber count)',   type: 'select',       options: ['12','24','48','72','96','144','216','288','432','864'], showWhen: { key: 'Condition', values: ['New','Remove'] } },
          { key: 'Footage',         label: 'Footage (ft)',         type: 'number',       placeholder: 'ft', showWhen: { key: 'Condition', values: ['New','Remove'] } },
          { key: 'LaborMethod',     label: 'Labor Method',        type: 'select',       options: ['LASH', 'OVERLASH', 'ADSS'], showWhen: { key: 'Method', values: ['Aerial'], } },
          { key: 'OccupiedConduit', label: 'Occupied Conduit',    type: 'checkbox',     defaultChecked: false, showWhen: { key: 'Condition', values: ['New'] } },
          { key: 'ReelNum',         label: 'Reel #',              type: 'text',         placeholder: '730-XXXX-XXX' },
          { key: 'WallSeq',         label: 'Wall (start)',         type: 'text',         placeholder: 'e.g. 5024' },
          { key: 'TailSeq',         label: 'Tail (end)',           type: 'text',         placeholder: 'e.g. 5390' },
          { key: 'PoleSeqs',        label: 'Sequentials (one per line)', type: 'textarea', placeholder: 'A-001 = 5024\nA-002 = 5150\n...' },
          { key: 'FootageLabel',    label: 'Mid-Line Label (optional)', type: 'text',   placeholder: "e.g. 48F — 350'" },
        ],
        mapping: (input) => {
          const method  = input.Method    || 'Aerial';
          const cond    = input.Condition || 'Existing';
          const size    = input.Size      || '48';
          const lMethod = input.LaborMethod || 'LASH';
          const footage = parseFloat(input.Footage) || 0;
          const occupied = input.OccupiedConduit === true || input.OccupiedConduit === 'true';
          const occFt   = occupied ? footage : 0;
          const isUG    = method === 'Underground';

          if (cond === 'Existing') return { color: '#000000', units: [] };

          if (cond === 'Remove') {
            const rmvCode = isUG ? 'RMV FIBER FROM CONDUIT' : 'RMV AERIAL FIBER';
            return { color: '#00AA00', removeXMarks: true, units: [{ code: rmvCode, type: 'LABOR', qty: footage, unit: 'FT' }] };
          }

          // New
          const matCode = `FIB ${size} 1JKT 1ARMOR LT`;
          let laborCode;
          if (isUG) {
            laborCode = 'FIBER PL IN CONDUIT';
          } else if (lMethod === 'OVERLASH') {
            laborCode = 'OVERLASH FIBER';
          } else if (lMethod === 'ADSS') {
            laborCode = 'LASH FIBER'; // ADSS billed same as lash per contract
          } else {
            laborCode = 'LASH FIBER';
          }
          const units = [
            { code: matCode,   type: 'MATERIAL', qty: footage, unit: 'FT' },
            { code: laborCode, type: 'LABOR',    qty: footage, unit: 'FT' },
          ];
          if (occupied && occFt > 0) {
            units.push({ code: 'OCCUPIED CONDUIT ADDER', type: 'LABOR', qty: occFt, unit: 'FT' });
          }
          return { color: '#FF0000', units };
        },
      },

      // ── ASW — Aerial Service Wire ──
      ASW: {
        attributes: [
          { key: 'Condition',    label: 'Condition',        type: 'toggle-group', options: ['New', 'Existing'] },
          { key: 'Size',         label: 'Wire Size',        type: 'select', options: ['2pr-22g SJSS','3pr-22g SHD SS','6pr-22g RND SJSS','6pr-22g SHD SS'], showWhen: { key: 'Condition', values: ['New'] } },
          { key: 'Footage',      label: 'Footage (ft)',     type: 'number', placeholder: 'ft', showWhen: { key: 'Condition', values: ['New'] } },
          { key: 'ReelNum',      label: 'Reel #',           type: 'text',   placeholder: '730-XXXX-XXX' },
          { key: 'WallSeq',      label: 'Wall (start)',      type: 'text',   placeholder: 'e.g. 5024' },
          { key: 'TailSeq',      label: 'Tail (end)',        type: 'text',   placeholder: 'e.g. 5390' },
          { key: 'FootageLabel', label: 'Mid-Line Label (optional)', type: 'text', placeholder: "e.g. ASW — 125'" },
        ],
        mapping: (input) => {
          const cond    = input.Condition || 'Existing';
          const size    = input.Size      || '2pr-22g SJSS';
          const footage = parseFloat(input.Footage) || 0;
          if (cond === 'Existing') return { color: '#000000', units: [] };
          return {
            color: '#FF0000',
            units: [
              { code: `SVC DROP AER COP ${size}`, type: 'MATERIAL', qty: footage, unit: 'FT' },
              { code: 'AERIAL SVC DROP',           type: 'LABOR',    qty: footage, unit: 'FT' },
            ],
          };
        },
      },

      // ── BSW — Buried Service Wire ──
      BSW: {
        attributes: [
          { key: 'Condition',    label: 'Condition',        type: 'toggle-group', options: ['New', 'Existing'] },
          { key: 'Placement',    label: 'Placement',        type: 'toggle-group', options: ['Direct Buried', 'In Conduit'], showWhen: { key: 'Condition', values: ['New'] } },
          { key: 'Size',         label: 'Wire Size',        type: 'select', options: ['2pr-22g SJSS','3pr-22g SHD SS','6pr-22g RND SJSS','6pr-22g SHD SS'], showWhen: { key: 'Condition', values: ['New'] } },
          { key: 'Footage',      label: 'Footage (ft)',     type: 'number', placeholder: 'ft', showWhen: { key: 'Condition', values: ['New'] } },
          { key: 'ReelNum',      label: 'Reel #',           type: 'text',   placeholder: '730-XXXX-XXX' },
          { key: 'WallSeq',      label: 'Wall (start)',      type: 'text',   placeholder: 'e.g. 5024' },
          { key: 'TailSeq',      label: 'Tail (end)',        type: 'text',   placeholder: 'e.g. 5390' },
          { key: 'FootageLabel', label: 'Mid-Line Label (optional)', type: 'text', placeholder: "e.g. BSW — 80'" },
        ],
        mapping: (input) => {
          const cond      = input.Condition || 'Existing';
          const placement = input.Placement || 'Direct Buried';
          const size      = input.Size      || '2pr-22g SJSS';
          const footage   = parseFloat(input.Footage)    || 0;
          const inConduit = placement === 'In Conduit';
          const occFt     = inConduit ? footage : 0;
          if (cond === 'Existing') return { color: '#000000', units: [] };
          const units = [
            { code: `SVC DROP AER COP ${size}`, type: 'MATERIAL', qty: footage, unit: 'FT' },
            { code: 'GROUND LAY SVC DROP',      type: 'LABOR',    qty: footage, unit: 'FT' },
          ];
          if (inConduit && occFt > 0) {
            units.push({ code: 'OCCUPIED CONDUIT ADDER', type: 'LABOR', qty: occFt, unit: 'FT' });
          }
          return { color: '#FF0000', units };
        },
      },

      // ── RMV_FIBER — Remove Fiber (Aerial or UG) ──
      RMV_FIBER: {
        attributes: [
          { key: 'Environment', label: 'Environment', type: 'toggle-group', options: ['Aerial', 'Underground'] },
          { key: 'Footage',     label: 'Footage (ft)', type: 'number', placeholder: 'ft' },
        ],
        mapping: (input) => {
          const env     = input.Environment || 'Aerial';
          const footage = parseFloat(input.Footage) || 0;
          const code    = env === 'Underground' ? 'RMV FIBER FROM CONDUIT' : 'RMV AERIAL FIBER';
          return { color: '#00AA00', removeXMarks: true, units: [{ code, type: 'LABOR', qty: footage, unit: 'FT' }] };
        },
      },

      // ── RMV_COPPER — Remove Copper (Aerial or UG) ──
      RMV_COPPER: {
        attributes: [
          { key: 'Environment', label: 'Environment', type: 'toggle-group', options: ['Aerial', 'Underground'] },
          { key: 'Size',        label: 'Size (pairs)', type: 'select', options: ['6','25','50','100','200','300','400','600','900','1200'] },
          { key: 'Footage',     label: 'Footage (ft)', type: 'number', placeholder: 'ft' },
        ],
        mapping: (input) => {
          const env     = input.Environment || 'Aerial';
          const size    = parseInt(input.Size) || 100;
          const footage = parseFloat(input.Footage) || 0;
          let code;
          if (env === 'Underground') {
            code = size <= 400 ? 'RMV UG COPPER <= 400pr' : 'RMV UG COPPER > 400pr';
          } else {
            code = size <= 400 ? 'RMV AERIAL COPPER <= 400pr' : 'RMV AERIAL COPPER > 400pr';
          }
          return { color: '#00AA00', removeXMarks: true, units: [{ code, type: 'LABOR', qty: footage, unit: 'FT' }] };
        },
      },

      // ── RMV_ASW — Remove Aerial Service Wire ──
      RMV_ASW: {
        attributes: [
          { key: 'Footage', label: 'Footage (ft)', type: 'number', placeholder: 'ft' },
        ],
        mapping: (input) => {
          const footage = parseFloat(input.Footage) || 0;
          return { color: '#00AA00', removeXMarks: true, units: [{ code: 'RMV AERIAL SVC DROP', type: 'LABOR', qty: footage, unit: 'FT' }] };
        },
      },

      // ── RMV_BSW — Remove Buried Service Wire ──
      RMV_BSW: {
        attributes: [
          { key: 'Placement', label: 'Placement', type: 'toggle-group', options: ['Direct Buried', 'In Conduit'] },
          { key: 'Footage',   label: 'Footage (ft)', type: 'number', placeholder: 'ft' },
        ],
        mapping: (input) => {
          const placement = input.Placement || 'Direct Buried';
          const footage   = parseFloat(input.Footage) || 0;
          const code      = placement === 'In Conduit' ? 'RMV SVC DROP FROM CONDUIT' : 'RMV GROUND LAY SVC DROP';
          return { color: '#00AA00', removeXMarks: true, units: [{ code, type: 'LABOR', qty: footage, unit: 'FT' }] };
        },
      },
    },
  },

  // ──────────────────────────────────────────────────────────
  // TAB: splicing
  // ──────────────────────────────────────────────────────────
  splicing: {
    label: 'Splicing',
    symbols: [
      { key: 'SPLICE_WIZARD', icon: '◇',  label: 'Splice Wizard', type: 'POINT', shape: 'DIAMOND' },
      { key: 'RISER',         icon: '⊣',  label: 'Riser',         type: 'POINT', shape: 'RISER'   },
      { key: 'GROUND_ROD',    icon: '⏚',  label: 'Ground Rod',    type: 'POINT', shape: 'GND_ROD' },
      { key: 'SNOWSHOE',      icon: '⊡',  label: 'Snowshoe',      type: 'POINT', shape: 'SNOWSHOE'},
      { key: 'TERMINAL',      icon: 'T',  label: 'Terminal',      type: 'POINT', shape: 'TERMINAL'},
      { key: 'BURIED_SPLICE',  icon: 'BS', label: 'Buried Splice',  type: 'CALLOUT' },
    ],
    logic: {
      SPLICE_WIZARD: {
        attributes: [
          { key: 'Location',  label: 'Location',   type: 'select', options: ['Aerial', 'Handhole', 'Pedestal-Cabinet', 'Vault-MH', 'Building'] },
          { key: 'CableType', label: 'Cable Type', type: 'select', options: ['Fiber', 'Copper'] },
          { key: 'FiberCount',label: 'Fiber Count (if Fiber)', type: 'number', placeholder: '0' },
          { key: 'PairCount', label: 'Pair Count (if Copper)', type: 'number', placeholder: '0' },
          { key: 'CaseCode',  label: 'Case Code', type: 'text', placeholder: 'e.g. CASE AER FIB D 11.5x30' },
        ],
        mapping: (input) => {
          const loc      = input.Location  || 'Aerial';
          const ctype    = input.CableType || 'Fiber';
          const fiber    = parseInt(input.FiberCount) || 0;
          const pair     = parseInt(input.PairCount)  || 0;
          const caseCode = input.CaseCode || '';

          const units = [];

          // 1. Setup/Teardown
          const setupKey = `${loc}+${ctype}`;
          const setupMap = {
            'Aerial+Fiber':            'SPL SETUP-TEARDOWN AERIAL-FIB',
            'Aerial+Copper':           'SPL SETUP-TEARDOWN AERIAL-COP',
            'Handhole+Fiber':          'SPL SETUP-TEARDOWN HH-FIB',
            'Handhole+Copper':         'SPL SETUP-TEARDOWN HH-COP',
            'Pedestal-Cabinet+Fiber':  'SPL SETUP-TEARDOWN PED/CABINET-FIB',
            'Pedestal-Cabinet+Copper': 'SPL SETUP-TEARDOWN PED/CABINET-COP',
            'Vault-MH+Fiber':          'SPL SETUP-TEARDOWN VAULT-MH-FIB',
            'Vault-MH+Copper':         'SPL SETUP-TEARDOWN VAULT-MH-COP',
            'Building+Fiber':          'SPL SETUP-TEARDOWN BUILDING-FIB',
            'Building+Copper':         'SPL SETUP-TEARDOWN BUILDING-COP',
          };
          const setupCode = setupMap[setupKey] || `SPL SETUP-TEARDOWN ${loc.toUpperCase()}-${ctype.slice(0,3).toUpperCase()}`;
          units.push({ code: setupCode, type: 'LABOR', qty: 1, unit: 'EA' });

          // 2. Splice count code
          if (ctype === 'Fiber' && fiber > 0) {
            let fiberCode;
            if      (fiber <= 4)   fiberCode = 'SPLICE FIBER FUSION 1-4';
            else if (fiber <= 12)  fiberCode = 'SPLICE FIBER FUSION 5-12';
            else if (fiber <= 24)  fiberCode = 'SPLICE FIBER FUSION 13-24';
            else if (fiber <= 48)  fiberCode = 'SPLICE FIBER FUSION 25-48';
            else if (fiber <= 144) fiberCode = 'SPLICE FIBER FUSION 49-144';
            else if (fiber <= 288) fiberCode = 'SPLICE FIBER FUSION 145-288';
            else if (fiber <= 432) fiberCode = 'SPLICE FIBER FUSION 289-432';
            else                   fiberCode = 'SPLICE FIBER FUSION 433-864';
            units.push({ code: fiberCode, type: 'LABOR', qty: 1, unit: 'EA' });
          }

          if (ctype === 'Copper' && pair > 0) {
            let copCode;
            if      (pair <= 25)  copCode = 'SPLICE COPPER MECHANICAL 1-25pr';
            else if (pair <= 100) copCode = 'SPLICE COPPER MECHANICAL 26-100pr';
            else                  copCode = 'SPLICE COPPER MODULE <= 300pr';
            units.push({ code: copCode, type: 'LABOR', qty: 1, unit: 'EA' });
          }

          // 3. Prep code
          const prepCode = ctype === 'Fiber'
            ? 'PREP FIBER CABLE IN HOUSING'
            : 'PREP COPPER CABLE IN HOUSING';
          units.push({ code: prepCode, type: 'LABOR', qty: 1, unit: 'EA' });

          // 4. Case material
          if (caseCode) {
            units.push({ code: caseCode, type: 'MATERIAL', qty: 1, unit: 'EA' });
          }

          return {
            color: '#FF0000',
            label: `SPLICE\n${loc}`,
            units,
          };
        },
      },

      RISER: {
        attributes: [
          { key: 'Status',   label: 'Status',       type: 'toggle-group', options: ['NEW', 'REMOVE', 'TRANSFER'] },
          { key: 'Material', label: 'Pipe Material', type: 'select', options: ['Plastic', 'Steel'] },
          { key: 'Size',     label: 'Pipe Size',     type: 'select', options: ['2in', '3in', '4in'] },
          { key: 'UGuard',   label: 'U-Guard',       type: 'select', options: ['None', '2in Plastic', '3in Plastic', '4in Plastic', '1in Steel', '2in Steel', '4in Steel'] },
          { key: 'Qty',      label: 'Qty',           type: 'number', placeholder: '1' },
        ],
        mapping: (input) => {
          const status   = input.Status   || 'NEW';
          const material = input.Material || 'Plastic';
          const size     = input.Size     || '2in';
          const uguard   = input.UGuard   || 'None';
          const qty      = parseFloat(input.Qty) || 1;

          // REMOVE — single flat unit, no material/size needed
          if (status === 'REMOVE') {
            return {
              color: '#00AA00',
              units: [{ code: 'RMV POLE RISER OR U-GUARD', type: 'LABOR', qty, unit: 'EA' }],
            };
          }

          // TRANSFER — single flat unit
          if (status === 'TRANSFER') {
            return {
              color: '#0000FF',
              units: [{ code: 'REARRANGE XFER POLE RISER', type: 'LABOR', qty, unit: 'EA' }],
            };
          }

          // NEW — pipe material + labor standoff + optional U-Guard
          const pipeCode = `RISER PIPE POLE ${size} ${material.toUpperCase()}`;
          const units = [
            { code: pipeCode,               type: 'MATERIAL', qty, unit: 'EA' },
            { code: 'POLE RISER - STANDOFF', type: 'LABOR',    qty, unit: 'EA' },
          ];

          const uguardMap = {
            '2in Plastic': 'RISER U-GUARD 2 in PLASTIC',
            '3in Plastic': 'RISER U-GUARD 3 in PLASTIC',
            '4in Plastic': 'RISER U-GUARD 4in PLASTIC',
            '1in Steel':   'RISER U-GUARD 1in STEEL',
            '2in Steel':   'RISER U-GUARD 2in STEEL',
            '4in Steel':   'RISER U-GUARD 4in STEEL',
          };
          if (uguardMap[uguard]) {
            units.push({ code: uguardMap[uguard], type: 'MATERIAL', qty, unit: 'EA' });
          }

          return { color: '#FF0000', units };
        },
      },

      GROUND_ROD: {
        attributes: [
          { key: 'Type', label: 'Type', type: 'select', options: ['5/8in-8ft', '5/8in-20ft', '1/2in-5ft'] },
          { key: 'Qty',  label: 'Qty',  type: 'number', placeholder: '1' },
        ],
        mapping: (input) => {
          const type = input.Type || '5/8in-8ft';
          const qty  = parseFloat(input.Qty) || 1;
          return {
            color: '#FF0000',
            units: [{ code: `GROUND ROD ${type}`, type: 'MATERIAL', qty, unit: 'EA' }],
          };
        },
      },

      SNOWSHOE: {
        attributes: [
          { key: 'Qty', label: 'Qty', type: 'number', placeholder: '1' },
        ],
        mapping: (input) => {
          const qty = parseFloat(input.Qty) || 1;
          return {
            color: '#FF0000',
            units: [{ code: 'AERIAL FIBER SNOWSHOE', type: 'MATERIAL', qty, unit: 'EA' }],
          };
        },
      },

      TERMINAL: {
        attributes: [
          { key: 'Status', label: 'Status', type: 'toggle-group', options: ['NEW', 'EXISTING'] },
          { key: 'Type',   label: 'Type',   type: 'select', options: ['PMT', 'SMT'] },
          { key: 'ATAG',   label: 'A-Tag',  type: 'text',   placeholder: 'A-Tag #' },
        ],
        mapping: (input) => {
          const status = input.Status || 'EXISTING';
          const color  = status === 'NEW' ? '#FF0000' : '#000000';
          const atag   = input.ATAG || '';
          const type   = input.Type || 'PMT';
          // Canvas reference only — no billing
          return { color, label: `${type}${atag ? ' ' + atag : ''}`, units: [] };
        },
      },

      BURIED_SPLICE: {
        attributes: [
          { key: 'CaseKit',    label: 'Case Kit (Material)',         type: 'select',
            options: ['3.5x12 KIT 200pr', '3x12 KIT 100pr', '4.25x20 KIT 400pr', '4.9x17.5 KIT 50pr', '5.25x20 KIT 600pr', '12x36 KIT 600pr'] },
          { key: 'SetupLoc',  label: 'Setup / Teardown Location',   type: 'select',
            options: ['PED/CABINET', 'HH', 'AERIAL', 'VAULT-MH', 'BUILDING'] },
          { key: 'SpliceSize', label: 'Splice Module Size',         type: 'select',
            options: ['<= 300pr', '301-900pr', '901-1800pr', '> 1800pr'] },
          { key: 'PairCount', label: 'Pairs Spliced',               type: 'number', placeholder: '200' },
        ],
        mapping: (input) => {
          const caseKit    = input.CaseKit    || '3.5x12 KIT 200pr';
          const setupLoc   = input.SetupLoc   || 'PED/CABINET';
          const spliceSize = input.SpliceSize || '<= 300pr';
          const pairs      = parseFloat(input.PairCount) || 0;

          const caseMaterial = `CASE BUR COP SOFT ${caseKit}`;

          const spliceCodeMap = {
            '<= 300pr':   'SPLICE COPPER MODULE <= 300pr',
            '301-900pr':  'SPLICE COPPER MODULE 301-900pr',
            '901-1800pr': 'SPLICE COPPER MODULE 901-1800pr',
            '> 1800pr':   'SPLICE COPPER MODULE > 1800pr',
          };
          const spliceCode = spliceCodeMap[spliceSize] || 'SPLICE COPPER MODULE <= 300pr';

          const setupCodeMap = {
            'PED/CABINET': 'SPL SETUP-TEARDOWN PED/CABINET-COP',
            'HH':          'SPL SETUP-TEARDOWN HH-COP',
            'AERIAL':      'SPL SETUP-TEARDOWN AERIAL-COP',
            'VAULT-MH':    'SPL SETUP-TEARDOWN VAULT-MH-COP',
            'BUILDING':    'SPL SETUP-TEARDOWN BUILDING-COP',
          };
          const setupCode = setupCodeMap[setupLoc] || 'SPL SETUP-TEARDOWN PED/CABINET-COP';

          return {
            color: '#000000',
            calloutLines: [
              'BURIED SPLICE',
              caseMaterial,
              `${pairs} PR`,
            ],
            units: [
              { code: caseMaterial,              type: 'MATERIAL', qty: 1,     unit: 'EA' },
              { code: 'CASE COPPER BURIED SOFT', type: 'LABOR',    qty: 1,     unit: 'EA' },
              { code: 'LOCATE MARKER BALL',      type: 'LABOR',    qty: 1,     unit: 'EA' },
              { code: spliceCode,                type: 'LABOR',    qty: pairs, unit: 'PR' },
              { code: setupCode,                 type: 'LABOR',    qty: 1,     unit: 'EA' },
            ],
          };
        },
      },

    },
  },

  // ──────────────────────────────────────────────────────────
  // TAB: xfers (Transfers)
  // All render in BLUE #0000FF
  // Arrow + bordered callout box
  // ──────────────────────────────────────────────────────────
  xfers: {
    label: 'X-Fers',
    symbols: [
      { key: 'XFER_POLE_ATTACH',      icon: '→□', label: 'Xfer Pole Attach',      type: 'ARROW_CALLOUT' },
      { key: 'XFER_POLE_ATTACH_ADDL', icon: '→□', label: 'Xfer Pole Attach Addl', type: 'ARROW_CALLOUT' },
      { key: 'XFER_SVC_DROP',         icon: '→□', label: 'Xfer Svc Drop',         type: 'ARROW_CALLOUT' },
      { key: 'XFER_SMALL_FAC',        icon: '→□', label: 'Xfer Small Fac',        type: 'ARROW_CALLOUT' },
      { key: 'XFER_LARGE_FAC',        icon: '→□', label: 'Xfer Large Fac',        type: 'ARROW_CALLOUT' },
      { key: 'XFER_POLE_TAG',         icon: '→□', label: 'Xfer Pole Tag',         type: 'ARROW_CALLOUT' },
    ],
    logic: {
      XFER_POLE_ATTACH: {
        attributes: [
          { key: 'ATAG', label: 'A-Tag', type: 'text',   placeholder: 'A-Tag' },
          { key: 'Qty',  label: 'Qty',   type: 'number', placeholder: '1'    },
        ],
        mapping: (input) => {
          const qty  = parseFloat(input.Qty)  || 1;
          const atag = input.ATAG || '';
          return {
            color: '#0000FF',
            calloutText: `XFER POLE ATTACH x${qty} — ${atag}`,
            units: [{ code: 'REARRANGE XFER POLE ATTACHMENT', type: 'LABOR', qty, unit: 'EA' }],
          };
        },
      },

      XFER_POLE_ATTACH_ADDL: {
        attributes: [
          { key: 'ATAG', label: 'A-Tag', type: 'text',   placeholder: 'A-Tag' },
          { key: 'Qty',  label: 'Qty',   type: 'number', placeholder: '1'    },
        ],
        mapping: (input) => {
          const qty  = parseFloat(input.Qty)  || 1;
          const atag = input.ATAG || '';
          return {
            color: '#0000FF',
            calloutText: `XFER POLE ATTACH ADDL x${qty} — ${atag}`,
            units: [{ code: 'REARRANGE XFER POLE ATTACHMENT ADDL', type: 'LABOR', qty, unit: 'EA' }],
          };
        },
      },

      XFER_SVC_DROP: {
        attributes: [
          { key: 'ATAG', label: 'A-Tag', type: 'text',   placeholder: 'A-Tag' },
          { key: 'Qty',  label: 'Qty',   type: 'number', placeholder: '1'    },
        ],
        mapping: (input) => {
          const qty  = parseFloat(input.Qty)  || 1;
          const atag = input.ATAG || '';
          return {
            color: '#0000FF',
            calloutText: `XFER SVC DROP x${qty} — ${atag}`,
            units: [{ code: 'REARRANGE XFER AERIAL SVC DROP ADDL', type: 'LABOR', qty, unit: 'EA' }],
          };
        },
      },

      XFER_SMALL_FAC: {
        attributes: [
          { key: 'ATAG', label: 'A-Tag', type: 'text',   placeholder: 'A-Tag' },
          { key: 'Qty',  label: 'Qty',   type: 'number', placeholder: '1'    },
        ],
        mapping: (input) => {
          const qty  = parseFloat(input.Qty)  || 1;
          const atag = input.ATAG || '';
          return {
            color: '#0000FF',
            calloutText: `XFER SMALL FAC x${qty} — ${atag}`,
            units: [{ code: 'REARRANGE XFER POLE MOUNT SMALL FAC', type: 'LABOR', qty, unit: 'EA' }],
          };
        },
      },

      XFER_LARGE_FAC: {
        attributes: [
          { key: 'ATAG', label: 'A-Tag', type: 'text',   placeholder: 'A-Tag' },
          { key: 'Qty',  label: 'Qty',   type: 'number', placeholder: '1'    },
        ],
        mapping: (input) => {
          const qty  = parseFloat(input.Qty)  || 1;
          const atag = input.ATAG || '';
          return {
            color: '#0000FF',
            calloutText: `XFER LARGE FAC x${qty} — ${atag}`,
            units: [{ code: 'REARRANGE XFER POLE MOUNT LARGE FAC', type: 'LABOR', qty, unit: 'EA' }],
          };
        },
      },

      XFER_POLE_TAG: {
        attributes: [
          { key: 'ATAG',      label: 'A-Tag',      type: 'text',   placeholder: 'A-Tag'  },
          { key: 'CableType', label: 'Cable Type', type: 'select', options: ['Copper', 'Fiber'] },
          { key: 'Qty',       label: 'Qty',        type: 'number', placeholder: '1'      },
        ],
        mapping: (input) => {
          const atag  = input.ATAG || '';
          const ctype = input.CableType || 'Copper';
          const qty   = parseFloat(input.Qty)  || 1;
          const code  = ctype === 'Fiber' ? 'TAG AER FIB CABLE' : 'TAG AER COP CABLE';
          return {
            color: '#0000FF',
            calloutText: `POLE TAG x${qty} — ${atag}`,
            units: [{ code, type: 'LABOR', qty, unit: 'EA' }],
          };
        },
      },
    },
  },

  // ──────────────────────────────────────────────────────────
  // TAB: removals
  // ──────────────────────────────────────────────────────────
  removals: {
    label: 'Removals',
    symbols: [
      { key: 'RMV_AER_COPPER',   icon: 'X-AC-X', label: 'Rmv Aer Copper',   type: 'LINE' },
      { key: 'RMV_UG_COPPER',    icon: 'X-UC-X', label: 'Rmv UG Copper',    type: 'LINE' },
      { key: 'RMV_AER_FIBER',    icon: 'X-AF-X', label: 'Rmv Aer Fiber',    type: 'LINE' },
      { key: 'RMV_UG_FIBER',     icon: 'X-UF-X', label: 'Rmv UG Fiber',     type: 'LINE' },
      { key: 'RMV_BURIED_FAC',   icon: '▣✕',    label: 'Rmv Buried Fac',   type: 'RECT' },
    ],
    logic: {
      RMV_AER_COPPER: {
        attributes: [
          { key: 'Size',    label: 'Pair Count', type: 'select', options: ['6','25','50','100','200','300','400','600','900','1200'] },
          { key: 'Footage', label: 'Footage',    type: 'number', placeholder: 'ft' },
        ],
        mapping: (input) => {
          const size    = parseInt(input.Size)    || 100;
          const footage = parseFloat(input.Footage) || 0;
          const code    = size <= 400 ? 'RMV AERIAL COPPER <= 400pr' : 'RMV AERIAL COPPER > 400pr';
          return {
            color: '#00AA00',
            removeXMarks: true,
            units: [{ code, type: 'LABOR', qty: footage, unit: 'FT' }],
          };
        },
      },

      RMV_UG_COPPER: {
        attributes: [
          { key: 'Size',    label: 'Pair Count', type: 'select', options: ['6','25','50','100','200','300','400','600','900','1200'] },
          { key: 'Footage', label: 'Footage',    type: 'number', placeholder: 'ft' },
        ],
        mapping: (input) => {
          const size    = parseInt(input.Size)    || 100;
          const footage = parseFloat(input.Footage) || 0;
          const code    = size <= 400 ? 'RMV COPPER FROM CONDUIT <= 400pr' : 'RMV COPPER FROM CONDUIT > 400pr';
          return {
            color: '#00AA00',
            removeXMarks: true,
            units: [{ code, type: 'LABOR', qty: footage, unit: 'FT' }],
          };
        },
      },

      RMV_AER_FIBER: {
        attributes: [
          { key: 'Footage', label: 'Footage', type: 'number', placeholder: 'ft' },
        ],
        mapping: (input) => {
          const footage = parseFloat(input.Footage) || 0;
          return {
            color: '#00AA00',
            removeXMarks: true,
            units: [{ code: 'RMV AERIAL FIBER', type: 'LABOR', qty: footage, unit: 'FT' }],
          };
        },
      },

      RMV_UG_FIBER: {
        attributes: [
          { key: 'Footage', label: 'Footage', type: 'number', placeholder: 'ft' },
        ],
        mapping: (input) => {
          const footage = parseFloat(input.Footage) || 0;
          return {
            color: '#00AA00',
            removeXMarks: true,
            units: [{ code: 'RMV FIBER FROM CONDUIT', type: 'LABOR', qty: footage, unit: 'FT' }],
          };
        },
      },

      RMV_BURIED_FAC: {
        attributes: [
          { key: 'LF',          label: 'Linear Footage (LF)',                  type: 'number',   placeholder: '0' },
          { key: 'AddlCover',   label: 'Exceeds 48in cover?',                  type: 'checkbox' },
          { key: 'CoverAddl',   label: 'Additional 12in increments of cover',  type: 'number',   placeholder: '0', showWhen: { key: 'AddlCover', values: [true, 'true', '1', 1] } },
          { key: 'AddlFac',     label: 'Additional facility in same trench?',  type: 'checkbox' },
        ],
        mapping: (input) => {
          const lf         = parseFloat(input.LF)        || 0;
          const addlCover  = input.AddlCover === true || input.AddlCover === 'true';
          const coverQty   = parseInt(input.CoverAddl)   || 0;
          const addlFac    = input.AddlFac   === true || input.AddlFac   === 'true';
          const units = [
            { code: 'RMV BURIED FACILITY <= 48in', type: 'LABOR', qty: lf, unit: 'FT' },
          ];
          if (addlCover && coverQty > 0) {
            units.push({ code: 'RMV BURIED FACILITY ADDL 12in CVR', type: 'LABOR', qty: lf * coverQty, unit: 'FT' });
          }
          if (addlFac) {
            units.push({ code: 'RMV BURIED FACILITY <=48in ADDL FAC', type: 'LABOR', qty: lf, unit: 'FT' });
          }
          const lines = ['RMV BURIED FACILITY', `${lf} LF`];
          if (addlCover && coverQty > 0) lines.push(`+${coverQty}x 12in cover`);
          if (addlFac) lines.push('+ ADDL FACILITY');
          return {
            color: '#FF0000',
            calloutLines: lines,
            units,
          };
        },
      },
    },
  },

  // ──────────────────────────────────────────────────────────
  // TAB: misc (NEW)
  // ──────────────────────────────────────────────────────────
  misc: {
    label: 'Misc',
    symbols: [
      { key: 'TNE',                icon: 'T&E',  label: 'T&E',                type: 'MODAL_ONLY' },
      { key: 'DOWNTIME',             icon: 'DT',   label: 'Downtime',           type: 'MODAL_ONLY' },
      { key: 'SPLICER_FIBER',        icon: 'S-F',  label: 'Splicer Fiber',      type: 'MODAL_ONLY' },
      { key: 'SPLICER_COPPER',       icon: 'S-C',  label: 'Splicer Copper',     type: 'MODAL_ONLY' },
      { key: 'EMERGENCY_TRAVEL',     icon: 'EMG',  label: 'Emg Travel Time',    type: 'MODAL_ONLY' },
      { key: 'VAC_TRUCK',             icon: 'VAC',  label: 'Vac Truck',           type: 'MODAL_ONLY' },
    ],
    logic: {
      TNE: {
        attributes: [
          {
            key: 'Crew', label: 'Crew', type: 'select',
            options: [
              'T& E 1 MAN ($98/hr)',
              'T&E 2 MAN AERIAL CREW',
              'T&E 2 MAN EXCAVATION CREW',
              'T&E 2 MAN SVC DROP CREW',
              'T&E 3 MAN AERIAL CREW ($320/hr)',
              'T&E 3 MAN EXCAVATION CREW ($275/hr)',
              'T&E 3 MAN UNDERGROUND CREW ($275/hr)',
              'T&E 4 MAN AERIAL CREW ($420/hr)',
              'T&E 4 MAN EXCAVATION CREW',
            ],
          },
          { key: 'Hours',       label: 'Hours',       type: 'number',   placeholder: '0' },
          { key: 'Description', label: 'Description (required justification)', type: 'textarea', placeholder: 'Justification...' },
        ],
        mapping: (input) => {
          const crew  = input.Crew        || 'T&E 2 MAN AERIAL CREW';
          const hours = parseFloat(input.Hours) || 0;
          const desc  = input.Description || '';
          const rate  = _extractRate(crew);
          const amount = rate ? (hours * rate) : null;
          const unitCode = crew.replace(/\s*\(\$[\d/hr]+\)/g, '').trim();
          return {
            color: '#000000',
            calloutLines: [
              unitCode,
              `${hours} hrs${amount !== null ? ' — $' + amount.toFixed(2) : ''}`,
              desc,
            ],
            billDashCode: unitCode,
            billDashHours: hours,
            units: [{ code: unitCode, type: 'LABOR', qty: hours, unit: 'HRS' }],
          };
        },
      },

      SPLICER_FIBER: {
        attributes: [
          { key: 'Hours',       label: 'Qty (hours)',  type: 'number',   placeholder: '0' },
          { key: 'Description', label: 'Description',  type: 'textarea', placeholder: 'Reason for billing...' },
        ],
        mapping: (input) => {
          const hours = parseFloat(input.Hours) || 0;
          const desc  = input.Description || '';
          return {
            color: '#000000',
            calloutLines: [
              'SPLICER - FIBER',
              `${hours} hrs`,
              desc,
            ],
            units: [{ code: 'SPLICER - FIBER', type: 'LABOR', qty: hours, unit: 'HRS' }],
          };
        },
      },

      SPLICER_COPPER: {
        attributes: [
          { key: 'Hours',       label: 'Qty (hours)',  type: 'number',   placeholder: '0' },
          { key: 'Description', label: 'Description',  type: 'textarea', placeholder: 'Reason for billing...' },
        ],
        mapping: (input) => {
          const hours = parseFloat(input.Hours) || 0;
          const desc  = input.Description || '';
          return {
            color: '#000000',
            calloutLines: [
              'SPLICER - COPPER',
              `${hours} hrs`,
              desc,
            ],
            units: [{ code: 'SPLICER - COPPER', type: 'LABOR', qty: hours, unit: 'HRS' }],
          };
        },
      },

      EMERGENCY_TRAVEL: {
        attributes: [
          { key: 'Qty', label: 'Qty (hours)', type: 'number', placeholder: '0' },
        ],
        mapping: (input) => {
          const qty = parseFloat(input.Qty) || 0;
          return {
            color: '#000000',
            calloutLines: [
              'EMERGENCY TRAVEL TIME',
              `${qty} hrs`,
            ],
            units: [{ code: 'EMERGENCY TRAVEL TIME', type: 'LABOR', qty: qty, unit: 'HRS' }],
          };
        },
      },

      VAC_TRUCK: {
        attributes: [
          { key: 'Company', label: 'Company / Vendor', type: 'text', placeholder: 'e.g. AMS Vac Services' },
        ],
        mapping: (input) => {
          const company = (input.Company || 'VENDOR TBD').toUpperCase();
          return {
            color: '#333333',
            calloutLines: [
              'VAC TRUCK',
              company,
              'SEE VENDOR INVOICE',
            ],
            units: [],
          };
        },
      },


      DOWNTIME: {
        attributes: [
          {
            key: 'Crew', label: 'Crew', type: 'select',
            options: [
              'T& E 1 MAN ($98/hr)',
              'T&E 2 MAN AERIAL CREW',
              'T&E 2 MAN EXCAVATION CREW',
              'T&E 2 MAN SVC DROP CREW',
              'T&E 3 MAN AERIAL CREW ($320/hr)',
              'T&E 3 MAN EXCAVATION CREW ($275/hr)',
              'T&E 3 MAN UNDERGROUND CREW ($275/hr)',
              'T&E 4 MAN AERIAL CREW ($420/hr)',
              'T&E 4 MAN EXCAVATION CREW',
            ],
          },
          { key: 'Hours',       label: 'Hours',       type: 'number',   placeholder: '0' },
          { key: 'Description', label: 'Description (required justification)', type: 'textarea', placeholder: 'Justification...' },
        ],
        mapping: (input) => {
          const crew  = input.Crew        || 'T&E 2 MAN AERIAL CREW';
          const hours = parseFloat(input.Hours) || 0;
          const desc  = input.Description || '';
          const rate  = _extractRate(crew);
          const amount = rate ? (hours * rate) : null;
          return {
            color: '#000000',
            calloutLines: [
              'DOWNTIME - CAPITAL PROJECT',
              `${hours} hrs${amount !== null ? ' — $' + amount.toFixed(2) : ''}`,
              desc,
            ],
            billDashCode: 'DOWNTIME - CAPITAL PROJECT',
            billDashHours: hours,
            units: [{ code: 'DOWNTIME - CAPITAL PROJECT', type: 'LABOR', qty: hours, unit: 'HRS' }],
          };
        },
      },
    },
  },

  // ──────────────────────────────────────────────────────────
  // Basic drawing tools (no billing)
  // ──────────────────────────────────────────────────────────
  basic: {
    label: 'Basic',
    symbols: [
      { key: 'BASIC_LINE',    icon: '╱',   label: 'Line',      type: 'LINE'    },
      { key: 'BASIC_CIRCLE',  icon: '◯',   label: 'Circle',    type: 'CIRCLE'  },
      { key: 'BASIC_SQUARE',  icon: '□',   label: 'Rectangle', type: 'RECT'    },
      { key: 'BASIC_ARROW',   icon: '↗',   label: 'Arrow',     type: 'LINE'    },
      { key: 'BASIC_DIM',     icon: '|↔|', label: 'Dimension', type: 'LINE'    },
      { key: 'BASIC_CALLOUT', icon: '💬',  label: 'Callout',   type: 'CALLOUT' },
      { key: 'BASIC_TEXT',    icon: 'T',   label: 'Text',      type: 'TEXT'    },
      { key: 'BASIC_IMAGE',   icon: '🖼',  label: 'Image',     type: 'IMAGE'   },
      { key: 'BASIC_PENCIL',  icon: '✎',   label: 'Freehand',  type: 'LINE'    },
    ],
    logic: {
      BASIC_LINE:    { attributes: [], mapping: () => null },
      BASIC_CIRCLE:  { attributes: [], mapping: () => null },
      BASIC_SQUARE:  { attributes: [], mapping: () => null },
      BASIC_ARROW:   { attributes: [], mapping: () => null },
      BASIC_DIM:     { attributes: [], mapping: () => null },
      BASIC_CALLOUT: { attributes: [], mapping: () => null },
      BASIC_TEXT:    { attributes: [], mapping: () => null },
      BASIC_IMAGE:   { attributes: [], mapping: () => null },
      BASIC_PENCIL:  { attributes: [], mapping: () => null },
    },
  },
};

// ============================================================
// PRIVATE HELPERS
// ============================================================
function _extractRate(crewLabel) {
  const m = crewLabel.match(/\$(\d+)\/hr/);
  return m ? parseInt(m[1]) : null;
}

// ============================================================
// resolveSmartUnit — PRIMARY RESOLUTION FUNCTION
// Returns a normalized result object:
// {
//   color,         // hex string
//   label,         // optional canvas label
//   unit_code,     // primary billing code
//   unit,          // 'EA' | 'FT' | 'HRS'
//   qty,           // number
//   extraUnits,    // [{ unit_code, unit, qty }]
//   removeXMarks,  // boolean — line tools with REMOVE status
//   calloutText,   // string for transfer arrow callouts
//   calloutLines,  // string[] for T&E / DOWNTIME callout boxes
//   trenchDetail,  // object with trench detail fields (Change 6)
// }
// ============================================================
export function resolveSmartUnit(category, symbolKey, attributes = {}) {
  const catData = SMART_UNIT_DICTIONARY[category];
  if (!catData || !catData.logic || !catData.logic[symbolKey]) {
    return {
      unit_code: symbolKey,
      desc: symbolKey,
      unit: 'EA',
      qty: 1,
      color: '#000000',
      extraUnits: [],
    };
  }

  const logic = catData.logic[symbolKey];

  if (typeof logic.mapping !== 'function') {
    return {
      unit_code: symbolKey,
      desc: symbolKey,
      unit: 'EA',
      qty: 1,
      color: '#000000',
      extraUnits: [],
    };
  }

  const raw = logic.mapping(attributes);

  if (!raw) return null;

  // raw.units is an array of { code, type, qty, unit }
  const rawUnits = raw.units || [];

  if (rawUnits.length === 0) {
    // No billing (Existing, canvas-only, etc.)
    return {
      unit_code: null,
      desc: raw.label || symbolKey,
      unit: 'EA',
      qty: 0,
      color: raw.color || '#000000',
      label: raw.label || null,
      removeXMarks: raw.removeXMarks || false,
      calloutText:  raw.calloutText  || null,
      calloutLines: raw.calloutLines || null,
      dashArray:    raw.dashArray    || null,
      trenchDetail: raw.trenchDetail || null,
      extraUnits: [],
    };
  }

  const primary = rawUnits[0];
  const extras  = rawUnits.slice(1).map(u => ({
    unit_code: u.unit_code || u.code,
    desc:      u.desc      || u.unit_code || u.code,
    unit:      u.unit      || 'FT',
    qty:       u.qty       != null ? u.qty : 1,
  }));

  return {
    unit_code:    primary.unit_code || primary.code,
    desc:         primary.desc      || primary.unit_code || primary.code,
    unit:         primary.unit      || 'FT',
    qty:          primary.qty       != null ? primary.qty : 1,
    color:        raw.color    || '#000000',
    label:        raw.label    || null,
    removeXMarks: raw.removeXMarks || false,
    calloutText:  raw.calloutText  || null,
    calloutLines: raw.calloutLines || null,
    dashArray:    raw.dashArray    || null,
    billDashCode:  raw.billDashCode  || null,
    billDashHours: raw.billDashHours || null,
    trenchDetail:  raw.trenchDetail  || null,
    extraUnits:   extras,
  };
}

// ============================================================
// resolveUnit — legacy wrapper
// ============================================================
export function resolveUnit(symbolKey, attributes = {}) {
  let category = 'basic';
  if (['POLE','STRAND_10M','DOWN_GUY','DE_RE','RE_TENSION','ANCHOR','TREE_TRIM','XFERS','ARBORIST'].includes(symbolKey)) category = 'aerial';
  if (['HH','MH','PEDESTAL','TRENCH','BORE','SPLICE_PIT','MH_GRADE_ADJ','POTHOLE','GRUBBING','ROD_PROOF','LOC_SONDE'].includes(symbolKey)) category = 'underground';
  if (['COPPER_CABLE','FIBER_CABLE','ASW','BSW','RMV_FIBER','RMV_COPPER','RMV_ASW','RMV_BSW'].includes(symbolKey)) category = 'cable';
  if (['SPLICE_WIZARD','RISER','GROUND_ROD','SNOWSHOE','TERMINAL','BURIED_SPLICE'].includes(symbolKey)) category = 'splicing';
  if (['XFER_POLE_ATTACH','XFER_POLE_ATTACH_ADDL','XFER_SVC_DROP','XFER_SMALL_FAC','XFER_LARGE_FAC','XFER_POLE_TAG'].includes(symbolKey)) category = 'xfers';
  if (['RMV_AER_COPPER','RMV_UG_COPPER','RMV_AER_FIBER','RMV_UG_FIBER'].includes(symbolKey)) category = 'removals';
  if (['RMV_BURIED_FAC'].includes(symbolKey)) category = 'underground';
  if (['RMV_ANCHOR'].includes(symbolKey)) category = 'aerial';
  if (['TNE','DOWNTIME','SPLICER_FIBER','SPLICER_COPPER','EMERGENCY_TRAVEL','VAC_TRUCK','CORE_DRILL'].includes(symbolKey)) category = 'misc';
  return resolveSmartUnit(category, symbolKey, attributes);
}
