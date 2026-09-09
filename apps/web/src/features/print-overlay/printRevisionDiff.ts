/**
 * What changed between two revisions of a print.
 * Deterministic structure revision comparison.
 */

import type { PrintEntity } from "./printParser.js";

export type PrintChangeKind = "added" | "removed" | "moved" | "changed";

export interface PrintChange {
  kind: PrintChangeKind;
  next?: PrintEntity;
  previous?: PrintEntity;
  summary: string;
  movedBy?: number;
}

export interface PrintRevisionDiff {
  changes: PrintChange[];
  unchangedCount: number;
}

function normalised(entity: PrintEntity): { x: number; y: number } | null {
  if (!entity.pageWidth || !entity.pageHeight) return null;
  return { x: entity.x / entity.pageWidth, y: entity.y / entity.pageHeight };
}

function distance(a: PrintEntity, b: PrintEntity): number | null {
  const na = normalised(a);
  const nb = normalised(b);
  if (!na || !nb) return null;
  return Math.hypot(na.x - nb.x, na.y - nb.y);
}

function describeAttributeChanges(
  previous: PrintEntity,
  next: PrintEntity
): string[] {
  const notes: string[] = [];
  const keys = new Set([
    ...Object.keys(previous.details || {}),
    ...Object.keys(next.details || {}),
  ]);

  keys.forEach((key) => {
    const before = previous.details?.[key];
    const after = next.details?.[key];
    if (before === after) return;
    if (!before) notes.push(`${key} set to ${after}`);
    else if (!after) notes.push(`${key} removed (was ${before})`);
    else notes.push(`${key}: ${before} \u2192 ${after}`);
  });

  return notes;
}

const MOVE_THRESHOLD = 0.01;
const MATCH_LIMIT = 0.08;

export function comparePrintRevisions(
  previousEntities: PrintEntity[],
  nextEntities: PrintEntity[]
): PrintRevisionDiff {
  const changes: PrintChange[] = [];
  let unchangedCount = 0;

  const unmatchedPrevious = new Set(previousEntities);

  const byLabel = new Map<string, PrintEntity[]>();
  previousEntities.forEach((entity) => {
    if (!entity.label) return;
    const key = `${entity.kind}:${entity.label}`;
    const list = byLabel.get(key) ?? [];
    list.push(entity);
    byLabel.set(key, list);
  });

  nextEntities.forEach((next) => {
    const labelKey = `${next.kind}:${next.label}`;
    let match = (byLabel.get(labelKey) ?? []).find((c) => unmatchedPrevious.has(c));

    if (!match) {
      let best: PrintEntity | undefined;
      let bestDistance = Number.POSITIVE_INFINITY;

      previousEntities.forEach((candidate) => {
        if (!unmatchedPrevious.has(candidate)) return;
        if (candidate.kind !== next.kind) return;
        if (candidate.page !== next.page) return;

        const d = distance(candidate, next);
        if (d === null || d > MATCH_LIMIT) return;
        if (d < bestDistance) {
          bestDistance = d;
          best = candidate;
        }
      });

      match = best;
    }

    if (!match) {
      changes.push({
        kind: "added",
        next,
        summary: `${next.mapTag || next.label || next.kind} is new on sheet ${next.page}`,
      });
      return;
    }

    unmatchedPrevious.delete(match);

    const moved = distance(match, next);
    const attributeNotes = describeAttributeChanges(match, next);

    if (moved !== null && moved > MOVE_THRESHOLD) {
      changes.push({
        kind: "moved",
        previous: match,
        next,
        movedBy: moved,
        summary:
          `${next.mapTag || next.label || next.kind} moved on sheet ${next.page}` +
          (attributeNotes.length ? ` (${attributeNotes.join("; ")})` : ""),
      });
      return;
    }

    if (attributeNotes.length > 0) {
      changes.push({
        kind: "changed",
        previous: match,
        next,
        summary: `${next.mapTag || next.label || next.kind}: ${attributeNotes.join("; ")}`,
      });
      return;
    }

    unchangedCount += 1;
  });

  unmatchedPrevious.forEach((previous) => {
    changes.push({
      kind: "removed",
      previous,
      summary:
        `${previous.mapTag || previous.label || previous.kind} is gone from sheet ${previous.page}`,
    });
  });

  const order: Record<PrintChangeKind, number> = {
    removed: 0,
    added: 1,
    moved: 2,
    changed: 3,
  };
  changes.sort((a, b) => order[a.kind] - order[b.kind]);

  return { changes, unchangedCount };
}

export function summariseDiff(diff: PrintRevisionDiff): string {
  if (diff.changes.length === 0) return "No structure changes";

  const counts = diff.changes.reduce<Record<string, number>>((acc, change) => {
    acc[change.kind] = (acc[change.kind] ?? 0) + 1;
    return acc;
  }, {});

  return (["added", "removed", "moved", "changed"] as PrintChangeKind[])
    .filter((kind) => counts[kind])
    .map((kind) => `${counts[kind]} ${kind}`)
    .join(", ");
}
