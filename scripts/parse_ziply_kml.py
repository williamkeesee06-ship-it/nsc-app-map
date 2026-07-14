import xml.etree.ElementTree as ET
import json
import re
import os

kml_path = "D:/1 MAP APP NEW GROK/nsc-app-map/SHARED/ZIPLY (1).kml"
geojson_out = "D:/1_NSC MAP APP/apps/web/public/experiments/lake-stevens/h2043/platform.geojson"

print("Parsing KML:", kml_path)

# KML Namespace
ns = {'kml': 'http://www.opengis.net/kml/2.2'}

try:
    tree = ET.parse(kml_path)
    root = tree.getroot()
except Exception as e:
    print("Error parsing XML tree:", e)
    # Try cleaning namespace-less parsing
    root = ET.fromstring(open(kml_path, "r", encoding="utf-8").read().encode("utf-8"))

def clean_text(text):
    if not text:
        return ""
    return text.strip()

def guess_layer(name, desc, geom_type):
    text = (clean_text(name) + " " + clean_text(desc)).lower()
    
    if geom_type == "Point":
        if "handhole" in text or "hh" in text or "vault" in text:
            return "handhole"
        if "pole" in text:
            return "pole"
        if "hub" in text or "fdh" in text or "splitter" in text:
            return "hub"
        if "terminal" in text or "mst" in text or "splice" in text or "closure" in text:
            return "terminal"
        if "service" in text or "address" in text:
            return "service_point"
        return "terminal" # fallback for points
    else: # LineString / Polygon
        if "feeder" in text or "mainline" in text:
            return "feeder"
        if "drop" in text:
            return "drop"
        if "bore" in text or "trench" in text or "duct" in text:
            return "bore"
        return "distribution" # fallback for lines

features = []
count_pts = 0
count_lines = 0

# Find all Placemarks
for pm in root.findall('.//kml:Placemark', ns):
    name_el = pm.find('kml:name', ns)
    desc_el = pm.find('kml:description', ns)
    
    name = name_el.text if name_el is not None else ""
    desc = desc_el.text if desc_el is not None else ""
    
    # Check for Point
    point = pm.find('.//kml:Point', ns)
    if point is not None:
        coord_el = point.find('kml:coordinates', ns)
        if coord_el is not None and coord_el.text:
            coords_str = coord_el.text.strip()
            parts = coords_str.split(',')
            if len(parts) >= 2:
                try:
                    lng = float(parts[0])
                    lat = float(parts[1])
                    layer = guess_layer(name, desc, "Point")
                    features.append({
                        "type": "Feature",
                        "id": f"mymaps-pt-{count_pts}",
                        "geometry": {
                            "type": "Point",
                            "coordinates": [lng, lat]
                        },
                        "properties": {
                            "layer": layer,
                            "type": "point",
                            "label": name or f"{layer.upper()} Point",
                            "description": desc,
                            "status": "designed"
                        }
                    })
                    count_pts += 1
                except ValueError:
                    pass
                    
    # Check for LineString
    line = pm.find('.//kml:LineString', ns)
    if line is not None:
        coord_el = line.find('kml:coordinates', ns)
        if coord_el is not None and coord_el.text:
            coords_str = coord_el.text.strip()
            # Split coordinates (might be spaces or newlines separated)
            coord_list = []
            for coord_pair in re.split(r'\s+', coords_str):
                if not coord_pair:
                    continue
                parts = coord_pair.split(',')
                if len(parts) >= 2:
                    try:
                        lng = float(parts[0])
                        lat = float(parts[1])
                        coord_list.append([lng, lat])
                    except ValueError:
                        pass
            if len(coord_list) >= 2:
                layer = guess_layer(name, desc, "LineString")
                features.append({
                    "type": "Feature",
                    "id": f"mymaps-ln-{count_lines}",
                    "geometry": {
                        "type": "LineString",
                        "coordinates": coord_list
                    },
                    "properties": {
                        "layer": layer,
                        "type": "line",
                        "label": name or f"{layer.upper()} Line",
                        "description": desc,
                        "status": "designed"
                    }
                })
                count_lines += 1

print(f"Parsed {count_pts} points, {count_lines} lines.")

geojson = {
    "type": "FeatureCollection",
    "name": "Ziply_Woodinville_Imported",
    "crs": {
        "type": "name",
        "properties": {
            "name": "urn:ogc:def:crs:OGC:1.3:CRS84"
        }
    },
    "metadata": {
        "projectId": "H2043",
        "city": "Woodinville",
        "stats": {
            "services": len([f for f in features if f["properties"]["layer"] == "service_point"]),
            "terminals": len([f for f in features if f["properties"]["layer"] == "terminal"]),
            "cables": len([f for f in features if f["properties"]["layer"] in ("feeder", "distribution")]),
        }
    },
    "features": features
}

# Write GeoJSON
os.makedirs(os.path.dirname(geojson_out), exist_ok=True)
with open(geojson_out, "w", encoding="utf-8") as f:
    json.dump(geojson, f, indent=2)

print("Saved parsed GeoJSON to:", geojson_out)
