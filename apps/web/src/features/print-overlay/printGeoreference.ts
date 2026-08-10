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
  if (overlay.southWestLat === undefined || overlay.southWestLng === undefined || overlay.northEastLat === undefined || overlay.northEastLng === undefined) return null;
  if (overlay.southWestLat === 0 && overlay.southWestLng === 0 && overlay.northEastLat === 0 && overlay.northEastLng === 0) return null;

  const centreLat = (overlay.northEastLat + overlay.southWestLat) / 2;
  const centreLng = (overlay.northEastLng + overlay.southWestLng) / 2;

  const radLat = (centreLat * Math.PI) / 180;
  const metersPerDegLat = 111139;
  const metersPerDegLng = 111139 * Math.cos(radLat);

  const latSpanMeters = (overlay.northEastLat - overlay.southWestLat) * metersPerDegLat;
  const lngSpanMeters = (overlay.northEastLng - overlay.southWestLng) * metersPerDegLng;

  const dx = x - pageWidth / 2;
  const dy = -(y - pageHeight / 2); // North is +y

  const mppX = lngSpanMeters / pageWidth;
  const mppY = latSpanMeters / pageHeight;

  const thetaRad = -((overlay.rotationDegrees || 0) * Math.PI) / 180;
  const cos = Math.cos(thetaRad);
  const sin = Math.sin(thetaRad);

  const eastMeters = (dx * cos - dy * sin) * mppX;
  const northMeters = (dx * sin + dy * cos) * mppY;

  const dLat = northMeters / metersPerDegLat;
  const dLng = metersPerDegLng !== 0 ? eastMeters / metersPerDegLng : 0;

  return {
    lat: centreLat + dLat,
    lng: centreLng + dLng,
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
