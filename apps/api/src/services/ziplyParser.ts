import { GoogleGenerativeAI } from "@google/generative-ai";

export class ZiplyPrintParseError extends Error {
  readonly code = "ziply_ai_parse_failed";
  readonly statusCode = 502;

  constructor(message: string) {
    super(message);
    this.name = "ZiplyPrintParseError";
  }
}

const ZIPLY_GEMINI_MODEL = "gemini-2.5-flash";
// Gemini 2.5 Flash supports up to 65,536 output tokens. Large multi-page
// FTTH prints can require tens of thousands of tokens when extracting all
// cable, terminal, address, permit, and construction details into JSON.
const ZIPLY_MAX_OUTPUT_TOKENS = 65_536;

const SYSTEM_INSTRUCTION =
  "You are an expert broadband telecom engineer specialized in Booker Engineering / Ziply FTTH " +
  "construction plan sets (cover sheets, sheet index, plan view sheets, details, legends). " +
  "You read house numbers on parcels, mainline fiber along named roads (e.g. Metron Rd), " +
  "MST/FDH symbols, bore/trench/aerial callouts, stationing (12+50 style), and footages. " +
  "Extract EVERY terminal, house number, cable segment, and station/offset when shown. " +
  "Return JSON strictly conforming to the requested schema. Never invent house numbers not on the sheet.";

export interface ZiplyParsedPrint {
  hubId: string | null;
  hubTypeSize: string | null;
  ziplyInspector: string | null;
  terminalCount: number | null;
  fiberCountsPerCable: string[] | null;
  drops: {
    lu: number | null;
    mdu: number | null;
    bu: number | null;
    total: number | null;
  } | null;
  permittedExcavationMethods: string[] | null;
  strandType: string | null;
  conduitSize: string | null;
  specialNotes: string | null;
  permits: {
    cityRow: "Pending" | "Approved" | "Active" | "Closed" | null;
    wsdot: "Pending" | "Approved" | "Active" | "Closed" | null;
    county: "Pending" | "Approved" | "Active" | "Closed" | null;
    railroad: "Pending" | "Approved" | "Active" | "Closed" | null;
    pa: "Pending" | "Approved" | "Active" | "Closed" | null;
    tcp: "Pending" | "Approved" | "Active" | "Closed" | null;
  } | null;
  /** PHYSICAL location: street intersection where the hub/FDH is installed on the plan view. */
  hubAddress?: string | null;
  /** The pole ID the hub is mounted on (e.g. "PSE 226988-169290"). */
  hubPoleId?: string | null;
  /** The street the hub pole sits on (e.g. "132nd Ave NE"). */
  hubPoleStreet?: string | null;
  /** Nearest intersection streets (from plan view) used for geocoding. */
  hubStreetIntersection?: { street1: string | null; street2: string | null } | null;
  /** City / community from title block (e.g. Arlington, Lake Stevens). */
  projectCity?: string | null;
  /** Primary ROW street the mainline follows (e.g. Metron Rd). */
  mainlineStreet?: string | null;
  mapObjects?: {
    cables: Array<{
      label: string;
      fiberCount: string;
      lengthFt: number | null;
      buildType?: "bore" | "trench" | "aerial" | null;
      role?: "mainline" | "lateral" | "feeder" | null;
      /** Terminal this cable feeds (e.g. MST-3) — improves map routing. */
      toTerminal?: string | null;
      /** Intermediate street names the cable follows (geocode later / layout hints). */
      routeStreets?: string[] | null;
      sheetPage?: number | null;
      sequenceOrder?: number | null;
      side?: "left" | "right" | "both" | null;
      /** Station feet along mainline (12+50 → 1250). */
      stationFt?: number | null;
    }>;
    terminals: Array<{
      label: string;
      type: string;
      portCount?: number | null;
      footageFt?: number | null;
      footageLabel?: string | null;
      dvftpRange?: string | null;
      code?: string | null;
      fiberSpec?: string | null;
      addressesServed?: string[] | null;
      /** Parcel house numbers from plan (e.g. "18052", "18118"). */
      houseNumbers?: string[] | null;
      sheetPage?: number | null;
      sequenceOrder?: number | null;
      side?: "left" | "right" | null;
      /** Station feet along mainline from plan. */
      stationFt?: number | null;
      /** Offset feet from mainline centerline to MST/parcel. */
      offsetFt?: number | null;
      /** Normalized page coords 0–1 (left→right, top→bottom) for affine reg. */
      sheetX?: number | null;
      sheetY?: number | null;
      /** Cross street if lateral leaves mainline. */
      crossStreet?: string | null;
    }>;
    notes: string | null;
    mainlineStreet?: string | null;
  } | null;
}

function stripJsonFences(text: string): string {
  return text
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
}

function findCompleteJsonPrefix(source: string): string | null {
  const start = source.search(/[\[{]/);
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < source.length; i += 1) {
    const char = source[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{" || char === "[") {
      depth += 1;
    } else if (char === "}" || char === "]") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, i + 1);
      }
      if (depth < 0) return null;
    }
  }

  return null;
}

function parseGeminiJson(responseText: string, finishReason: string | undefined): ZiplyParsedPrint {
  const cleaned = stripJsonFences(responseText);

  try {
    return JSON.parse(cleaned) as ZiplyParsedPrint;
  } catch (firstErr) {
    const completePrefix = findCompleteJsonPrefix(cleaned);
    if (completePrefix && completePrefix !== cleaned) {
      try {
        return JSON.parse(completePrefix) as ZiplyParsedPrint;
      } catch {
        // Fall through to the clear client error below.
      }
    }

    const firstMessage = firstErr instanceof Error ? firstErr.message : String(firstErr);
    const rawPreview = cleaned.slice(0, 2_000);
    // eslint-disable-next-line no-console
    console.warn(
      `[ziplyParser] Failed to parse Gemini JSON. finishReason=${finishReason ?? "unknown"}; ` +
        `length=${cleaned.length}; parseError=${firstMessage}; preview=${rawPreview}`
    );

    const reasonDetail = finishReason ? ` Gemini finish reason: ${finishReason}.` : "";
    throw new ZiplyPrintParseError(
      "Ziply AI parsing returned incomplete or invalid JSON after analyzing the uploaded print." +
        reasonDetail +
        " The print may be too large or complex for a single extraction pass; retry the ingest or split the print into smaller page groups."
    );
  }
}

// Convert base64 data URL to Gemini part object
function dataUrlToPart(dataUrl: string): { inlineData: { data: string; mimeType: string } } {
  const matches = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!matches) {
    throw new Error("Invalid base64 data URL");
  }
  const mimeType = matches[1]!;
  const data = matches[2]!;

  // Allow only images and PDFs
  const supported = [
    "image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif",
    "application/pdf",
  ];
  if (!supported.includes(mimeType.toLowerCase())) {
    throw new Error(`Unsupported file type: ${mimeType}. Use PDF or JPEG/PNG/WEBP.`);
  }

  return {
    inlineData: {
      data,
      mimeType,
    },
  };
}

async function runGeminiJsonPass(
  genai: GoogleGenerativeAI,
  printParts: Array<{ inlineData: { data: string; mimeType: string } }>,
  prompt: string
): Promise<ZiplyParsedPrint> {
  const model = genai.getGenerativeModel({
    model: ZIPLY_GEMINI_MODEL,
    systemInstruction: { role: "system", parts: [{ text: SYSTEM_INSTRUCTION }] },
    generationConfig: {
      temperature: 0.1,
      responseMimeType: "application/json",
      maxOutputTokens: ZIPLY_MAX_OUTPUT_TOKENS,
    },
  });
  const result = await model.generateContent([prompt, ...printParts]);
  const responseText = result.response.text();
  const finishReason = result.response.candidates?.[0]?.finishReason;
  return parseGeminiJson(responseText, finishReason);
}

function terminalHouseCount(p: ZiplyParsedPrint): number {
  let n = 0;
  for (const t of p.mapObjects?.terminals ?? []) {
    n += t.houseNumbers?.length ?? 0;
    n += t.addressesServed?.length ?? 0;
  }
  return n;
}

function mergeParsedDetail(base: ZiplyParsedPrint, detail: ZiplyParsedPrint): ZiplyParsedPrint {
  const bTerms = base.mapObjects?.terminals ?? [];
  const dTerms = detail.mapObjects?.terminals ?? [];
  const byLabel = new Map(bTerms.map((t) => [t.label, { ...t }]));
  for (const t of dTerms) {
    const prev = byLabel.get(t.label);
    if (!prev) {
      byLabel.set(t.label, t);
      continue;
    }
    byLabel.set(t.label, {
      ...prev,
      ...t,
      houseNumbers: [
        ...new Set([...(prev.houseNumbers ?? []), ...(t.houseNumbers ?? [])]),
      ],
      addressesServed: [
        ...new Set([...(prev.addressesServed ?? []), ...(t.addressesServed ?? [])]),
      ],
      stationFt: t.stationFt ?? prev.stationFt,
      offsetFt: t.offsetFt ?? prev.offsetFt,
      sheetX: t.sheetX ?? prev.sheetX,
      sheetY: t.sheetY ?? prev.sheetY,
      side: t.side ?? prev.side,
      sequenceOrder: t.sequenceOrder ?? prev.sequenceOrder,
      crossStreet: t.crossStreet ?? prev.crossStreet,
    });
  }
  const bCables = base.mapObjects?.cables ?? [];
  const dCables = detail.mapObjects?.cables ?? [];
  const cableByLabel = new Map(bCables.map((c) => [c.label, { ...c }]));
  for (const c of dCables) {
    const prev = cableByLabel.get(c.label);
    cableByLabel.set(c.label, prev ? { ...prev, ...c } : c);
  }
  return {
    ...base,
    ...detail,
    hubId: base.hubId ?? detail.hubId,
    hubAddress: base.hubAddress ?? detail.hubAddress,
    projectCity: base.projectCity ?? detail.projectCity,
    mainlineStreet: base.mainlineStreet ?? detail.mainlineStreet,
    mapObjects: {
      mainlineStreet:
        base.mapObjects?.mainlineStreet ??
        detail.mapObjects?.mainlineStreet ??
        base.mainlineStreet ??
        null,
      cables: [...cableByLabel.values()],
      terminals: [...byLabel.values()],
      notes: detail.mapObjects?.notes ?? base.mapObjects?.notes ?? null,
    },
  };
}

export async function parseZiplyPrint(dataUrls: string | string[]): Promise<ZiplyParsedPrint> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not set in environment");

  const genai = new GoogleGenerativeAI(apiKey);
  const urls = Array.isArray(dataUrls) ? dataUrls : [dataUrls];
  const printParts = urls.map(dataUrlToPart);

  const prompt = `
Analyze ALL attached FTTH construction print pages (Booker Engineering / Ziply style).
Include cover, sheet index, PLAN VIEW sheets, details, and legends — not only the cover.

CRITICAL FOR MAP PLACEMENT (read plan sheets carefully):

=== HUB PHYSICAL LOCATION — THIS IS THE MOST IMPORTANT FIELD ===
The hub/FDH/splitter cabinet is a physical piece of equipment bolted to a pole or sitting
in a vault. Its location is shown on the PLAN VIEW sheets as a symbol (rectangle, cabinet,
"P-1" label, "FDH", "S21xx" etc.) at a specific intersection or pole.

- hubAddress: The EXACT STREET INTERSECTION or pole address where the hub cabinet is
  physically located on the plan view sheet. Examples:
    • "132nd Ave NE & NE 144th Pl, Woodinville, WA"
    • "18154 Metron Rd & Cedar Dr, Arlington, WA"
    • "Pole PSE 226988-169290 at 132nd Ave NE"
  DO NOT use the customer/service address from the title block (that is where the fiber
  goes, not where the hub sits). Look at the plan view: find the hub/FDH/cabinet/splitter
  symbol, read the nearby street labels, and report THAT intersection.
  If only a pole number is labeled, include the street it sits on.

- hubStreetIntersection: The two street names that form the nearest intersection to the
  hub on the plan view (e.g. "132nd Ave NE" and "NE 144th Pl"). Always populate this.
- projectCity (e.g. Arlington, Lake Stevens, Woodinville)
- mainlineStreet: the road the thick multi-fiber feeder line follows on the plan view

- On plan views: house numbers printed on parcels (18052, 18118, 18151, 18330…) are REQUIRED.
  Put them in terminals[].houseNumbers AND expand to full addresses when street is known:
  addressesServed: ["18052 Metron Rd"] (or cross-street if labeled)
- Cables along the main road = role "mainline"; short runs to MSTs/houses = role "lateral";
  existing feeder callouts = role "feeder"
- buildType from callouts: BORE / TRENCH / AERIAL / OVERLASH → bore|trench|aerial
- Footage labels like "BORE 42'" or "TRENCH 208'" → lengthFt
- STATIONING: if plan shows 12+50 / STA marks, set stationFt (12+50 → 1250 feet)
- OFFSET: distance from mainline to MST if dimensioned → offsetFt (feet)
- sequenceOrder: order along mainline south→north or up-station as printed
- side: "left" or "right" of mainline looking up-station / north
- sheetX/sheetY: approximate position on the plan page as 0–1 (0,0 = top-left of plan view)
- crossStreet: if lateral leaves mainline onto another named street

FIELDS:
1. Hub ID (H1002, S3065 cabinet id, etc.)
2. Hub Type/Size (port count / vault mount codes)
3. Terminal Count
4. Fiber Counts (48F, 96F, …)
5. Drops LU/MDU/BU/total from cover table
6. Permitted excavation methods
7. Strand / conduit
8. Special notes (existing feeder, school, etc.)
9. Permits table statuses
10. hubAddress (PHYSICAL HUB LOCATION from plan view — see above), hubStreetIntersection, projectCity, mainlineStreet
11. mapObjects — EVERY MST, splice, and cable segment from plan sheets:
    cables: { label, fiberCount, lengthFt, buildType, role, toTerminal, routeStreets,
              sheetPage, sequenceOrder, side, stationFt }
    terminals: { label, type, portCount, footageFt, footageLabel, dvftpRange, code, fiberSpec,
                 addressesServed, houseNumbers, sheetPage, sequenceOrder, side, stationFt, offsetFt,
                 sheetX, sheetY, crossStreet }
    notes, mainlineStreet
    Order terminals south→north or as numbered on the plan index when possible.

Schema:
{
  "hubId": "string or null",
  "hubTypeSize": "string or null",
  "ziplyInspector": "string or null",
  "terminalCount": number or null,
  "fiberCountsPerCable": ["string"],
  "drops": { "lu": number|null, "mdu": number|null, "bu": number|null, "total": number|null },
  "permittedExcavationMethods": ["string"],
  "strandType": "string or null",
  "conduitSize": "string or null",
  "specialNotes": "string or null",
  "hubAddress": "PHYSICAL intersection/pole location of hub from plan view — NOT the customer title block address",
  "hubStreetIntersection": { "street1": "132nd Ave NE", "street2": "NE 144th Pl" },
  "projectCity": "string or null",
  "mainlineStreet": "string or null",
  "permits": {
    "cityRow": "Pending|Approved|Active|Closed|null",
    "wsdot": "Pending|Approved|Active|Closed|null",
    "county": "Pending|Approved|Active|Closed|null",
    "railroad": "Pending|Approved|Active|Closed|null",
    "pa": "Pending|Approved|Active|Closed|null",
    "tcp": "Pending|Approved|Active|Closed|null"
  },
  "mapObjects": {
    "mainlineStreet": "Metron Rd or null",
    "cables": [{"label":"C-1","fiberCount":"48F","lengthFt":250,"buildType":"bore","role":"lateral","toTerminal":"MST-1","routeStreets":["Metron Rd"],"sheetPage":3,"sequenceOrder":4,"side":"left","stationFt":1250}],
    "terminals": [{"label":"MST-1","type":"8-port MST","portCount":8,"footageFt":42,"footageLabel":"BORE 42'","dvftpRange":null,"code":null,"fiberSpec":"12F","houseNumbers":["18052"],"addressesServed":["18052 Metron Rd"],"sheetPage":3,"sequenceOrder":4,"side":"left","stationFt":1250,"offsetFt":35,"sheetX":0.42,"sheetY":0.55,"crossStreet":null}],
    "notes": "string or null"
  }
}
`;

  // Pass 1: full package (cover + plan overview)
  let parsed = await runGeminiJsonPass(genai, printParts, prompt);

  // Pass 2: plan-detail when houses/stations sparse (CAD fidelity)
  const houses = terminalHouseCount(parsed);
  const termN = parsed.mapObjects?.terminals?.length ?? 0;
  const needDetail = houses < 4 || termN < 3 || !parsed.mainlineStreet;
  if (needDetail && printParts.length > 0) {
    try {
      const detailPrompt = `
PASS 2 — PLAN DETAIL ONLY (Booker / Ziply FTTH plan view sheets).
Ignore cover fluff. Extract MAXIMUM house numbers, MST labels, stationing, sides,
sheetX/sheetY (0–1 on plan page), crossStreet for laterals off the mainline.
Return the SAME schema as mapObjects + hubAddress + mainlineStreet + projectCity.
Never invent house numbers not printed on the sheets.
Schema:
{
  "hubAddress": "string|null",
  "projectCity": "string|null",
  "mainlineStreet": "string|null",
  "mapObjects": {
    "mainlineStreet": "string|null",
    "cables": [{"label":"…","fiberCount":"","lengthFt":null,"buildType":"bore","role":"lateral","toTerminal":"…","routeStreets":[],"sheetPage":null,"sequenceOrder":null,"side":"left","stationFt":null}],
    "terminals": [{"label":"…","type":"MST","portCount":null,"footageFt":null,"footageLabel":null,"dvftpRange":null,"code":null,"fiberSpec":null,"houseNumbers":["18052"],"addressesServed":["18052 Metron Rd"],"sheetPage":null,"sequenceOrder":1,"side":"left","stationFt":null,"offsetFt":null,"sheetX":0.5,"sheetY":0.5,"crossStreet":null}],
    "notes": null
  }
}
`;
      const detail = await runGeminiJsonPass(genai, printParts, detailPrompt);
      parsed = mergeParsedDetail(parsed, detail);
      // eslint-disable-next-line no-console
      console.info(
        `[ziplyParser] two-pass merge houses=${terminalHouseCount(parsed)} terminals=${parsed.mapObjects?.terminals?.length ?? 0}`
      );
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[ziplyParser] pass-2 detail failed; using pass-1 only", e);
    }
  }

  return parsed;
}

/** Structured fields extracted from a ROW / city / WSDOT / county permit PDF. */
export interface ZiplyParsedPermit {
  permitNumber: string | null;
  /** cityRow | wsdot | county | railroad | pa | tcp | other */
  permitTypeKey: string | null;
  issuingAgency: string | null;
  status: "Pending" | "Approved" | "Active" | "Closed" | null;
  issueDate: string | null;
  expirationDate: string | null;
  workStartDate: string | null;
  workEndDate: string | null;
  workHours: string | null;
  workLocation: string | null;
  streets: string[] | null;
  excavationMethods: string[] | null;
  trafficControlRequired: boolean | null;
  conditions: string[] | null;
  restrictions: string[] | null;
  contacts: string[] | null;
  summary: string | null;
}

function parseGeminiPermitJson(
  responseText: string,
  finishReason: string | undefined
): ZiplyParsedPermit {
  try {
    const cleaned = stripJsonFences(responseText);
    const jsonText = findCompleteJsonPrefix(cleaned) ?? cleaned;
    const raw = JSON.parse(jsonText) as Record<string, unknown>;
    const str = (k: string) =>
      typeof raw[k] === "string" ? (raw[k] as string).trim() || null : null;
    const strArr = (k: string): string[] | null => {
      if (!Array.isArray(raw[k])) return null;
      const arr = (raw[k] as unknown[])
        .filter((x): x is string => typeof x === "string")
        .map((s) => s.trim())
        .filter(Boolean);
      return arr.length ? arr : null;
    };
    const statusRaw = str("status");
    const statusOk =
      statusRaw === "Pending" ||
      statusRaw === "Approved" ||
      statusRaw === "Active" ||
      statusRaw === "Closed"
        ? statusRaw
        : null;
    return {
      permitNumber: str("permitNumber"),
      permitTypeKey: str("permitTypeKey"),
      issuingAgency: str("issuingAgency"),
      status: statusOk,
      issueDate: str("issueDate"),
      expirationDate: str("expirationDate"),
      workStartDate: str("workStartDate"),
      workEndDate: str("workEndDate"),
      workHours: str("workHours"),
      workLocation: str("workLocation"),
      streets: strArr("streets"),
      excavationMethods: strArr("excavationMethods"),
      trafficControlRequired:
        typeof raw.trafficControlRequired === "boolean"
          ? raw.trafficControlRequired
          : null,
      conditions: strArr("conditions"),
      restrictions: strArr("restrictions"),
      contacts: strArr("contacts"),
      summary: str("summary"),
    };
  } catch (e) {
    const reasonDetail = finishReason ? ` Gemini finish reason: ${finishReason}.` : "";
    throw new ZiplyPrintParseError(
      `Failed to parse permit document JSON.${reasonDetail} ` +
        (e instanceof Error ? e.message : "Unknown parse error")
    );
  }
}

/**
 * AI-extract key fields from a municipal / WSDOT / utility permit PDF or image.
 * Used after the operator uploads a permit for a Ziply job.
 */
export async function parseZiplyPermit(
  dataUrls: string | string[],
  hintPermitType?: string | null
): Promise<ZiplyParsedPermit> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not set in environment");

  const genai = new GoogleGenerativeAI(apiKey);
  const urls = Array.isArray(dataUrls) ? dataUrls : [dataUrls];
  const parts = urls.map(dataUrlToPart);
  const hint = hintPermitType?.trim() || "unknown";

  const prompt = `
You are analyzing a construction / right-of-way / telecom permit document (PDF or image).
The operator labeled this upload as permit type: "${hint}".

Extract every operationally useful field for a fiber construction crew. Return JSON only.

FIELDS:
1. permitNumber — official permit / application / case number
2. permitTypeKey — one of: cityRow, wsdot, county, railroad, pa, tcp, other
   (cityRow = city right-of-way; pa = franchise / power / PA; tcp = traffic control plan)
3. issuingAgency — city, county, WSDOT, railroad, utility, etc.
4. status — Pending | Approved | Active | Closed (use Approved if issued/valid; Active if currently in force)
5. issueDate, expirationDate, workStartDate, workEndDate — ISO-like strings if shown (YYYY-MM-DD preferred)
6. workHours — allowed hours / days of work (e.g. "7am-7pm Mon-Fri")
7. workLocation — address, segment description, or project location text
8. streets — list of street names covered
9. excavationMethods — bore, trench, open cut, aerial, etc. if restricted or allowed
10. trafficControlRequired — true/false if TCP or flaggers required
11. conditions — numbered or bullet conditions that affect construction
12. restrictions — noise, lane closure, seasonal, tree, wetland, etc.
13. contacts — agency contacts / inspector phone or email if present
14. summary — 1-3 sentence plain-English summary for a field supervisor

Schema:
{
  "permitNumber": "string or null",
  "permitTypeKey": "cityRow|wsdot|county|railroad|pa|tcp|other or null",
  "issuingAgency": "string or null",
  "status": "Pending|Approved|Active|Closed or null",
  "issueDate": "string or null",
  "expirationDate": "string or null",
  "workStartDate": "string or null",
  "workEndDate": "string or null",
  "workHours": "string or null",
  "workLocation": "string or null",
  "streets": ["string"],
  "excavationMethods": ["string"],
  "trafficControlRequired": true or false or null,
  "conditions": ["string"],
  "restrictions": ["string"],
  "contacts": ["string"],
  "summary": "string or null"
}
`;

  const model = genai.getGenerativeModel({
    model: ZIPLY_GEMINI_MODEL,
    systemInstruction: {
      role: "system",
      parts: [
        {
          text:
            "You are an expert construction permit analyst for broadband fiber ROW work in Washington State. " +
            "Extract exact numbers, dates, and conditions. Never invent permit numbers. Return strict JSON.",
        },
      ],
    },
    generationConfig: {
      temperature: 0.1,
      responseMimeType: "application/json",
      maxOutputTokens: 8192,
    },
  });

  const result = await model.generateContent([prompt, ...parts]);
  const responseText = result.response.text();
  const finishReason = result.response.candidates?.[0]?.finishReason;
  return parseGeminiPermitJson(responseText, finishReason);
}
