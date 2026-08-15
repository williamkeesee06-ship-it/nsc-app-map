import type { Job, DrawingObject } from "@nsc/types";

/**
 * Converts standard CSS hex color (#RRGGBB or #RGB) and opacity (0-1) to KML aabbggrr hex format.
 */
export function cssColorToKml(hex: string, opacity = 1.0): string {
  let clean = (hex || "#1ea7ff").replace("#", "").trim();
  if (clean.length === 3) {
    clean = clean.split("").map((c) => c + c).join("");
  }
  if (clean.length !== 6) {
    clean = "1ea7ff";
  }
  const r = clean.slice(0, 2);
  const g = clean.slice(2, 4);
  const b = clean.slice(4, 6);
  const a = Math.round(Math.max(0, Math.min(1, opacity)) * 255)
    .toString(16)
    .padStart(2, "0");
  return `${a}${b}${g}${r}`.toLowerCase();
}

/**
 * Generates root KML Network Link manifest for Google Earth.
 */
export function generateJobNetworkLinkKml(jobId: string, host: string, token: string): string {
  const feedUrl = `https://${host}/api/earth/layers/${encodeURIComponent(jobId)}/all.kml?token=${encodeURIComponent(token)}`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>NSMS Live Network Link — Job ${jobId}</name>
    <open>1</open>
    <NetworkLink>
      <name>Canonical Live Geometry (60s Refresh)</name>
      <open>1</open>
      <flyToView>1</flyToView>
      <Link>
        <href>${feedUrl}</href>
        <refreshMode>onInterval</refreshMode>
        <refreshInterval>60</refreshInterval>
        <viewRefreshMode>onStop</viewRefreshMode>
        <viewRefreshTime>2</viewRefreshTime>
      </Link>
    </NetworkLink>
  </Document>
</kml>`;
}

/**
 * Generates the multi-layer KML payload for a job, strictly preserving user geometry and styling.
 */
export function generateJobLayersKml(
  job: Job,
  objects: DrawingObject[],
  _layerCode = "all"
): string {
  const activeObjects = objects.filter((o) => !o.style?.isDeleted);

  const lines = activeObjects.filter(
    (o) => "vertices" in o && Array.isArray((o as any).vertices) && (o as any).vertices.length > 0
  );
  const points = activeObjects.filter((o) => "position" in o && (o as any).position);

  const placemarksXml: string[] = [];

  // Render Polylines
  for (const obj of lines) {
    const o = obj as any;
    const style = obj.style || {};
    const kmlColor = cssColorToKml(style.strokeColor || "#06B6D4", style.opacity ?? 0.9);
    const width = Math.max(1, style.strokeWidth ?? 3);
    const name = style.userLabel || obj.tool || "Cable Span";
    const coords = (o.vertices as Array<{ lat: number; lng: number }>)
      .map((v) => `${v.lng},${v.lat},0`)
      .join(" ");

    placemarksXml.push(`
      <Placemark id="${obj.id}">
        <name>${name}</name>
        <Style>
          <LineStyle>
            <color>${kmlColor}</color>
            <width>${width}</width>
          </LineStyle>
        </Style>
        <ExtendedData>
          <Data name="nscJobId"><value>${job.jobId}</value></Data>
          <Data name="nscJobNumber"><value>${job.workOrder}</value></Data>
          <Data name="nscBuildReference"><value>${job.buildReference || ""}</value></Data>
          <Data name="nscFeatureId"><value>${obj.id}</value></Data>
          <Data name="nscLayerCode"><value>earth_design</value></Data>
        </ExtendedData>
        <LineString>
          <tessellate>1</tessellate>
          <coordinates>${coords}</coordinates>
        </LineString>
      </Placemark>
    `);
  }

  // Render Points / Markers
  for (const obj of points) {
    const o = obj as any;
    const style = obj.style || {};
    const name = style.userLabel || obj.tool || "Point";
    const pos = o.position as { lat: number; lng: number };

    placemarksXml.push(`
      <Placemark id="${obj.id}">
        <name>${name}</name>
        <ExtendedData>
          <Data name="nscJobId"><value>${job.jobId}</value></Data>
          <Data name="nscJobNumber"><value>${job.workOrder}</value></Data>
          <Data name="nscBuildReference"><value>${job.buildReference || ""}</value></Data>
          <Data name="nscFeatureId"><value>${obj.id}</value></Data>
          <Data name="nscLayerCode"><value>earth_design</value></Data>
        </ExtendedData>
        <Point>
          <coordinates>${pos.lng},${pos.lat},0</coordinates>
        </Point>
      </Placemark>
    `);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${job.displayName || job.workOrder}</name>
    <Folder>
      <name>02 Earth Design — Approved</name>
      <open>1</open>
      ${placemarksXml.join("\n")}
    </Folder>
  </Document>
</kml>`;
}
