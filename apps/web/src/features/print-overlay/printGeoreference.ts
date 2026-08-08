import type { MapImageOverlay } from "./types.js";
import type { StoredPrintEntity } from "./printParser.js";

export interface LatLng {
  lat: number;
  lng: number;
}

export function overlayForPage(
  overlays: MapImageOverlay[],
  page: number
): MapImageOverlay | undefined {
  const anchored = overlays.filter((o) => o.isAnchored !== false && !o.presetKey);

  const numbered = anchored.find((o) => {
    const match = o.title?.match(/(?:page|sheet|pg)\s*[-_ ]?(\d+)/i);
    return match ? Number(match[1]) === page : false;
  });
  if (numbered) return numbered;

  return anchored[page - 1];
}

export function projectPageToLatLng(
  overlay: MapImageOverlay,
  x: number,
  y: number,
  pageWidth: number,
  pageHeight: number
): LatLng | null {
  if (!pageWidth || !pageHeight) return null;

  const centreLat = (overlay.northEastLat + overlay.southWestLat) / 2;
  const centreLng = (overlay.northEastLng + overlay.southWestLng) / 2;
  const latSpan = overlay.northEastLat - overlay.southWestLat;
  const lngSpan = overlay.northEastLng - overlay.southWestLng;

  const dx = x / pageWidth - 0.5;
  const dy = y / pageHeight - 0.5;

  const theta = ((overlay.rotationDegrees || 0) * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);

  const rx = dx * cos - dy * sin;
  const ry = dx * sin + dy * cos;

  return {
    lat: centreLat - ry * latSpan,
    lng: centreLng + rx * lngSpan,
  };
}

export interface PlacementPlan {
  entity: StoredPrintEntity;
  position: LatLng;
}

export interface PlacementSurvey {
  plans: PlacementPlan[];
  alreadyPlaced: number;
  noAnchoredSheet: number;
  missingPageSize: number;
}

export function surveyPlacements(
  entities: StoredPrintEntity[],
  overlays: MapImageOverlay[],
  placeableKinds: string[]
): PlacementSurvey {
  const survey: PlacementSurvey = {
    plans: [],
    alreadyPlaced: 0,
    noAnchoredSheet: 0,
    missingPageSize: 0,
  };

  entities.forEach((entity) => {
    if (!placeableKinds.includes(entity.kind)) return;

    if (entity.placedMarkerId) {
      survey.alreadyPlaced += 1;
      return;
    }

    if (!entity.pageWidth || !entity.pageHeight) {
      survey.missingPageSize += 1;
      return;
    }

    const overlay = overlayForPage(overlays, entity.page);
    if (!overlay) {
      survey.noAnchoredSheet += 1;
      return;
    }

    const position = projectPageToLatLng(
      overlay,
      entity.x,
      entity.y,
      entity.pageWidth,
      entity.pageHeight
    );
    if (!position) {
      survey.missingPageSize += 1;
      return;
    }

    survey.plans.push({ entity, position });
  });

  return survey;
}
