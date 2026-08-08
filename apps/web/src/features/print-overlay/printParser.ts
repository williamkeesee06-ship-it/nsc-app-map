/**
 * Print Data Sidecar - deterministic extraction of build data from a design PDF.
 * Ported from MAP-STUDIO-GIS, running on top of browser pdfjs-dist.
 */

import { putPrintDocument } from "./printDocumentStore.js";

/** One positioned run of text lifted off a PDF page. */
export interface PrintTextItem {
  text: string;
  /** Page-space X, origin top-left, PDF points. */
  x: number;
  /** Page-space Y, origin top-left, PDF points. */
  y: number;
  page: number;
}

/** Text items merged into a single visual line. */
export interface PrintTextLine {
  page: number;
  x: number;
  y: number;
  text: string;
}

/** Only things the operator physically places. */
export type PrintEntityKind =
  | "terminal"
  | "pole"
  | "handhole"
  | "manhole"
  | "pedestal"
  | "riser"
  | "splitter"
  | "hub";

/**
 * A parsed entity once it belongs to a job and can track its own placement.
 */
export interface StoredPrintEntity extends PrintEntity {
  jobId: string;
  /** Print the entity was read from, for provenance when several are loaded. */
  sourceFile: string;
  /** Set once the operator has placed this entity on the map. */
  placedMarkerId?: string;
}

/** Kinds that correspond to something the operator physically places. */
export const PLACEABLE_KINDS: PrintEntityKind[] = [
  "terminal",
  "pole",
  "handhole",
  "manhole",
  "pedestal",
  "riser",
  "splitter",
  "hub",
];

export interface PrintEntity {
  id: string;
  kind: PrintEntityKind;
  /** Short identifier as drawn: "T5", "P-1", "S2107". */
  label: string;
  /** Tag to write onto the map marker: "T-5". */
  mapTag: string;
  /** Map symbol this becomes when placed. */
  iconSymbol: string | null;
  page: number;
  x: number;
  y: number;
  pageWidth?: number;
  pageHeight?: number;
  details: Record<string, string>;
  /** One-line summary for the sidecar row. */
  summary: string;
}

/* ------------------------------------------------------------------ *
 * Stage 1: positioned text -> visual lines
 * ------------------------------------------------------------------ */

const HATCH_TOKENS = new Set(["RW", "EOP", "CL", "OHP", "UGP", "G", "W", "SS", "SD"]);

export function reconstructLines(
  items: PrintTextItem[],
  yTolerance = 2.2,
  xGap = 14
): PrintTextLine[] {
  const byPage = new Map<number, PrintTextItem[]>();
  items.forEach((item) => {
    const text = item.text.trim();
    if (!text) return;
    if (HATCH_TOKENS.has(text.toUpperCase())) return;
    const bucket = byPage.get(item.page);
    if (bucket) bucket.push(item);
    else byPage.set(item.page, [item]);
  });

  const lines: PrintTextLine[] = [];

  byPage.forEach((pageItems, page) => {
    const sorted = [...pageItems].sort((a, b) => a.y - b.y || a.x - b.x);

    const bands: PrintTextItem[][] = [];
    let band: PrintTextItem[] = [];
    let bandY = Number.NaN;

    sorted.forEach((item) => {
      if (band.length === 0 || Math.abs(item.y - bandY) <= yTolerance) {
        band.push(item);
        bandY = item.y;
      } else {
        bands.push(band);
        band = [item];
        bandY = item.y;
      }
    });
    if (band.length) bands.push(band);

    bands.forEach((entries) => {
      const ordered = [...entries].sort((a, b) => a.x - b.x);
      let run: PrintTextItem[] = [];
      let prevEnd = Number.NaN;

      const flush = () => {
        if (run.length === 0) return;
        lines.push({
          page,
          x: run[0].x,
          y: run[0].y,
          text: run
            .map((i) => i.text.trim())
            .filter(Boolean)
            .join(" ")
            .replace(/\s+/g, " ")
            .trim(),
        });
        run = [];
      };

      ordered.forEach((item) => {
        if (run.length > 0 && item.x - prevEnd > xGap) flush();
        run.push(item);
        prevEnd = item.x + item.text.trim().length * 4.2;
      });
      flush();
    });
  });

  return lines;
}

/* ------------------------------------------------------------------ *
 * Stage 2: lines -> entities
 * ------------------------------------------------------------------ */

const BOILERPLATE = /^(RW|EOP|ENGR:|SCALE:|CNTY:|TWNSHP:|RNG:|SEC:|FILE:|PHONE:|DWG:)$/i;

function cleanFootage(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

function fieldValue(
  lines: PrintTextLine[],
  index: number,
  inlineValue: string | undefined,
  lookahead = 2
): string | null {
  const inline = inlineValue?.trim();
  if (inline) return inline;

  for (let i = index + 1; i <= index + lookahead && i < lines.length; i += 1) {
    const candidate = lines[i]?.text.trim();
    if (!candidate) continue;
    if (/:$/.test(candidate)) return null;
    return candidate;
  }
  return null;
}

function parseTerminals(lines: PrintTextLine[]): PrintEntity[] {
  const out: PrintEntity[] = [];

  lines.forEach((line, index) => {
    const anchor = line.text.match(/^FIBER TERM\s+(T\d+)\b/i);
    if (!anchor) return;

    const label = anchor[1].toUpperCase();
    const details: Record<string, string> = {};
    let ports = "";
    let footage = "";
    let address = "";

    const block = lines
      .filter(
        (l) =>
          l.page === line.page &&
          l.y > line.y &&
          l.y - line.y <= 46 &&
          Math.abs(l.x - line.x) <= 130
      )
      .sort((a, b) => a.y - b.y || a.x - b.x);

    for (let i = 0; i < block.length; i += 1) {
      const text = block[i].text.trim();
      if (!text || /^FIBER TERM/i.test(text)) break;

      const portMatch = text.match(/^(\d+)\s*PORT\s*(.*)$/i);
      if (portMatch && !ports) {
        ports = portMatch[1];
        footage = cleanFootage(portMatch[2]).split(/\s+(?:DNFTP|TEST:|XD,|S\d{4},|FT-)/i)[0].trim();
        continue;
      }

      const dnftp = text.match(/DNFTP\s+(FT-[\w-]+)/i);
      if (dnftp) details["DNFTP"] = dnftp[1];

      for (const assign of text.matchAll(/\b([A-Z]{1,4}\d{0,4}),\s*(\d+(?:-\d+)?)\b/g)) {
        if (assign[1].toUpperCase() === "DNFTP") continue;
        details[`Fiber ${assign[1]}`] = assign[2];
      }

      if (
        !address &&
        /\d/.test(text) &&
        /(ST|AVE|RD|DR|PL|WAY|BLVD|LN|CT)\b/i.test(text) &&
        !/^\d+\s*PORT/i.test(text)
      ) {
        if (/^OPP\s+/i.test(text)) details["Position"] = "Opposite";
        address = text
          .replace(/^OPP\s+/i, "")
          .replace(/\s+(?:XD|S\d{4}|FC\d+),\s*[\d-]+.*$/i, "")
          .trim();
      }
    }

    if (ports) details["Ports"] = ports;
    if (footage) details["Footage"] = footage;
    if (address) details["Address"] = address;
    details["Sheet"] = String(line.page);

    out.push({
      id: `terminal:${label}`,
      kind: "terminal",
      label,
      mapTag: label.replace(/^T/i, "T-"),
      iconSymbol: "terminal",
      page: line.page,
      x: line.x,
      y: line.y,
      details,
      summary: [ports ? `${ports} port` : null, footage, address]
        .filter(Boolean)
        .join("  ·  "),
    });
  });

  return dedupe(out);
}

function parsePoles(lines: PrintTextLine[]): PrintEntity[] {
  const out: PrintEntity[] = [];

  lines.forEach((line, index) => {
    const numberMatch = line.text.match(/^Pole\s*#\s*(\d+)\s*:?\s*(.*)$/i);
    if (!numberMatch) return;

    const poleNo = numberMatch[1];
    const poleId = fieldValue(lines, index, numberMatch[2]);
    if (!poleId || !/^[\d-]{4,}$/.test(poleId)) return;

    const details: Record<string, string> = {
      "Pole ID": poleId,
      Sheet: String(line.page),
    };

    for (let i = Math.max(0, index - 4); i < index; i += 1) {
      const ownerMatch = lines[i].text.match(/^Pole Owner:?\s*(.*)$/i);
      if (!ownerMatch) continue;
      const owner = fieldValue(lines, i, ownerMatch[1]);
      if (owner) details["Pole Owner"] = owner.split(/\s+/)[0];
    }

    const window = lines.slice(index, index + 40);
    window.forEach((l, wi) => {
      const label = l.text.match(
        /^(Neutral|Secondary\d?|Comcast|Ziply-Overlash|Ziply)\s*(.*)$/i
      );
      if (!label) return;
      const value = fieldValue(window, wi, label[2], 1);
      if (value && /^\d+'/.test(value)) {
        details[label[1]] = value.replace(/\s+/g, "");
      }
    });

    const notes = window
      .map((l) => l.text)
      .filter((t) => /^(BORE\s+\d+'|PLACE\s+\d|TRANSFER\b|REPLACE\b)/i.test(t));
    if (notes.length) details["Make Ready"] = [...new Set(notes)].join("; ");

    out.push({
      id: `pole:P-${poleNo}`,
      kind: "pole",
      label: `P-${poleNo}`,
      mapTag: `P-${poleNo}`,
      iconSymbol: "pole",
      page: line.page,
      x: line.x,
      y: line.y,
      details,
      summary: [details["Pole Owner"], poleId, notes.length ? notes[0] : null]
        .filter(Boolean)
        .join("  ·  "),
    });
  });

  return dedupe(out);
}

function parseSplitters(lines: PrintTextLine[]): PrintEntity[] {
  const out: PrintEntity[] = [];

  lines.forEach((line, index) => {
    if (!/^Splitter ID\b/i.test(line.text)) return;

    const inline = line.text.match(/^Splitter ID\s+(S\d+)/i);
    const next = lines[index + 1]?.text.trim() ?? "";
    const label = (inline?.[1] ?? next.match(/^(S\d+)$/)?.[1] ?? "").toUpperCase();
    if (!label) return;

    const details: Record<string, string> = { Sheet: String(line.page) };
    const window = lines.slice(index, index + 16);
    const fields: Array<[RegExp, string]> = [
      [/^Material Description:?\s*(.*)$/i, "Material"],
      [/^Manufacturer:?\s*(.*)$/i, "Manufacturer"],
      [/^In:?\s*(.*)$/i, "In"],
      [/^Out:?\s*(.*)$/i, "Out"],
    ];

    window.forEach((l, wi) => {
      fields.forEach(([pattern, key]) => {
        if (details[key]) return;
        const match = l.text.match(pattern);
        if (!match) return;
        const value = fieldValue(window, wi, match[1], 1);
        if (value) details[key] = value;
      });
    });

    out.push({
      id: `splitter:${label}`,
      kind: "splitter",
      label,
      mapTag: label,
      iconSymbol: "splitter",
      page: line.page,
      x: line.x,
      y: line.y,
      details,
      summary: [details["Material"], details["Out"] ? `out ${details["Out"]}` : null]
        .filter(Boolean)
        .join("  ·  "),
    });
  });

  return dedupe(out);
}

function parseLabelledStructures(lines: PrintTextLine[]): PrintEntity[] {
  const out: PrintEntity[] = [];
  const seq: Record<string, number> = {};

  const next = (kind: string) => {
    seq[kind] = (seq[kind] || 0) + 1;
    return seq[kind];
  };

  const TICKS = "['\"\u2018\u2019\u201A\u201B\u201C\u201D\u2032\u2033\u02BC\u00B4`]";

  const normalizeSize = (raw: string) =>
    raw.replace(new RegExp(`${TICKS}|\\s`, "g"), "").toUpperCase();

  lines.forEach((line) => {
    const text = line.text.trim();
    if (!text || BOILERPLATE.test(text)) return;

    const isMeasurement = text.includes("=");

    const sizePattern = `(\\d+\\s*${TICKS}?\\s*[xX]\\s*\\d+\\s*${TICKS}?)`;
    const hhSized = isMeasurement
      ? null
      : text.match(new RegExp(`${sizePattern}\\s*(?:HH|HANDHOLE)\\b`, "i")) ||
        text.match(new RegExp(`\\b(?:HH|HANDHOLE)\\s*${sizePattern}`, "i"));
    const hhBare = !isMeasurement && /^(?:PLACE\s+)?(?:HH|HANDHOLE|HAND\s*HOLE)$/i.test(text);

    if (hhSized || hhBare) {
      const size = hhSized ? normalizeSize(hhSized[1]) : "";
      const label = size ? `HH-${size}` : "HH";
      const n = next("handhole");
      out.push({
        id: `handhole:${line.page}:${n}`,
        kind: "handhole",
        label,
        mapTag: label,
        iconSymbol: "handhole",
        page: line.page,
        x: line.x,
        y: line.y,
        details: { ...(size ? { "Vault Size": size } : {}), Sheet: String(line.page) },
        summary: size ? `${size} handhole` : "Handhole (size not called out)",
      });
      return;
    }

    if (/^(?:MH|MANHOLE|MAN\s*HOLE)(?:\s+\S{1,10})?$/i.test(text)) {
      const n = next("manhole");
      out.push({
        id: `manhole:${line.page}:${n}`,
        kind: "manhole",
        label: `MH-${n}`,
        mapTag: `MH-${n}`,
        iconSymbol: "manhole",
        page: line.page,
        x: line.x,
        y: line.y,
        details: { Sheet: String(line.page) },
        summary: "Manhole",
      });
      return;
    }

    if (/^(?:PED|PEDESTAL)(?:\s+\S{1,10})?$/i.test(text)) {
      const n = next("pedestal");
      out.push({
        id: `pedestal:${line.page}:${n}`,
        kind: "pedestal",
        label: `PED-${n}`,
        mapTag: `PED-${n}`,
        iconSymbol: "pedestal",
        page: line.page,
        x: line.x,
        y: line.y,
        details: { Sheet: String(line.page) },
        summary: "Pedestal",
      });
      return;
    }

    const riser = text.match(new RegExp(`(?:PLACE\\s+)?(\\d+)\\s*${TICKS}?\\s*RISER$`, "i"));
    if (riser || /^RISER$/i.test(text)) {
      const size = riser ? `${riser[1]}"` : "";
      const n = next("riser");
      out.push({
        id: `riser:${line.page}:${n}`,
        kind: "riser",
        label: `R-${n}`,
        mapTag: "R-",
        iconSymbol: "riser",
        page: line.page,
        x: line.x,
        y: line.y,
        details: { ...(size ? { Size: size } : {}), Sheet: String(line.page) },
        summary: size ? `${size} riser` : "Riser",
      });
      return;
    }

    const hub = text.match(/^HUB\s*[-#]?\s*(\d{1,6}[A-Z]?)$/i);
    if (hub) {
      const n = next("hub");
      out.push({
        id: `hub:${hub[1].toUpperCase()}`,
        kind: "hub",
        label: `HUB ${hub[1].toUpperCase()}`,
        mapTag: hub[1].toUpperCase(),
        iconSymbol: "hub",
        page: line.page,
        x: line.x,
        y: line.y,
        details: { Sheet: String(line.page) },
        summary: `Hub ${hub[1].toUpperCase()}`,
      });
    }
  });

  return out;
}

function dedupe(entities: PrintEntity[]): PrintEntity[] {
  const best = new Map<string, PrintEntity>();
  entities.forEach((entity) => {
    const existing = best.get(entity.id);
    if (
      !existing ||
      Object.keys(entity.details).length > Object.keys(existing.details).length
    ) {
      best.set(entity.id, entity);
    }
  });
  return [...best.values()];
}

function parsePoleTags(lines: PrintTextLine[]): PrintEntity[] {
  const out: PrintEntity[] = [];

  lines.forEach((line) => {
    const match = line.text.trim().match(/^P-(\d{1,7})$/);
    if (!match) return;

    const label = `P-${match[1]}`;
    out.push({
      id: `pole:${label}`,
      kind: "pole",
      label,
      mapTag: label,
      iconSymbol: "pole",
      page: line.page,
      x: line.x,
      y: line.y,
      details: { "Pole Tag": match[1], Sheet: String(line.page) },
      summary: `Pole tag ${match[1]}`,
    });
  });

  return dedupe(out);
}

function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

export function parsePrintEntities(items: PrintTextItem[]): PrintEntity[] {
  const lines = reconstructLines(items);

  const entities = [
    ...parseTerminals(lines),
    ...parsePoles(lines),
    ...parsePoleTags(lines),
    ...parseSplitters(lines),
    ...parseLabelledStructures(lines),
  ];

  const order: PrintEntityKind[] = [
    "terminal",
    "splitter",
    "hub",
    "handhole",
    "manhole",
    "pedestal",
    "pole",
    "riser",
  ];
  return entities.sort(
    (a, b) =>
      order.indexOf(a.kind) - order.indexOf(b.kind) ||
      naturalCompare(a.label, b.label)
  );
}

/* ------------------------------------------------------------------ *
 * Stage 3: pdf.js adapter
 * ------------------------------------------------------------------ */

export async function extractPrintEntities(
  fileOrBuffer: File | ArrayBuffer
): Promise<PrintEntity[]> {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

  const arrayBuffer =
    fileOrBuffer instanceof File ? await fileOrBuffer.arrayBuffer() : fileOrBuffer;

  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const items: PrintTextItem[] = [];
  const pageSizes = new Map<number, { width: number; height: number }>();

  for (let pageNo = 1; pageNo <= pdf.numPages; pageNo += 1) {
    const page = await pdf.getPage(pageNo);
    const content = await page.getTextContent();
    const viewport = page.getViewport({ scale: 1 });
    const height = viewport.height;
    pageSizes.set(pageNo, { width: viewport.width, height: viewport.height });

    content.items.forEach((raw: any) => {
      if (typeof raw?.str !== "string" || !raw.str.trim()) return;
      const transform = raw.transform as number[];
      items.push({
        text: raw.str,
        x: transform[4],
        y: height - transform[5],
        page: pageNo,
      });
    });
  }

  return parsePrintEntities(items).map((entity) => {
    const size = pageSizes.get(entity.page);
    return size ? { ...entity, pageWidth: size.width, pageHeight: size.height } : entity;
  });
}
