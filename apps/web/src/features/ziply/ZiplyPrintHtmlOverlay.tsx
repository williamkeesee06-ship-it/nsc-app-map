import { useEffect, useRef } from "react";
import { useMap } from "@vis.gl/react-google-maps";

interface HtmlOverlayProps {
  url: string;
  bounds: {
    sw: { lat: number; lng: number };
    ne: { lat: number; lng: number };
  };
  opacity?: number;
  visible: boolean;
}

export default function ZiplyPrintHtmlOverlay({
  url,
  bounds,
  opacity = 0.55,
  visible,
}: HtmlOverlayProps) {
  const map = useMap();
  const divRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<google.maps.OverlayView | null>(null);

  useEffect(() => {
    if (!map || !url || !bounds || !visible) {
      if (overlayRef.current) {
        overlayRef.current.setMap(null);
        overlayRef.current = null;
      }
      return;
    }

    const div = document.createElement("div");
    div.style.position = "absolute";
    div.style.top = "0px";
    div.style.left = "0px";
    div.style.border = "none";
    div.style.opacity = String(opacity);
    div.style.pointerEvents = "none"; // allow user to click through to map vectors
    div.style.transition = "opacity 0.2s ease";
    div.style.mixBlendMode = "multiply";
    div.style.backgroundColor = "transparent";
    div.style.willChange = "transform";
    divRef.current = div;

    // Render the print iframe or image
    const isPdf = url.toLowerCase().includes(".pdf");
    if (isPdf) {
      const iframe = document.createElement("iframe");
      iframe.src = url.includes("#") ? url : `${url}#toolbar=0&navpanes=0&scrollbar=0`;
      iframe.style.width = "100%";
      iframe.style.height = "100%";
      iframe.style.border = "none";
      iframe.style.pointerEvents = "none";
      iframe.style.backgroundColor = "transparent";
      div.appendChild(iframe);
    } else {
      const img = document.createElement("img");
      img.src = url;
      img.style.width = "100%";
      img.style.height = "100%";
      img.style.objectFit = "fill";
      img.style.pointerEvents = "none";
      div.appendChild(img);
    }

    const overlay = new google.maps.OverlayView();
    overlay.onAdd = function (this: google.maps.OverlayView) {
      const panes = this.getPanes();
      if (panes) {
        // overlayLayer pane is drawn below map controls but above base tiles.
        // It's the perfect place for georeferenced blueprints!
        panes.overlayLayer.appendChild(div);
      }
    };

    overlay.draw = function (this: google.maps.OverlayView) {
      const projection = this.getProjection();
      if (!projection) return;

      const sw = projection.fromLatLngToDivPixel(
        new google.maps.LatLng(bounds.sw.lat, bounds.sw.lng)
      );
      const ne = projection.fromLatLngToDivPixel(
        new google.maps.LatLng(bounds.ne.lat, bounds.ne.lng)
      );

      if (sw && ne) {
        const left = Math.min(sw.x, ne.x);
        const top = Math.min(sw.y, ne.y);
        const width = Math.abs(ne.x - sw.x);
        const height = Math.abs(sw.y - ne.y);
        div.style.transform = `translate3d(${left}px, ${top}px, 0px)`;
        div.style.width = `${width}px`;
        div.style.height = `${height}px`;
      }
    };

    overlay.onRemove = function () {
      if (div.parentNode) {
        div.parentNode.removeChild(div);
      }
    };

    overlay.setMap(map);
    overlayRef.current = overlay;

    return () => {
      overlay.setMap(null);
    };
  }, [map, url, bounds.sw.lat, bounds.sw.lng, bounds.ne.lat, bounds.ne.lng, opacity, visible]);

  return null;
}
