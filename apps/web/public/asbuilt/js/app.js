/**
 * NSC As-Built Editor — app.js
 * Fabric.js 5.3.0 | North Sky Communications
 * Full rebuild per spec + 7 upgrades.
 */

import { resolveSmartUnit, SMART_UNIT_DICTIONARY, ASBUILT_THEME } from './units.js';

// ============================================================
// CONSTANTS
// ============================================================
const GRID_SIZE   = 20;
const HISTORY_MAX = 50;

// ============================================================
// STATE
// ============================================================
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

// ============================================================
// CANVAS SETUP
// ============================================================
const canvasEl   = document.getElementById('main-canvas');
const canvasArea = document.getElementById('canvas-area');

const canvas = new fabric.Canvas('main-canvas', {
  selection:              true,
  preserveObjectStacking: true,
  stopContextMenu:        true,
  fireRightClick:         false,
  perPixelTargetFind:     true,
  targetFindTolerance:    4,
});

// Tighten bounding boxes globally — no extra padding on any object
fabric.Object.prototype.padding          = 0;
fabric.Object.prototype.cornerSize       = 8;
fabric.Object.prototype.cornerStyle      = 'circle';
fabric.Object.prototype.transparentCorners = false;
fabric.Object.prototype.borderColor      = '#0071e3';
fabric.Object.prototype.cornerColor      = '#0071e3';

function sizeCanvas() {
  const panelOpen = document.getElementById('tool-panel').classList.contains('panel-open');
  const tabW   = 48;
  const panelW = panelOpen ? 220 : 0;
  const w = window.innerWidth  - tabW - panelW;
  // Measure actual rendered heights
  const notesBar   = document.getElementById('notes-bar');
  const notesH     = notesBar   ? notesBar.getBoundingClientRect().height   : 56;
  const header     = document.getElementById('app-header');
  const headerH    = header     ? header.getBoundingClientRect().height     : 92;
  const styleStrip = document.getElementById('style-strip');
  const stripH     = styleStrip ? styleStrip.getBoundingClientRect().height : 36;
  const h = window.innerHeight - headerH - notesH - stripH;
  // Keep CSS variables in sync so canvas-area top/left align correctly
  document.documentElement.style.setProperty('--header-h', headerH + 'px');
  document.documentElement.style.setProperty('--notes-h',  notesH  + 'px');
  document.documentElement.style.setProperty('--strip-h',  stripH  + 'px');
  canvas.setWidth(w);
  canvas.setHeight(h);
  drawGrid();
  canvas.renderAll();
}

// ============================================================
// GRID BACKGROUND
// ============================================================
function drawGrid() {
  if (state.showGrid === false) { canvas.setBackgroundColor(getComputedStyle(document.getElementById('canvas-area')).backgroundColor || '#1a1e24', canvas.renderAll.bind(canvas)); return; }
  const w    = canvas.getWidth();
  const h    = canvas.getHeight();
  const zoom = canvas.getZoom();
  const vpt  = canvas.viewportTransform;
  const offsetX = vpt[4] % (GRID_SIZE * zoom);
  const offsetY = vpt[5] % (GRID_SIZE * zoom);

  const lines = [];
  const step  = GRID_SIZE * zoom;
  for (let x = offsetX; x < w; x += step) {
    lines.push(`<line x1="${x.toFixed(1)}" y1="0" x2="${x.toFixed(1)}" y2="${h}" stroke="#d1d5db" stroke-width="0.5"/>`);
  }
  for (let y = offsetY; y < h; y += step) {
    lines.push(`<line x1="0" y1="${y.toFixed(1)}" x2="${w}" y2="${y.toFixed(1)}" stroke="#d1d5db" stroke-width="0.5"/>`);
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <rect width="${w}" height="${h}" fill="white"/>
    ${lines.join('')}
  </svg>`;
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  canvas.setBackgroundImage(url, canvas.renderAll.bind(canvas), { crossOrigin: 'anonymous' });
}

// ============================================================
// GRID SNAP
// ============================================================
function snap(val) { return Math.round(val / GRID_SIZE) * GRID_SIZE; }

function snapPoint(p) {
  const vpt  = canvas.viewportTransform;
  const zoom = canvas.getZoom();
  const cx = (p.x - vpt[4]) / zoom;
  const cy = (p.y - vpt[5]) / zoom;
  return { x: snap(cx), y: snap(cy) };
}

// ============================================================
// HISTORY (UNDO)
// ============================================================
function pushHistory() {
  if (state.historyLocked) return;
  const json = JSON.stringify(canvas.toJSON(['nscData', '__uid', 'selectable', 'evented']));
  state.history.push(json);
  if (state.history.length > HISTORY_MAX) state.history.shift();
}

async function undo() {
  if (state.history.length === 0) return;
  const json = state.history.pop();
  state.historyLocked = true;
  await new Promise(resolve => {
    canvas.loadFromJSON(json, () => {
      canvas.renderAll();
      state.historyLocked = false;
      rebuildUnitMap();
      updateBillableUnits();
      resolve();
    });
  });
}

// ============================================================
// ZOOM & PAN
// ============================================================
// Zoom helper — zoom to center of canvas
function zoomCanvas(factor) {
  const center = canvas.getCenter();
  let zoom = canvas.getZoom() * factor;
  zoom = Math.max(0.1, Math.min(5, zoom));
  canvas.zoomToPoint({ x: center.left, y: center.top }, zoom);
  drawGrid();
  updateZoomDisplay();
}

function resetZoom() {
  canvas.setViewportTransform([1,0,0,1,0,0]);
  drawGrid();
  updateZoomDisplay();
}

function updateZoomDisplay() {
  const el = document.getElementById('zoom-level');
  if (el) el.textContent = Math.round(canvas.getZoom() * 100) + '%';
}

canvas.on('mouse:wheel', opt => {
  const e = opt.e;
  if (e.ctrlKey || e.metaKey) {
    // Ctrl+scroll = zoom to cursor
    const delta = e.deltaY;
    let zoom = canvas.getZoom();
    zoom *= 0.999 ** delta;
    zoom = Math.max(0.1, Math.min(5, zoom));
    canvas.zoomToPoint({ x: e.offsetX, y: e.offsetY }, zoom);
    drawGrid();
    updateZoomDisplay();
  } else {
    // Plain scroll = pan up/down, shift+scroll = pan left/right
    const panX = e.shiftKey ? -e.deltaY : 0;
    const panY = e.shiftKey ? 0 : -e.deltaY;
    canvas.relativePan({ x: panX, y: panY });
    drawGrid();
  }
  e.preventDefault();
  e.stopPropagation();
});

canvas.on('mouse:down', opt => {
  if (state.spaceDown || opt.e.button === 1) {
    state.isPanning    = true;
    state.lastPanPoint = { x: opt.e.clientX, y: opt.e.clientY };
    document.body.classList.add('panning');
    canvas.selection = false;
    return;
  }
  handleMouseDown(opt);
});

canvas.on('mouse:move', opt => {
  if (state.isPanning && state.lastPanPoint) {
    const dx = opt.e.clientX - state.lastPanPoint.x;
    const dy = opt.e.clientY - state.lastPanPoint.y;
    canvas.relativePan({ x: dx, y: dy });
    state.lastPanPoint = { x: opt.e.clientX, y: opt.e.clientY };
    drawGrid();
    return;
  }
  handleMouseMove(opt);
});

canvas.on('mouse:up', opt => {
  if (state.isPanning) {
    state.isPanning = false;
    document.body.classList.remove('panning');
    canvas.selection = true;
    return;
  }
  handleMouseUp(opt);
});

// ============================================================
// OBJECT EVENTS
// ============================================================
// Force tight bounding boxes on every object added
canvas.on('object:added', (e) => {
  if (e.target) {
    e.target.set({ padding: 0 });
    if (e.target._objects) {
      e.target._objects.forEach(o => o.set({ padding: 0 }));
    }
  }
});

canvas.on('object:added', () => {
  if (!state.historyLocked) { pushHistory(); updateBillableUnits(); }
});
canvas.on('object:modified', () => { pushHistory(); updateBillableUnits(); });
canvas.on('object:removed',  () => { pushHistory(); updateBillableUnits(); });

canvas.on('selection:created', updateSelectionUI);
canvas.on('selection:updated', updateSelectionUI);
canvas.on('selection:cleared', clearSelectionUI);

canvas.on('mouse:dblclick', opt => {
  // ── Polyline finish ──────────────────────────────────────────────────────
  if (state.polyLineTool) {
    state._polyDblClick = true;
    const pointer = canvas.getPointer(opt.e);
    const pt = { x: snap(pointer.x), y: snap(pointer.y) };
    finishPolyLine(pt);
    return;
  }

  // ── Re-edit any placed NSC tool object ──────────────────────────────────
  const target = opt.target;
  if (!target) return;

  // Walk up to the top-level group
  let obj = target;
  while (obj.group) obj = obj.group;

  const nsc = obj.nscData;
  if (!nsc || !nsc.category || !nsc.key) return;

  // Get stored attrs + modal attribute definitions
  const prevAttrs = nsc.attrs || {};
  const attrs = getModalAttributes(nsc.category, nsc.key);
  if (!attrs || attrs.length === 0) return;

  // Pre-fill the modal fields with previously saved values
  const prefilled = attrs.map(a => {
    const stored = prevAttrs[a.key];
    if (stored === undefined) return a;
    // Use _default for select/text/number/toggle, defaultChecked for checkbox
    return { ...a, _default: stored, defaultChecked: stored === true || stored === 'true' };
  });

  const savedLeft = obj.left;
  const savedTop  = obj.top;

  showModal(nsc.key + ' — Edit', prefilled, (values) => {
    // Remove the old object
    canvas.remove(obj);

    // Rebuild the symbol at same position
    const pt = { x: savedLeft, y: savedTop };
    const defaultColor = nsc.key.startsWith('RMV_') ? '#00AA00' : '#000000';
    const newGroup = buildSymbolGroup(nsc.key, pt, defaultColor);
    if (!newGroup) return;

    newGroup.nscData = { category: nsc.category, key: nsc.key, attrs: values, type: nsc.type || 'POINT' };
    canvas.add(newGroup);

    const resolved = resolveSmartUnit(nsc.category, nsc.key, values);
    if (resolved) {
      applyColorToGroup(newGroup, resolved.color);
      if (resolved.label) applyLabelToGroup(newGroup, resolved.label);
    }
    newGroup.nscData.attrs = values;
    storeUnitData(newGroup, resolved);
    updateBillableUnits();
    pushHistory();
    canvas.setActiveObject(newGroup);
    canvas.renderAll();
  }, () => {
    // Discard — just re-select the original
    canvas.setActiveObject(obj);
    canvas.renderAll();
  });
});

canvas.on('object:moving', opt => {
  const obj = opt.target;
  obj.set({ left: snap(obj.left), top: snap(obj.top) });
});

// ============================================================
// SELECTION UI
// ============================================================
function updateSelectionUI() {
  const active    = canvas.getActiveObjects();
  const btnGroup  = document.getElementById('btn-group');
  const btnUG     = document.getElementById('btn-ungroup');
  const ssPropGroup   = document.getElementById('ss-prop-group');
  const ssPropDivider = document.getElementById('ss-prop-divider');

  btnGroup.style.display = (active.length >= 2 && !(canvas.getActiveObject() instanceof fabric.Group)) ? 'inline-flex' : 'none';
  btnUG.style.display    = (canvas.getActiveObject() instanceof fabric.Group) ? 'inline-flex' : 'none';

  if (active.length === 1) {
    ssPropGroup.style.display   = 'flex';
    ssPropDivider.style.display = 'block';
    const obj   = active[0];
    const color = obj.stroke || obj.fill || '#000000';
    document.getElementById('prop-color').value  = colorToHex(color);
    const sw = obj.strokeWidth || 1;
    document.getElementById('prop-stroke').value     = sw;
    document.getElementById('prop-stroke-val').textContent = sw;
    const fontRow = document.getElementById('prop-font-row');
    if (obj.type === 'i-text' || obj.type === 'text') {
      fontRow.style.display = 'inline-flex';
      document.getElementById('prop-fontsize').value = obj.fontSize || 14;
    } else {
      fontRow.style.display = 'none';
    }
  } else {
    ssPropGroup.style.display   = 'none';
    ssPropDivider.style.display = 'none';
  }
}

function clearSelectionUI() {
  document.getElementById('btn-group').style.display   = 'none';
  document.getElementById('btn-ungroup').style.display = 'none';
  const ssPropGroup   = document.getElementById('ss-prop-group');
  const ssPropDivider = document.getElementById('ss-prop-divider');
  if (ssPropGroup)   ssPropGroup.style.display   = 'none';
  if (ssPropDivider) ssPropDivider.style.display = 'none';
}

function colorToHex(c) {
  if (!c || c === 'transparent') return '#000000';
  if (c.startsWith('#')) return c;
  const m = c.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (m) return '#' + [m[1], m[2], m[3]].map(v => parseInt(v).toString(16).padStart(2, '0')).join('');
  return '#000000';
}

// ============================================================
// MOUSE HANDLERS
// ============================================================
function handleMouseDown(opt) {
  const pointer = canvas.getPointer(opt.e);
  const pt      = { x: snap(pointer.x), y: snap(pointer.y) };

  if (state.activeTool === 'SELECT')   return;
  if (state.activeTool === 'FREEHAND') return;

  if (state.activeTool === 'TEXT') {
    if (opt.target) return;
    placeText(pt);
    return;
  }

  if (false) {
    return;
  }

  if (state.activeTool === 'ROD_PROOF' || state.activeTool === 'LOC_SONDE') {
    if (state._polyDblClick) { state._polyDblClick = false; return; } // absorb the mousedown paired with dblclick
    polyLineAddPoint(pt);
    return;
  }

  if (state.activeTool === 'XFERS') {
    handleXfersClick(pt);
    return;
  }

  if (state.activeCategory !== null) {
    handleTelecomMouseDown(pt, opt);
    return;
  }

  switch (state.activeTool) {
    case 'LINE':      startLineDraw(pt);            break;
    case 'ARROW':     startLineDraw(pt, true);       break;
    case 'DIMENSION': startLineDraw(pt, false, true); break;
    case 'CALLOUT':   handleCalloutDown(pt);         break;
    case 'RECT':      startRectDraw(pt);             break;
    case 'CIRCLE':    startCircleDraw(pt);           break;
  }
}

function handleMouseMove(opt) {
  const pointer = canvas.getPointer(opt.e);
  const pt      = { x: snap(pointer.x), y: snap(pointer.y) };

  if (state.drawingLine && state.previewLine) {
    state.previewLine.set({ x2: pt.x, y2: pt.y });
    // Update live arrowhead position and angle during drag
    if (state._isArrow && state.previewArrowHead) {
      const dx = pt.x - state.lineStart.x;
      const dy = pt.y - state.lineStart.y;
      const angle = Math.atan2(dy, dx) * 180 / Math.PI;
      state.previewArrowHead.set({ left: pt.x, top: pt.y, angle: angle + 90 });
    }
    canvas.renderAll();
  }
  if (state.drawingRect && state.previewRect) {
    const sx = state.rectStart.x, sy = state.rectStart.y;
    state.previewRect.set({
      left:   Math.min(sx, pt.x),
      top:    Math.min(sy, pt.y),
      width:  Math.abs(pt.x - sx),
      height: Math.abs(pt.y - sy),
    });
    canvas.renderAll();
  }
  if (state.drawingCircle && state.previewCircle) {
    const dx = pt.x - state.circleStart.x;
    const dy = pt.y - state.circleStart.y;
    const r  = Math.max(4, Math.sqrt(dx * dx + dy * dy));
    state.previewCircle.set({ radius: r });
    canvas.renderAll();
  }
  // Change 4: Callout drag preview
  if (state.calloutDragging && state.calloutLeaderPt && state._calloutPreviewLine) {
    state._calloutPreviewLine.set({ x2: pt.x, y2: pt.y });
    canvas.renderAll();
  }
  // Change 5: Wreckout drag
  // RMV Buried Fac drag preview
  if (state.drawingRmvBuried && state.previewRmvBuried) {
    const sx = state.rmvBuriedStart.x, sy = state.rmvBuriedStart.y;
    state.previewRmvBuried.set({
      left:   Math.min(sx, pt.x),
      top:    Math.min(sy, pt.y),
      width:  Math.abs(pt.x - sx),
      height: Math.abs(pt.y - sy),
    });
    canvas.renderAll();
  }
  // Poly-line rubber band (Rod & Proof / Locate Sonde)
  if (state.polyLineTool && state.polyPoints.length > 0 && state.polyPreview) {
    const last = state.polyPoints[state.polyPoints.length - 1];
    state.polyPreview.set({ x1: last.x, y1: last.y, x2: pt.x, y2: pt.y });
    canvas.renderAll();
  }
}

function handleMouseUp(opt) {
  const pointer = canvas.getPointer(opt.e);
  const pt      = { x: snap(pointer.x), y: snap(pointer.y) };
  if (state.drawingRect)     finishRectDraw(pt);
  if (state.drawingCircle)   finishCircleDraw(pt);

  // Change 4: finish callout drag
  if (state.calloutDragging) finishCalloutDrag(pt);
}

// ============================================================
// LINE DRAWING (basic)
// ============================================================
function startLineDraw(pt, isArrow = false, isDimension = false) {
  if (!state.drawingLine) {
    state.drawingLine  = true;
    state.lineStart    = pt;
    state._isArrow     = isArrow;
    state._isDimension = isDimension;
    const dashArray = state.toolLinestyle === 'dashed' ? [10, 5] : null;
    const preview   = new fabric.Line([pt.x, pt.y, pt.x, pt.y], {
      stroke: state.toolColor, strokeWidth: state.toolStroke,
      strokeDashArray: dashArray, selectable: false, evented: false, opacity: 0.6,
    });
    canvas.add(preview);
    state.previewLine = preview;

    // Arrow: also create a live arrowhead triangle that tracks the end point
    if (isArrow) {
      const head = new fabric.Triangle({
        width: 12, height: 14, fill: state.toolColor,
        left: pt.x, top: pt.y,
        originX: 'center', originY: 'center',
        angle: 90, selectable: false, evented: false, opacity: 0.6,
      });
      canvas.add(head);
      state.previewArrowHead = head;
    }
  } else {
    finishLineDraw(pt);
  }
}

function finishLineDraw(pt) {
  canvas.remove(state.previewLine);
  state.previewLine = null;
  // Remove live arrowhead preview if present
  if (state.previewArrowHead) {
    canvas.remove(state.previewArrowHead);
    state.previewArrowHead = null;
  }
  state.drawingLine = false;

  const sx = state.lineStart.x, sy = state.lineStart.y;
  const ex = pt.x, ey = pt.y;

  let placedObj = null;
  if (state._isArrow) {
    placedObj = placeArrow(sx, sy, ex, ey);
  } else if (state._isDimension) {
    placedObj = placeDimension(sx, sy, ex, ey);
  } else {
    const dashArray = state.toolLinestyle === 'dashed' ? [10, 5] : null;
    placedObj = new fabric.Line([sx, sy, ex, ey], {
      stroke: state.toolColor, strokeWidth: state.toolStroke, strokeDashArray: dashArray,
    });
    canvas.add(placedObj);
  }
  // Drop back to SELECT and select the drawn object — Bluebeam-style
  setTool('SELECT');
  if (placedObj) { canvas.setActiveObject(placedObj); canvas.renderAll(); }
  pushHistory();
}

// ============================================================
// ARROW
// ============================================================
function placeArrow(x1, y1, x2, y2, color, strokeW) {
  color   = color   || state.toolColor;
  strokeW = strokeW || state.toolStroke;
  const angle    = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
  const line     = new fabric.Line([x1, y1, x2, y2], { stroke: color, strokeWidth: strokeW });
  const arrowHead = new fabric.Triangle({
    width: 12, height: 14, fill: color, stroke: 'none',
    left: x2, top: y2, originX: 'center', originY: 'center', angle: angle + 90,
  });
  const group = new fabric.Group([line, arrowHead]);
  canvas.add(group);
  return group;
}

// ============================================================
// DIMENSION
// ============================================================
function placeDimension(x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const lengthPx = Math.sqrt(dx * dx + dy * dy);
  const lengthFt = Math.round(lengthPx / 5);
  const angle    = Math.atan2(dy, dx) * 180 / Math.PI;
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;

  const line = new fabric.Line([x1, y1, x2, y2], { stroke: state.toolColor, strokeWidth: state.toolStroke });

  function perp(x, y, a, len) {
    const rad = (a + 90) * Math.PI / 180;
    return new fabric.Line(
      [x - Math.cos(rad)*len, y - Math.sin(rad)*len, x + Math.cos(rad)*len, y + Math.sin(rad)*len],
      { stroke: state.toolColor, strokeWidth: state.toolStroke }
    );
  }
  const tick1 = perp(x1, y1, angle, 8);
  const tick2 = perp(x2, y2, angle, 8);
  const label = new fabric.IText(`${lengthFt}'`, {
    left: mx, top: my - 16, fontSize: 12, fill: state.toolColor,
    fontFamily: 'Arial', fontWeight: 'bold', originX: 'center', originY: 'center', editable: true,
  });
  const dimGroup = new fabric.Group([line, tick1, tick2, label]);
  canvas.add(dimGroup);
  return dimGroup;
}

// ============================================================
// CALLOUT — Change 4: Click-then-drag Bluebeam style
// First click = arrow tip (annotation point)
// Drag = leader direction to box position
// Mouse-up = open modal for callout text
// ============================================================
function handleCalloutDown(pt) {
  if (!state.calloutDragging) {
    // First click — record arrow tip, start drag
    state.calloutLeaderPt = pt;
    state.calloutDragging = true;
    state.calloutStep     = 1;

    // Visual cue: dot at annotation point
    const dot = new fabric.Circle({
      left: pt.x, top: pt.y, radius: 4, fill: '#ff4444',
      originX: 'center', originY: 'center', selectable: false, evented: false,
    });
    canvas.add(dot);
    state._calloutDot = dot;

    // Preview leader line
    const preview = new fabric.Line([pt.x, pt.y, pt.x, pt.y], {
      stroke: '#000000', strokeWidth: 1, selectable: false, evented: false, opacity: 0.5,
    });
    canvas.add(preview);
    state._calloutPreviewLine = preview;
  }
}

function finishCalloutDrag(pt) {
  if (!state.calloutDragging) return;
  state.calloutDragging = false;
  state.calloutStep     = 0;

  // Clean up preview
  if (state._calloutDot)         { canvas.remove(state._calloutDot);         state._calloutDot         = null; }
  if (state._calloutPreviewLine) { canvas.remove(state._calloutPreviewLine); state._calloutPreviewLine = null; }

  const arrowTip = state.calloutLeaderPt;  // First click — the thing being annotated
  const boxPt    = pt;                      // Drag endpoint — where the box goes

  // Open modal for callout text
  const attrs = [
    { key: 'CalloutText', label: 'Callout Text', type: 'text', placeholder: 'Label for this annotation...' },
  ];

  showModal('CALLOUT', attrs, (values) => {
    const note = values.CalloutText || '';
    if (!note.trim()) return;

    // Arrow tip is arrowTip (first click), box is at boxPt (drag end)
    const dx     = boxPt.x - arrowTip.x;
    const dy     = boxPt.y - arrowTip.y;
    const angle  = Math.atan2(dy, dx) * 180 / Math.PI;

    // Leader line from box position to arrow tip
    const leader = new fabric.Line([arrowTip.x, arrowTip.y, boxPt.x, boxPt.y], {
      stroke: '#000000', strokeWidth: 1.5,
    });

    // Arrowhead at the annotation point (arrowTip)
    const arrowHead = new fabric.Triangle({
      width: 10, height: 12, fill: '#000000', stroke: 'none',
      left: arrowTip.x, top: arrowTip.y,
      originX: 'center', originY: 'center',
      angle: angle + 90,
    });

    // Measure text for box sizing
    const tempText = new fabric.Text(note, { fontSize: 12, fontFamily: 'Arial' });
    const pad = 8;
    const boxW = Math.max(60, tempText.width  + pad * 2);
    const boxH = Math.max(24, tempText.height + pad * 2);

    // Box positioned at boxPt
    const box = new fabric.Rect({
      left: -boxW / 2, top: -boxH / 2,
      width: boxW, height: boxH,
      fill: '#ffffff', stroke: '#000000', strokeWidth: 1,
    });

    const label = new fabric.Text(note, {
      left: -boxW / 2 + pad, top: -boxH / 2 + pad,
      fontSize: 12, fill: '#000000', fontFamily: 'Arial',
    });

    // Build group — box and label positioned relative to boxPt
    // Leader goes from arrowTip to boxPt; group origin at boxPt center
    const calloutGroup = new fabric.Group([leader, arrowHead, box, label], {
      left: boxPt.x,
      top:  boxPt.y,
      originX: 'center',
      originY: 'center',
    });

    canvas.add(calloutGroup);
    setTool('SELECT');
    canvas.setActiveObject(calloutGroup);
    canvas.renderAll();
    pushHistory();
  }, () => {
    // Discard — nothing to do, previews already removed
    setTool('SELECT');
  });
}

// ============================================================
// RECT / CIRCLE drawing (basic)
// ============================================================
function startRectDraw(pt) {
  state.drawingRect  = true;
  state.rectStart    = pt;
  const rect = new fabric.Rect({
    left: pt.x, top: pt.y, width: 0, height: 0,
    fill: 'transparent', stroke: state.toolColor, strokeWidth: state.toolStroke,
    selectable: false, evented: false, opacity: 0.6,
  });
  canvas.add(rect);
  state.previewRect = rect;
}

function finishRectDraw(pt) {
  if (!state.drawingRect) return;
  canvas.remove(state.previewRect);
  state.drawingRect = false; state.previewRect = null;
  const sx = state.rectStart.x, sy = state.rectStart.y;
  const w  = Math.abs(pt.x - sx), h = Math.abs(pt.y - sy);
  if (w < 4 && h < 4) return;
  const dashArray = state.toolLinestyle === 'dashed' ? [10, 5] : null;
  const rect = new fabric.Rect({
    left: Math.min(sx, pt.x), top: Math.min(sy, pt.y), width: w, height: h,
    fill: 'transparent', stroke: state.toolColor, strokeWidth: state.toolStroke,
    strokeDashArray: dashArray,
  });
  canvas.add(rect);
  setTool('SELECT');
  canvas.setActiveObject(rect);
  canvas.renderAll();
  pushHistory();
}

function startCircleDraw(pt) {
  // Click-to-place at fixed default size — no drag needed, resize with handles after
  const DEFAULT_RADIUS = 30;
  const circ = new fabric.Circle({
    left: pt.x, top: pt.y,
    radius: DEFAULT_RADIUS,
    fill: 'transparent',
    stroke: state.toolColor,
    strokeWidth: state.toolStroke,
    originX: 'center', originY: 'center',
  });
  canvas.add(circ);
  // Drop back to SELECT immediately, select the placed circle
  state.drawingCircle = false;
  state.previewCircle = null;
  setTool('SELECT');
  canvas.setActiveObject(circ);
  canvas.renderAll();
  pushHistory();
}

function finishCircleDraw(pt) {
  if (!state.drawingCircle) return;
  canvas.remove(state.previewCircle);
  state.drawingCircle = false; state.previewCircle = null;
  const dx = pt.x - state.circleStart.x;
  const dy = pt.y - state.circleStart.y;
  const r  = Math.max(4, Math.sqrt(dx * dx + dy * dy));
  const dashArray = state.toolLinestyle === 'dashed' ? [10, 5] : null;
  canvas.add(new fabric.Circle({
    left: state.circleStart.x, top: state.circleStart.y, radius: r,
    fill: 'transparent', stroke: state.toolColor, strokeWidth: state.toolStroke,
    strokeDashArray: dashArray, originX: 'center', originY: 'center',
  }));
}

// ============================================================


// ============================================================
// GRUBBING — dashed green rect, 50% opacity, crosshatch, LF label
// ============================================================
function startGrubbingDraw(pt) {
  state.drawingGrubbing = true;
  state.grubbingStart   = pt;
  const rect = new fabric.Rect({
    left: pt.x, top: pt.y, width: 0, height: 0,
    fill: 'rgba(0,160,0,0.15)', stroke: '#008000', strokeWidth: 2,
    strokeDashArray: [6, 4],
    selectable: false, evented: false, opacity: 0.8,
  });
  canvas.add(rect);
  state.previewGrubbing = rect;
}

function finishGrubbingDraw(pt) {
  if (!state.drawingGrubbing) return;
  canvas.remove(state.previewGrubbing);
  state.drawingGrubbing = false;
  state.previewGrubbing = null;

  const sx = state.grubbingStart.x, sy = state.grubbingStart.y;
  const w  = Math.abs(pt.x - sx), h = Math.abs(pt.y - sy);
  if (w < 8 && h < 8) return;

  const left = Math.min(sx, pt.x);
  const top  = Math.min(sy, pt.y);
  const hw = w / 2, hh = h / 2;
  const color = '#008000';

  // Ask for LF
  showModal('GRUBBING', [
    { key: 'LF', label: 'Linear Footage (LF)', type: 'number', placeholder: '0' },
  ], (values) => {
    const lf = parseFloat(values.LF) || 0;

    const rect = new fabric.Rect({
      left: -hw, top: -hh, width: w, height: h,
      fill: 'rgba(0,128,0,0.18)',
      stroke: color, strokeWidth: 2,
      strokeDashArray: [6, 4],
    });
    const diag1 = new fabric.Line([-hw, -hh,  hw,  hh], { stroke: color, strokeWidth: 1.5, opacity: 0.5 });
    const diag2 = new fabric.Line([ hw, -hh, -hw,  hh], { stroke: color, strokeWidth: 1.5, opacity: 0.5 });
    const lbl = new fabric.Text(`${lf} LF`, {
      fontSize: 13, fill: color, fontFamily: 'Arial', fontWeight: 'bold',
      originX: 'center', originY: 'center',
    });

    const group = new fabric.Group([rect, diag1, diag2, lbl], {
      left: left + hw, top: top + hh,
      originX: 'center', originY: 'center',
      opacity: 0.5,
    });

    group.nscData = {
      category: 'underground', key: 'GRUBBING', attrs: { LF: lf }, type: 'POINT',
    };

    const resolved = resolveSmartUnit('underground', 'GRUBBING', { LF: lf });

    canvas.add(group);
    storeUnitData(group, resolved);
    updateBillableUnits();
    setTool('SELECT');
    canvas.setActiveObject(group);
    canvas.renderAll();
    pushHistory();
  }, () => {
    setTool('SELECT');
  });
}

// ============================================================
// ============================================================
// RMV BURIED FACILITY — red dashed rect, 50% opacity, crosshatch + callout
// ============================================================
function startRmvBuriedDraw(pt) {
  state.drawingRmvBuried = true;
  state.rmvBuriedStart   = pt;
  const rect = new fabric.Rect({
    left: pt.x, top: pt.y, width: 0, height: 0,
    fill: 'rgba(200,0,0,0.12)', stroke: '#FF0000', strokeWidth: 2,
    strokeDashArray: [6, 4],
    selectable: false, evented: false, opacity: 0.8,
  });
  canvas.add(rect);
  state.previewRmvBuried = rect;
}

function finishRmvBuriedDraw(pt) {
  if (!state.drawingRmvBuried) return;
  canvas.remove(state.previewRmvBuried);
  state.drawingRmvBuried = false;
  state.previewRmvBuried = null;

  const sx = state.rmvBuriedStart.x, sy = state.rmvBuriedStart.y;
  const w  = Math.abs(pt.x - sx), h = Math.abs(pt.y - sy);
  if (w < 8 && h < 8) return;
  const left = Math.min(sx, pt.x);
  const top  = Math.min(sy, pt.y);
  const hw = w / 2, hh = h / 2;
  const color = '#FF0000';

  const attrs = getModalAttributes('removals', 'RMV_BURIED_FAC');
  showModal('RMV BURIED FACILITY', attrs, (values) => {
    const resolved = resolveSmartUnit('removals', 'RMV_BURIED_FAC', values);
    if (!resolved) return;

    const lf       = parseFloat(values.LF) || 0;
    const addlCover = values.AddlCover === true || values.AddlCover === 'true';
    const coverQty  = parseInt(values.CoverAddl) || 0;
    const addlFac   = values.AddlFac === true || values.AddlFac === 'true';

    // Build label lines
    const labelLines = [`RMV BURIED FAC`, `${lf} LF`];
    if (addlCover && coverQty > 0) labelLines.push(`+${coverQty}x 12in CVR`);
    if (addlFac) labelLines.push('+ ADDL FAC');

    // Rect
    const rect = new fabric.Rect({
      left: -hw, top: -hh, width: w, height: h,
      fill: 'rgba(200,0,0,0.12)',
      stroke: color, strokeWidth: 2,
      strokeDashArray: [6, 4],
    });

    // Crosshatch diagonals
    const diag1 = new fabric.Line([-hw, -hh,  hw,  hh], { stroke: color, strokeWidth: 1.2, opacity: 0.6 });
    const diag2 = new fabric.Line([ hw, -hh, -hw,  hh], { stroke: color, strokeWidth: 1.2, opacity: 0.6 });

    // Callout box — offset to the right
    const pad   = 7;
    const lineH = 13;
    const boxW  = 160;
    const boxH  = labelLines.length * lineH + pad * 2;
    const callX = hw + 20;
    const callY = -boxH / 2;

    const callRect = new fabric.Rect({
      left: callX, top: callY, width: boxW, height: boxH,
      fill: 'rgba(255,255,255,0.97)', stroke: color, strokeWidth: 1.5,
    });
    const leaderLine = new fabric.Line([hw, 0, callX, 0], {
      stroke: color, strokeWidth: 1,
    });
    const textObjs = labelLines.map((line, i) => new fabric.Text(line, {
      fontSize:   i === 0 ? 10 : 9,
      fontWeight: i === 0 ? 'bold' : 'normal',
      fill: color,
      fontFamily: 'Arial',
      left: callX + pad,
      top:  callY + pad + i * lineH,
    }));

    const group = new fabric.Group([rect, diag1, diag2, leaderLine, callRect, ...textObjs], {
      left: left + hw, top: top + hh,
      originX: 'center', originY: 'center',
      opacity: 0.5,
    });

    group.nscData = {
      category: 'removals', key: 'RMV_BURIED_FAC', attrs: values, type: 'RECT',
    };

    canvas.add(group);
    storeUnitData(group, resolved);
    updateBillableUnits();
    setTool('SELECT');
    canvas.setActiveObject(group);
    canvas.renderAll();
    pushHistory();
  }, () => {
    setTool('SELECT');
  });
}

// ============================================================
// UNIFIED XFERS TOOL
// Click on canvas → checklist modal → draggable callout with arrow
// ============================================================
function handleXfersClick(pt) {
  // Place a blue dot as anchor, then open the checklist modal
  if (state.xfersDot) { canvas.remove(state.xfersDot); state.xfersDot = null; }

  const dot = new fabric.Circle({
    left: pt.x, top: pt.y, radius: 6,
    fill: '#0000FF', stroke: '#ffffff', strokeWidth: 1.5,
    originX: 'center', originY: 'center', selectable: false, evented: false,
  });
  canvas.add(dot);
  state.xfersDot = dot;
  canvas.renderAll();

  openXfersModal(pt);
}

function openXfersModal(anchorPt) {
  // Build the modal HTML — checklist with qty inputs
  const items = [
    { key: 'POLE_ATTACH',      label: 'Pole Attachment',             code: 'XFER POLE ATTACHMENT',             qty: true  },
    { key: 'POLE_ATTACH_ADDL', label: 'Pole Attachment Additional',  code: 'XFER POLE ATTACHMENT ADDL',        qty: true  },
    { key: 'SVC_DROP',         label: 'Service Drop',                code: 'XFER SVC DROP',                    qty: true  },
    { key: 'SVC_DROP_ADDL',    label: 'Service Drop Additional',     code: 'XFER SVC DROP ADDL',               qty: true  },
    { key: 'SMALL_FAC',        label: 'Small Facility',              code: 'XFER SMALL FAC',                   qty: false },
    { key: 'LARGE_FAC',        label: 'Large Facility',              code: 'XFER LARGE FAC',                   qty: false },
    { key: 'DOWN_GUY',         label: 'Down Guy (10M)',              code: 'XFER DOWN GUY 10M',                qty: true  },
    { key: 'POLE_TAG',         label: 'Pole Tag',                   code: 'XFER POLE TAG',                    qty: false },
  ];

  // Build modal content
  const existing = document.getElementById('nsc-xfers-modal');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'nsc-xfers-modal';
  overlay.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9999;display:flex;align-items:center;justify-content:center;`;

  const box = document.createElement('div');
  box.style.cssText = `background:#fff;border-radius:12px;padding:24px 28px;min-width:360px;max-width:460px;box-shadow:0 8px 32px rgba(0,0,0,0.22);font-family:'Inter',sans-serif;`;

  box.innerHTML = `
    <div style="font-size:13px;font-weight:700;color:#1c1c1e;letter-spacing:.5px;text-transform:uppercase;margin-bottom:16px;">POLE TRANSFER — SELECT ITEMS</div>
    <div id="xfers-checklist" style="display:flex;flex-direction:column;gap:10px;">
      ${items.map(item => `
        <div style="display:flex;align-items:center;gap:10px;">
          <input type="checkbox" id="xfer-chk-${item.key}" data-key="${item.key}" style="width:16px;height:16px;cursor:pointer;accent-color:#0071e3;">
          <label for="xfer-chk-${item.key}" style="flex:1;font-size:12px;font-weight:500;color:#1c1c1e;cursor:pointer;">${item.label}</label>
          ${item.qty ? `<input type="number" id="xfer-qty-${item.key}" min="1" value="1" style="width:52px;padding:4px 6px;border:1px solid #d1d1d6;border-radius:6px;font-size:12px;font-family:'Inter',sans-serif;color:#1c1c1e;" placeholder="qty">` : ''}
        </div>
      `).join('')}
    </div>
    <div style="display:flex;gap:10px;margin-top:20px;justify-content:flex-end;">
      <button id="xfers-cancel" style="padding:8px 18px;border-radius:20px;border:none;background:#e5e5ea;color:#1c1c1e;font-size:12px;font-weight:600;cursor:pointer;font-family:'Inter',sans-serif;">Cancel</button>
      <button id="xfers-confirm" style="padding:8px 18px;border-radius:20px;border:none;background:#0071e3;color:#fff;font-size:12px;font-weight:600;cursor:pointer;font-family:'Inter',sans-serif;">Place</button>
    </div>
  `;

  overlay.appendChild(box);
  document.body.appendChild(overlay);

  // Cancel
  document.getElementById('xfers-cancel').onclick = () => {
    overlay.remove();
    if (state.xfersDot) { canvas.remove(state.xfersDot); state.xfersDot = null; }
    setTool('SELECT');
  };

  // Confirm
  document.getElementById('xfers-confirm').onclick = () => {
    const selected = [];
    items.forEach(item => {
      const chk = document.getElementById(`xfer-chk-${item.key}`);
      if (chk && chk.checked) {
        const qty = item.qty ? (parseInt(document.getElementById(`xfer-qty-${item.key}`)?.value) || 1) : 1;
        selected.push({ ...item, resolvedQty: qty });
      }
    });
    overlay.remove();
    if (selected.length === 0) {
      if (state.xfersDot) { canvas.remove(state.xfersDot); state.xfersDot = null; }
      setTool('SELECT');
      return;
    }
    placeXfersCallout(anchorPt, selected);
  };
}

function placeXfersCallout(anchorPt, selected) {
  if (state.xfersDot) { canvas.remove(state.xfersDot); state.xfersDot = null; }

  const color   = '#0000FF';
  const pad     = 8;
  const lineH   = 14;
  const bulletW = 6;

  // Build text lines
  const titleLine = 'POLE TRANSFER';
  const bulletLines = selected.map(item => {
    const qtyStr = item.qty ? ` ×${item.resolvedQty}` : '';
    return `• ${item.code}${qtyStr}`;
  });
  const allLines = [titleLine, ...bulletLines];

  // Measure box
  const longestLine = allLines.reduce((a, b) => (b.length > a.length ? b : a), '');
  const boxW = Math.max(200, longestLine.length * 6.2 + pad * 2);
  const boxH = allLines.length * lineH + pad * 2 + 4;

  // Arrow tip = 80px to the right of anchor
  const tipX = anchorPt.x + 80;
  const tipY = anchorPt.y;

  // Arrow
  const arrowLine = new fabric.Line([anchorPt.x, anchorPt.y, tipX, tipY], {
    stroke: color, strokeWidth: 2, selectable: false,
  });
  const angle = Math.atan2(tipY - anchorPt.y, tipX - anchorPt.x) * 180 / Math.PI;
  const arrowHead = new fabric.Triangle({
    width: 10, height: 12, fill: color,
    left: tipX, top: tipY, originX: 'center', originY: 'center', angle: angle + 90,
    selectable: false,
  });

  // Box
  const boxLeft = tipX + 6;
  const boxTop  = tipY - boxH / 2;
  const boxRect = new fabric.Rect({
    left: boxLeft, top: boxTop, width: boxW, height: boxH,
    fill: 'rgba(255,255,255,0.97)', stroke: color, strokeWidth: 1.5,
    rx: 3, ry: 3,
  });

  // Text objects
  const textObjs = allLines.map((line, i) => {
    const isTitle = i === 0;
    return new fabric.Text(line, {
      fontSize:   isTitle ? 10 : 9,
      fontWeight: isTitle ? 'bold' : 'normal',
      fill:       isTitle ? color : '#1c1c1e',
      fontFamily: 'Arial',
      left:  boxLeft + pad,
      top:   boxTop  + pad + i * lineH + (i > 0 ? 4 : 0),
    });
  });

  // Group everything — fully draggable as one unit
  const group = new fabric.Group([arrowLine, arrowHead, boxRect, ...textObjs], {
    selectable: true,
    hasControls: true,
    hasBorders: true,
  });

  // Store billing
  group.nscData = { category: 'xfers', key: 'XFERS', attrs: { selected }, type: 'XFERS' };

  // Build unit list for billing
  const units = selected.map(item => ({
    unit_code: item.code,
    desc:      item.code,
    type:      'LABOR',
    qty:       item.resolvedQty,
    unit:      'EA',
  }));
  const resolved = { unit_code: units[0]?.unit_code, qty: units[0]?.qty, unit: 'EA', extraUnits: units.slice(1), color };

  canvas.add(group);
  storeUnitData(group, resolved);
  updateBillableUnits();
  setTool('SELECT');
  canvas.setActiveObject(group);
  canvas.renderAll();
  pushHistory();
}

// POLY-LINE DRAW — Rod & Proof / Locate Sonde
// Multi-segment: click to add point, double-click to finish
// ============================================================
function polyLineAddPoint(pt) {
  const tool = state.activeTool; // 'ROD_PROOF' or 'LOC_SONDE'

  if (!state.polyLineTool) {
    // First click — initialise
    state.polyLineTool = tool;
    state.polyPoints   = [pt];
    state.polySegments = [];
    // Rubber-band preview line
    const preview = new fabric.Line([pt.x, pt.y, pt.x, pt.y], {
      stroke: '#0000CC', strokeWidth: 2, strokeDashArray: [8, 5],
      selectable: false, evented: false, opacity: 0.6,
    });
    canvas.add(preview);
    state.polyPreview = preview;
    canvas.renderAll();
    return;
  }

  // Subsequent clicks — lock in a segment
  const last = state.polyPoints[state.polyPoints.length - 1];
  const seg  = new fabric.Line([last.x, last.y, pt.x, pt.y], {
    stroke: '#0000CC', strokeWidth: 2, strokeDashArray: [8, 5],
    selectable: false, evented: false, opacity: 0.6,
  });
  canvas.add(seg);
  state.polySegments.push(seg);
  state.polyPoints.push(pt);
  canvas.renderAll();
}

function finishPolyLine(endPt) {
  if (!state.polyLineTool || state.polyPoints.length < 1) return;

  const tool   = state.polyLineTool;
  const points = [...state.polyPoints];

  // Remove all preview objects
  state.polySegments.forEach(s => canvas.remove(s));
  if (state.polyPreview) canvas.remove(state.polyPreview);
  state.polyLineTool = null;
  state.polyPoints   = [];
  state.polySegments = [];
  state.polyPreview  = null;

  // Need at least 2 distinct points
  if (points.length < 2) { setTool('SELECT'); canvas.renderAll(); return; }

  const isRnP     = tool === 'ROD_PROOF';
  const unitCode  = isRnP ? (false /* filled in modal */ ? 'ROD & PROOF EXISTING CONDUIT ISP' : 'ROD & PROOF EXISTING CONDUIT UG') : 'LOCATE CONDUIT USING A SONDE';
  const midLabel  = isRnP ? 'R&P' : 'LOC';
  const modalTitle = isRnP ? 'Rod & Proof' : 'Locate with Sonde';
  const color     = '#0000CC';

  const modalAttrs = [
    { key: 'Footage', label: 'Footage (LF)', type: 'number', placeholder: '0' },
  ];
  if (isRnP) {
    modalAttrs.push({ key: 'ISP', label: 'ISP (Inside Plant)', type: 'checkbox', defaultChecked: false });
  }

  showModal(modalTitle, modalAttrs, (values) => {
    const footage = parseFloat(values.Footage) || 0;
    const isISP   = isRnP && (values.ISP === true || values.ISP === 'true');
    const code    = isRnP
      ? (isISP ? 'ROD & PROOF EXISTING CONDUIT ISP' : 'ROD & PROOF EXISTING CONDUIT UG')
      : 'LOCATE CONDUIT USING A SONDE';

    const objs = [];

    // Build segments between each consecutive point pair
    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i], p2 = points[i + 1];
      const segLine = new fabric.Line([p1.x, p1.y, p2.x, p2.y], {
        stroke: color, strokeWidth: 2, strokeDashArray: [8, 5],
      });
      objs.push(segLine);

      // Intermittent labels every 80px along this segment
      const dx  = p2.x - p1.x, dy = p2.y - p1.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx) * 180 / Math.PI;
      const step  = 80;
      const num   = Math.max(1, Math.floor(len / step));
      for (let j = 1; j <= num; j++) {
        const t  = j / (num + 1);
        const mx = p1.x + dx * t;
        const my = p1.y + dy * t;
        objs.push(new fabric.Text(midLabel, {
          left: mx, top: my,
          fontSize: 9, fill: color, fontFamily: 'Arial', fontWeight: 'bold',
          originX: 'center', originY: 'center',
          angle: angle,
        }));
      }
    }

    const group = new fabric.Group(objs, { opacity: 0.5 });
    group.nscData = { category: 'underground', key: tool, attrs: values, type: 'LINE' };

    const resolved = resolveSmartUnit('underground', tool, values);

    canvas.add(group);
    storeUnitData(group, resolved);
    updateBillableUnits();
    setTool('SELECT');
    canvas.setActiveObject(group);
    canvas.renderAll();
    pushHistory();
  }, () => {
    setTool('SELECT');
    canvas.renderAll();
  });
}

// ============================================================
// TEXT
// ============================================================
function placeText(pt) {
  const PAD = 10;  // padding inside the border
  const defaultText = 'Text';
  const fontSize = 14;

  // Create the editable text
  const itext = new fabric.IText(defaultText, {
    left: PAD, top: PAD,
    fontSize,
    fill: state.toolColor,
    fontFamily: 'Arial',
    editable: true,
  });

  // Measure text to size the border rect
  const textW = itext.width  || 60;
  const textH = itext.height || 20;

  // Border rectangle
  const border = new fabric.Rect({
    left: 0, top: 0,
    width:  textW + PAD * 2,
    height: textH + PAD * 2,
    fill: 'transparent',
    stroke: state.toolColor,
    strokeWidth: state.toolStroke,
    rx: 2, ry: 2,
  });

  // Group them together
  const group = new fabric.Group([border, itext], {
    left: pt.x,
    top:  pt.y,
    subTargetCheck: true,   // allow clicking inside group
    lockScalingFlip: true,
  });

  // Double-click to enter editing mode
  group.on('mousedblclick', () => {
    // Ungroup, enter editing, re-group on exit
    const items  = group.getObjects();
    const grpLeft = group.left;
    const grpTop  = group.top;
    canvas.remove(group);

    const rect = items[0];
    const txt  = items[1];

    // Restore absolute positions
    rect.set({ left: grpLeft, top: grpTop, selectable: true });
    txt.set({
      left: grpLeft + PAD,
      top:  grpTop  + PAD,
      selectable: true,
    });

    canvas.add(rect);
    canvas.add(txt);
    canvas.setActiveObject(txt);
    txt.enterEditing();
    txt.selectAll();

    // Re-group when editing ends
    txt.on('editing:exited', () => {
      canvas.remove(rect);
      canvas.remove(txt);

      const newW = txt.width  || 60;
      const newH = txt.height || 20;
      rect.set({ width: newW + PAD * 2, height: newH + PAD * 2 });

      const newGroup = new fabric.Group([rect, txt], {
        left: grpLeft,
        top:  grpTop,
        subTargetCheck: true,
        lockScalingFlip: true,
      });

      // Carry over stroke/color changes
      newGroup.on('mousedblclick', arguments.callee);

      canvas.add(newGroup);
      canvas.setActiveObject(newGroup);
      canvas.renderAll();
    });

    canvas.renderAll();
  });

  canvas.add(group);
  canvas.setActiveObject(group);
  canvas.renderAll();
  setTool('SELECT');
}

// ============================================================
// TELECOM TOOLS — MOUSE DOWN ROUTER
// ============================================================
function handleTelecomMouseDown(pt, opt) {
  // Don't start draw if user clicks an existing object (except during active line draw)
  if (opt.target && opt.target !== state.previewLine && !state.drawingLine && state.xferStep === 0) return;

  const type = state.activeType;

  if (type === 'MODAL_ONLY') {
    // T&E / Downtime: open modal immediately, no canvas click needed
    // This branch shouldn't fire via canvas click — handled via button
    return;
  }

  // XFERS — click a point on canvas, then open checklist modal
  if (state.activeTool === 'XFERS' || state.xfersMode) {
    handleXfersClick(pt);
    return;
  }

  // RMV_BURIED_FAC — drag red crosshatch rect
  if (state.activeKey === 'RMV_BURIED_FAC') {
    if (!state.drawingRmvBuried) {
      startRmvBuriedDraw(pt);
    } else {
      finishRmvBuriedDraw(pt);
    }
    return;
  }

  if (type === 'POINT') {
    placeTelecomPoint(pt);
    return;
  }

  if (type === 'ARROW_CALLOUT') {
    // Two-click: step 1 = arrow start, step 2 = arrow end + callout
    handleXferClick(pt);
    return;
  }

  // LINE / ARROW / ANCHOR
  if (!state.drawingLine) {
    state.drawingLine = true;
    state.lineStart   = pt;
    const dashArray   = getTelecomDashArray();
    const preview     = new fabric.Line([pt.x, pt.y, pt.x, pt.y], {
      stroke: getTelecomLineColor(), strokeWidth: getTelecomLineWidth(),
      strokeDashArray: dashArray, selectable: false, evented: false, opacity: 0.6,
    });
    canvas.add(preview);
    state.previewLine = preview;
  } else {
    canvas.remove(state.previewLine);
    state.previewLine = null;
    state.drawingLine = false;
    placeTelecomLine(state.lineStart, pt);
  }
}

// ============================================================
// TRANSFER / XFER — Two-click arrow + callout
// ============================================================
function handleXferClick(pt) {
  if (state.xferStep === 0) {
    // First click: open modal to get attributes, wait
    const category = state.activeCategory;
    const key      = state.activeKey;
    const attrs    = getModalAttributes(category, key);

    showModal(key + ' Attributes', attrs, (values) => {
      state.xferAttrs = values;
      state.xferStart = pt;
      state.xferStep  = 1;
      // Visual cue: small dot
      const dot = new fabric.Circle({
        left: pt.x, top: pt.y, radius: 5, fill: '#0000FF',
        originX: 'center', originY: 'center', selectable: false, evented: false,
      });
      canvas.add(dot);
      state._xferDot = dot;
      canvas.renderAll();
    }, () => { /* discard — do nothing */ });
  } else {
    // Second click: draw arrow + callout box
    if (state._xferDot) canvas.remove(state._xferDot);
    state.xferStep = 0;

    const p1   = state.xferStart;
    const p2   = pt;
    const attrs = state.xferAttrs || {};
    state.xferAttrs = null;

    const resolved = resolveSmartUnit(state.activeCategory, state.activeKey, attrs);
    if (!resolved) return;

    const color      = resolved.color || '#0000FF';
    const calloutTxt = resolved.calloutText || state.activeKey;

    // Arrow line + head
    const angle     = Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180 / Math.PI;
    const arrowLine = new fabric.Line([p1.x, p1.y, p2.x, p2.y], {
      stroke: color, strokeWidth: 2,
    });
    const arrowHead = new fabric.Triangle({
      width: 12, height: 14, fill: color, stroke: 'none',
      left: p2.x, top: p2.y, originX: 'center', originY: 'center', angle: angle + 90,
    });

    // Callout box
    const pad   = 6;
    const cbLabel = new fabric.Text(calloutTxt, {
      fontSize: 10, fill: color, fontFamily: 'Arial', fontWeight: 'bold',
      originX: 'left', originY: 'top',
    });
    const cbW = cbLabel.width  + pad * 2;
    const cbH = cbLabel.height + pad * 2;
    const cbRect = new fabric.Rect({
      width: cbW, height: cbH,
      fill: 'rgba(255,255,255,0.9)', stroke: color, strokeWidth: 1.5,
      left: p2.x + 8, top: p2.y - cbH / 2,
    });
    const cbText = new fabric.Text(calloutTxt, {
      fontSize: 10, fill: color, fontFamily: 'Arial', fontWeight: 'bold',
      left: p2.x + 8 + pad, top: p2.y - cbH / 2 + pad,
    });

    const group = new fabric.Group([arrowLine, arrowHead, cbRect, cbText]);
    group.nscData = { category: state.activeCategory, key: state.activeKey, attrs, type: 'XFER' };
    canvas.add(group);
    canvas.setActiveObject(group);

    storeUnitData(group, resolved);
    updateBillableUnits();
    pushHistory();
  }
}

// ============================================================
// TELECOM LINE COLOR / WIDTH / DASH
// ============================================================
function getTelecomLineColor() {
  const key = state.activeKey;
  if (!key) return '#000000';
  if (key.startsWith('RMV_') || key === 'STRAND_10M' && false) return '#00AA00';
  switch (key) {
    case 'TRENCH':       return '#8B4513';
    case 'BORE':         return '#8B4513';
    case 'DE_RE':        return '#A020F0';
    case 'RE_TENSION':
    case 'DOWN_GUY':     return '#FF0000';
    case 'STRAND_10M':   return '#000000';
    // Removal lines
    case 'RMV_AER_COPPER':
    case 'RMV_UG_COPPER':
    case 'RMV_AER_FIBER':
    case 'RMV_UG_FIBER':
    case 'RMV_FIBER':
    case 'RMV_COPPER':
    case 'RMV_ASW':
    case 'RMV_BSW': return '#00AA00';
    case 'TREE_TRIM':  return '#228B22';
    default:             return '#000000';
  }
}

function getTelecomLineWidth() {
  switch (state.activeKey) {
    case 'STRAND_10M': return 3;
    case 'TRENCH':     return 4;
    case 'BORE':       return 3;
    default:           return 2;
  }
}

function getTelecomDashArray() {
  switch (state.activeKey) {
    case 'STRAND_10M': return [12, 6];
    case 'BORE':       return [8, 4];
    default:           return null;
  }
}

// ============================================================
// REMOVAL X MARKS along a line
// Place green X glyphs every 40px along the line
// ============================================================
function buildRemovalXMarks(p1, p2, color) {
  const marks = [];
  const dx    = p2.x - p1.x;
  const dy    = p2.y - p1.y;
  const len   = Math.sqrt(dx * dx + dy * dy);
  const step  = 40;
  const num   = Math.max(1, Math.floor(len / step));

  for (let i = 1; i <= num; i++) {
    const t  = i / (num + 1);
    const mx = p1.x + dx * t;
    const my = p1.y + dy * t;
    const x  = new fabric.Text('X', {
      left: mx, top: my,
      fontSize: 11, fill: color, fontFamily: 'Arial', fontWeight: 'bold',
      originX: 'center', originY: 'center',
      selectable: false, evented: false,
    });
    marks.push(x);
  }
  return marks;
}

// ============================================================
// TELECOM POINT PLACEMENT
// ============================================================
function placeTelecomPoint(pt) {
  const key      = state.activeKey;
  const category = state.activeCategory;

  // Determine initial color before modal
  const defaultColor = key.startsWith('RMV_') ? '#00AA00' : '#000000';
  const group = buildSymbolGroup(key, pt, defaultColor);
  if (!group) return;

  group.nscData = { category, key, attrs: {}, type: 'POINT' };
  canvas.add(group);
  canvas.setActiveObject(group);

  const attrs = getModalAttributes(category, key);

  if (attrs && attrs.length > 0) {
    showModal(key + ' Attributes', attrs, (values) => {
      const resolved = resolveSmartUnit(category, key, values);
      if (resolved) {
        applyColorToGroup(group, resolved.color);
        if (resolved.label) applyLabelToGroup(group, resolved.label);

        // Change 3: StructLabel auto-label
        if (values.StructLabel && values.StructLabel.trim()) {
          const statusColor = _statusColor(values.Status || values.Condition || 'EXISTING', resolved.color);
          const structLbl = new fabric.Text(values.StructLabel.trim(), {
            fontSize: 11, fill: statusColor, fontFamily: 'Arial',
            left: 18, top: 4,
          });
          // Add label to a new group wrapping the existing group
          const objs = [...group.getObjects(), structLbl];
          const gLeft = group.left, gTop = group.top;
          canvas.remove(group);
          const newGroup = new fabric.Group(objs, { left: gLeft, top: gTop, originX: 'center', originY: 'center' });
          newGroup.nscData = group.nscData;
          newGroup.nscData.attrs = values;
          canvas.add(newGroup);
          storeUnitData(newGroup, resolved);
          updateBillableUnits();
          pushHistory();
          setTool('SELECT');
          canvas.setActiveObject(newGroup);
          canvas.renderAll();
          return;
        }
      }
      group.nscData.attrs = values;
      storeUnitData(group, resolved);
      updateBillableUnits();
      pushHistory();
      // Drop to SELECT after placing telecom point
      setTool('SELECT');
      canvas.setActiveObject(group);
      canvas.renderAll();
    }, () => {
      canvas.remove(group);
      canvas.renderAll();
    });
  } else {
    const resolved = resolveSmartUnit(category, key, {});
    if (resolved) applyColorToGroup(group, resolved.color);
    storeUnitData(group, resolved);
    updateBillableUnits();
    pushHistory();
    setTool('SELECT');
    canvas.setActiveObject(group);
    canvas.renderAll();
  }
}

// Helper: get status color
function _statusColor(status, fallback) {
  const s = (status || '').toUpperCase();
  if (s === 'NEW')      return '#FF0000';
  if (s === 'REMOVE')   return '#00AA00';
  if (s === 'EXISTING') return '#000000';
  return fallback || '#000000';
}

// ============================================================
// TELECOM LINE PLACEMENT
// ============================================================
function placeTelecomLine(p1, p2) {
  const key      = state.activeKey;
  const category = state.activeCategory;
  const lineColor = getTelecomLineColor();
  const lineW     = getTelecomLineWidth();
  const dashArray = getTelecomDashArray();
  const type      = state.activeType;

  const dx        = p2.x - p1.x;
  const dy        = p2.y - p1.y;
  const lengthPx  = Math.sqrt(dx * dx + dy * dy);
  const autoFootage = Math.round(lengthPx * 0.8);

  const objs = [];
  const line  = new fabric.Line([p1.x, p1.y, p2.x, p2.y], {
    stroke: lineColor, strokeWidth: lineW, strokeDashArray: dashArray,
  });
  objs.push(line);

  // Cable marker label along line
  const markerLabel = getCableMarkerLabel(key);
  if (markerLabel) {
    const markerStep = 200;
    const numMarkers = Math.floor(lengthPx / markerStep);
    for (let i = 1; i <= numMarkers; i++) {
      const t  = (i * markerStep) / lengthPx;
      const mx = p1.x + dx * t;
      const my = p1.y + dy * t;
      objs.push(new fabric.IText(markerLabel, {
        left: mx, top: my - 10, fontSize: 9, fill: lineColor,
        fontFamily: 'Arial', fontWeight: 'bold',
        originX: 'center', originY: 'center', selectable: false, evented: false,
      }));
    }
  }

  // Tree icons along TREE_TRIM line
  if (key === 'TREE_TRIM') {
    const treeStep = 150;
    const numTrees = Math.max(1, Math.floor(lengthPx / treeStep));
    for (let i = 1; i <= numTrees; i++) {
      const t  = (i * treeStep) / (lengthPx + treeStep * 0.5);
      if (t > 1) break;
      const tx = p1.x + dx * t;
      const ty = p1.y + dy * t;
      // Canopy — two stacked triangles
      const tri1 = new fabric.Triangle({ width: 22, height: 14, fill: '#228B22', stroke: 'none', left: tx, top: ty - 18, originX: 'center', originY: 'center', selectable: false, evented: false });
      const tri2 = new fabric.Triangle({ width: 18, height: 12, fill: '#1a6e1a', stroke: 'none', left: tx, top: ty - 9,  originX: 'center', originY: 'center', selectable: false, evented: false });
      // Trunk
      const trunk = new fabric.Rect({ width: 5, height: 7, fill: '#8B4513', stroke: 'none', left: tx - 2.5, top: ty - 2, selectable: false, evented: false });
      objs.push(tri1, tri2, trunk);
    }
  }

  // Arrow head for ARROW type (RE_TENSION, DOWN_GUY)
  if (type === 'ARROW') {
    const angle = Math.atan2(dy, dx) * 180 / Math.PI;
    objs.push(new fabric.Triangle({
      width: 12, height: 14, fill: lineColor, stroke: 'none',
      left: p2.x, top: p2.y, originX: 'center', originY: 'center', angle: angle + 90,
    }));
  }

  // Anchor base for ANCHOR type
  if (type === 'ANCHOR') {
    objs.push(new fabric.Line([p2.x - 12, p2.y, p2.x + 12, p2.y], {
      stroke: lineColor, strokeWidth: lineW + 1,
    }));
    objs.push(new fabric.Triangle({
      width: 12, height: 14, fill: lineColor,
      left: p1.x, top: p1.y, originX: 'center', originY: 'center',
      angle: (Math.atan2(p1.y - p2.y, p1.x - p2.x) * 180 / Math.PI) + 90,
    }));
  }

  const group = new fabric.Group(objs);
  group.nscData = { category, key, attrs: {}, type: 'LINE', footage: autoFootage };
  canvas.add(group);
  canvas.setActiveObject(group);

  const modalAttrs = getModalAttributes(category, key);
  if (modalAttrs && modalAttrs.length > 0) {
    // Pre-fill footage
    const fa = modalAttrs.find(a => a.key === 'footage' || a.key === 'Footage');
    if (fa) fa._default = String(autoFootage);

    showModal(key + ' Attributes', modalAttrs, (values) => {
      if (!values.footage && !values.Footage) values.footage = String(autoFootage);
      group.nscData.attrs = values;

      const resolved = resolveSmartUnit(category, key, values);
      if (resolved) {
        // Re-color line and objects
        const col = resolved.color || lineColor;
        group.getObjects().forEach(o => {
          if (o.stroke && o.stroke !== 'none') o.set('stroke', col);
          if (o.fill && o.fill !== 'transparent' && o.fill !== 'none') o.set('fill', col);
        });

        // Add label at midpoint
        if (resolved.label) {
          const mx = (p1.x + p2.x) / 2;
          const my = (p1.y + p2.y) / 2;
          const lbl = new fabric.IText(resolved.label, {
            left: mx, top: my - 14, fontSize: 10, fill: col,
            fontFamily: 'Arial', fontWeight: 'bold',
            originX: 'center', originY: 'center',
          });
          canvas.add(lbl);
        }

        // Removal X marks — add as separate objects (not in group so they stay visible)
        if (resolved.removeXMarks) {
          const marks = buildRemovalXMarks(p1, p2, '#00AA00');
          marks.forEach(m => canvas.add(m));
        }

        // Change 6: Trench Detail Callout
        if (key === 'TRENCH' && resolved.trenchDetail) {
          placeTrenchDetailCallout(p1, p2, resolved.trenchDetail, col);
        }
      }

      // Change 2: Cable Sequentials — Wall/Tail labels + pole/struct seq labels
      _placeCableSeqLabels(p1, p2, values, resolved ? (resolved.color || lineColor) : lineColor);

      // Change 7: Mid-Line Footage Label
      _placeMidLineFootageLabel(p1, p2, values, resolved ? (resolved.color || lineColor) : lineColor);

      storeUnitData(group, resolved);
      updateBillableUnits();
      pushHistory();
      // Drop to SELECT after telecom line placed
      setTool('SELECT');
      canvas.setActiveObject(group);
      canvas.renderAll();
    }, () => {
      canvas.remove(group);
      canvas.renderAll();
    });
  } else {
    const resolved = resolveSmartUnit(category, key, {});
    if (resolved && resolved.removeXMarks) {
      const marks = buildRemovalXMarks(p1, p2, '#00AA00');
      marks.forEach(m => canvas.add(m));
    }
    storeUnitData(group, resolved);
    updateBillableUnits();
    pushHistory();
  }
}

// ============================================================
// CHANGE 2 — Cable Sequential Labels
// ============================================================
function _placeCableSeqLabels(p1, p2, values, lineColor) {
  const isCable = ['FIBER_CABLE', 'COPPER_CABLE', 'ASW', 'BSW', 'RMV_FIBER', 'RMV_COPPER', 'RMV_ASW', 'RMV_BSW', 'TREE_TRIM'].includes(state.activeKey);
  if (!isCable) return;

  const labelObjs = [];

  // Wall (start) label
  if (values.WallSeq && values.WallSeq.trim()) {
    const wLbl = new fabric.Text(`W: ${values.WallSeq.trim()}`, {
      left: p1.x - 8, top: p1.y - 18,
      fontSize: 11, fill: '#333333', fontFamily: 'Arial',
      originX: 'right', originY: 'bottom',
    });
    labelObjs.push(wLbl);
  }

  // Tail (end) label
  if (values.TailSeq && values.TailSeq.trim()) {
    const tLbl = new fabric.Text(`T: ${values.TailSeq.trim()}`, {
      left: p2.x + 8, top: p2.y - 18,
      fontSize: 11, fill: '#333333', fontFamily: 'Arial',
      originX: 'left', originY: 'bottom',
    });
    labelObjs.push(tLbl);
  }

  // Pole or Structure sequentials
  const seqRaw = values.PoleSeqs || values.StructSeqs || '';
  if (seqRaw && seqRaw.trim()) {
    const lines = seqRaw.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const mx = (p1.x + p2.x) / 2;
    const my = (p1.y + p2.y) / 2;
    lines.forEach((ln, i) => {
      // Format: "NAME = SEQ" or just text
      const parts = ln.split('=');
      let labelText;
      if (parts.length >= 2) {
        labelText = `${parts[0].trim()}: ${parts[1].trim()}`;
      } else {
        labelText = ln;
      }
      const vertOffset = (i - Math.floor(lines.length / 2)) * 14;
      const seqLbl = new fabric.Text(labelText, {
        left: mx,
        top:  my + 14 + vertOffset,
        fontSize: 10, fill: '#555555', fontFamily: 'Arial',
        originX: 'center', originY: 'top',
      });
      labelObjs.push(seqLbl);
    });
  }

  // Add all labels as independent objects
  labelObjs.forEach(o => canvas.add(o));
}

// ============================================================
// CHANGE 6 — Trench Detail Callout
// ============================================================
function placeTrenchDetailCallout(p1, p2, detail, trenchColor) {
  if (!detail) return;

  // Build callout lines
  const lines = [];

  const L = detail.Length   || '';
  const W = detail.Width    || '';
  const D = detail.Depth    || '';

  if (L || W || D) {
    const dims = [L, W, D].filter(v => v).join("' x ");
    lines.push(`Trench: ${dims}'`);
  }

  if (detail.Backfill && detail.Backfill.trim()) lines.push(`Backfill: ${detail.Backfill.trim()} yds`);
  if (detail.Spoils   && detail.Spoils.trim())   lines.push(`Spoils: ${detail.Spoils.trim()} yds`);
  if (detail.ColdMix  && detail.ColdMix.trim())  lines.push(`Cold Mix: ${detail.ColdMix.trim()} yds`);
  if (detail.MatNotes && detail.MatNotes.trim())  lines.push(detail.MatNotes.trim());

  if (lines.length === 0) return;

  const mx = (p1.x + p2.x) / 2;
  const my = (p1.y + p2.y) / 2;
  const boxX = mx + 30;
  const boxY = my - 40;

  const pad   = 8;
  const lineH = 14;
  const boxW  = 200;
  const boxH  = lines.length * lineH + pad * 2;

  const brownColor = '#8B4513';

  const boxRect = new fabric.Rect({
    left: -boxW / 2, top: -boxH / 2,
    width: boxW, height: boxH,
    fill: '#fffef0', stroke: brownColor, strokeWidth: 1,
  });

  const textObjs = lines.map((ln, i) => new fabric.Text(ln, {
    left: -boxW / 2 + pad, top: -boxH / 2 + pad + i * lineH,
    fontSize: 11, fill: brownColor, fontFamily: 'Arial',
  }));

  // Leader line from midpoint to box
  const leaderLine = new fabric.Line([mx, my, boxX, boxY], {
    stroke: brownColor, strokeWidth: 1,
  });

  const calloutGroup = new fabric.Group([leaderLine, boxRect, ...textObjs], {
    left: boxX,
    top:  boxY,
    originX: 'center',
    originY: 'center',
  });

  canvas.add(calloutGroup);
}

// ============================================================
// CHANGE 7 — Mid-Line Footage Label
// ============================================================
function _placeMidLineFootageLabel(p1, p2, values, lineColor) {
  if (!values.FootageLabel || !values.FootageLabel.trim()) return;

  const dx    = p2.x - p1.x;
  const dy    = p2.y - p1.y;
  const mx    = (p1.x + p2.x) / 2;
  const my    = (p1.y + p2.y) / 2;
  const angle = Math.atan2(dy, dx) * 180 / Math.PI;

  const lbl = new fabric.Text(values.FootageLabel.trim(), {
    left: mx, top: my,
    fontSize: 11,
    fill: lineColor,
    fontFamily: 'Arial',
    originX: 'center', originY: 'center',
    angle: angle,
    backgroundColor: '#ffffff',
  });

  canvas.add(lbl);
}

// ============================================================
// SYMBOL GROUP BUILDERS
// ============================================================
function buildSymbolGroup(key, pt, color) {
  color = color || '#000000';
  const x = pt.x, y = pt.y;

  switch (key) {

    // ---- POLE (circle with X) ----
    case 'POLE':
    case 'RMV_POLE': {
      const r = 18;
      const circle = new fabric.Circle({ radius: r, fill: 'transparent', stroke: color, strokeWidth: 2, originX: 'center', originY: 'center' });
      const d1 = new fabric.Line([-r*0.7, -r*0.7,  r*0.7,  r*0.7], { stroke: color, strokeWidth: 2 });
      const d2 = new fabric.Line([ r*0.7, -r*0.7, -r*0.7,  r*0.7], { stroke: color, strokeWidth: 2 });
      const lbl = new fabric.Text('POLE', { fontSize: 10, fill: color, fontFamily: 'Arial', fontWeight: 'bold', top: r + 4, originX: 'center', originY: 'top' });
      return new fabric.Group([circle, d1, d2, lbl], { left: x, top: y, originX: 'center', originY: 'center' });
    }

    // ---- HH — rectangle 40×25 with "HH" centered ----
    case 'HH': {
      const w = 60, h = 38;
      const rect = new fabric.Rect({ width: w, height: h, fill: 'transparent', stroke: color, strokeWidth: 2, originX: 'center', originY: 'center' });
      const lbl  = new fabric.Text('HH', { fontSize: 16, fill: color, fontFamily: 'Arial', fontWeight: 'bold', originX: 'center', originY: 'center' });
      return new fabric.Group([rect, lbl], { left: x, top: y, originX: 'center', originY: 'center' });
    }

    // ---- MH — circle radius 16 with "MH" centered ----
    case 'MH': {
      const r = 26;
      const circle = new fabric.Circle({ radius: r, fill: 'transparent', stroke: color, strokeWidth: 2, originX: 'center', originY: 'center' });
      const lbl    = new fabric.Text('MH', { fontSize: 16, fill: color, fontFamily: 'Arial', fontWeight: 'bold', originX: 'center', originY: 'center' });
      return new fabric.Group([circle, lbl], { left: x, top: y, originX: 'center', originY: 'center' });
    }

    // ---- PEDESTAL — 20×20 square with two diagonal lines (X) ----
    case 'PEDESTAL': {
      const s = 36;
      const rect = new fabric.Rect({ width: s, height: s, fill: 'transparent', stroke: color, strokeWidth: 2, originX: 'center', originY: 'center' });
      const d1   = new fabric.Line([-s/2, -s/2,  s/2,  s/2], { stroke: color, strokeWidth: 1.5 });
      const d2   = new fabric.Line([ s/2, -s/2, -s/2,  s/2], { stroke: color, strokeWidth: 1.5 });
      const lbl  = new fabric.Text('PED', { fontSize: 10, fill: color, fontFamily: 'Arial', fontWeight: 'bold', top: s/2 + 4, originX: 'center', originY: 'top' });
      return new fabric.Group([rect, d1, d2, lbl], { left: x, top: y, originX: 'center', originY: 'center' });
    }

    // ---- SPLICE_PIT — dashed-border rect with crosshatch interior ----
    case 'SPLICE_PIT': {
      const s  = 48;
      const h2 = s / 2;
      const rect = new fabric.Rect({
        width: s, height: s, fill: 'transparent', stroke: color,
        strokeWidth: 2, strokeDashArray: [4, 4], originX: 'center', originY: 'center',
      });
      // crosshatch: two diagonal lines
      const h1 = new fabric.Line([-h2, -h2, h2, h2], { stroke: color, strokeWidth: 1.5 });
      const h3 = new fabric.Line([ h2, -h2, -h2, h2], { stroke: color, strokeWidth: 1.5 });
      return new fabric.Group([rect, h1, h3], { left: x, top: y, originX: 'center', originY: 'center' });
    }

    // ---- MH_GRADE_ADJ — arrow pointing to callout ----
    case 'MH_GRADE_ADJ': {
      const rect = new fabric.Rect({
        width: 140, height: 22, fill: 'rgba(255,255,255,0.9)', stroke: color,
        strokeWidth: 1.5, left: 20, top: -11,
      });
      const lbl = new fabric.Text('MH GRADE ADJ', { fontSize: 13, fill: color, fontFamily: 'Arial', fontWeight: 'bold', left: 46, top: -9 });
      const arrow = new fabric.Triangle({ width: 10, height: 12, fill: color, angle: -90, left: 8, top: -6, originX: 'center', originY: 'center' });
      return new fabric.Group([arrow, rect, lbl], { left: x, top: y, originX: 'center', originY: 'center' });
    }

    // ---- ANCHOR — filled diamond ----
    case 'ANCHOR':
    case 'RMV_ANCHOR': {
      const sq = new fabric.Rect({ width: 14, height: 14, fill: color, stroke: color, strokeWidth: 1, originX: 'center', originY: 'center', angle: 45 });
      return new fabric.Group([sq], { left: x, top: y, originX: 'center', originY: 'center' });
    }

    // ---- SPLICE_WIZARD — diamond (rotated square) ----
    case 'SPLICE_WIZARD': {
      const sq  = new fabric.Rect({ width: 22, height: 22, fill: 'transparent', stroke: color, strokeWidth: 2, originX: 'center', originY: 'center', angle: 45 });
      const lbl = new fabric.Text('SPL', { fontSize: 12, fill: color, fontFamily: 'Arial', fontWeight: 'bold', originX: 'center', originY: 'center' });
      return new fabric.Group([sq, lbl], { left: x, top: y, originX: 'center', originY: 'center' });
    }

    // ---- RISER — vertical line with bracket at bottom ----
    case 'RISER': {
      const vLine  = new fabric.Line([0, -20, 0, 20], { stroke: color, strokeWidth: 2 });
      const bLeft  = new fabric.Line([-8, 20, 0, 20], { stroke: color, strokeWidth: 2 });
      const bRight = new fabric.Line([0, 20, 8, 20],  { stroke: color, strokeWidth: 2 });
      const lbl    = new fabric.Text('RSR', { fontSize: 7, fill: color, fontFamily: 'Arial', fontWeight: 'bold', left: 10, top: -4 });
      return new fabric.Group([vLine, bLeft, bRight, lbl], { left: x, top: y, originX: 'center', originY: 'center' });
    }

    // ---- GROUND_ROD — ground symbol (⏚) ----
    case 'GROUND_ROD': {
      const vert  = new fabric.Line([0, -14, 0, 0],    { stroke: color, strokeWidth: 2 });
      const g1    = new fabric.Line([-10, 0,  10, 0],   { stroke: color, strokeWidth: 2 });
      const g2    = new fabric.Line([-6,  5,  6,  5],   { stroke: color, strokeWidth: 2 });
      const g3    = new fabric.Line([-2,  10, 2,  10],  { stroke: color, strokeWidth: 2 });
      return new fabric.Group([vert, g1, g2, g3], { left: x, top: y, originX: 'center', originY: 'center' });
    }

    // ---- SNOWSHOE — rectangle with lines off each side ----
    case 'SNOWSHOE': {
      const rect  = new fabric.Rect({ width: 20, height: 12, fill: 'transparent', stroke: color, strokeWidth: 2, originX: 'center', originY: 'center' });
      const lLeft  = new fabric.Line([-16, 0, -10, 0], { stroke: color, strokeWidth: 2 });
      const lRight = new fabric.Line([ 10, 0,  16, 0], { stroke: color, strokeWidth: 2 });
      const lUp    = new fabric.Line([0, -10, 0, -6], { stroke: color, strokeWidth: 2 });
      const lDown  = new fabric.Line([0,  6,  0, 10], { stroke: color, strokeWidth: 2 });
      return new fabric.Group([rect, lLeft, lRight, lUp, lDown], { left: x, top: y, originX: 'center', originY: 'center' });
    }

    // ---- TERMINAL — small square with "T" inside ----
    case 'TERMINAL': {
      const s    = 16;
      const rect = new fabric.Rect({ width: s, height: s, fill: 'transparent', stroke: color, strokeWidth: 2, originX: 'center', originY: 'center' });
      const lbl  = new fabric.Text('T', { fontSize: 14, fill: color, fontFamily: 'Arial', fontWeight: 'bold', originX: 'center', originY: 'center' });
      return new fabric.Group([rect, lbl], { left: x, top: y, originX: 'center', originY: 'center' });
    }

    // ---- POTHOLE — bold brown circle with capital "P" centered ----
    case 'POTHOLE':
    case 'POTHOLE_CIRCLE': {
      const pColor = '#8B4513'; // always brown
      const r = 18;
      const circle = new fabric.Circle({
        radius: r, fill: 'transparent', stroke: pColor,
        strokeWidth: 4, originX: 'center', originY: 'center',
      });
      const lbl = new fabric.Text('P', {
        fontSize: 30, fill: pColor, fontFamily: 'Arial', fontWeight: 'bold',
        originX: 'center', originY: 'center',
      });
      return new fabric.Group([circle, lbl], { left: x, top: y, originX: 'center', originY: 'center' });
    }

    default: {
      const circle = new fabric.Circle({ radius: 20, fill: 'transparent', stroke: color, strokeWidth: 2, originX: 'center', originY: 'center' });
      const abbr   = (key || '?').substring(0, 3);
      const lbl    = new fabric.Text(abbr, { fontSize: 13, fill: color, fontFamily: 'Arial', fontWeight: 'bold', originX: 'center', originY: 'center' });
      return new fabric.Group([circle, lbl], { left: x, top: y, originX: 'center', originY: 'center' });
    }
  }
}

// ============================================================
// COLOR / LABEL HELPERS
// ============================================================
function applyColorToGroup(group, color) {
  if (!group || !color) return;
  group.getObjects().forEach(obj => {
    if (obj.stroke && obj.stroke !== 'none')   obj.set('stroke', color);
    if (obj.fill   && obj.fill !== 'transparent' && obj.fill !== 'none') obj.set('fill', color);
  });
  canvas.renderAll();
}

function applyLabelToGroup(group, labelText) {
  const existing = group.getObjects().find(o => o.type === 'text' || o.type === 'i-text');
  if (existing) existing.set('text', labelText);
  canvas.renderAll();
}

// ============================================================
// CABLE MARKER LABEL
// ============================================================
function getCableMarkerLabel(key) {
  switch (key) {
    case 'COPPER_CABLE':    return 'C';
    case 'FIBER_CABLE':     return 'F';
    case 'ASW':             return 'ASW';
    case 'BSW':             return 'BSW';
    case 'RMV_AER_COPPER':  return 'X-AC-X';
    case 'RMV_UG_COPPER':   return 'X-UC-X';
    case 'RMV_AER_FIBER':   return 'X-AF-X';
    case 'RMV_UG_FIBER':    return 'X-UF-X';
    case 'RMV_FIBER':       return 'X-F-X';
    case 'RMV_COPPER':      return 'X-C-X';
    case 'RMV_ASW':         return 'X-ASW-X';
    case 'RMV_BSW':         return 'X-BSW-X';
    default:                return null;
  }
}

// ============================================================
// MODAL ATTRIBUTES LOOKUP
// ============================================================
function getModalAttributes(category, key) {
  const dict = SMART_UNIT_DICTIONARY;
  const catData = dict[category];
  if (!catData || !catData.logic || !catData.logic[key]) return [];
  return catData.logic[key].attributes || [];
}

// ============================================================
// T&E / DOWNTIME — Canvas Callout Box (center of viewport)
// ============================================================
function placeMiscCalloutBox(resolved) {
  if (!resolved || !resolved.calloutLines) return;

  const vpt  = canvas.viewportTransform;
  const zoom = canvas.getZoom();
  const cxV  = canvas.getWidth()  / 2;
  const cyV  = canvas.getHeight() / 2;
  const cx   = (cxV - vpt[4]) / zoom;
  const cy   = (cyV - vpt[5]) / zoom;

  const lines = resolved.calloutLines;
  const pad   = 8;
  const lineH = 14;
  const boxW  = 220;
  const boxH  = lines.length * lineH + pad * 2 + 4;

  const rect = new fabric.Rect({
    width: boxW, height: boxH,
    fill: 'rgba(255,255,255,0.97)', stroke: '#000000', strokeWidth: 1.5,
    left: -boxW / 2, top: -boxH / 2,
  });

  const textObjs = lines.map((line, i) => new fabric.Text(line, {
    fontSize:   i === 0 ? 10 : 9,
    fontWeight: i === 0 ? 'bold' : 'normal',
    fill:       '#000000',
    fontFamily: 'Arial',
    left:       -boxW / 2 + pad,
    top:        -boxH / 2 + pad + i * lineH,
  }));

  const group = new fabric.Group([rect, ...textObjs], {
    left: cx, top: cy, originX: 'center', originY: 'center',
  });
  group.nscData = {
    category: state.activeCategory,
    key:      state.activeKey,
    attrs:    state._miscAttrs || {},
    type:     'MISC',
  };
  canvas.add(group);
  canvas.setActiveObject(group);
  storeUnitData(group, resolved);
  updateBillableUnits();
  pushHistory();
}

// ============================================================
// SMART MODAL
// ============================================================
function showModal(title, attributes, onConfirm, onDiscard) {
  const modal       = document.getElementById('smart-modal');
  const modalTitle  = document.getElementById('modal-title');
  const modalFields = document.getElementById('modal-fields');

  modalTitle.textContent = title;
  modalFields.innerHTML  = '';

  const fieldValues = {};

  // Helper: evaluate showWhen visibility for all fields
  function refreshConditionalFields() {
    attributes.forEach(attr => {
      if (!attr.showWhen) return;
      const depVal = fieldValues[attr.showWhen.key];
      const grp = modalFields.querySelector(`[data-field-key="${attr.key}"]`);
      if (!grp) return;
      grp.style.display = attr.showWhen.values.includes(depVal) ? '' : 'none';
    });
  }

  attributes.forEach(attr => {
    const group = document.createElement('div');
    group.className        = 'modal-field-group';
    group.dataset.fieldKey = attr.key;
    // Apply initial showWhen visibility
    if (attr.showWhen) group.style.display = 'none';

    const lbl = document.createElement('div');
    lbl.className   = 'modal-field-label';
    lbl.textContent = attr.label || attr.key;
    group.appendChild(lbl);

    if (attr.type === 'toggle-group') {
      const tg = document.createElement('div');
      tg.className = 'toggle-group';
      fieldValues[attr.key] = attr._default || attr.options[0];

      attr.options.forEach(opt => {
        const btn = document.createElement('button');
        btn.className = 'toggle-btn';
        btn.type      = 'button';
        btn.textContent = opt;
        if (opt === fieldValues[attr.key]) btn.classList.add('selected', `selected-${opt.toLowerCase().replace(/[^a-z]/g,'')}`);
        btn.addEventListener('click', () => {
          tg.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('selected','selected-new','selected-remove','selected-existing'));
          btn.classList.add('selected', `selected-${opt.toLowerCase()}`);
          fieldValues[attr.key] = opt;
          refreshConditionalFields(); // show/hide dependent fields live
        });
        tg.appendChild(btn);
      });
      group.appendChild(tg);

    } else if (attr.type === 'select') {
      const sel = document.createElement('select');
      sel.className = 'modal-input';
      (attr.options || []).forEach(opt => {
        const o = document.createElement('option');
        o.value = opt; o.textContent = opt;
        sel.appendChild(o);
      });
      if (attr._default !== undefined) sel.value = attr._default;
      fieldValues[attr.key] = sel.value;
      sel.addEventListener('change', () => { fieldValues[attr.key] = sel.value; });
      group.appendChild(sel);

    } else if (attr.type === 'number') {
      const inp = document.createElement('input');
      inp.type = 'number'; inp.className = 'modal-input';
      inp.placeholder = attr.placeholder || ''; inp.min = '0';
      if (attr._default !== undefined) inp.value = attr._default;
      fieldValues[attr.key] = inp.value;
      inp.addEventListener('input', () => { fieldValues[attr.key] = inp.value; });
      group.appendChild(inp);

    } else if (attr.type === 'checkbox') {
      const wrap = document.createElement('label');
      wrap.className = 'modal-checkbox-row';
      const chk = document.createElement('input');
      chk.type    = 'checkbox';
      chk.checked = attr.defaultChecked === true; // only checked if explicitly true
      fieldValues[attr.key] = chk.checked;
      chk.addEventListener('change', () => { fieldValues[attr.key] = chk.checked; });
      const span = document.createElement('span');
      span.textContent = attr.label || attr.key;
      wrap.appendChild(chk);
      wrap.appendChild(span);
      // Hide the redundant label above since checkbox row has its own label
      lbl.style.display = 'none';
      group.appendChild(wrap);

    } else if (attr.type === 'textarea') {
      const ta = document.createElement('textarea');
      ta.className   = 'modal-input';
      ta.placeholder = attr.placeholder || '';
      ta.rows        = 3;
      ta.style.width = '100%';
      fieldValues[attr.key] = '';
      ta.addEventListener('input', () => { fieldValues[attr.key] = ta.value; });
      group.appendChild(ta);

    } else {
      // text
      const inp = document.createElement('input');
      inp.type        = 'text'; inp.className = 'modal-input';
      inp.placeholder = attr.placeholder || '';
      if (attr._default) inp.value = attr._default;
      fieldValues[attr.key] = inp.value || '';
      inp.addEventListener('input', () => { fieldValues[attr.key] = inp.value; });
      group.appendChild(inp);
    }

    modalFields.appendChild(group);
  });

  // Run once after all fields are built to show correct initial state
  refreshConditionalFields();

  modal.style.display = 'flex';

  function syncAllFields() {
    modalFields.querySelectorAll('select').forEach(el => {
      const k = el.closest('[data-field-key]')?.dataset.fieldKey;
      if (k) fieldValues[k] = el.value;
    });
    modalFields.querySelectorAll('input[type="text"], input[type="number"]').forEach(el => {
      const k = el.closest('[data-field-key]')?.dataset.fieldKey;
      if (k) fieldValues[k] = el.value;
    });
    modalFields.querySelectorAll('textarea').forEach(el => {
      const k = el.closest('[data-field-key]')?.dataset.fieldKey;
      if (k) fieldValues[k] = el.value;
    });
    modalFields.querySelectorAll('input[type="checkbox"]').forEach(el => {
      const k = el.closest('[data-field-key]')?.dataset.fieldKey;
      if (k) fieldValues[k] = el.checked;
    });
  }

  function confirmModal() {
    syncAllFields();
    modal.style.display = 'none';
    cleanup();
    onConfirm(fieldValues);
  }

  function discardModal() {
    modal.style.display = 'none';
    cleanup();
    if (onDiscard) onDiscard();
  }

  const confirmBtn  = document.getElementById('modal-confirm');
  const discardBtn  = document.getElementById('modal-discard');
  const discardXBtn = document.getElementById('modal-discard-x');
  const confirmHandler  = () => confirmModal();
  const discardHandler  = () => discardModal();
  confirmBtn.addEventListener('click', confirmHandler);
  discardBtn.addEventListener('click', discardHandler);
  if (discardXBtn) discardXBtn.addEventListener('click', discardHandler);

  function cleanup() {
    confirmBtn.removeEventListener('click', confirmHandler);
    discardBtn.removeEventListener('click', discardHandler);
    if (discardXBtn) discardXBtn.removeEventListener('click', discardHandler);
  }

  state._modalConfirm  = confirmModal;
  state._modalDiscard  = discardModal;
}

// ============================================================
// BILLABLE UNITS
// ============================================================
function storeUnitData(obj, resolved) {
  if (!obj || !resolved) return;
  const id = obj.__uid || (obj.__uid = Math.random().toString(36).slice(2, 11));
  const entries = [];

  // Format A: single unit_code + optional extraUnits[] (pole, HH, MH, misc tools)
  if (resolved.unit_code && resolved.qty !== 0) {
    entries.push({
      unit_code: resolved.unit_code,
      desc:      resolved.desc || resolved.unit_code,
      unit:      resolved.unit || 'EA',
      qty:       resolved.qty  || 1,
    });
  }
  if (resolved.extraUnits) {
    resolved.extraUnits.forEach(eu => {
      if (eu.unit_code && (eu.qty == null || eu.qty > 0)) {
        entries.push({
          unit_code: eu.unit_code,
          desc:      eu.desc || eu.unit_code,
          unit:      eu.unit || 'FT',
          qty:       eu.qty  != null ? eu.qty : 1,
        });
      }
    });
  }

  // Format B: units[] array (cable tools — FIBER_CABLE, COPPER_CABLE, ASW, BSW, etc.)
  // Each entry has { code, type, qty, unit }
  if (resolved.units && Array.isArray(resolved.units)) {
    resolved.units.forEach(u => {
      const uc = u.unit_code || u.code;
      if (uc) {
        entries.push({
          unit_code: uc,
          desc:      u.desc || uc,
          unit:      u.unit || 'FT',
          qty:       u.qty  != null ? u.qty : 1,
        });
      }
    });
  }

  state.unitMap.set(id, entries);
}

function rebuildUnitMap() {
  state.unitMap.clear();
  canvas.getObjects().forEach(obj => {
    if (obj.__uid && obj.nscData && obj.nscData.category && obj.nscData.key) {
      const resolved = resolveSmartUnit(obj.nscData.category, obj.nscData.key, obj.nscData.attrs || {});
      storeUnitData(obj, resolved);
    }
  });
}

function updateBillableUnits() {
  // Build the set of __uids that are currently on the canvas
  const liveUids = new Set();
  canvas.getObjects().forEach(obj => {
    // Register any untracked nscData objects
    if (obj.nscData && obj.nscData.category && obj.nscData.key) {
      if (!obj.__uid) {
        const resolved = resolveSmartUnit(obj.nscData.category, obj.nscData.key, obj.nscData.attrs || {});
        storeUnitData(obj, resolved);
      }
      if (obj.__uid) liveUids.add(obj.__uid);
    }
  });

  // Purge unitMap entries for objects no longer on canvas
  state.unitMap.forEach((_, uid) => {
    if (!liveUids.has(uid)) state.unitMap.delete(uid);
  });

  // Aggregate only live entries
  const aggregated = new Map();
  state.unitMap.forEach(entries => {
    entries.forEach(entry => {
      const code = entry.unit_code;
      if (!code) return;
      if (!aggregated.has(code)) {
        aggregated.set(code, { ...entry });
      } else {
        aggregated.get(code).qty += (entry.qty != null ? entry.qty : 1);
      }
    });
  });

  renderBillableUnits(aggregated);
}

function renderBillableUnits(aggregated) {
  const listEl = document.getElementById('units-list');
  if (aggregated.size === 0) {
    listEl.innerHTML = '<div class="units-empty">No items placed yet.</div>';
    return;
  }
  listEl.innerHTML = '';
  aggregated.forEach(entry => {
    if (!entry.unit_code || entry.qty === 0) return;
    const row = document.createElement('div');
    row.className = 'unit-row';
    const isHrs = entry.unit === 'HRS';
    const qtyNum = parseFloat(entry.qty) || 0;
    const qtyDisplay = isHrs
      ? qtyNum.toFixed(1) + ' hrs'
      : (Number.isInteger(qtyNum) ? qtyNum : qtyNum.toFixed(2).replace(/\.?0+$/, ''));
    row.innerHTML = `
      <span class="unit-code">${entry.unit_code}</span>
      <span class="unit-qty">${qtyDisplay}</span>
      <span class="unit-type">${isHrs ? '' : (entry.unit || 'EA')}</span>
    `;
    listEl.appendChild(row);
  });
}

// ============================================================
// PHOTO IMPORT
// ============================================================
function importPhoto(file) {
  const reader = new FileReader();
  reader.onload = e => {
    fabric.Image.fromURL(e.target.result, img => {
      img.scaleToWidth(Math.min(400, canvas.getWidth() / 2));
      img.set({
        left: 60,
        top: 60,
        selectable: true,
        evented: true,
        hasControls: true,
        hasBorders: true,
        lockUniScaling: false,
      });
      img.nscData = { type: 'PHOTO_IMPORT' };
      canvas.add(img);
      canvas.setActiveObject(img);
    });
  };
  reader.readAsDataURL(file);
}

// ============================================================
// SAVE / LOAD JSON
// ============================================================
function saveJSON() {
  const data = {
    version: '2.0',
    meta: {
      job:     document.getElementById('meta-job').value,
      date:    document.getElementById('meta-date').value,
      foreman: document.getElementById('meta-foreman').value,
      address: document.getElementById('meta-address').value,
      city:    document.getElementById('meta-city').value,
      notes:   document.getElementById('meta-notes').value,   // Change 1
    },
    canvas: canvas.toJSON(['nscData', '__uid', 'selectable', 'evented']),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `Job_${data.meta.job || 'Draft'}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function loadJSON(file) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (data.meta) {
        document.getElementById('meta-job').value     = data.meta.job     || '';
        document.getElementById('meta-date').value    = data.meta.date    || '';
        document.getElementById('meta-foreman').value = data.meta.foreman || '';
        document.getElementById('meta-address').value = data.meta.address || '';
        document.getElementById('meta-city').value    = data.meta.city    || '';
        // Change 1: load notes
        if (document.getElementById('meta-notes')) {
          document.getElementById('meta-notes').value = data.meta.notes || '';
        }
      }
      state.historyLocked = true;
      canvas.loadFromJSON(data.canvas, () => {
        canvas.renderAll();
        state.historyLocked = false;
        rebuildUnitMap();
        updateBillableUnits();
        drawGrid();
      });
    } catch (err) {
      alert('Error loading file: ' + err.message);
    }
  };
  reader.readAsText(file);
}

// ============================================================
// PDF EXPORT — Change 1: include notes in PDF header
// ============================================================
async function exportPDF() {
  const { jsPDF } = window.jspdf;
  const doc   = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  // Gather meta including notes
  const meta = {
    job:     document.getElementById('meta-job').value     || '—',
    date:    document.getElementById('meta-date').value    || '—',
    foreman: document.getElementById('meta-foreman').value || '—',
    address: document.getElementById('meta-address').value || '—',
    city:    document.getElementById('meta-city').value    || '—',
    notes:   document.getElementById('meta-notes')?.value  || '',
  };

  // Header height — expand if notes present
  const hasNotes    = meta.notes.trim().length > 0;
  const headerH     = hasNotes ? 32 : 24;

  // Header background
  doc.setFillColor(0, 82, 204);
  doc.rect(0, 0, pageW, headerH, 'F');

  try {
    const logoImg    = document.getElementById('header-logo');
    const logoCanvas = document.createElement('canvas');
    logoCanvas.width  = logoImg.naturalWidth;
    logoCanvas.height = logoImg.naturalHeight;
    logoCanvas.getContext('2d').drawImage(logoImg, 0, 0);
    doc.addImage(logoCanvas.toDataURL('image/jpeg'), 'JPEG', 4, 2, 30, 18);
  } catch (e) { /* skip logo */ }

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('NORTH SKY COMMUNICATIONS — AS-BUILT DRAWING', pageW / 2, 8, { align: 'center' });

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.text(`JOB #: ${meta.job}   DATE: ${meta.date}   FOREMAN: ${meta.foreman}`, pageW / 2, 14, { align: 'center' });
  doc.text(`ADDRESS: ${meta.address}   CITY: ${meta.city}`, pageW / 2, 19, { align: 'center' });

  // Change 1: Print notes below address line
  if (hasNotes) {
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'italic');
    // Truncate to first 120 chars if very long
    const notesLine = meta.notes.trim().replace(/\n/g, ' ').substring(0, 140);
    doc.text(`NOTES: ${notesLine}`, pageW / 2, 27, { align: 'center' });
  }

  // Canvas image
  const canvasDataURL  = canvas.toDataURL({ format: 'png', multiplier: 1.5 });
  const canvasImgH     = pageH - headerH - 50;
  doc.addImage(canvasDataURL, 'PNG', 4, headerH + 2, pageW - 8, canvasImgH);

  // Billable units table
  const tableY = headerH + 2 + canvasImgH + 4;
  doc.setFillColor(0, 82, 204);
  doc.rect(4, tableY, pageW - 8, 6, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.text('BILLABLE UNITS', 6, tableY + 4);

  let rowY = tableY + 9;
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(6.5);
  doc.setFont('helvetica', 'bold');
  doc.text('Unit Code', 6, rowY);
  doc.text('Qty', 160, rowY);
  doc.text('Unit', 175, rowY);
  rowY += 4;
  doc.setFont('helvetica', 'normal');

  const aggregated = new Map();
  state.unitMap.forEach(entries => {
    entries.forEach(entry => {
      const code = entry.unit_code;
      if (!code) return;
      if (!aggregated.has(code)) aggregated.set(code, { ...entry });
      else aggregated.get(code).qty += (entry.qty || 1);
    });
  });

  aggregated.forEach(entry => {
    if (!entry.unit_code || entry.qty === 0) return;
    if (rowY > pageH - 4) { doc.addPage(); rowY = 10; }
    doc.text(String(entry.unit_code), 6,   rowY);
    doc.text(String(Math.round(entry.qty)), 160, rowY);
    doc.text(String(entry.unit || 'EA'),   175, rowY);
    rowY += 4;
  });

  doc.save(`Job_${meta.job !== '—' ? meta.job : 'Draft'}_AsBuilt.pdf`);
}

// ============================================================
// TOOL SWITCHING
// ============================================================
function setTool(toolName) {
  state.activeTool     = toolName;
  state.activeCategory = null;
  state.activeKey      = null;
  state.activeType     = null;
  state.drawingLine    = false;
  state.xferStep       = 0;
  state.calloutDragging = false;
  if (state.previewLine)        { canvas.remove(state.previewLine);        state.previewLine        = null; }
  if (state.previewRect)        { canvas.remove(state.previewRect);        state.previewRect        = null; }
  if (state.previewCircle)      { canvas.remove(state.previewCircle);      state.previewCircle      = null; }
  if (state.previewGrubbing)    { canvas.remove(state.previewGrubbing);    state.previewGrubbing    = null; }
  if (state.previewRmvBuried)   { canvas.remove(state.previewRmvBuried);   state.previewRmvBuried   = null; }
  state.drawingRmvBuried = false;
  if (state._xferDot)           { canvas.remove(state._xferDot);           state._xferDot           = null; }
  if (state._calloutDot)        { canvas.remove(state._calloutDot);        state._calloutDot        = null; }
  if (state._calloutPreviewLine){ canvas.remove(state._calloutPreviewLine);state._calloutPreviewLine= null; }
  state.drawingRect     = false;
  state.drawingCircle   = false;
  state.drawingGrubbing = false;
  // cancel any active polyline
  if (state.polyLineTool) {
    state.polySegments.forEach(s => canvas.remove(s));
    if (state.polyPreview) canvas.remove(state.polyPreview);
    state.polyLineTool = null;
    state.polyPoints   = [];
    state.polySegments = [];
    state.polyPreview  = null;
    canvas.renderAll();
  }

  canvas.isDrawingMode = (toolName === 'FREEHAND');
  canvas.selection     = (toolName === 'SELECT');

  document.body.className = '';
  if (toolName === 'FREEHAND') document.body.classList.add('tool-freehand');
  else if (toolName !== 'SELECT') document.body.classList.add('tool-crosshair');

  document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tool === toolName);
  });
  document.querySelectorAll('.tele-btn').forEach(btn => btn.classList.remove('active'));
}

function setTelecomTool(category, key, type) {
  state.activeTool     = 'TELECOM';
  state.activeCategory = category;
  state.activeKey      = key;
  state.activeType     = type;
  state.drawingLine    = false;
  state.xferStep       = 0;
  if (state.previewLine) { canvas.remove(state.previewLine); state.previewLine = null; }
  if (state._xferDot)   { canvas.remove(state._xferDot);   state._xferDot   = null; }

  canvas.isDrawingMode = false;
  canvas.selection     = false;

  document.body.className = type === 'POINT' ? 'tool-point' : 'tool-crosshair';

  document.querySelectorAll('.tele-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.key === key && btn.dataset.category === category);
  });
  document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => btn.classList.remove('active'));

  // MODAL_ONLY tools: open modal immediately
  if (type === 'MODAL_ONLY') {
    canvas.isDrawingMode = false;
    canvas.selection     = true;
    openMiscModal(category, key);
  }
}

// ============================================================
// MISC MODAL (T&E / DOWNTIME) — open immediately, no canvas click
// ============================================================
function openMiscModal(category, key) {
  const attrs = getModalAttributes(category, key);
  const titleMap = {
    TNE:               'T&E — Time & Equipment',
    DOWNTIME:          'DOWNTIME',
    SPLICER_FIBER:     'SPLICER — FIBER',
    SPLICER_COPPER:    'SPLICER — COPPER',
    EMERGENCY_TRAVEL:  'EMERGENCY TRAVEL TIME',
    VAC_TRUCK:         'VAC TRUCK — PASS-THROUGH',
    ARBORIST:          'ARBORIST — PASS-THROUGH',
    CORE_DRILL:        'CORE DRILL — OSP CONCRETE',
  };
  showModal(titleMap[key] || key, attrs, (values) => {
    state._miscAttrs = values;
    const resolved = resolveSmartUnit(category, key, values);
    if (resolved) placeMiscCalloutBox(resolved);
    // Reset to select tool
    setTool('SELECT');
  }, () => { setTool('SELECT'); });
}

// ============================================================
// PANEL / TAB MANAGEMENT
// ============================================================
function initTabs() {
  const tabBtns = document.querySelectorAll('.tab-btn');
  const panel   = document.getElementById('tool-panel');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId   = btn.dataset.tab;
      const isActive = btn.classList.contains('active');

      if (isActive) {
        panel.classList.remove('panel-open');
        btn.classList.remove('active');
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        canvasArea.classList.add('panel-collapsed');
      } else {
        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        panel.classList.add('panel-open');
        canvasArea.classList.remove('panel-collapsed');
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        const content = document.getElementById('tab-' + tabId);
        if (content) content.classList.add('active');
      }
      setTimeout(sizeCanvas, 210);
    });
  });

  // Auto-open TOOLS tab on load
  const defaultBtn     = document.querySelector('.tab-btn[data-tab="tools"]');
  const defaultContent = document.getElementById('tab-tools');
  if (defaultBtn && defaultContent) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    defaultBtn.classList.add('active');
    defaultContent.classList.add('active');
    panel.classList.add('panel-open');
    canvasArea.classList.remove('panel-collapsed');
  }
}

// ============================================================
// INJECT MISC TAB into the DOM
// ============================================================
function injectMiscTab() {
  // Tab button
  const tabStrip = document.getElementById('tab-strip');
  if (tabStrip && !document.querySelector('.tab-btn[data-tab="misc"]')) {
    const btn = document.createElement('button');
    btn.className   = 'tab-btn';
    btn.dataset.tab = 'misc';
    btn.innerHTML   = '<span>MISC</span>';
    tabStrip.appendChild(btn);
  }

  // Tab content panel
  const toolPanel = document.getElementById('tool-panel');
  if (toolPanel && !document.getElementById('tab-misc')) {
    const div = document.createElement('div');
    div.className = 'tab-content';
    div.id        = 'tab-misc';
    div.innerHTML = `
      <div class="panel-section-title">MISC TOOLS</div>
      <div class="tool-grid">
        <button class="tool-btn tele-btn" data-category="misc" data-key="TNE" data-type="MODAL_ONLY">T&amp;E</button>
        <button class="tool-btn tele-btn" data-category="misc" data-key="DOWNTIME" data-type="MODAL_ONLY">DOWNTIME</button>
        <button class="tool-btn tele-btn" data-category="misc" data-key="SPLICER_FIBER" data-type="MODAL_ONLY">SPLICER FIBER</button>
        <button class="tool-btn tele-btn" data-category="misc" data-key="SPLICER_COPPER" data-type="MODAL_ONLY">SPLICER COPPER</button>
        <button class="tool-btn tele-btn" data-category="misc" data-key="EMERGENCY_TRAVEL" data-type="MODAL_ONLY">EMG TRAVEL TIME</button>
        <button class="tool-btn tele-btn" data-category="misc" data-key="VAC_TRUCK" data-type="MODAL_ONLY">VAC TRUCK</button>
        <button class="tool-btn tele-btn" data-category="underground" data-key="GRUBBING" data-type="RECT">GRUBBING</button>
        <button class="tool-btn tele-btn" data-tool="ROD_PROOF">ROD &amp; PROOF</button>
        <button class="tool-btn tele-btn" data-tool="LOC_SONDE">LOC W/ SONDE</button>
      </div>
      <div class="panel-section-title" style="margin-top:12px;font-size:9px;color:#666">
        Opens modal — no canvas click needed.<br>Callout box drops at center of viewport.
      </div>
    `;
    toolPanel.appendChild(div);
  }

  // Inject new tab-specific underground tools that were missing in index.html
  const ugPanel = document.getElementById('tab-underground');
  if (ugPanel && !ugPanel.querySelector('[data-key="MH"]')) {
    const grid = ugPanel.querySelector('.tool-grid');
    if (grid) {
      const mhBtn = document.createElement('button');
      mhBtn.className = 'tool-btn tele-btn';
      mhBtn.dataset.category = 'underground';
      mhBtn.dataset.key  = 'MH';
      mhBtn.dataset.type = 'POINT';
      mhBtn.textContent  = 'MANHOLE';
      grid.appendChild(mhBtn);

      const mgBtn = document.createElement('button');
      mgBtn.className = 'tool-btn tele-btn';
      mgBtn.dataset.category = 'underground';
      mgBtn.dataset.key  = 'MH_GRADE_ADJ';
      mgBtn.dataset.type = 'POINT';
      mgBtn.textContent  = 'MH GRADE ADJ';
      grid.appendChild(mgBtn);
    }
  }

  // Inject splicing tools that were remapped in the spec
  const splPanel = document.getElementById('tab-splicing');
  if (splPanel) {
    // Replace SPLICE_CASE with SPLICE_WIZARD
    const oldCase = splPanel.querySelector('[data-key="SPLICE_CASE"]');
    if (oldCase) {
      oldCase.dataset.key  = 'SPLICE_WIZARD';
      oldCase.textContent  = 'SPLICE WIZARD';
    }
    // Remove MPOP (not in new spec)
    const mpop = splPanel.querySelector('[data-key="MPOP"]');
    if (mpop) mpop.remove();
  }



  // Re-bind all tele-btns (including newly injected ones)
  bindTeleButtons();
}

// ============================================================
// BIND TELE BUTTONS (called after DOM injection)
// ============================================================
function bindTeleButtons() {
  document.querySelectorAll('.tele-btn').forEach(btn => {
    // Remove old listener by cloning
    const clone = btn.cloneNode(true);
    btn.parentNode.replaceChild(clone, btn);

    // Buttons with data-tool (e.g. XFERS) go through setTool, not setTelecomTool
    if (clone.dataset.tool) {
      clone.addEventListener('click', () => setTool(clone.dataset.tool));
    } else {
      clone.addEventListener('click', () => {
        setTelecomTool(clone.dataset.category, clone.dataset.key, clone.dataset.type);
      });
    }
  });
}

// ============================================================
// KEYBOARD EVENTS
// ============================================================
document.addEventListener('keydown', e => {
  if (e.code === 'Space' && !e.target.matches('input, textarea, [contenteditable]')) {
    e.preventDefault();
    state.spaceDown = true;
    document.body.classList.add('panning');
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); }
  if ((e.key === 'Delete' || e.key === 'Backspace') && !document.activeElement.matches('input, textarea')) {
    const active = canvas.getActiveObjects();
    if (active.length) {
      active.forEach(obj => canvas.remove(obj));
      canvas.discardActiveObject();
      canvas.renderAll();
    }
  }
  if (e.key === 'Escape') {
    state.drawingLine = false;
    if (state.previewLine)        { canvas.remove(state.previewLine);        state.previewLine        = null; }
    state.drawingRect = false;
    if (state.previewRect)        { canvas.remove(state.previewRect);        state.previewRect        = null; }
    state.drawingCircle = false;
    if (state.previewCircle)      { canvas.remove(state.previewCircle);      state.previewCircle      = null; }
        state.drawingGrubbing = false;
    if (state.previewGrubbing) { canvas.remove(state.previewGrubbing); state.previewGrubbing = null; }
    state.polySegments.forEach(s => canvas.remove(s));
    if (state.polyPreview) canvas.remove(state.polyPreview);
    state.polyLineTool = null; state.polyPoints = []; state.polySegments = []; state.polyPreview = null;
    state.calloutStep     = 0;
    state.calloutDragging = false;
    if (state._calloutDot)        { canvas.remove(state._calloutDot);        state._calloutDot        = null; }
    if (state._calloutPreviewLine){ canvas.remove(state._calloutPreviewLine);state._calloutPreviewLine= null; }
    state.xferStep = 0;
    if (state._xferDot)           { canvas.remove(state._xferDot);           state._xferDot           = null; }
  }
});

document.addEventListener('keyup', e => {
  if (e.code === 'Space') {
    state.spaceDown = false;
    if (!state.isPanning) document.body.classList.remove('panning');
  }
});

// ============================================================
// PROPERTY PANEL EVENTS
// ============================================================
document.getElementById('prop-color').addEventListener('input', e => {
  const color = e.target.value;
  canvas.getActiveObjects().forEach(obj => {
    if (obj.stroke) obj.set('stroke', color);
    if (obj.fill && obj.fill !== 'transparent') obj.set('fill', color);
  });
  canvas.renderAll();
});

document.getElementById('prop-stroke').addEventListener('input', e => {
  const sw = parseInt(e.target.value);
  document.getElementById('prop-stroke-val').textContent = sw;
  canvas.getActiveObjects().forEach(obj => obj.set('strokeWidth', sw));
  canvas.renderAll();
});

document.getElementById('prop-fontsize').addEventListener('input', e => {
  const fs = parseInt(e.target.value);
  canvas.getActiveObjects().forEach(obj => { if (obj.fontSize !== undefined) obj.set('fontSize', fs); });
  canvas.renderAll();
});

document.getElementById('tool-stroke').addEventListener('input', e => {
  state.toolStroke = parseInt(e.target.value);
  document.getElementById('tool-stroke-val').textContent = state.toolStroke;
});

document.getElementById('tool-color').addEventListener('input', e => {
  state.toolColor = e.target.value;
  if (canvas.isDrawingMode) canvas.freeDrawingBrush.color = e.target.value;
});

document.getElementById('tool-linestyle').addEventListener('change', e => {
  state.toolLinestyle = e.target.value;
});

// ============================================================
// SMARTSHEET JOB LOOKUP
// ============================================================
const SS_WORKER = 'https://nsc-smartapp.williamkeesee06.workers.dev';

async function lookupJob(workOrder) {
  const statusEl = document.getElementById('job-lookup-status');
  const btn      = document.getElementById('btn-job-lookup');

  statusEl.style.display = 'inline';
  statusEl.style.color   = '#f59e0b';
  statusEl.textContent   = '⟳ SEARCHING...';
  btn.disabled = true;

  try {
    const res  = await fetch(`${SS_WORKER}/?wo=${encodeURIComponent(workOrder)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json();

    if (!d.found) {
      statusEl.style.color = '#ef4444';
      statusEl.textContent = '✗ NOT FOUND';
      btn.disabled = false;
      return;
    }

    // Populate header fields
    if (d.address)    document.getElementById('meta-address').value    = d.address;
    if (d.city)       document.getElementById('meta-city').value       = d.city;
    if (d.supervisor) document.getElementById('meta-supervisor').value = d.supervisor;
    if (d.foreman)    document.getElementById('meta-foreman').value    = d.foreman;
    if (d.schedDate)  document.getElementById('meta-date').value       = d.schedDate;
    if (d.notes)      document.getElementById('meta-notes').value      = d.notes.split('\n')[0];

    // Traffic control checkbox
    if (d.tcRequired === true || d.tcRequired === 'true' || d.tcRequired === 1) {
      const tc = document.getElementById('chk-traffic-control');
      if (tc) { tc.checked = true; tc.dispatchEvent(new Event('change')); }
    }

    // Auto-geocode and center map on job address
    const fullAddress = [d.address, d.city, d.zip].filter(Boolean).join(', ');
    state.jobAddress = fullAddress;
    if (window._googleMapReady && window.mapGeocoder && fullAddress) {
      window.mapGeocoder.geocode({ address: fullAddress }, (results, geoStatus) => {
        if (geoStatus === 'OK' && results[0]) {
          const loc = results[0].geometry.location;
          window.googleMap.setCenter(loc);
          window.googleMap.setZoom(18);
          if (window._jobMarker) window._jobMarker.setMap(null);
          window._jobMarker = new google.maps.Marker({
            position: loc,
            map: window.googleMap,
            title: fullAddress,
            icon: {
              path: google.maps.SymbolPath.BACKWARD_CLOSED_ARROW,
              scale: 7,
              fillColor: '#ff6b00',
              fillOpacity: 1,
              strokeColor: '#fff',
              strokeWeight: 2,
            }
          });
        }
      });
    }

    statusEl.style.color = '#16a34a';
    statusEl.textContent = `✓ ${d.jobStatus || 'LOADED'}`;

  } catch (err) {
    console.error('Smartsheet lookup error:', err);
    statusEl.style.color = '#ef4444';
    statusEl.textContent = '✗ ERROR — check connection';
  }

  btn.disabled = false;
}

// Trigger on button click OR Enter key in JOB # field
document.getElementById('btn-job-lookup').addEventListener('click', () => {
  const wo = document.getElementById('meta-job').value.trim();
  if (wo) lookupJob(wo);
});
document.getElementById('meta-job').addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const wo = document.getElementById('meta-job').value.trim();
    if (wo) lookupJob(wo);
  }
});

// ============================================================
// HEADER BUTTON EVENTS
// ============================================================
document.getElementById('btn-zoom-in').addEventListener('click',    () => zoomCanvas(1.2));
document.getElementById('btn-zoom-out').addEventListener('click',   () => zoomCanvas(1/1.2));
document.getElementById('btn-zoom-reset').addEventListener('click', resetZoom);

document.getElementById('btn-undo').addEventListener('click', undo);
document.getElementById('btn-save').addEventListener('click', saveJSON);

document.getElementById('btn-load').addEventListener('click', () => {
  document.getElementById('file-load-input').click();
});
document.getElementById('file-load-input').addEventListener('change', e => {
  if (e.target.files[0]) { loadJSON(e.target.files[0]); e.target.value = ''; }
});

document.getElementById('btn-photo').addEventListener('click', () => {
  document.getElementById('file-photo-input').click();
});
document.getElementById('file-photo-input').addEventListener('change', e => {
  if (e.target.files[0]) { importPhoto(e.target.files[0]); e.target.value = ''; }
});

document.getElementById('btn-export-pdf').addEventListener('click', exportPDF);

// ============================================================
// BASIC TOOL BUTTON EVENTS
// ============================================================
document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
  btn.addEventListener('click', () => setTool(btn.dataset.tool));
});

// XFERS button wired via data-tool="XFERS" — handled by setTool
// setTool('XFERS') sets state.activeTool = 'XFERS', canvas click routes to handleXfersClick

// ============================================================
// GROUP / UNGROUP
// ============================================================
document.getElementById('btn-group').addEventListener('click', () => {
  const active = canvas.getActiveObject();
  if (active && active.type === 'activeSelection') {
    active.toGroup();
    canvas.requestRenderAll();
    pushHistory();
  }
});

document.getElementById('btn-ungroup').addEventListener('click', () => {
  const active = canvas.getActiveObject();
  if (active && active.type === 'group') {
    active.toActiveSelection();
    canvas.requestRenderAll();
    pushHistory();
  }
});

// ============================================================
// CLEAR ALL
// ============================================================
document.getElementById('btn-clear-all').addEventListener('click', () => {
  if (confirm('Clear all objects from the canvas? This cannot be undone.')) {
    canvas.clear();
    state.unitMap.clear();
    state.history = [];
    updateBillableUnits();
    drawGrid();
  }
});

// ============================================================
// UNITS DASHBOARD TOGGLE
// ============================================================
// ============================================================
// BILLABLE UNITS PANEL — DRAG, MINIMIZE, RESIZE
// ============================================================
(function initUnitsPanel() {
  const panel  = document.getElementById('units-dashboard');
  const handle = document.getElementById('units-drag-handle');
  const minBtn = document.getElementById('units-minimize');
  const colBtn = document.getElementById('units-toggle');
  const grip   = document.getElementById('units-resize-grip');

  // --- DRAG ---
  let dragging = false, dragOffX = 0, dragOffY = 0;

  handle.addEventListener('mousedown', e => {
    if (e.target.tagName === 'BUTTON') return; // don't drag on button clicks
    dragging = true;
    const rect = panel.getBoundingClientRect();
    dragOffX = e.clientX - rect.left;
    dragOffY = e.clientY - rect.top;
    panel.style.right  = 'auto';
    panel.style.bottom = 'auto';
    panel.style.left   = rect.left + 'px';
    panel.style.top    = rect.top  + 'px';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    panel.style.left = (e.clientX - dragOffX) + 'px';
    panel.style.top  = (e.clientY - dragOffY) + 'px';
  });

  document.addEventListener('mouseup', () => {
    dragging = false;
    document.body.style.userSelect = '';
  });

  // --- MINIMIZE (collapse to header bar only) ---
  minBtn.addEventListener('click', () => {
    const minimized = panel.classList.toggle('minimized');
    minBtn.textContent = minimized ? '□' : '─';
    minBtn.title = minimized ? 'Restore' : 'Minimize';
  });

  // --- COLLAPSE body (keep header + totals, hide list) ---
  colBtn.addEventListener('click', () => {
    const body = document.getElementById('units-body');
    const collapsed = body.style.display === 'none';
    body.style.display = collapsed ? '' : 'none';
    colBtn.textContent = collapsed ? '▼' : '▲';
    colBtn.title = collapsed ? 'Collapse' : 'Expand';
  });

  // --- RESIZE (drag bottom grip to change height) ---
  if (grip) {
    let resizing = false, resizeStartY = 0, resizeStartH = 0;
    grip.addEventListener('mousedown', e => {
      resizing = true;
      resizeStartY = e.clientY;
      resizeStartH = panel.offsetHeight;
      document.body.style.userSelect = 'none';
      e.preventDefault();
      e.stopPropagation();
    });
    document.addEventListener('mousemove', e => {
      if (!resizing) return;
      const newH = Math.max(80, resizeStartH + (e.clientY - resizeStartY));
      panel.style.maxHeight = newH + 'px';
    });
    document.addEventListener('mouseup', () => { resizing = false; document.body.style.userSelect = ''; });
  }
})();

// ============================================================
// FREEHAND BRUSH
// ============================================================
function setupFreehand() {
  canvas.freeDrawingBrush       = new fabric.PencilBrush(canvas);
  canvas.freeDrawingBrush.color = state.toolColor;
  canvas.freeDrawingBrush.width = state.toolStroke;

  // After completing a freehand stroke, drop back to SELECT and select the path
  canvas.on('path:created', (e) => {
    if (state.activeTool !== 'FREEHAND') return;
    setTool('SELECT');
    if (e.path) { canvas.setActiveObject(e.path); canvas.renderAll(); }
    pushHistory();
  });

  document.getElementById('tool-color').addEventListener('input', () => {
    if (canvas.freeDrawingBrush) canvas.freeDrawingBrush.color = state.toolColor;
  });
  document.getElementById('tool-stroke').addEventListener('input', () => {
    if (canvas.freeDrawingBrush) canvas.freeDrawingBrush.width = state.toolStroke;
  });
}

// ============================================================
// RESIZE
// ============================================================
window.addEventListener('resize', sizeCanvas);

// ============================================================
// INIT
// ============================================================
function init() {
  // Inject MISC tab and fix other tab buttons before initTabs
  injectMiscTab();
  initTabs();
  setupFreehand();
  sizeCanvas();
  drawGrid();
  setTool('SELECT');

  // Set today's date
  const today = new Date();
  const mm    = String(today.getMonth() + 1).padStart(2, '0');
  const dd    = String(today.getDate()).padStart(2, '0');
  const yyyy  = today.getFullYear();
  document.getElementById('meta-date').value = `${mm}/${dd}/${yyyy}`;

  pushHistory();
}

// init() is now called by safeInit() above

// ============================================================
// TOOL ICONS — Bluebeam-style SVG injection
// ============================================================
const TOOL_ICONS = {

  // ── TOOLS TAB ─────────────────────────────────────────────

  // Arrow cursor: diagonal arrow pointing up-left
  'SELECT': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M4 4 L4 16 L8 12 L11 19 L13 18 L10 11 L16 11 Z" stroke="currentColor" stroke-width="1.5" fill="none"/>
  </svg>`,

  // Diagonal line bottom-left to top-right
  'LINE': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
    <line x1="4" y1="20" x2="20" y2="4"/>
  </svg>`,

  // Open rectangle outline
  'RECT': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <rect x="3" y="5" width="18" height="14" rx="1"/>
  </svg>`,

  // Open circle outline
  'CIRCLE': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
    <circle cx="12" cy="12" r="8"/>
  </svg>`,

  // Horizontal line with arrowhead on right
  'ARROW': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <line x1="3" y1="12" x2="19" y2="12"/>
    <polyline points="14,7 20,12 14,17"/>
  </svg>`,

  // Dimension: horizontal line with vertical tick marks at each end (|——|)
  'DIMENSION': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
    <line x1="4" y1="12" x2="20" y2="12"/>
    <line x1="4" y1="7" x2="4" y2="17"/>
    <line x1="20" y1="7" x2="20" y2="17"/>
  </svg>`,

  // Callout: speech bubble rectangle with small triangle pointer at bottom-left
  'CALLOUT': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <rect x="3" y="3" width="18" height="12" rx="1"/>
    <path d="M5 15 L3 20 L9 15"/>
  </svg>`,

  // Capital "T" with serif baseline
  'TEXT': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
    <line x1="12" y1="5" x2="12" y2="19"/>
    <line x1="5" y1="5" x2="19" y2="5"/>
    <line x1="8" y1="19" x2="16" y2="19"/>
  </svg>`,

  // Wavy squiggly line (freehand path)
  'FREEHAND': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M3 14 C5 10, 7 16, 9 12 S13 8, 15 12 S19 16, 21 12"/>
  </svg>`,


  // ── AERIAL TAB ────────────────────────────────────────────

  // Pole: circle with X through it (⊗ telecom standard)
  'POLE': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
    <circle cx="12" cy="12" r="8"/>
    <line x1="6.3" y1="6.3" x2="17.7" y2="17.7"/>
    <line x1="17.7" y1="6.3" x2="6.3" y2="17.7"/>
  </svg>`,

  // Strand 10M: dashed horizontal line (3 dashes)
  'STRAND_10M': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
    <line x1="2" y1="12" x2="8" y2="12" stroke-dasharray="0"/>
    <line x1="10" y1="12" x2="14" y2="12"/>
    <line x1="16" y1="12" x2="22" y2="12"/>
  </svg>`,

  // DE/Relash: wavy sinusoidal line
  'DE_RE': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M2 12 C4 8, 6 16, 8 12 S12 8, 14 12 S18 16, 20 12 L22 12"/>
  </svg>`,

  // Re-Tension: arrow with compression tick marks in middle
  'RE_TENSION': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <line x1="2" y1="12" x2="22" y2="12"/>
    <line x1="10" y1="8" x2="10" y2="16"/>
    <line x1="14" y1="8" x2="14" y2="16"/>
    <polyline points="18,8 22,12 18,16"/>
  </svg>`,

  // Down Guy: diagonal line going down-right with small circle at bottom (anchor)
  'DOWN_GUY': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
    <line x1="5" y1="4" x2="18" y2="17"/>
    <circle cx="19" cy="19" r="2.5"/>
  </svg>`,

  // Anchor: filled diamond
  'ANCHOR': `<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1">
    <polygon points="12,3 21,12 12,21 3,12"/>
  </svg>`,

  // ── UNDERGROUND TAB ───────────────────────────────────────

  // HH Handhole: small rectangle with "HH" text inside
  'HH': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <rect x="3" y="7" width="18" height="10" rx="1"/>
    <text x="6" y="16" font-size="7" font-family="Arial" font-weight="bold" fill="currentColor" stroke="none">HH</text>
  </svg>`,

  // MH Manhole: circle with "MH" text inside
  'MH': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
    <circle cx="12" cy="12" r="8"/>
    <text x="7.5" y="15.5" font-size="6.5" font-family="Arial" font-weight="bold" fill="currentColor" stroke="none">MH</text>
  </svg>`,

  // Pedestal: square with X through it
  'PEDESTAL': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
    <rect x="4" y="4" width="16" height="16" rx="1"/>
    <line x1="4" y1="4" x2="20" y2="20"/>
    <line x1="20" y1="4" x2="4" y2="20"/>
  </svg>`,

  // Trench: two parallel horizontal lines (lower one thicker)
  'TRENCH': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round">
    <line x1="3" y1="9" x2="21" y2="9" stroke-width="1.5"/>
    <line x1="3" y1="15" x2="21" y2="15" stroke-width="3"/>
  </svg>`,

  // Bore: dashed line with small arrow tip
  'BORE': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <line x1="2" y1="12" x2="16" y2="12" stroke-dasharray="3 2"/>
    <polyline points="13,8 19,12 13,16"/>
  </svg>`,

  // Splice Pit: dashed border square with two diagonal crossing lines
  'SPLICE_PIT': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <rect x="4" y="4" width="16" height="16" rx="1" stroke-dasharray="3 2"/>
    <line x1="4" y1="4" x2="20" y2="20"/>
    <line x1="20" y1="4" x2="4" y2="20"/>
  </svg>`,

  // MH Grade Adj: circle with up-arrow inside
  'MH_GRADE_ADJ': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="8"/>
    <line x1="12" y1="16" x2="12" y2="9"/>
    <polyline points="9,12 12,8 15,12"/>
  </svg>`,

  // ── CABLE TAB ─────────────────────────────────────────────

  // Copper Cable: solid horizontal line with "C" label in center circle
  'COPPER_CABLE': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
    <line x1="2" y1="12" x2="9" y2="12"/>
    <circle cx="12" cy="12" r="4" stroke-width="1.5"/>
    <text x="9.5" y="15.5" font-size="6.5" font-family="Arial" font-weight="bold" fill="currentColor" stroke="none">C</text>
    <line x1="15" y1="12" x2="22" y2="12"/>
  </svg>`,

  // Fiber Cable: solid horizontal line with "F" label in center circle
  'FIBER_CABLE': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
    <line x1="2" y1="12" x2="9" y2="12"/>
    <circle cx="12" cy="12" r="4" stroke-width="1.5"/>
    <text x="9.8" y="15.5" font-size="6.5" font-family="Arial" font-weight="bold" fill="currentColor" stroke="none">F</text>
    <line x1="15" y1="12" x2="22" y2="12"/>
  </svg>`,

  // Coax Cable: solid horizontal line with "O" label in center circle
  'COAX_CABLE': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
    <line x1="2" y1="12" x2="9" y2="12"/>
    <circle cx="12" cy="12" r="4" stroke-width="1.5"/>
    <text x="9.3" y="15.5" font-size="6.5" font-family="Arial" font-weight="bold" fill="currentColor" stroke="none">O</text>
    <line x1="15" y1="12" x2="22" y2="12"/>
  </svg>`,

  // ── SPLICING TAB ──────────────────────────────────────────

  // Splice Wizard: diamond shape ◇
  'SPLICE_WIZARD': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <polygon points="12,3 21,12 12,21 3,12"/>
  </svg>`,

  // Riser: vertical line with bracket/base at bottom (⊥ style)
  'RISER': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
    <line x1="12" y1="4" x2="12" y2="18"/>
    <line x1="6" y1="18" x2="18" y2="18"/>
    <line x1="6" y1="21" x2="18" y2="21"/>
  </svg>`,

  // Ground Rod: three horizontal lines decreasing in width downward (⏚)
  'GROUND_ROD': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
    <line x1="12" y1="3" x2="12" y2="12"/>
    <line x1="5" y1="12" x2="19" y2="12"/>
    <line x1="7" y1="15.5" x2="17" y2="15.5"/>
    <line x1="9" y1="19" x2="15" y2="19"/>
  </svg>`,

  // Snowshoe: horizontal rectangle with short lines extending from left and right sides
  'SNOWSHOE': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
    <rect x="6" y="9" width="12" height="6" rx="1"/>
    <line x1="2" y1="12" x2="6" y2="12"/>
    <line x1="18" y1="12" x2="22" y2="12"/>
    <line x1="2" y1="9" x2="2" y2="15"/>
    <line x1="22" y1="9" x2="22" y2="15"/>
  </svg>`,

  // Terminal: small square with "T" inside
  'TERMINAL': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
    <rect x="5" y="5" width="14" height="14" rx="1"/>
    <line x1="12" y1="9" x2="12" y2="17"/>
    <line x1="8" y1="9" x2="16" y2="9"/>
  </svg>`,

  // MPOP: diamond with circle center
  'MPOP': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <polygon points="12,3 21,12 12,21 3,12"/>
    <circle cx="12" cy="12" r="3"/>
  </svg>`,

  // ── X-FERS TAB ────────────────────────────────────────────

  // Xfer Pole Attach: pole ⊗ with curved arrow wrapping around it
  'XFER_POLE_ATTACH': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="10" cy="12" r="6"/>
    <line x1="5.8" y1="7.8" x2="14.2" y2="16.2"/>
    <line x1="14.2" y1="7.8" x2="5.8" y2="16.2"/>
    <path d="M18 6 A8 8 0 0 1 20 12" stroke-width="1.5"/>
    <polyline points="19,9 20,12 17,12"/>
  </svg>`,

  // Xfer Pole Attach Addl: same with "+" symbol
  'XFER_POLE_ATTACH_ADDL': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="9" cy="12" r="5.5"/>
    <line x1="5.1" y1="8.1" x2="12.9" y2="15.9"/>
    <line x1="12.9" y1="8.1" x2="5.1" y2="15.9"/>
    <line x1="17" y1="9" x2="17" y2="15"/>
    <line x1="14" y1="12" x2="20" y2="12"/>
  </svg>`,

  // Xfer Svc Drop: diagonal arrow pointing down-right
  'XFER_SVC_DROP': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <line x1="5" y1="5" x2="19" y2="19"/>
    <polyline points="10,19 19,19 19,10"/>
  </svg>`,

  // Xfer Small Fac: pole ⊗ with small "S" label
  'XFER_SMALL_FAC': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
    <circle cx="10" cy="12" r="6"/>
    <line x1="5.8" y1="7.8" x2="14.2" y2="16.2"/>
    <line x1="14.2" y1="7.8" x2="5.8" y2="16.2"/>
    <text x="17" y="14" font-size="7" font-family="Arial" font-weight="bold" fill="currentColor" stroke="none">S</text>
  </svg>`,

  // Xfer Large Fac: pole ⊗ with small "L" label
  'XFER_LARGE_FAC': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
    <circle cx="10" cy="12" r="6"/>
    <line x1="5.8" y1="7.8" x2="14.2" y2="16.2"/>
    <line x1="14.2" y1="7.8" x2="5.8" y2="16.2"/>
    <text x="17" y="14" font-size="7" font-family="Arial" font-weight="bold" fill="currentColor" stroke="none">L</text>
  </svg>`,

  // Xfer Pole Tag: rectangle tag shape with small hole at left (price tag)
  'XFER_POLE_TAG': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M4 12 L8 6 L21 6 L21 18 L8 18 Z"/>
    <circle cx="7" cy="12" r="1.5" fill="none" stroke-width="1.5"/>
  </svg>`,

  // ── REMOVALS TAB ──────────────────────────────────────────

  // Rmv Pole: pole ⊗ with X overlaid
  'RMV_POLE': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
    <circle cx="12" cy="12" r="7"/>
    <line x1="7.1" y1="7.1" x2="16.9" y2="16.9"/>
    <line x1="16.9" y1="7.1" x2="7.1" y2="16.9"/>
    <line x1="3" y1="3" x2="21" y2="21" stroke-width="2"/>
    <line x1="21" y1="3" x2="3" y2="21" stroke-width="2"/>
  </svg>`,

  // Rmv Anchor: diamond with X overlaid
  'RMV_ANCHOR': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
    <polygon points="12,3 21,12 12,21 3,12"/>
    <line x1="5" y1="5" x2="19" y2="19" stroke-width="2"/>
    <line x1="19" y1="5" x2="5" y2="19" stroke-width="2"/>
  </svg>`,

  // Rmv Aer Copper: horizontal line with X marks + "C"
  'RMV_AER_COPPER': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
    <line x1="2" y1="12" x2="22" y2="12"/>
    <line x1="6" y1="9" x2="9" y2="15"/>
    <line x1="9" y1="9" x2="6" y2="15"/>
    <text x="12" y="10" font-size="6" font-family="Arial" font-weight="bold" fill="currentColor" stroke="none">C</text>
  </svg>`,

  // Rmv UG Copper: dashed line with X marks + "C"
  'RMV_UG_COPPER': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
    <line x1="2" y1="12" x2="22" y2="12" stroke-dasharray="3 2"/>
    <line x1="6" y1="9" x2="9" y2="15"/>
    <line x1="9" y1="9" x2="6" y2="15"/>
    <text x="12" y="10" font-size="6" font-family="Arial" font-weight="bold" fill="currentColor" stroke="none">C</text>
  </svg>`,

  // Rmv Aer Fiber: horizontal line with X marks + "F"
  'RMV_AER_FIBER': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
    <line x1="2" y1="12" x2="22" y2="12"/>
    <line x1="6" y1="9" x2="9" y2="15"/>
    <line x1="9" y1="9" x2="6" y2="15"/>
    <text x="12" y="10" font-size="6" font-family="Arial" font-weight="bold" fill="currentColor" stroke="none">F</text>
  </svg>`,

  // Rmv UG Fiber: dashed line with X marks + "F"
  'RMV_UG_FIBER': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
    <line x1="2" y1="12" x2="22" y2="12" stroke-dasharray="3 2"/>
    <line x1="6" y1="9" x2="9" y2="15"/>
    <line x1="9" y1="9" x2="6" y2="15"/>
    <text x="12" y="10" font-size="6" font-family="Arial" font-weight="bold" fill="currentColor" stroke="none">F</text>
  </svg>`,

  // ── MISC TAB ──────────────────────────────────────────────

  // TNE: clock face with T&E label
  'TNE': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
    <circle cx="12" cy="12" r="8"/>
    <line x1="12" y1="7" x2="12" y2="12"/>
    <line x1="12" y1="12" x2="16" y2="12"/>
    <text x="5.5" y="22" font-size="5" font-family="Arial" font-weight="bold" fill="currentColor" stroke="none">T&amp;E</text>
  </svg>`,

  // Downtime: pause symbol ⏸ (two vertical bars)
  'DOWNTIME': `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <rect x="6" y="5" width="4" height="14" rx="1"/>
    <rect x="14" y="5" width="4" height="14" rx="1"/>
  </svg>`,

  // ── POTHOLE ───────────────────────────────────────────────
  // Bold brown circle with capital P (hardcoded brown per user spec)
  'POTHOLE': `<svg viewBox="0 0 24 24" fill="none" stroke="#8B4513" stroke-width="2.5" stroke-linecap="round">
    <circle cx="12" cy="12" r="8" stroke="#8B4513" stroke-width="2.5"/>
    <text x="8.2" y="16.5" font-size="10" font-family="Arial" font-weight="900" fill="#8B4513" stroke="none">P</text>
  </svg>`,

  // ── ASW ───────────────────────────────────────────────────
  // Solid line with "ASW" text centered in a small box
  'ASW': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
    <line x1="2" y1="12" x2="8" y2="12"/>
    <rect x="8" y="9" width="8" height="6" rx="1" stroke-width="1" fill="none"/>
    <text x="9" y="15" font-size="4.5" font-family="Arial" font-weight="bold" fill="currentColor" stroke="none">ASW</text>
    <line x1="16" y1="12" x2="22" y2="12"/>
  </svg>`,

  // ── BSW ───────────────────────────────────────────────────
  // Dashed line with "BSW" text centered in a small box
  'BSW': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
    <line x1="2" y1="12" x2="8" y2="12" stroke-dasharray="2 1.5"/>
    <rect x="8" y="9" width="8" height="6" rx="1" stroke-width="1" fill="none"/>
    <text x="9" y="15" font-size="4.5" font-family="Arial" font-weight="bold" fill="currentColor" stroke="none">BSW</text>
    <line x1="16" y1="12" x2="22" y2="12" stroke-dasharray="2 1.5"/>
  </svg>`,

  // ── RMV_FIBER (Cable tab) ─────────────────────────────────
  // Horizontal line with X marks + "F" label above
  'RMV_FIBER': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
    <line x1="2" y1="14" x2="22" y2="14"/>
    <line x1="5" y1="10" x2="9" y2="18"/>
    <line x1="9" y1="10" x2="5" y2="18"/>
    <line x1="14" y1="10" x2="18" y2="18"/>
    <line x1="18" y1="10" x2="14" y2="18"/>
    <text x="10" y="9" font-size="6" font-family="Arial" font-weight="bold" fill="currentColor" stroke="none">F</text>
  </svg>`,

  // ── RMV_COPPER (Cable tab) ────────────────────────────────
  // Horizontal line with X marks + "C" label above
  'RMV_COPPER': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
    <line x1="2" y1="14" x2="22" y2="14"/>
    <line x1="5" y1="10" x2="9" y2="18"/>
    <line x1="9" y1="10" x2="5" y2="18"/>
    <line x1="14" y1="10" x2="18" y2="18"/>
    <line x1="18" y1="10" x2="14" y2="18"/>
    <text x="10" y="9" font-size="6" font-family="Arial" font-weight="bold" fill="currentColor" stroke="none">C</text>
  </svg>`,

  // ── RMV_ASW ───────────────────────────────────────────────
  // Line with X marks + "ASW" micro-label above
  'RMV_ASW': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
    <line x1="2" y1="15" x2="22" y2="15"/>
    <line x1="5" y1="11" x2="8" y2="19"/>
    <line x1="8" y1="11" x2="5" y2="19"/>
    <line x1="15" y1="11" x2="18" y2="19"/>
    <line x1="18" y1="11" x2="15" y2="19"/>
    <text x="8" y="9.5" font-size="5" font-family="Arial" font-weight="bold" fill="currentColor" stroke="none">ASW</text>
  </svg>`,

  // ── RMV_BSW ───────────────────────────────────────────────
  // Dashed line with X marks + "BSW" micro-label above
  'RMV_BSW': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
    <line x1="2" y1="15" x2="22" y2="15" stroke-dasharray="3 2"/>
    <line x1="5" y1="11" x2="8" y2="19"/>
    <line x1="8" y1="11" x2="5" y2="19"/>
    <line x1="15" y1="11" x2="18" y2="19"/>
    <line x1="18" y1="11" x2="15" y2="19"/>
    <text x="8" y="9.5" font-size="5" font-family="Arial" font-weight="bold" fill="currentColor" stroke="none">BSW</text>
  </svg>`,

  // ── RMV_BURIED_FAC ────────────────────────────────────────
  // Red dashed rectangle with crosshatch diagonal lines (50% opacity via CSS not SVG)
  'RMV_BURIED_FAC': `<svg viewBox="0 0 24 24" fill="none" stroke="#CC0000" stroke-width="1.5" stroke-linecap="round">
    <rect x="2" y="5" width="20" height="14" rx="1" stroke-dasharray="3 2"/>
    <line x1="2" y1="5" x2="22" y2="19" stroke-width="1"/>
    <line x1="22" y1="5" x2="2" y2="19" stroke-width="1"/>
    <line x1="2" y1="10" x2="15" y2="19" stroke-width="0.75"/>
    <line x1="9" y1="5" x2="22" y2="14" stroke-width="0.75"/>
  </svg>`,

  // ── SPLICER_FIBER ─────────────────────────────────────────
  // Person silhouette (hard hat) + "F" — splicer at work on fiber
  'SPLICER_FIBER': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="5" r="2.5"/>
    <path d="M8 21 L8 13 Q8 10 12 10 Q16 10 16 13 L16 21"/>
    <line x1="8" y1="16" x2="16" y2="16"/>
    <line x1="6" y1="8" x2="18" y2="8" stroke-width="2"/>
    <text x="9" y="20" font-size="4" font-family="Arial" font-weight="bold" fill="currentColor" stroke="none">F</text>
  </svg>`,

  // ── SPLICER_COPPER ────────────────────────────────────────
  // Same person silhouette + "C"
  'SPLICER_COPPER': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="5" r="2.5"/>
    <path d="M8 21 L8 13 Q8 10 12 10 Q16 10 16 13 L16 21"/>
    <line x1="8" y1="16" x2="16" y2="16"/>
    <line x1="6" y1="8" x2="18" y2="8" stroke-width="2"/>
    <text x="9" y="20" font-size="4" font-family="Arial" font-weight="bold" fill="currentColor" stroke="none">C</text>
  </svg>`,

  // ── EMERGENCY_TRAVEL ──────────────────────────────────────
  // Lightning bolt inside a circle (emergency/urgent)
  'EMERGENCY_TRAVEL': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="9"/>
    <polygon points="13,4 7,13 12,13 11,20 17,11 12,11" fill="currentColor" stroke="none"/>
  </svg>`,

  // ── GRUBBING ──────────────────────────────────────────────
  // Shovel: long handle diagonal + scoop at bottom-right
  'GRUBBING': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <line x1="5" y1="4" x2="16" y2="15"/>
    <line x1="3" y1="6" x2="7" y2="2"/>
    <path d="M16 15 Q20 15 20 19 Q20 22 16 21 Q13 21 13 17 Z" stroke-width="1.5"/>
  </svg>`,

  // ── ROD_PROOF ─────────────────────────────────────────────
  // Ground rod symbol (⏚) + small checkmark = tested/proven
  'ROD_PROOF': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
    <line x1="12" y1="2" x2="12" y2="10"/>
    <line x1="5" y1="10" x2="19" y2="10"/>
    <line x1="7" y1="13.5" x2="17" y2="13.5"/>
    <line x1="9" y1="17" x2="15" y2="17"/>
    <polyline points="14,20 17,23 22,17" stroke-width="1.5" stroke="#0000CC"/>
  </svg>`,

  // ── LOC_SONDE ─────────────────────────────────────────────
  // Locator wand: vertical stick with signal waves radiating upward
  'LOC_SONDE': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
    <line x1="12" y1="10" x2="12" y2="22"/>
    <line x1="9" y1="22" x2="15" y2="22"/>
    <path d="M9 10 Q12 6 15 10" stroke-width="1.5" fill="none"/>
    <path d="M6 8 Q12 2 18 8" stroke-width="1.5" fill="none"/>
  </svg>`,

};


// ── Icon injection ─────────────────────────────────────────

function injectToolIcons() {
  document.querySelectorAll('.tool-btn').forEach(btn => {
    if (btn.querySelector('.tool-icon')) return; // already done
    const key = btn.dataset.tool || btn.dataset.key || '';
    const svg = TOOL_ICONS[key];
    if (!svg) return;
    const existingText = btn.textContent.trim();
    btn.innerHTML = `<span class="tool-icon">${svg}</span><span class="tool-label">${existingText}</span>`;
  });
}

// Run after DOM is ready, then re-run once to catch late-injected buttons
function safeInit() {
  init();
  // Re-draw grid after layout settles (fonts, notes bar, header fully painted)
  setTimeout(() => { sizeCanvas(); drawGrid(); }, 150);
  setTimeout(() => { sizeCanvas(); drawGrid(); }, 500);
  // Icon injection
  setTimeout(injectToolIcons, 50);
  setTimeout(injectToolIcons, 600);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', safeInit);
} else {
  safeInit();
}

// Aliases for original HTML button keys that get replaced/renamed by injectMiscTab
TOOL_ICONS['SPLICE_CASE']    = TOOL_ICONS['SPLICE_WIZARD'];

// Cable tab removal button key aliases (data-key on buttons)
TOOL_ICONS['RMV_FIBER']      = TOOL_ICONS['RMV_FIBER'];    // already defined
TOOL_ICONS['RMV_COPPER']     = TOOL_ICONS['RMV_COPPER'];   // already defined
TOOL_ICONS['RMV_ASW']        = TOOL_ICONS['RMV_ASW'];      // already defined
TOOL_ICONS['RMV_BSW']        = TOOL_ICONS['RMV_BSW'];      // already defined

// Misc tab injected button key aliases
TOOL_ICONS['TNE']            = TOOL_ICONS['TNE'];           // already defined
TOOL_ICONS['GRUBBING']       = TOOL_ICONS['GRUBBING'];      // already defined
TOOL_ICONS['ROD_PROOF']      = TOOL_ICONS['ROD_PROOF'];     // already defined
TOOL_ICONS['LOC_SONDE']      = TOOL_ICONS['LOC_SONDE'];     // already defined
TOOL_ICONS['SPLICER_FIBER']  = TOOL_ICONS['SPLICER_FIBER']; // already defined
TOOL_ICONS['SPLICER_COPPER'] = TOOL_ICONS['SPLICER_COPPER'];// already defined
TOOL_ICONS['EMERGENCY_TRAVEL']= TOOL_ICONS['EMERGENCY_TRAVEL']; // already defined
TOOL_ICONS['VAC_TRUCK']        = TOOL_ICONS['VAC_TRUCK'];         // pass-through

// XFERS: pole circle (with X) + curved transfer arrow
TOOL_ICONS['XFERS'] = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <!-- Pole circle -->
  <circle cx="10" cy="12" r="6"/>
  <!-- X through circle -->
  <line x1="5.8" y1="7.8" x2="14.2" y2="16.2"/>
  <line x1="14.2" y1="7.8" x2="5.8" y2="16.2"/>
  <!-- Curved transfer arrow pointing away from pole -->
  <path d="M17 8 Q21 12 17 16" stroke-width="1.5" fill="none"/>
  <polyline points="15.5,15 17,16 17.5,14" stroke-width="1.5" fill="none"/>
</svg>`;

// ============================================================
// MAP PANEL — Google Maps background capture
// ============================================================
// NOTE: googleMap and mapGeocoder are initialized in the inline <script> in
// index.html (window.googleMap / window.mapGeocoder) so they are available
// before this ES module loads. We just reference window.* here.

// If the map was already ready before this module ran, nothing to do.
// If it fires after, the 'googleMapReady' event triggers a resize.
document.addEventListener('googleMapReady', () => {
  // Map is initialized — if the modal is already open, trigger resize
  const modal = document.getElementById('map-modal');
  if (modal && modal.style.display === 'flex' && window.googleMap) {
    setTimeout(() => google.maps.event.trigger(window.googleMap, 'resize'), 150);
  }
});

// Open map modal
document.getElementById('btn-map').addEventListener('click', () => {
  const modal = document.getElementById('map-modal');
  modal.style.display = 'flex';
  if (window.googleMap) {
    setTimeout(() => {
      google.maps.event.trigger(window.googleMap, 'resize');
      // Re-center on user location every time the map opens
      if (window.goToUserLocation) window.goToUserLocation();
    }, 150);
  }
});

// MY LOCATION button
document.getElementById('map-locate-btn').addEventListener('click', () => {
  const btn = document.getElementById('map-locate-btn');
  btn.textContent = '⊙ LOCATING...';
  btn.disabled = true;
  if (window.goToUserLocation) {
    window.goToUserLocation((success) => {
      btn.innerHTML = '&#9737; MY LOCATION';
      btn.disabled = false;
      if (!success) alert('Could not get your location. Make sure location access is allowed in your browser.');
    });
  } else {
    btn.innerHTML = '&#9737; MY LOCATION';
    btn.disabled = false;
  }
});

// Close map modal
document.getElementById('map-close-btn').addEventListener('click', () => {
  document.getElementById('map-modal').style.display = 'none';
});

// Close on backdrop click
document.getElementById('map-modal').addEventListener('click', (e) => {
  if (e.target === document.getElementById('map-modal')) {
    document.getElementById('map-modal').style.display = 'none';
  }
});

// Address search
document.getElementById('map-search-btn').addEventListener('click', mapSearch);
document.getElementById('map-address-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') mapSearch();
});

function mapSearch() {
  if (!window.googleMap) return;
  const address = document.getElementById('map-address-input').value.trim();
  if (!address) return;

  const btn = document.getElementById('map-search-btn');
  btn.textContent = '...';
  btn.disabled = true;

  const done = () => { btn.textContent = 'SEARCH'; btn.disabled = false; };

  // --- Strategy 1: Places FindPlaceFromQuery (works on Maps JS API key alone) ---
  try {
    const svc = new google.maps.places.PlacesService(window.googleMap);
    svc.findPlaceFromQuery(
      { query: address, fields: ['geometry', 'name'] },
      (results, status) => {
        if (status === google.maps.places.PlacesServiceStatus.OK && results && results[0]) {
          window.googleMap.setCenter(results[0].geometry.location);
          window.googleMap.setZoom(18);
          done();
        } else {
          // --- Strategy 2: Geocoder fallback ---
          _mapSearchGeocode(address, done);
        }
      }
    );
  } catch (e) {
    // Places library not loaded — fall back to geocoder
    _mapSearchGeocode(address, done);
  }
}

function _mapSearchGeocode(address, done) {
  if (window.mapGeocoder) {
    window.mapGeocoder.geocode({ address }, (results, status) => {
      if (status === 'OK' && results && results[0]) {
        window.googleMap.setCenter(results[0].geometry.location);
        window.googleMap.setZoom(18);
      } else {
        alert('Address not found (status: ' + status + '). Try a full street address including city and state.');
      }
      done();
    });
  } else {
    alert('Search unavailable — map not fully loaded yet. Try again in a moment.');
    done();
  }
}

// Satellite / Street view toggle
document.getElementById('map-view-satellite').addEventListener('click', () => {
  if (!window.googleMap) return;
  window.googleMap.setMapTypeId('satellite');
  window.googleMap.setTilt(0);
  document.getElementById('map-view-satellite').style.background = '#1565c0';
  document.getElementById('map-view-satellite').style.color = '#fff';
  document.getElementById('map-view-roadmap').style.background = '#333';
  document.getElementById('map-view-roadmap').style.color = '#aaa';
});

document.getElementById('map-view-roadmap').addEventListener('click', () => {
  if (!window.googleMap) return;
  window.googleMap.setMapTypeId('roadmap');
  document.getElementById('map-view-roadmap').style.background = '#1565c0';
  document.getElementById('map-view-roadmap').style.color = '#fff';
  document.getElementById('map-view-satellite').style.background = '#333';
  document.getElementById('map-view-satellite').style.color = '#aaa';
});

// Capture map view and set as canvas background
// Uses Static Maps API directly — html2canvas cannot capture Google Maps tiles (CORS blocked)
document.getElementById('map-capture-btn').addEventListener('click', () => {
  if (!window.googleMap) return;

  const captureBtn = document.getElementById('map-capture-btn');
  captureBtn.textContent = 'CAPTURING...';
  captureBtn.disabled = true;

  const center  = window.googleMap.getCenter();
  const zoom    = window.googleMap.getZoom();
  const mapType = window.googleMap.getMapTypeId(); // 'satellite' or 'roadmap'

  // Build canvas dimensions for the request
  const cw = Math.round(canvas.getWidth());
  const ch = Math.round(canvas.getHeight());
  // Static Maps API max size is 640x640 on standard, 1280x1280 on premium
  // We request the closest fit within 1280, then scale to fill canvas
  const reqW = Math.min(cw, 1280);
  const reqH = Math.min(ch, 1280);

  const staticUrl = [
    'https://maps.googleapis.com/maps/api/staticmap',
    '?center=' + center.lat() + ',' + center.lng(),
    '&zoom=' + zoom,
    '&size=' + reqW + 'x' + reqH,
    '&scale=2',
    '&maptype=' + mapType,
    '&key=AIzaSyBRrs_7R-edB7ffraBtksAWmdSa3OT0XuA',
  ].join('');

  fabric.Image.fromURL(staticUrl, (img) => {
    captureBtn.textContent = 'USE AS BACKGROUND';
    captureBtn.disabled = false;

    if (!img || !img.width) {
      alert('Map capture failed. Make sure the Static Maps API is enabled for this key in Google Cloud Console.');
      return;
    }

    img.set({
      left:           0,
      top:            0,
      scaleX:         cw / img.width,
      scaleY:         ch / img.height,
      selectable:     true,
      evented:        true,
      lockMovementX:  false,
      lockMovementY:  false,
      hasControls:    true,
      hasBorders:     true,
      lockUniScaling: false,
    });
    img.nscData = { type: 'MAP_BACKGROUND' };

    // Remove any previous background
    canvas.getObjects().forEach(obj => {
      if (obj.nscData && obj.nscData.type === 'MAP_BACKGROUND') canvas.remove(obj);
    });

    canvas.add(img);
    canvas.sendToBack(img);
    canvas.renderAll();
    pushHistory();
    document.getElementById('map-modal').style.display = 'none';
  }, { crossOrigin: 'anonymous' });
});

// ============================================================
// RIGHT-CLICK CONTEXT MENU (Map/Photo images)
// ============================================================
(function setupContextMenu() {
  const menu = document.getElementById('canvas-context-menu');
  let _ctxTarget = null;
  let _clipboardImg = null;

  function hideMenu() {
    // If we temporarily re-enabled evented on a flattened bg, lock it back down
    if (_ctxTarget && _ctxTarget.nscData && _ctxTarget.nscData.type === 'FLATTENED_BACKGROUND') {
      _ctxTarget.set({ evented: false, selectable: false });
      canvas.discardActiveObject();
      canvas.renderAll();
    }
    menu.style.display = 'none';
    _ctxTarget = null;
  }

  // Hide on any click outside menu
  document.addEventListener('mousedown', (e) => {
    if (!menu.contains(e.target)) hideMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideMenu();
  });

  // Fabric right-click handler
  canvas.on('mouse:down', function(opt) {
    if (opt.e.button !== 2) return;
    opt.e.preventDefault();
    opt.e.stopPropagation();

    const target = opt.target;
    const isImage = target && target.type === 'image';
    const isMapOrPhoto = isImage && target.nscData &&
      (target.nscData.type === 'MAP_BACKGROUND' || target.nscData.type === 'PHOTO_IMPORT' || target.nscData.type === 'FLATTENED_BACKGROUND');

    if (!isMapOrPhoto) { hideMenu(); return; }

    _ctxTarget = target;

    // Show/hide flatten vs unflatten based on current state
    const isFlattened = target.nscData.type === 'FLATTENED_BACKGROUND';
    document.getElementById('ctx-flatten').style.display   = isFlattened ? 'none'  : 'flex';
    document.getElementById('ctx-unflatten').style.display = isFlattened ? 'flex'  : 'none';

    // Re-enable evented temporarily so we can show the menu
    if (isFlattened) {
      target.set({ evented: true });
    }

    canvas.setActiveObject(target);
    canvas.renderAll();

    // Position menu near cursor
    const canvasEl = canvas.getElement().parentElement; // .canvas-container
    const rect = canvasEl.getBoundingClientRect();
    let mx = opt.e.clientX;
    let my = opt.e.clientY;

    menu.style.display = 'block';
    // Keep menu on screen
    const mw = menu.offsetWidth || 180;
    const mh = menu.offsetHeight || 220;
    if (mx + mw > window.innerWidth)  mx = window.innerWidth  - mw - 8;
    if (my + mh > window.innerHeight) my = window.innerHeight - mh - 8;
    menu.style.left = mx + 'px';
    menu.style.top  = my + 'px';
  });

  // Prevent browser native right-click on canvas
  canvas.getElement().addEventListener('contextmenu', e => e.preventDefault());

  // FLATTEN — lock THIS image as a permanent, non-interactive background.
  // All other objects on the canvas stay fully editable on top of it.
  document.getElementById('ctx-flatten').addEventListener('click', () => {
    if (!_ctxTarget) { hideMenu(); return; }
    const obj = _ctxTarget;
    hideMenu();

    // Lock the map/photo image in place — no selection, no movement, no controls.
    // Keep its current position and scale so nothing shifts.
    obj.set({
      selectable:    false,
      evented:       false,
      lockMovementX: true,
      lockMovementY: true,
      hasControls:   false,
      hasBorders:    false,
    });
    obj.nscData = { type: 'FLATTENED_BACKGROUND' };

    // Push it all the way to the back so every tool icon sits on top.
    canvas.sendToBack(obj);
    canvas.discardActiveObject();
    canvas.renderAll();
    pushHistory();
  });

  // UNFLATTEN — restore the background image to fully resizable/moveable
  document.getElementById('ctx-unflatten').addEventListener('click', () => {
    if (!_ctxTarget) { hideMenu(); return; }
    const obj = _ctxTarget;
    obj.set({
      selectable:    true,
      evented:       true,
      lockMovementX: false,
      lockMovementY: false,
      hasControls:   true,
      hasBorders:    true,
    });
    obj.nscData = { type: 'MAP_BACKGROUND' };
    canvas.setActiveObject(obj);
    canvas.renderAll();
    pushHistory();
    // Clear _ctxTarget before calling hideMenu so it doesn't re-lock
    _ctxTarget = null;
    menu.style.display = 'none';
  });

  // COPY
  document.getElementById('ctx-copy').addEventListener('click', () => {
    if (!_ctxTarget) { hideMenu(); return; }
    _ctxTarget.clone((cloned) => { _clipboardImg = cloned; });
    hideMenu();
  });

  // PASTE
  document.getElementById('ctx-paste').addEventListener('click', () => {
    hideMenu();
    if (!_clipboardImg) return;
    _clipboardImg.clone((cloned) => {
      cloned.set({ left: (_clipboardImg.left || 0) + 20, top: (_clipboardImg.top || 0) + 20 });
      if (!cloned.nscData) cloned.nscData = { type: 'PHOTO_IMPORT' };
      cloned.set({ selectable: true, evented: true, hasControls: true, hasBorders: true });
      canvas.add(cloned);
      canvas.setActiveObject(cloned);
      canvas.renderAll();
      pushHistory();
    });
  });

  // DELETE
  document.getElementById('ctx-delete').addEventListener('click', () => {
    if (!_ctxTarget) { hideMenu(); return; }
    canvas.remove(_ctxTarget);
    canvas.renderAll();
    pushHistory();
    hideMenu();
  });

  // SEND TO BACK
  document.getElementById('ctx-send-back').addEventListener('click', () => {
    if (!_ctxTarget) { hideMenu(); return; }
    canvas.sendToBack(_ctxTarget);
    canvas.renderAll();
    pushHistory();
    hideMenu();
  });

  // BRING TO FRONT
  document.getElementById('ctx-bring-front').addEventListener('click', () => {
    if (!_ctxTarget) { hideMenu(); return; }
    canvas.bringToFront(_ctxTarget);
    canvas.renderAll();
    pushHistory();
    hideMenu();
  });
})();
