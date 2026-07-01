// 811 Phase 2 — Gemini-backed marking-instruction generation.
//
// Ported from the AI Studio reference app (811_review/server.ts) but using the
// codebase's existing @google/generative-ai SDK + gemini-2.5-flash (the repo
// standard; gemini-1.5-* is explicitly banned). Given a job + dig shape +
// ticket specs, Gemini returns a compliant marking-instruction block as JSON.
import { GoogleGenerativeAI } from "@google/generative-ai";
import type { DigShape, DigTicket, Job, PolygonData } from "@nsc/types";

const SYSTEM_INSTRUCTION =
  "You are an expert utility excavation coordinator and certified 811 Dig " +
  "Alert representative. Draft ultra-precise, compliant excavation directions " +
  "and safety guidelines based on map coordinate boundaries and construction " +
  "logs. Return JSON strictly complying with the requested schema.";

export interface MarkingInstructionResult {
  markingInstructions: string;
  hazardsWarning: string;
  summaryText: string;
  safeExcavationGuidelines: string[];
}

function shapeSummary(shape: DigShape | PolygonData): string {
  const b = shape.bounds;
  const lines = [
    `- Map Coordinates (Vertices Lat/Lng): ${JSON.stringify(shape.vertices)}`,
    `- Bounding Box: SW(${b.swLat.toFixed(5)}, ${b.swLng.toFixed(5)}) to NE(${b.neLat.toFixed(5)}, ${b.neLng.toFixed(5)})`,
    `- Total Approximate Dig Area: ${Math.round(shape.areaSqFt).toLocaleString()} sq ft`,
    `- Perimeter: ${Math.round(shape.perimeterFt).toLocaleString()} ft`,
  ];
  const type = (shape as Partial<DigShape>).type;
  if (type === "radius") {
    lines.unshift(`- Shape: RADIUS excavation, ${(shape as { radiusFt: number }).radiusFt} ft radius`);
  } else if (type === "route") {
    lines.unshift(`- Shape: ROUTE excavation, ${(shape as { widthFt: number }).widthFt} ft wide corridor`);
  } else {
    lines.unshift("- Shape: freeform POLYGON excavation");
  }
  return lines.join("\n");
}

function buildPrompt(
  job: Job,
  shape: DigShape | PolygonData,
  specs: DigTicket["specs"]
): string {
  const scope = [job.workType, job.customerProject, job.nscProjectNotes]
    .filter(Boolean)
    .join(" — ");
  const equipment = specs.equipment.length ? specs.equipment.join(", ") : "Not specified";
  return `
Analyze the following utility excavation job details and spatial map shape drawn by the operator.
Generate a structured, precise, and legally compliant 811 Dig Ticket marking instruction block.

JOB INFO FROM SMARTSHEETS:
- Job Name: ${job.nscProjectNotes || job.customerProject || job.workOrder}
- Job ID: ${job.workOrder}
- Site Address: ${[job.address, job.city, job.zipCode].filter(Boolean).join(", ") || "Unknown"}
- Type of Utility Work: ${specs.workType || job.workType || "Unknown"}
- Scope of Work: ${scope || "Not specified"}

SHAPE GEOMETRY STATS:
${shapeSummary(shape)}

TICKET DETAILS:
- Maximum Depth: ${specs.depth || "Not specified"}
- Hand digging only: ${specs.handDigOnly ? "YES" : "NO"}
- Explosives used: ${specs.explosives ? "YES" : "NO"}
- Horizontal Directional Boring (HDD): ${specs.directionalBoring ? "YES" : "NO"}
- White-Lining Pre-marked on site: ${specs.whiteLined ? "YES" : "NO"}
- Equipment in use: ${equipment}
- Mark around: ${specs.markAround || "the full excavation boundary"}

Provide the following outputs inside a clean JSON object:
1. "markingInstructions": A clear, detailed 3-4 sentence paragraph that the utility markings locator can read to locate and spray-paint standard markings. Use exact directional terminology (e.g., North, South, East, West, right-of-way, easement, curb line, property boundary) relative to the drawn area and site description.
2. "hazardsWarning": A brief alert of any potential nearby structures, underground easements, or utility lines inferred from the site type.
3. "summaryText": A 1-sentence executive summary of the excavation ticket scope.
4. "safeExcavationGuidelines": A bulleted list of 3 safety tips specific to this utility type and depth.

Your response must be clean JSON, conforming to this schema:
{
  "markingInstructions": "string",
  "hazardsWarning": "string",
  "summaryText": "string",
  "safeExcavationGuidelines": ["string", "string", "string"]
}
`;
}

export async function generateMarkingInstructions(
  job: Job,
  shape: DigShape | PolygonData,
  specs: DigTicket["specs"]
): Promise<MarkingInstructionResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not set in environment");

  const genai = new GoogleGenerativeAI(apiKey);
  const model = genai.getGenerativeModel({
    model: "gemini-2.5-flash",
    systemInstruction: { role: "system", parts: [{ text: SYSTEM_INSTRUCTION }] },
    generationConfig: {
      temperature: 0.3,
      responseMimeType: "application/json",
      maxOutputTokens: 2048,
    },
  });

  const result = await model.generateContent(buildPrompt(job, shape, specs));
  const text = result.response.text() || "{}";
  let parsed: Partial<MarkingInstructionResult>;
  try {
    parsed = JSON.parse(text) as Partial<MarkingInstructionResult>;
  } catch {
    // Model occasionally wraps JSON in a code fence despite responseMimeType.
    const cleaned = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    parsed = JSON.parse(cleaned) as Partial<MarkingInstructionResult>;
  }

  return {
    markingInstructions: parsed.markingInstructions ?? "",
    hazardsWarning: parsed.hazardsWarning ?? "",
    summaryText: parsed.summaryText ?? "",
    safeExcavationGuidelines: Array.isArray(parsed.safeExcavationGuidelines)
      ? parsed.safeExcavationGuidelines
      : [],
  };
}
