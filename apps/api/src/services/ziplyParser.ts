import { GoogleGenerativeAI } from "@google/generative-ai";

const SYSTEM_INSTRUCTION =
  "You are an expert broadband telecom engineer specialized in reviewing Fiber to the Home (FTTH) engineering prints and construction sheets. " +
  "Analyze the provided document (PDF page image) and extract key engineered units, material logs, and permit specifications. " +
  "Return JSON strictly conforming to the requested schema.";

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
  /** Street address of the hub/FDH, used to georeference the print (spec §1). */
  hubAddress?: string | null;
  mapObjects?: {
    cables: Array<{
      label: string;
      fiberCount: string;
      lengthFt: number | null;
      buildType?: "bore" | "trench" | "aerial" | null;
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
    }>;
    notes: string | null;
  } | null;
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

export async function parseZiplyPrint(dataUrls: string | string[]): Promise<ZiplyParsedPrint> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not set in environment");

  const genai = new GoogleGenerativeAI(apiKey);
  const urls = Array.isArray(dataUrls) ? dataUrls : [dataUrls];
  const printParts = urls.map(dataUrlToPart);

  const prompt = `
Analyze the attached engineering print cover sheet(s) or layout print(s).
Extract all key telecom engineering metrics and return them in a structured JSON format.

FIELDS TO LOOK FOR:
1. Hub ID: The identifier of the fiber hub (e.g. H1002, H3201).
2. Hub Type/Size: Material and mount code of the FDH cabinet (e.g. VCAPS21-1C4131Q400, 288-port vault mount, 432-port).
3. Terminal Count: Total count of Multi-port Service Terminals (MST) or splices.
4. Fiber Counts: Distinct fiber count configurations found on lines (e.g. 48F, 96F, 144F, 288F, 432F).
5. Drops: Sites or homes passed count, categorised by LU (Living Unit), MDU (Multi-Family), BU (Business), and total drops.
6. Permitted Excavation Methods: Specific methods allowed (e.g. Bore, Directional Bore, Trench, Plow, Aerial, Overlash).
7. Strand Type: e.g. 10M, 6M.
8. Conduit Size: default drop or distribution conduit (e.g. 1.25", 2").
9. Special Notes: General construction or engineering notes.
10. Permits Status Table: Find status or require check for City, WSDOT, County, Railroad, PGE/PA, TCP (typically under a PERMITS card). Status must be: Pending, Approved, Active, Closed, or null.
11. Hub Address: The physical street address where the FDH cabinet is located (used to place it on a map).
12. Map Objects: Look for EVERY labeled cable, line, and MST/terminal designation across ALL pages. Extract:
    - cables: list of { label, fiberCount, lengthFt, buildType }. buildType is the placement
      method for the segment: "bore", "trench", or "aerial" (null if unknown).
    - terminals: list of ALL service terminals. For each, extract as many of these as the print shows:
        label      (e.g. "MST-1", "T205")
        type       (e.g. "8-port MST", "12-port MST")
        portCount  (number of ports, e.g. 8, 12)
        footageFt  (numeric footage of the drop/lateral, e.g. 1000)
        footageLabel (raw footage string including overlash if present, e.g. "1000' (593' OL)")
        dvftpRange (distribution fiber / port range, e.g. "H2051, 205-216")
        code       (any engineering code on the terminal)
        fiberSpec  (fiber specification, e.g. "12F", "48F")
        addressesServed (array of street addresses served by this terminal — used to place it on a map)
    - notes: any location notes or layout remarks.

Return a JSON block strictly complying with this schema:
{
  "hubId": "string or null",
  "hubTypeSize": "string or null",
  "ziplyInspector": "string or null",
  "terminalCount": number or null,
  "fiberCountsPerCable": ["string"],
  "drops": {
    "lu": number or null,
    "mdu": number or null,
    "bu": number or null,
    "total": number or null
  },
  "permittedExcavationMethods": ["string"],
  "strandType": "string or null",
  "conduitSize": "string or null",
  "specialNotes": "string or null",
  "hubAddress": "string or null",
  "permits": {
    "cityRow": "Pending | Approved | Active | Closed | null",
    "wsdot": "Pending | Approved | Active | Closed | null",
    "county": "Pending | Approved | Active | Closed | null",
    "railroad": "Pending | Approved | Active | Closed | null",
    "pa": "Pending | Approved | Active | Closed | null",
    "tcp": "Pending | Approved | Active | Closed | null"
  },
  "mapObjects": {
    "cables": [{"label": "C-1", "fiberCount": "48F", "lengthFt": 250, "buildType": "bore"}],
    "terminals": [{"label": "MST-1", "type": "8-port MST", "portCount": 8, "footageFt": 1000, "footageLabel": "1000' (593' OL)", "dvftpRange": "H2051, 205-216", "code": null, "fiberSpec": "12F", "addressesServed": ["13613 Division St"]}],
    "notes": "string or null"
  }
}
`;

  const model = genai.getGenerativeModel({
    model: "gemini-2.5-flash",
    systemInstruction: { role: "system", parts: [{ text: SYSTEM_INSTRUCTION }] },
    generationConfig: {
      temperature: 0.1,
      responseMimeType: "application/json",
      // Large FTTH prints carry 30+ terminals each with several detail fields;
      // 2048 truncated the JSON mid-array. 8192 comfortably fits a full sheet.
      maxOutputTokens: 8192,
    },
  });

  const result = await model.generateContent([prompt, ...printParts]);
  const responseText = result.response.text();
  
  // Clean fences
  const cleaned = responseText
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();

  return JSON.parse(cleaned) as ZiplyParsedPrint;
}
