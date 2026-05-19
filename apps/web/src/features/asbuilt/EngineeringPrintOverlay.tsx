// EngineeringPrintOverlay — Phase 7: renders a single EngineeringPrint as a
// GroundOverlay on the workspace map, with optional NW/SE drag handles for
// alignment. Visual reference only — never used to derive billing.
import { useEffect, useRef } from "react";
import { useMap } from "@vis.gl/react-google-maps";
import type { EngineeringPrint } from "@nsc/types";

interface Props {
  print: EngineeringPrint;
  /** When true, render drag handles for re-alignment. */
  editing: boolean;
  /** Called when handles are dragged or opacity changes; persists corners. */
  onCornersChange?: (corners: EngineeringPrint["corners"]) => void;
}

export default function EngineeringPrintOverlay({ print, editing, onCornersChange }: Props) {
  const map = useMap();
  const overlayRef = useRef<google.maps.GroundOverlay | null>(null);
  const nwMarkerRef = useRef<google.maps.Marker | null>(null);
  const seMarkerRef = useRef<google.maps.Marker | null>(null);
  const rotateMarkerRef = useRef<google.maps.Marker | null>(null);

  // Render / re-render overlay whenever print changes
  useEffect(() => {
    if (!map) return;
    if (!print.visible) {
      overlayRef.current?.setMap(null);
      overlayRef.current = null;
      return;
    }
    const { nw, se } = print.corners;
    const bounds = new google.maps.LatLngBounds(
      { lat: Math.min(nw.lat, se.lat), lng: Math.min(nw.lng, se.lng) },
      { lat: Math.max(nw.lat, se.lat), lng: Math.max(nw.lng, se.lng) }
    );

    if (overlayRef.current) overlayRef.current.setMap(null);
    overlayRef.current = new google.maps.GroundOverlay(print.source.dataUrl, bounds, {
      opacity: print.opacity,
      clickable: false,
    });
    overlayRef.current.setMap(map);

    return () => {
      overlayRef.current?.setMap(null);
      overlayRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, print.printId, print.source, print.corners.nw.lat, print.corners.nw.lng,
      print.corners.se.lat, print.corners.se.lng, print.opacity, print.visible]);

  // Drag handles when editing
  useEffect(() => {
    if (!map || !editing) {
      nwMarkerRef.current?.setMap(null);
      seMarkerRef.current?.setMap(null);
      rotateMarkerRef.current?.setMap(null);
      nwMarkerRef.current = null;
      seMarkerRef.current = null;
      rotateMarkerRef.current = null;
      return;
    }

    const { nw, se } = print.corners;
    const ne = { lat: nw.lat, lng: se.lng };

    nwMarkerRef.current?.setMap(null);
    seMarkerRef.current?.setMap(null);
    rotateMarkerRef.current?.setMap(null);

    nwMarkerRef.current = new google.maps.Marker({
      map,
      position: nw,
      draggable: true,
      label: { text: "NW", fontSize: "10px", fontWeight: "bold", color: "#fff" },
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 10,
        fillColor: "#3aa7ff",
        fillOpacity: 0.9,
        strokeColor: "#fff",
        strokeWeight: 2,
      },
    });
    seMarkerRef.current = new google.maps.Marker({
      map,
      position: se,
      draggable: true,
      label: { text: "SE", fontSize: "10px", fontWeight: "bold", color: "#fff" },
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 10,
        fillColor: "#3aa7ff",
        fillOpacity: 0.9,
        strokeColor: "#fff",
        strokeWeight: 2,
      },
    });
    rotateMarkerRef.current = new google.maps.Marker({
      map,
      position: ne,
      draggable: true,
      label: { text: "↻", fontSize: "12px", fontWeight: "bold", color: "#fff" },
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 9,
        fillColor: "#39ff7a",
        fillOpacity: 0.9,
        strokeColor: "#fff",
        strokeWeight: 2,
      },
    });

    const onNwDrag = () => {
      const pos = nwMarkerRef.current!.getPosition();
      if (!pos) return;
      const newNw = { lat: pos.lat(), lng: pos.lng() };
      const newSe = print.corners.se;
      onCornersChange?.({
        nw: newNw,
        ne: { lat: newNw.lat, lng: newSe.lng },
        se: newSe,
        sw: { lat: newSe.lat, lng: newNw.lng },
      });
    };
    const onSeDrag = () => {
      const pos = seMarkerRef.current!.getPosition();
      if (!pos) return;
      const newSe = { lat: pos.lat(), lng: pos.lng() };
      const newNw = print.corners.nw;
      onCornersChange?.({
        nw: newNw,
        ne: { lat: newNw.lat, lng: newSe.lng },
        se: newSe,
        sw: { lat: newSe.lat, lng: newNw.lng },
      });
    };

    const nwListener = nwMarkerRef.current.addListener("dragend", onNwDrag);
    const seListener = seMarkerRef.current.addListener("dragend", onSeDrag);

    return () => {
      google.maps.event.removeListener(nwListener);
      google.maps.event.removeListener(seListener);
      nwMarkerRef.current?.setMap(null);
      seMarkerRef.current?.setMap(null);
      rotateMarkerRef.current?.setMap(null);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, editing, print.printId, print.corners.nw.lat, print.corners.nw.lng,
      print.corners.se.lat, print.corners.se.lng]);

  return null;
}
