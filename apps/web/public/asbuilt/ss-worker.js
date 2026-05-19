// Cloudflare Worker — Smartsheet Job Lookup Proxy
// Deploy at: https://workers.cloudflare.com
// Environment variables (set in CF dashboard, NOT here):
//   SS_TOKEN = Smartsheet bearer token
//   SS_SHEET = Sheet ID

const SHEET_ID = '1833739362822020';

// Column IDs we care about
const COLS = {
  workOrder:  '4680657223346052',
  supervisor: '8776041144995716',
  foreman:    '4146149265985412',
  address:    '7094520111753092',
  city:       '1465020577539972',
  zip:        '4822376816371588',
  jobStatus:  '4721327342413700',
  schedDate:  '7671030022360964',
  tcRequired: '6789809108373380',
  notes:      '6458790863759236',
  customer:   '1669618860877700',
  sapOrder:   '8974365654470532',
};

async function handleRequest(request, env) {
  // CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      }
    });
  }

  const url    = new URL(request.url);
  const workOrder = url.searchParams.get('wo');

  if (!workOrder) {
    return json({ error: 'Missing ?wo= parameter' }, 400);
  }

  const token = env.SS_TOKEN || '2RrwMyQPbc3MzzBE0jl05SFUgTndzBvctSsfO';

  // Fetch entire sheet (Smartsheet doesn't support server-side cell search)
  const ssRes = await fetch(
    `https://api.smartsheet.com/2.0/sheets/${SHEET_ID}?includeAll=true`,
    { headers: { 'Authorization': `Bearer ${token}` } }
  );

  if (!ssRes.ok) {
    return json({ error: `Smartsheet error: ${ssRes.status}` }, 502);
  }

  const sheet = await ssRes.json();

  // Build col id → array index map
  const colIndex = {};
  sheet.columns.forEach((c, i) => { colIndex[c.id] = i; });

  const woIdx = colIndex[COLS.workOrder];

  const match = sheet.rows.find(row => {
    const cell = row.cells[woIdx];
    return cell && String(cell.displayValue || cell.value || '')
      .trim().toLowerCase() === workOrder.trim().toLowerCase();
  });

  if (!match) {
    return json({ found: false, workOrder });
  }

  const get = (colId) => {
    const idx  = colIndex[colId];
    if (idx === undefined) return '';
    const cell = match.cells[idx];
    return cell ? (cell.displayValue ?? cell.value ?? '') : '';
  };

  return json({
    found:      true,
    workOrder:  get(COLS.workOrder),
    sapOrder:   get(COLS.sapOrder),
    supervisor: get(COLS.supervisor),
    foreman:    get(COLS.foreman),
    address:    get(COLS.address),
    city:       get(COLS.city),
    zip:        get(COLS.zip),
    jobStatus:  get(COLS.jobStatus),
    schedDate:  get(COLS.schedDate),
    tcRequired: get(COLS.tcRequired),
    notes:      get(COLS.notes),
    customer:   get(COLS.customer),
  });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    }
  });
}

export default { fetch: handleRequest };




Contains: js/app.js (full ~4,224 lines)
