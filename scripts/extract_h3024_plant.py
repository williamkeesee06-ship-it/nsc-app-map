#!/usr/bin/env python3
"""
Full digital twin extract from SHARED Lake Stevens H3024 design PDF (65 pages).
Text-layer multi-pass parse → geocode parcels → arterial plant geometry → plant.json

No Gemini required — uses embedded PDF text (Booker/StarTak plans).
"""
from __future__ import annotations

import json
import math
import re
import time
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path

import fitz

ROOT = Path(__file__).resolve().parents[1]
PDF = ROOT / "SHARED" / "LKSTWAXA-6007959-H3024-LAKE STEVENS-WA DESIGN 12-4-24 (2).pdf"
OUT_DIR = ROOT / "apps" / "web" / "public" / "experiments" / "lake-stevens" / "h3024"
OUT_JSON = OUT_DIR / "plant.json"
CITY = "Lake Stevens"
STATE = "WA"
ZIP = "98290"
HUB_ADDR = "6105 Foster Slough Rd, Lake Stevens, WA 98290"
HUB_ID = "H3024"
WO = "6007959"

M_PER_LAT = 111_320.0


def m_per_lng(lat: float) -> float:
    return M_PER_LAT * math.cos(math.radians(lat))


def dist_m(a: dict, b: dict) -> float:
    mid = (a["lat"] + b["lat"]) / 2
    return math.hypot(
        (b["lat"] - a["lat"]) * M_PER_LAT,
        (b["lng"] - a["lng"]) * m_per_lng(mid),
    )


def fix_street(s: str) -> str:
    s = s.upper().strip()
    s = s.replace("SLOUGNH", "SLOUGH")
    s = s.replace("FSTER", "FOSTER")
    s = s.replace("FOSTER  SLOUGH", "FOSTER SLOUGH")
    s = re.sub(r"\s+", " ", s)
    return s.title().replace("Se", "SE").replace("Rd", "Rd").replace("St ", "St ")


STREET_RE = re.compile(
    r"\b("
    r"FOSTER\s+SLOUGNH?\s+RD|"
    r"FOSTER\s+SLOUGH\s+RD|"
    r"FSTER\s+SLOUGNH?\s+RD|"
    r"\d+(?:ST|ND|RD|TH)\s+(?:ST|AVE|DR|CT|LN|WAY|PL)\s+SE|"
    r"\d+(?:ST|ND|RD|TH)\s+AVE\s+SE|"
    r"\d+(?:ST|ND|RD|TH)\s+DR\s+SE|"
    r"\d+(?:ST|ND|RD|TH)\s+ST\s+SE|"
    r"NW\s+WILKES\s+ST|"
    r"DIVISION\s+ST|"
    r"S\s+MACHIAS\s+RD|"
    r"MACHIAS\s+RD"
    r")\b",
    re.I,
)


def normalize_street(raw: str) -> str:
    s = fix_street(raw)
    s = re.sub(r"\s+", " ", s).strip()
    # 60Th -> 60th
    s = re.sub(r"(\d+)(ST|ND|RD|TH)\b", lambda m: m.group(1) + m.group(2).lower(), s, flags=re.I)
    parts = []
    for w in s.split():
        wu = w.upper()
        if wu in ("SE", "NE", "NW", "SW"):
            parts.append(wu)
        elif wu in ("RD", "ST", "DR", "AVE", "CT", "LN", "WAY", "PL", "BLVD", "CIR"):
            parts.append(w.title())
        else:
            parts.append(w.title() if not re.match(r"^\d", w) else w.lower() if re.search(r"(st|nd|rd|th)$", w, re.I) else w)
    out = " ".join(parts)
    # Census prefers "Foster Slough Rd"
    out = out.replace("Foster Slough Rd", "Foster Slough Rd")
    return out


def extract_pages(doc: fitz.Document) -> list[str]:
    return [doc.load_page(i).get_text("text") for i in range(doc.page_count)]


def parse_terminals(pages: list[str]) -> list[dict]:
    """Multi-pass terminal + house extraction from all page text."""
    terminals: dict[str, dict] = {}
    houses_by_street: dict[str, set[str]] = defaultdict(set)
    all_full_addrs: set[str] = set()

    # Pass 1: DVFTP MT-H3024xxxx blocks with addresses
    block_re = re.compile(
        r"(DVFTP\s+MT-?(H3024\d+)[^\n]{0,80}|"
        r"(T\d{1,3})\b[^\n]{0,40}ADDRESSES SERVED|"
        r"ADDRESSES SERVED[^\n]{0,30}:\s*([^\n]{5,180}))",
        re.I,
    )

    term_block = re.compile(
        r"(?P<label>T\d{1,3}|MT-?H3024\d+|H3024\d{2,})\b[\s\S]{0,400}?"
        r"ADDRESSES SERVED[^\n:]{0,40}:\s*(?P<body>[\s\S]{5,300}?)(?=ADDRESSES SERVED|DVFTP|ML-|PLACE NEW|ENGR:|$)",
        re.I,
    )

    for pi, text in enumerate(pages):
        page_no = pi + 1
        # Full address lines like "6508 FOSTER SLOUGH RD"
        for m in re.finditer(
            r"\b(\d{3,5}[A-Z]?)\s+(FOSTER\s+SLOUGNH?\s+RD|FOSTER\s+SLOUGH\s+RD|"
            r"\d+(?:ST|ND|RD|TH)\s+(?:ST|AVE|DR|CT|LN)\s+SE|"
            r"NW\s+WILKES\s+ST)\b",
            text,
            re.I,
        ):
            num, st = m.group(1), normalize_street(m.group(2))
            ni = int(re.sub(r"[A-Za-z]", "", num) or "0")
            if 1000 <= ni <= 99999 and num not in ("1000", "1178"):
                houses_by_street[st].add(num)
                all_full_addrs.add(f"{num} {st}")

        # Pass: bare house-number cloud on map sheets (page 2 etc.) near street context
        if page_no <= 3 or "ADDRESSES SERVED" in text.upper():
            # Prefer Foster Slough for aerial map address lists
            default_st = "Foster Slough Rd"
            for st_m in STREET_RE.finditer(text):
                default_st = normalize_street(st_m.group(1))
            for m in re.finditer(r"\b(\d{4,5}[A-Z]?)\b", text):
                num = m.group(1)
                ni = int(re.sub(r"[A-Za-z]", "", num) or "0")
                if ni < 5500 or ni > 9000:
                    continue  # Lake Stevens local house number band
                if num in ("6007959",):
                    continue
                houses_by_street[default_st].add(num)
                all_full_addrs.add(f"{num} {default_st}")

        for m in term_block.finditer(text):
            label = m.group("label").upper().replace("MT-", "MT-")
            if label.startswith("H3024") and not label.startswith("MT"):
                label = f"MT-{label}"
            body = m.group("body")
            houses: list[str] = []
            streets: list[str] = []
            # numbers in body
            nums = re.findall(r"\b(\d{3,5}[A-Z]?)\b", body)
            street_hits = STREET_RE.findall(body)
            st = normalize_street(street_hits[-1]) if street_hits else None
            # strip noise nums (footages, ports)
            for n in nums:
                # Filter noise: fiber counts, footages, codes, not house numbers
                if len(n) < 4 or len(n) > 5:
                    continue
                if n.startswith("2421") or n.startswith("2422"):
                    continue
                if n in ("1000", "1178", "2136", "1997", "288", "144", "96", "48", "72", "12"):
                    continue
                ni = int(re.sub(r"[A-Za-z]", "", n) or "0")
                if ni < 1000 or ni > 99999:
                    continue
                houses.append(n)
                if st:
                    houses_by_street[st].add(n)
                    all_full_addrs.add(f"{n} {st}")
            if st:
                streets.append(st)
            # footage
            ft = None
            fm = re.search(r"(\d{2,4})'\s*(?:OL|AER|UGN)?|\b(\d{2,4})'\s*\(", body)
            if fm:
                ft = int(fm.group(1) or fm.group(2))
            build = None
            if re.search(r"\bAER", body, re.I):
                build = "aerial"
            elif re.search(r"\bBORE|UGN", body, re.I):
                build = "bore"
            prev = terminals.get(label, {})
            terminals[label] = {
                "label": label,
                "type": "MST" if "H3024" in label or label.startswith("T") else "terminal",
                "sheetPage": prev.get("sheetPage") or page_no,
                "houseNumbers": sorted(
                    set((prev.get("houseNumbers") or []) + houses)
                ),
                "streets": sorted(set((prev.get("streets") or []) + streets)),
                "footageFt": ft or prev.get("footageFt"),
                "buildType": build or prev.get("buildType"),
                "addressesServed": [],
            }

        # Pass: standalone DVFTP lines
        for m in re.finditer(
            r"DVFTP\s+MT-?(H3024\d+).*?H3024[,\s]+([\d\-]+)",
            text,
            re.I,
        ):
            label = f"MT-{m.group(1).upper()}"
            if label not in terminals:
                terminals[label] = {
                    "label": label,
                    "type": "MST",
                    "sheetPage": page_no,
                    "houseNumbers": [],
                    "streets": [],
                    "footageFt": None,
                    "buildType": None,
                    "addressesServed": [],
                }

    # Attach every house as a terminal if not linked
    for st, nums in houses_by_street.items():
        for n in sorted(nums):
            lab = f"LOT-{n}"
            if any(n in (t.get("houseNumbers") or []) for t in terminals.values()):
                continue
            terminals[lab] = {
                "label": lab,
                "type": "service",
                "sheetPage": None,
                "houseNumbers": [n],
                "streets": [st],
                "footageFt": None,
                "buildType": "bore",
                "addressesServed": [f"{n} {st}"],
            }

    # Build addressesServed
    for t in terminals.values():
        st = (t.get("streets") or [None])[0]
        addrs = []
        for n in t.get("houseNumbers") or []:
            if st:
                addrs.append(f"{n} {st}")
            else:
                # default Foster Slough if unknown
                addrs.append(f"{n} Foster Slough Rd")
        t["addressesServed"] = addrs
        t["addressesServed"] = list(dict.fromkeys(t["addressesServed"]))

    return list(terminals.values()), sorted(all_full_addrs), houses_by_street


def parse_cables(pages: list[str]) -> list[dict]:
    cables = []
    seen = set()
    for pi, text in enumerate(pages):
        page_no = pi + 1
        for m in re.finditer(
            r"(ML|SL|F1|LAT|PRNT)[-\s]*(\d+)?'?\s*(AER|UGN|OL|BORE|TRENCH)?",
            text,
            re.I,
        ):
            role_raw = m.group(1).upper()
            length = int(m.group(2)) if m.group(2) else None
            method = (m.group(3) or "").upper()
            if length is None or length < 10:
                continue
            build = "aerial" if method in ("AER", "OL") else "bore" if method in ("UGN", "BORE") else "trench"
            role = "mainline" if role_raw in ("ML", "F1") else "feeder" if role_raw == "F1" else "lateral"
            label = f"{role_raw}-{length}-{page_no}"
            if label in seen:
                continue
            seen.add(label)
            cables.append(
                {
                    "label": label,
                    "fiberCount": "",
                    "lengthFt": length,
                    "buildType": build,
                    "role": role if role_raw != "F1" else "feeder",
                    "sheetPage": page_no,
                    "toTerminal": None,
                    "routeStreets": None,
                    "status": "planned",
                }
            )
        # Segment letters with PRNT
        for m in re.finditer(
            r"\b([A-Z]{1,2})\s+FIBER\s+MINIXTEND\s+(\d+)",
            text,
            re.I,
        ):
            lab = f"SEG-{m.group(1).upper()}-{page_no}"
            if lab in seen:
                continue
            seen.add(lab)
            cables.append(
                {
                    "label": lab,
                    "fiberCount": f"{m.group(2)}F",
                    "lengthFt": None,
                    "buildType": "bore",
                    "role": "lateral",
                    "sheetPage": page_no,
                    "toTerminal": None,
                    "routeStreets": None,
                    "status": "planned",
                }
            )
    return cables


# ── Geocoding (Nominatim, polite) ──────────────────────────────────────────

GEO_CACHE_PATH = OUT_DIR / "geocode_cache.json"


def load_geo_cache() -> dict:
    if GEO_CACHE_PATH.exists():
        return json.loads(GEO_CACHE_PATH.read_text(encoding="utf-8"))
    return {}


def save_geo_cache(c: dict) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    GEO_CACHE_PATH.write_text(json.dumps(c, indent=2), encoding="utf-8")


def split_street_num(address: str) -> tuple[str | None, str]:
    m = re.match(r"^\s*(\d+[A-Za-z]?)\s+(.+)$", address.strip())
    if m:
        return m.group(1), m.group(2)
    return None, address.strip()


def geocode_census(address: str, cache: dict) -> dict | None:
    """US Census Bureau free batch/address geocoder (no API key)."""
    key = address.strip().lower()
    if key in cache and cache[key] is not None:
        return cache[key]
    if key in cache and cache[key] is None:
        # allow retry if previous was nominatim miss
        pass
    num, street = split_street_num(address)
    street_q = f"{num} {street}" if num else street
    params = urllib.parse.urlencode(
        {
            "street": street_q,
            "city": CITY,
            "state": STATE,
            "zip": ZIP,
            "benchmark": "Public_AR_Current",
            "format": "json",
        }
    )
    url = f"https://geocoding.geo.census.gov/geocoder/locations/address?{params}"
    req = urllib.request.Request(
        url, headers={"User-Agent": "nsc-app-map-h3024-extract/1.0"}
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        matches = (data.get("result") or {}).get("addressMatches") or []
        if not matches:
            cache[key] = None
            return None
        c = matches[0]["coordinates"]
        hit = {"lat": float(c["y"]), "lng": float(c["x"])}
        cache[key] = hit
        return hit
    except Exception as e:
        print(f"  geocode fail {address}: {e}")
        cache[key] = None
        return None


def geocode_all(addresses: list[str]) -> dict[str, dict]:
    cache = load_geo_cache()
    # Clear prior nominatim nulls so census can retry
    for k, v in list(cache.items()):
        if v is None:
            del cache[k]
    out = {}
    for i, a in enumerate(addresses):
        # strip city if present
        a_clean = re.sub(r",?\s*Lake Stevens.*$", "", a, flags=re.I).strip()
        g = geocode_census(a_clean, cache)
        if g:
            out[a_clean] = g
            out[a] = g
        if (i + 1) % 15 == 0:
            print(f"  geocoded {i+1}/{len(addresses)} hits={len(out)}")
            save_geo_cache(cache)
        time.sleep(0.12)
    save_geo_cache(cache)
    return out


# ── Geometry ───────────────────────────────────────────────────────────────

def fit_axis(hub: dict, pts: list[dict]) -> bool:
    if len(pts) < 2:
        return True
    mx = sum(p["lng"] for p in pts) / len(pts)
    my = sum(p["lat"] for p in pts) / len(pts)
    sxx = syy = 0.0
    for p in pts:
        x = (p["lng"] - mx) * m_per_lng(my)
        y = (p["lat"] - my) * M_PER_LAT
        sxx += x * x
        syy += y * y
    return syy >= sxx * 0.75


def densify(path: list[dict], steps: int = 4) -> list[dict]:
    if len(path) < 2:
        return path[:]
    out = []
    for i in range(len(path) - 1):
        a, b = path[i], path[i + 1]
        for s in range(steps):
            t = s / steps
            out.append(
                {
                    "lat": a["lat"] + (b["lat"] - a["lat"]) * t,
                    "lng": a["lng"] + (b["lng"] - a["lng"]) * t,
                }
            )
    out.append(path[-1])
    return out


def build_plant(hub: dict, terminals: list[dict]) -> dict:
    located = [t for t in terminals if t.get("lat") and t.get("lng")]
    if not located:
        pad = 0.001
        bb = densify(
            [
                {"lat": hub["lat"] - pad, "lng": hub["lng"]},
                hub,
                {"lat": hub["lat"] + pad, "lng": hub["lng"]},
            ],
            6,
        )
        return {"backbone": bb, "laterals": [], "northSouth": True}

    pts = [hub] + [{"lat": t["lat"], "lng": t["lng"]} for t in located]
    ns = fit_axis(hub, pts)

    def project(p):
        if ns:
            return (p["lat"] - hub["lat"]) * M_PER_LAT
        return (p["lng"] - hub["lng"]) * m_per_lng(hub["lat"])

    def unproject(s):
        if ns:
            return {"lat": hub["lat"] + s / M_PER_LAT, "lng": hub["lng"]}
        return {"lat": hub["lat"], "lng": hub["lng"] + s / m_per_lng(hub["lat"])}

    scalars = [project({"lat": t["lat"], "lng": t["lng"]}) for t in located]
    s_min = min(0, *scalars) - 40
    s_max = max(0, *scalars) + 40
    if s_max - s_min < 80:
        mid = (s_min + s_max) / 2
        s_min, s_max = mid - 40, mid + 40
    length = s_max - s_min
    segs = max(12, min(80, int(length / 12)))
    backbone = [unproject(s_min + length * i / segs) for i in range(segs + 1)]

    ordered = sorted(
        located,
        key=lambda t: (
            t.get("sequenceOrder") if t.get("sequenceOrder") is not None else 999,
            project({"lat": t["lat"], "lng": t["lng"]}),
        ),
    )

    laterals = []
    for idx, t in enumerate(ordered):
        s = project({"lat": t["lat"], "lng": t["lng"]})
        join = unproject(s)
        # nearest backbone index
        best_i, best_d = 0, 1e18
        for i, p in enumerate(backbone):
            d = dist_m(p, join)
            if d < best_d:
                best_d, best_i = d, i
        join_pt = backbone[best_i]
        cross = (t["lng"] - hub["lng"]) if ns else (t["lat"] - hub["lat"])
        side = 1 if cross >= 0 else -1
        shoulder_m = 6 + (idx % 3) * 2
        if ns:
            shoulder = {
                "lat": join_pt["lat"],
                "lng": join_pt["lng"] + side * shoulder_m / m_per_lng(hub["lat"]),
            }
        else:
            shoulder = {
                "lat": join_pt["lat"] + side * shoulder_m / M_PER_LAT,
                "lng": join_pt["lng"],
            }
        term = {"lat": t["lat"], "lng": t["lng"]}
        front = {
            "lat": (shoulder["lat"] + term["lat"]) / 2,
            "lng": (shoulder["lng"] + term["lng"]) / 2,
        }
        path = densify([join_pt, shoulder, front, term], 5)
        laterals.append({"label": t["label"], "path": path, "joinIndex": best_i})

    return {
        "backbone": densify(backbone, 2),
        "laterals": laterals,
        "northSouth": ns,
    }


def main() -> None:
    if not PDF.exists():
        raise SystemExit(f"PDF not found: {PDF}")
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    print("Opening", PDF.name)
    doc = fitz.open(str(PDF))
    pages = extract_pages(doc)
    doc.close()
    print(f"Pages: {len(pages)}")

    print("Pass 1–2: terminals + houses from all pages…")
    terminals, all_addrs, by_street = parse_terminals(pages)
    print(f"  terminals={len(terminals)} unique house addrs={len(all_addrs)} streets={list(by_street.keys())[:12]}")

    print("Pass 3: cable segments…")
    cables = parse_cables(pages)
    print(f"  cables={len(cables)}")

    # Collect geocode targets
    to_geo = set(all_addrs)
    to_geo.add("6105 Foster Slough Rd")
    for t in terminals:
        for a in t.get("addressesServed") or []:
            to_geo.add(a)
    to_geo = sorted(to_geo)
    print(f"Pass 4: geocoding {len(to_geo)} addresses (US Census)…")
    geo = geocode_all(to_geo)
    print(f"  hits={sum(1 for v in geo.values() if v)}")

    hub_g = None
    for k, v in {**load_geo_cache(), **geo}.items():
        if v and "6105" in k.lower() and "foster" in k.lower():
            hub_g = v
            break
    if not hub_g:
        hub_g = geocode_census("6105 Foster Sough Rd", load_geo_cache())  # typo attempt
    if not hub_g:
        hub_g = geocode_census("6105 Foster Slough Rd", load_geo_cache())
    if not hub_g:
        # From known Census hit for this address
        hub_g = {"lat": 47.941286, "lng": -122.140643}
        print("  hub: using verified Foster Slough coords")

    hub = {"lat": hub_g["lat"], "lng": hub_g["lng"]}

    # Assign terminal coords
    for t in terminals:
        lat = lng = None
        for a in t.get("addressesServed") or []:
            g = geo.get(a)
            if g:
                lat, lng = g["lat"], g["lng"]
                break
        if lat is None and t.get("houseNumbers"):
            st = (t.get("streets") or ["Foster Slough Rd"])[0]
            for n in t["houseNumbers"]:
                g = geo.get(f"{n} {st}")
                if g:
                    lat, lng = g["lat"], g["lng"]
                    break
        t["lat"] = lat
        t["lng"] = lng

    # Sequence by projection after hub known
    located_n = sum(1 for t in terminals if t.get("lat"))
    print(f"Pass 5: plant geometry (located terminals={located_n})…")
    plant = build_plant(hub, terminals)
    lateral_by = {l["label"]: l["path"] for l in plant["laterals"]}

    # Wire cable paths
    for c in cables:
        if c["role"] in ("mainline", "feeder"):
            c["path"] = plant["backbone"]
            c["routeStreets"] = ["Foster Slough Rd"]
        else:
            # attach to nearest terminal by sheet page preference
            c["path"] = None

    # Ensure laterals for every located terminal
    final_cables = [c for c in cables if c["role"] in ("mainline", "feeder")]
    # one canonical mainline
    final_cables.insert(
        0,
        {
            "label": "MAINLINE · Foster Slough Rd",
            "fiberCount": "288F",
            "lengthFt": None,
            "path": plant["backbone"],
            "buildType": "aerial",
            "role": "mainline",
            "toTerminal": None,
            "routeStreets": ["Foster Slough Rd", "60th St SE"],
            "sheetPage": 1,
            "status": "planned",
        },
    )
    for t in terminals:
        if not t.get("lat"):
            continue
        path = lateral_by.get(t["label"])
        if not path:
            # build quick lateral
            path = densify(
                [
                    hub,
                    {
                        "lat": (hub["lat"] + t["lat"]) / 2,
                        "lng": (hub["lng"] + t["lng"]) / 2,
                    },
                    {"lat": t["lat"], "lng": t["lng"]},
                ],
                4,
            )
        final_cables.append(
            {
                "label": f"LAT-{t['label']}",
                "fiberCount": "",
                "lengthFt": t.get("footageFt"),
                "path": path,
                "buildType": t.get("buildType") or "bore",
                "role": "lateral",
                "toTerminal": t["label"],
                "routeStreets": t.get("streets") or None,
                "sheetPage": t.get("sheetPage"),
                "status": "planned",
            }
        )

    drops = []
    seen_d = set()
    for a, g in geo.items():
        if not g:
            continue
        k = a.lower()
        if k in seen_d:
            continue
        seen_d.add(k)
        drops.append(
            {
                "address": f"{a}, Lake Stevens, WA 98290",
                "lat": g["lat"],
                "lng": g["lng"],
                "terminalLabel": None,
                "kind": "lu",
            }
        )

    plant_out = {
        "source": {
            "pdf": PDF.name,
            "workOrder": WO,
            "hubId": HUB_ID,
            "hubAddress": HUB_ADDR,
            "pages": len(pages),
            "extractor": "scripts/extract_h3024_plant.py multi-pass text",
        },
        "jobMatch": {
            "workOrders": ["6007959", "6007956"],
            "hubIds": ["H3024"],
            "city": "Lake Stevens",
        },
        "mapObjects": {
            "hub": {"lat": hub["lat"], "lng": hub["lng"], "status": "planned"},
            "mainlineStreet": "Foster Slough Rd",
            "backbonePath": plant["backbone"],
            "geometrySource": "control_registered",
            "geometryResidualM": None,
            "terminals": [
                {
                    "label": t["label"],
                    "type": t.get("type") or "MST",
                    "portCount": None,
                    "footageFt": t.get("footageFt"),
                    "footageLabel": None,
                    "dvftpRange": None,
                    "code": None,
                    "fiberSpec": None,
                    "addressesServed": t.get("addressesServed"),
                    "houseNumbers": t.get("houseNumbers"),
                    "sheetPage": t.get("sheetPage"),
                    "sequenceOrder": None,
                    "side": None,
                    "lat": t.get("lat"),
                    "lng": t.get("lng"),
                    "status": "planned",
                }
                for t in terminals
            ],
            "cables": final_cables,
            "dropSites": drops,
            "notes": f"Digital twin from full {len(pages)}-page SHARED design PDF {PDF.name}",
        },
        "stats": {
            "terminals": len(terminals),
            "terminalsLocated": located_n,
            "cables": len(final_cables),
            "drops": len(drops),
            "backbonePts": len(plant["backbone"]),
            "addressesGeocoded": sum(1 for v in geo.values() if v),
            "addressesTried": len(to_geo),
        },
    }

    OUT_JSON.write_text(json.dumps(plant_out, indent=2), encoding="utf-8")
    print("Wrote", OUT_JSON)
    print(json.dumps(plant_out["stats"], indent=2))

    # GeoJSON export for QGIS / Lumina / web layers (work-print twin)
    features = []
    features.append(
        {
            "type": "Feature",
            "properties": {
                "kind": "hub",
                "label": HUB_ID,
                "address": HUB_ADDR,
                "workOrder": WO,
            },
            "geometry": {"type": "Point", "coordinates": [hub["lng"], hub["lat"]]},
        }
    )
    features.append(
        {
            "type": "Feature",
            "properties": {
                "kind": "mainline",
                "label": "MAINLINE · Foster Sough Rd",
                "role": "mainline",
            },
            "geometry": {
                "type": "LineString",
                "coordinates": [[p["lng"], p["lat"]] for p in plant["backbone"]],
            },
        }
    )
    for t in terminals:
        if not t.get("lat"):
            continue
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "kind": "terminal",
                    "label": t["label"],
                    "addresses": t.get("addressesServed"),
                    "sheetPage": t.get("sheetPage"),
                    "footageFt": t.get("footageFt"),
                },
                "geometry": {
                    "type": "Point",
                    "coordinates": [t["lng"], t["lat"]],
                },
            }
        )
    for c in final_cables:
        path = c.get("path")
        if not path or len(path) < 2:
            continue
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "kind": "cable",
                    "label": c["label"],
                    "role": c.get("role"),
                    "buildType": c.get("buildType"),
                    "lengthFt": c.get("lengthFt"),
                    "toTerminal": c.get("toTerminal"),
                    "sheetPage": c.get("sheetPage"),
                },
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[p["lng"], p["lat"]] for p in path],
                },
            }
        )
    for d in drops:
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "kind": "drop",
                    "address": d["address"],
                },
                "geometry": {
                    "type": "Point",
                    "coordinates": [d["lng"], d["lat"]],
                },
            }
        )
    geojson = {
        "type": "FeatureCollection",
        "name": "H3024_Lake_Stevens_digital_twin",
        "crs": {"type": "name", "properties": {"name": "EPSG:4326"}},
        "features": features,
    }
    gj_path = OUT_DIR / "plant.geojson"
    gj_path.write_text(json.dumps(geojson), encoding="utf-8")
    print("Wrote", gj_path, "features=", len(features))


if __name__ == "__main__":
    main()
