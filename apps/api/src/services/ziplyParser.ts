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
    cityRow: string | null;
    wsdot: string | null;
    county: string | null;
    railroad: string | null;
    pa: string | null;
    tcp: string | null;
  } | null;
}

// Convert base64 data URL to Gemini part object
function dataUrlToPart(dataUrl: string): { inlineData: { data: string; mimeType: string } } {
  const matches = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!matches) {
    throw new Error("Invalid base64 data URL");
  }
  return {
    inlineData: {
      data: matches[2]!,
      mimeType: matches[1]!,
    },
  };
}

export async function parseZiplyPrint(dataUrl: string): Promise<ZiplyParsedPrint> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not set in environment");

  const genai = new GoogleGenerativeAI(apiKey);
  const printPart = dataUrlToPart(dataUrl);

  const prompt = `
Analyze the attached engineering print cover sheet or layout print.
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
10. Permits Status Table: Find status or require check for City, WSDOT, County, Railroad, PGE/PA, TCP (typically under a PERMITS card).

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
  "permits": {
    "cityRow": "Pending | Approved | Active | Closed | null",
    "wsdot": "Pending | Approved | Active | Closed | null",
    "county": "Pending | Approved | Active | Closed | null",
    "railroad": "Pending | Approved | Active | Closed | null",
    "pa": "Pending | Approved | Active | Closed | null",
    "tcp": "Pending | Approved | Active | Closed | null"
  }
}
`;

  const model = genai.getGenerativeModel({
    model: "gemini-2.5-flash",
    systemInstruction: { role: "system", parts: [{ text: SYSTEM_INSTRUCTION }] },
    generationConfig: {
      temperature: 0.1,
      responseMimeType: "application/json",
      maxOutputTokens: 2048,
    },
  });

  const result = await model.generateContent([prompt, printPart]);
  const responseText = result.response.text();
  
  // Clean fences
  const cleaned = responseText
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();

  return JSON.parse(cleaned) as ZiplyParsedPrint;
}
