#!/usr/bin/env python3
"""
Digital Field Operations Platform — H3024 Lake Stevens (print-faithful).

PDF text layer → multi-layer GeoJSON:
  hub, feeder, distribution, drop, bore, terminal, service_point, pole, handhole

Fidelity rules:
  - SLOUGNH → SLOUGH always
  - Street from print (Foster / 60th / 64th / 76th / 70th / 61st) — never dump all on Foster
  - ~229 LUs from design cover; extract every street-bound + SERVED address
  - Terminals: address centroids when linked; else work-sheet house cluster
  - Cables: street-snapped polylines between real nodes (not synthetic dots)
  - Hub: print lat/lng kept as metadata; map hub snaps to geocoded 6105 Foster Slough
"""
from __future__ import annotations

import json
import math
import re
import time
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path

import fitz

ROOT = Path(__file__).resolve().parents[1]
PDF = ROOT / "SHARED" / "LKSTWAXA-6007959-H3024-LAKE STEVENS-WA DESIGN 12-4-24 (2).pdf"
OUT = ROOT / "apps" / "web" / "public" / "experiments" / "lake-stevens" / "h3024"
CACHE = OUT / "geocode_cache.json"

# Print cover anchor (field GPS on design); used as metadata only if Census misses 6105
HUB_PRINT = {"lat": 47.939488, "lng": -122.157410}
HUB_ADDR = "6105 Foster Slough Rd, Lake Stevens, WA 98290"
CITY, STATE, ZIP = "Lake Stevens", "WA", "98290"
M_PER_LAT = 111_320.0

STREET_CANON = {
    "FOSTER SLOUGH RD": "Foster Sough Rd",  # fixed below
}


def m_per_lng(lat: float) -> float:
    return M_PER_LAT * math.cos(math.radians(lat))


def dist_m(a, b) -> float:
    mid = (a["lat"] + b["lat"]) / 2
    return math.hypot(
        (b["lat"] - a["lat"]) * M_PER_LAT,
        (b["lng"] - a["lng"]) * m_per_lng(mid),
    )


# ── Address / street normalization ─────────────────────────────────────

def fix_st(s: str) -> str:
    s = re.sub(r"\s+", " ", s.upper().strip())
    s = s.replace("SLOUGNH", "SLOUGH").replace("FSTER", "FOSTER")
    s = s.replace("SLOUGNHRD", "SLOUGH RD")
    s = s.replace("STS E", "ST SE").replace("STSE", "ST SE")
    s = s.replace("FOSTER  SLOUGH", "FOSTER SLOUGH")
    s = re.sub(r"(\d+)(ST|ND|RD|TH)\b", lambda m: m.group(1) + m.group(2).lower(), s)
    parts = []
    for w in s.split():
        wu = w.upper()
        if wu in ("SE", "NE", "NW", "SW"):
            parts.append(wu)
        elif wu in ("RD", "ST", "DR", "AVE", "CT", "LN", "WAY", "PL"):
            parts.append(w.title())
        else:
            parts.append(w.title())
    out = " ".join(parts)
    # ordinal casing: 64Th → 64th
    out = re.sub(
        r"(\d+)(St|Nd|Rd|Th)\b",
        lambda m: m.group(1) + m.group(2).lower(),
        out,
    )
    return out


def normalize_address(addr: str) -> str:
    a = re.sub(r"\s+", " ", addr.strip())
    a = (
        a.replace("SLOUGNH", "SLOUGH")
        .replace("Slougnh", "Slough")
        .replace("slougnh", "slough")
        .replace("SLOUGNHRD", "SLOUGH RD")
        .replace("FSTER", "FOSTER")
        .replace("Fster", "Foster")
        .replace("STS E", "ST SE")
    )
    a = re.sub(r",?\s*Lake Stevens.*$", "", a, flags=re.I).strip()
    m = re.match(r"^(\d+[A-Za-z]?)\s+(.+)$", a)
    if m:
        a = f"{m.group(1)} {fix_st(m.group(2))}"
    if "WA" not in a.upper():
        a = f"{a}, Lake Stevens, WA 98290"
    return a


def street_only(addr: str) -> str:
    n = normalize_address(addr)
    return re.sub(r",?\s*Lake Stevens.*$", "", n, flags=re.I).strip()


def house_num(addr: str) -> int | None:
    m = re.match(r"^(\d+)", str(addr).strip())
    return int(m.group(1)) if m else None


def street_name_of(addr: str) -> str:
    so = street_only(addr)
    return re.sub(r"^\d+[A-Za-z]?\s+", "", so).strip()


STREET_RE = re.compile(
    r"(FOSTER\s+SLOUGNH?\s*RD|FOSTER\s+SLOUGH\s*RD|"
    r"64TH\s+STS?\s*E|64TH\s+ST\s*SE|"
    r"60TH\s+ST\s*SE|"
    r"76TH\s+DR\s*SE|70TH\s+DR\s*SE|61ST\s+AVE\s*SE|"
    r"NW\s+WILKES\s+ST|DIVISION\s+ST|MACHIAS\s+RD)",
    re.I,
)

# nums… STREET (multi house + street on one line / wrapped)
INLINE_ADDR_RE = re.compile(
    r"\b((?:\d{4,5}[A-Z]?(?:\(\d+\))?\s*,\s*)*\d{4,5}[A-Z]?(?:\(\d+\))?)\s+"
    r"(FOSTER\s+SLOUGNH?\s*RD|FOSTER\s+SLOUGH\s*RD|"
    r"64TH\s+STS?\s*E|64TH\s+ST\s*SE|"
    r"60TH\s+ST\s*SE|76TH\s+DR\s*SE|70TH\s+DR\s*SE|61ST\s+AVE\s*SE|"
    r"NW\s+WILKES\s+ST|DIVISION\s+ST|MACHIAS\s+RD)",
    re.I,
)

NOISE_NUMS = {
    "1000", "1178", "1500", "2421", "2422", "2136", "1997",
    "6007959", "288", "144", "96", "48", "72", "12", "432",
}


def is_house(n: str) -> bool:
    raw = re.sub(r"[A-Za-z()]", "", n)
    if not raw.isdigit():
        return False
    ni = int(raw)
    if n in NOISE_NUMS or raw in NOISE_NUMS:
        return False
    # Lake Stevens residential band for this plant
    return 4000 <= ni <= 9000 or 42000 <= ni <= 43000


def resolve_terminal_id(tlab: str | None, terminals: dict) -> str | None:
    if not tlab:
        return None
    lab = tlab.strip().upper().replace(" ", "")
    if lab in terminals:
        return lab
    m = re.match(r"^(?:MT-)?H3024(\d{1,4})$", lab)
    if m:
        cand = f"MT-H3024{m.group(1)}"
        terminals.setdefault(
            cand,
            {
                "terminalId": cand,
                "fiberRange": None,
                "portCount": None,
                "addresses": [],
                "printRef": None,
                "type": "terminal",
                "status": "designed",
                "sheetPages": set(),
            },
        )
        return cand
    m = re.match(r"^T(\d{1,3})$", lab)
    if m:
        n = m.group(1)
        for cand in (
            f"MT-H3024{n}",
            f"MT-H30240{n}",
            f"MT-H3024{n.zfill(2)}",
            f"MT-H3024{n.zfill(3)}",
            f"MT-H3024{n.zfill(4)}",
        ):
            if cand in terminals:
                return cand
        for tid in terminals:
            if re.search(rf"{n}$", tid) or tid.endswith(n.zfill(2)) or tid.endswith(n.zfill(3)):
                return tid
        # create T-mapped id as MT-H3024{n}
        cand = f"MT-H3024{n.zfill(2) if len(n) <= 2 else n}"
        terminals.setdefault(
            cand,
            {
                "terminalId": cand,
                "fiberRange": None,
                "portCount": None,
                "addresses": [],
                "printRef": None,
                "type": "terminal",
                "status": "designed",
                "sheetPages": set(),
            },
        )
        return cand
    return None


def ensure_term(terminals: dict, tid: str, page: int | None = None) -> dict:
    t = terminals.setdefault(
        tid,
        {
            "terminalId": tid,
            "fiberRange": None,
            "portCount": None,
            "addresses": [],
            "printRef": f"p{page}" if page else None,
            "type": "terminal",
            "status": "designed",
            "sheetPages": set(),
        },
    )
    if "sheetPages" not in t:
        t["sheetPages"] = set()
    if page:
        t["sheetPages"].add(page)
        t["printRef"] = f"p{page}"
    return t


# ── Geocoding ──────────────────────────────────────────────────────────

def load_cache() -> dict:
    if CACHE.exists():
        return json.loads(CACHE.read_text(encoding="utf-8"))
    return {}


def save_cache(c: dict) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    CACHE.write_text(json.dumps(c, indent=2), encoding="utf-8")


def address_keys(addr: str) -> list[str]:
    keys = {addr.strip(), addr.strip().lower(), addr.title(), addr.upper()}
    n = normalize_address(addr)
    so = street_only(n)
    keys.update({n, n.lower(), so, so.lower(), so.upper()})
    keys.add(so.upper().replace("SLOUGH", "SLOUGNH"))
    return [k for k in keys if k]


def geocode_census(street_line: str, cache: dict, hub_ref: dict | None = None) -> dict | None:
    full = normalize_address(street_line)
    so = street_only(full)
    key = so.lower()
    if key in cache and cache[key]:
        return cache[key]
    params = urllib.parse.urlencode(
        {
            "street": so,
            "city": CITY,
            "state": STATE,
            "zip": ZIP,
            "benchmark": "Public_AR_Current",
            "format": "json",
        }
    )
    url = f"https://geocoding.geo.census.gov/geocoder/locations/address?{params}"
    req = urllib.request.Request(url, headers={"User-Agent": "nsc-h3024-platform/2.0"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.loads(r.read().decode())
        matches = (data.get("result") or {}).get("addressMatches") or []
        if not matches:
            cache[key] = None
            return None
        c = matches[0]["coordinates"]
        hit = {"lat": float(c["y"]), "lng": float(c["x"])}
        ref = hub_ref or HUB_PRINT
        if dist_m(ref, hit) > 15000:
            cache[key] = None
            return None
        cache[key] = hit
        for k in address_keys(street_line) + address_keys(full):
            cache[k.lower()] = hit
        return hit
    except Exception as e:
        print("  geo fail", so, e)
        cache[key] = None
        return None


def interpolate_house(addr: str, known: list[tuple[int, float, float]]) -> dict | None:
    n = house_num(addr)
    if n is None or len(known) < 2:
        return None
    known = sorted(known, key=lambda x: x[0])
    if n <= known[0][0]:
        a, b = known[0], known[1]
    elif n >= known[-1][0]:
        a, b = known[-2], known[-1]
    else:
        a = b = known[0]
        for i in range(len(known) - 1):
            if known[i][0] <= n <= known[i + 1][0]:
                a, b = known[i], known[i + 1]
                break
    span = max(b[0] - a[0], 1)
    t = (n - a[0]) / span
    return {
        "lat": a[1] + (b[1] - a[1]) * t,
        "lng": a[2] + (b[2] - a[2]) * t,
        "interpolated": True,
    }


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


def street_centerline(points: list[dict]) -> list[dict]:
    """Order points along principal axis (max variance of lng vs lat)."""
    if len(points) < 2:
        return points[:]
    lats = [p["lat"] for p in points]
    lngs = [p["lng"] for p in points]
    if max(lngs) - min(lngs) >= max(lats) - min(lats):
        ordered = sorted(points, key=lambda p: (p["lng"], p["lat"]))
    else:
        ordered = sorted(points, key=lambda p: (p["lat"], p["lng"]))
    # drop near-duplicates
    out = [ordered[0]]
    for p in ordered[1:]:
        if dist_m(out[-1], p) > 8:
            out.append(p)
    return out


# ── Extraction ─────────────────────────────────────────────────────────

def extract_all(pages: list[str]):
    terminals: dict[str, dict] = {}
    service_points: dict[str, dict] = {}
    poles: dict[str, dict] = {}
    handholes: list[dict] = []
    cable_rows: list[dict] = []
    # page → house numbers seen (for terminal sheet placement)
    page_houses: dict[int, list[str]] = defaultdict(list)
    page_streets: dict[int, list[str]] = defaultdict(list)
    page_terms: dict[int, list[str]] = defaultdict(list)

    def add_svc(num: str, street: str, tid: str | None, page: int, source: str):
        if not is_house(num):
            return
        n_clean = re.sub(r"[A-Za-z()]", "", num)
        st = fix_st(street)
        raw = f"{n_clean} {st}"
        sk = street_only(normalize_address(raw))
        prev = service_points.get(sk)
        if prev:
            if tid and not prev.get("terminal"):
                prev["terminal"] = tid
            return
        service_points[sk] = {
            "address": sk,
            "addressFull": normalize_address(raw),
            "addressRaw": raw,
            "terminal": tid,
            "dropFootage": None,
            "type": "service_point",
            "status": "designed",
            "printRef": f"p{page}",
            "source": source,
            "street": st,
        }
        page_houses[page].append(sk)
        if tid and tid in terminals:
            if sk not in terminals[tid]["addresses"]:
                terminals[tid]["addresses"].append(sk)

    for pi, text in enumerate(pages):
        page = pi + 1
        # poles
        for m in re.finditer(
            r"(?:SNOHOMISH\s+PUD\s*/\s*)?(D\d{2,3}|VZ\d+|NT|DF1|STUB\s+POLE)",
            text,
            re.I,
        ):
            pid = re.sub(r"\s+", " ", m.group(1).upper())
            poles[pid] = {
                "id": pid,
                "owner": "Snohomish PUD" if pid.startswith("D") else "Ziply/other",
                "printRef": f"p{page}",
                "type": "pole",
            }

        # handholes
        for m in re.finditer(
            r"PLACE NEW\s+(\d+'?\s*[Xx×]\s*\d+'?|\d+X\d+|2'x3'|17x30)\s*HH|"
            r"(\d+'?\s*[Xx×]\s*\d+)'?\s*HH",
            text,
            re.I,
        ):
            size = (m.group(1) or m.group(2) or "HH").replace("×", "x")
            handholes.append(
                {
                    "id": f"HH-{page}-{len(handholes)+1}",
                    "size": size,
                    "type": "new",
                    "printRef": f"p{page}",
                    "page": page,
                }
            )

        # terminals MT-H3024 / H3024nn
        for m in re.finditer(r"(?:MT-)?H3024(\d{1,4})\b", text, re.I):
            # skip bare H3024 alone (group must be digits) — already in pattern
            digits = m.group(1)
            # reject fiber-looking single digit ranges incorrectly — keep 1-4 digits
            tid = f"MT-H3024{digits}"
            ensure_term(terminals, tid, page)
            page_terms[page].append(tid)

        for m in re.finditer(
            r"(MT-?H3024\d{1,4})[,\s]+(\d{1,3})-(\d{1,3})",
            text,
            re.I,
        ):
            raw = m.group(1).upper()
            tid = raw if raw.startswith("MT-") else f"MT-{raw}"
            tid = tid.replace("MT-MT-", "MT-")
            t = ensure_term(terminals, tid, page)
            t["fiberRange"] = f"H3024,{m.group(2)}-{m.group(3)}"

        # streets on page
        for sm in STREET_RE.finditer(text):
            page_streets[page].append(fix_st(sm.group(1)))

        # ADDRESSES SERVED (AERIAL / UGN) — split UGN sub-blocks
        for m in re.finditer(
            r"ADDRESSES SERVED[^\n]{0,40}:\s*([^\n]+(?:\n[^\n]{0,120}){0,3})",
            text,
            re.I,
        ):
            body = re.sub(r"\s+", " ", m.group(1))
            # split nested UGN served
            chunks = re.split(r"ADDRESSES SERVED\s+\w+\s+\d+:", body, flags=re.I)
            if len(chunks) == 1:
                chunks = [body]
            prev = text[max(0, m.start() - 240) : m.start()]
            after = text[m.end() : min(len(text), m.end() + 200)]
            ctx = prev + " " + body + " " + after
            full_ids = re.findall(r"(?:MT-)?H3024\d{1,4}", ctx, re.I)
            tlab = None
            if full_ids:
                # prefer id after the block (callout order)
                after_ids = re.findall(r"(?:MT-)?H3024\d{1,4}", after, re.I)
                pick = after_ids[0] if after_ids else full_ids[-1]
                tlab = pick.upper()
                if not tlab.startswith("MT-"):
                    tlab = "MT-" + tlab
            if not tlab:
                tm = re.findall(r"\bT\d{1,3}\b", prev, re.I)
                if tm:
                    tlab = tm[-1].upper()
            tid = resolve_terminal_id(tlab, terminals)
            if tid:
                ensure_term(terminals, tid, page)

            for chunk in chunks:
                # may have multiple street segments in one chunk
                for im in INLINE_ADDR_RE.finditer(chunk):
                    nums_blob, st = im.group(1), im.group(2)
                    for n in re.findall(r"\d{4,5}[A-Z]?", nums_blob):
                        add_svc(n, st, tid, page, "served")
                # leftover numbers with street from STREET_RE
                st_m = STREET_RE.search(chunk)
                if st_m:
                    st = fix_st(st_m.group(1))
                    for n in re.findall(r"\b(\d{4,5}[A-Z]?)\b", chunk):
                        add_svc(n, st, tid, page, "served")

        # Inline "6508 FOSTER SLOUGNH RD" / "5504 60TH ST SE" everywhere
        for im in INLINE_ADDR_RE.finditer(text):
            nums_blob, st = im.group(1), im.group(2)
            for n in re.findall(r"\d{4,5}[A-Z]?", nums_blob):
                add_svc(n, st, None, page, "inline")

        # FUTURE RESERVE … 5508, 5512, 5504 60TH ST SE
        for m in re.finditer(
            r"(?:FUTURE RESERVE|NO EASEMENT|LEFT IN NEW).{0,80}?"
            r"((?:\d{4,5}\s*,\s*)+\d{4,5})\s+"
            r"(60TH\s+ST\s*SE|64TH\s+ST\s*SE|FOSTER\s+SLOUG\w*\s*RD|76TH\s+DR\s*SE|"
            r"70TH\s+DR\s*SE|61ST\s+AVE\s*SE)",
            text,
            re.I | re.S,
        ):
            st = fix_st(m.group(2))
            for n in re.findall(r"\d{4,5}", m.group(1)):
                add_svc(n, st, None, page, "future_reserve")
                sk = street_only(normalize_address(f"{n} {st}"))
                if sk in service_points:
                    service_points[sk]["status"] = "future"
                    service_points[sk]["type"] = "service_point"

        # cables ML / BORE / DW / MINIXTEND
        for m in re.finditer(r"ML-\s*(\d+)'?\s*(AER|UGN|OL|BORE)?", text, re.I):
            ft = int(m.group(1))
            method = (m.group(2) or "UGN").upper()
            if ft < 15:
                continue
            install = "AER" if method in ("AER", "OL") else "UGN"
            layer = "bore" if method == "BORE" else ("feeder" if ft > 800 else "distribution")
            cable_rows.append(
                {
                    "cableId": f"ML-{ft}-p{page}",
                    "fiberCount": None,
                    "type": install,
                    "footage": ft,
                    "layer": layer,
                    "installMethod": "DIR_BORE" if method == "BORE" else install,
                    "printRef": f"PRNT/p{page}",
                    "page": page,
                    "status": "designed",
                    "progressPct": 0,
                }
            )
        for m in re.finditer(r"BORE\s+(\d+)'", text, re.I):
            ft = int(m.group(1))
            if ft < 10:
                continue
            cable_rows.append(
                {
                    "cableId": f"BORE-{ft}-p{page}",
                    "fiberCount": None,
                    "type": "UGN",
                    "footage": ft,
                    "layer": "bore",
                    "installMethod": "DIR_BORE",
                    "printRef": f"p{page}",
                    "page": page,
                    "status": "designed",
                    "progressPct": 0,
                }
            )
        for m in re.finditer(r"\bDW\s*(\d+)'", text, re.I):
            ft = int(m.group(1))
            if ft < 5 or ft > 500:
                continue
            cable_rows.append(
                {
                    "cableId": f"DW-{ft}-p{page}",
                    "fiberCount": None,
                    "type": "AER",
                    "footage": ft,
                    "layer": "drop",
                    "installMethod": "DROP",
                    "printRef": f"p{page}",
                    "page": page,
                    "status": "designed",
                    "progressPct": 0,
                }
            )
        for m in re.finditer(
            r"([A-Z]{1,2})\s+FIBER\s+MINIXTEND\s+(\d+)",
            text,
            re.I,
        ):
            cable_rows.append(
                {
                    "cableId": f"SEG-{m.group(1).upper()}-p{page}",
                    "fiberCount": int(m.group(2)),
                    "type": "UGN",
                    "footage": None,
                    "layer": "distribution",
                    "installMethod": "UGN",
                    "printRef": f"p{page}",
                    "page": page,
                    "status": "designed",
                    "progressPct": 0,
                    "cableSpec": f"FIBER MINIXTEND {m.group(2)}",
                }
            )

    # Page-2 house cloud: 4-digit numbers assigned via known street map + defaults
    # Prefer streets already learned from INLINE; remaining → Foster only if in Foster range
    p2 = pages[1] if len(pages) > 1 else ""
    known_by_num: dict[str, str] = {}
    for sk, s in service_points.items():
        hn = str(house_num(sk) or "")
        if hn:
            known_by_num[hn] = s["street"]

    # Street preference by house number band from already-classified services
    for m in re.finditer(r"\b(\d{4,5})\b", p2):
        n = m.group(1)
        if not is_house(n):
            continue
        if n in known_by_num:
            add_svc(n, known_by_num[n], None, 2, "map_index")
            continue
        ni = int(n)
        # heuristics from print (60th lower band, Foster mid, 64th higher mid)
        if 5500 <= ni <= 5999:
            st = "60th St SE"  # confirmed FUTURE RESERVE on 60th
        elif 7000 <= ni <= 7600 and n in {x for x, stn in known_by_num.items() if "64" in stn}:
            st = "64th St SE"
        elif 7600 <= ni <= 8400:
            # mix of Foster south + 60th — leave if unknown until later
            st = "Foster Slough Rd"
        else:
            st = "Foster Slough Rd"
        add_svc(n, st, None, 2, "map_index")

    # Re-bind services that got wrong street when a better street exists for same house
    # Prefer non-Foster if we later learned a better street via INLINE
    # (already handled by known_by_num first)

    return {
        "terminals": terminals,
        "service_points": service_points,
        "poles": poles,
        "handholes": handholes,
        "cable_rows": cable_rows,
        "page_houses": page_houses,
        "page_streets": page_streets,
        "page_terms": page_terms,
    }


# ── Main ───────────────────────────────────────────────────────────────

def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    doc = fitz.open(str(PDF))
    pages = [doc.load_page(i).get_text("text") for i in range(doc.page_count)]
    doc.close()
    print(f"pages={len(pages)}")

    data = extract_all(pages)
    terminals = data["terminals"]
    service_points = data["service_points"]
    poles = data["poles"]
    handholes = data["handholes"]
    cable_rows = data["cable_rows"]
    page_houses = data["page_houses"]
    page_streets = data["page_streets"]
    page_terms = data["page_terms"]

    print(
        f"extracted terminals={len(terminals)} services={len(service_points)} "
        f"poles={len(poles)} hh={len(handholes)} cables={len(cable_rows)}"
    )
    by_src = Counter(s.get("source") for s in service_points.values())
    by_st = Counter(s.get("street") for s in service_points.values())
    print("  services by source:", dict(by_src))
    print("  services by street:", dict(by_st))

    # Geocode hub first for alignment
    cache = load_cache()
    cleared = 0
    for k, v in list(cache.items()):
        if v is None or "slougnh" in k:
            del cache[k]
            cleared += 1
    if cleared:
        print(f"cleared {cleared} stale geocode cache entries")

    hub_geo = geocode_census("6105 Foster Slough Rd", cache) or HUB_PRINT
    HUB = {"lat": hub_geo["lat"], "lng": hub_geo["lng"]}
    print(f"hub map={HUB} print={HUB_PRINT}")

    geo: dict[str, dict] = {}
    addrs = sorted(service_points.keys())
    print(f"geocoding {len(addrs)} service points…")
    failed: list[str] = []
    for i, a in enumerate(addrs):
        g = geocode_census(a, cache, hub_ref=HUB)
        if g:
            geo[a] = g
            for k in address_keys(a):
                geo[k] = g
            service_points[a]["lat"] = g["lat"]
            service_points[a]["lng"] = g["lng"]
            service_points[a]["geocodeSource"] = "census"
        else:
            failed.append(a)
        if (i + 1) % 40 == 0:
            print(f"  {i+1}/{len(addrs)} located={sum(1 for s in service_points.values() if s.get('lat'))}")
            save_cache(cache)
        time.sleep(0.06)

    still: list[str] = []
    if failed:
        print(f"retry normalize {len(failed)}…")
        for a in failed:
            g = geocode_census(normalize_address(a), cache, hub_ref=HUB)
            if g:
                geo[a] = g
                for k in address_keys(a):
                    geo[k] = g
                service_points[a]["lat"] = g["lat"]
                service_points[a]["lng"] = g["lng"]
                service_points[a]["geocodeSource"] = "census_retry"
            else:
                still.append(a)
            time.sleep(0.06)
    save_cache(cache)

    # Per-street interpolation for misses
    by_street_pts: dict[str, list[tuple[int, float, float]]] = defaultdict(list)
    for a, s in service_points.items():
        if not s.get("lat"):
            continue
        st = s.get("street") or street_name_of(a)
        hn = house_num(a)
        if hn is not None:
            by_street_pts[st].append((hn, s["lat"], s["lng"]))
    # also from cache
    for k, v in cache.items():
        if not v:
            continue
        hn = house_num(k)
        if hn is None:
            continue
        st = street_name_of(k) if re.search(r"[A-Za-z]", k) else "Foster Slough Rd"
        by_street_pts[st].append((hn, v["lat"], v["lng"]))

    recovered = 0
    for a in still:
        st = service_points[a].get("street") or street_name_of(a)
        pts = by_street_pts.get(st) or by_street_pts.get("Foster Slough Rd") or []
        # unique
        seen: set[int] = set()
        uniq: list[tuple[int, float, float]] = []
        for hn, lat, lng in sorted(pts):
            if hn in seen:
                continue
            seen.add(hn)
            uniq.append((hn, lat, lng))
        g = interpolate_house(a, uniq) if uniq else None
        # Reject wild extrapolations (e.g. 42115 on wrong street band)
        if g and dist_m(HUB, g) > 12000:
            g = None
        # last resort: street mean, then plant centroid, then hub
        if not g:
            if uniq:
                g = {
                    "lat": sum(p[1] for p in uniq) / len(uniq),
                    "lng": sum(p[2] for p in uniq) / len(uniq),
                    "interpolated": True,
                }
            else:
                seed = [s for s in service_points.values() if s.get("lat")]
                if seed:
                    g = {
                        "lat": sum(s["lat"] for s in seed) / len(seed),
                        "lng": sum(s["lng"] for s in seed) / len(seed),
                        "interpolated": True,
                    }
                else:
                    g = {"lat": HUB["lat"], "lng": HUB["lng"], "interpolated": True}
        geo[a] = g
        for k in address_keys(a):
            geo[k] = g
        service_points[a]["lat"] = g["lat"]
        service_points[a]["lng"] = g["lng"]
        service_points[a]["geocodeSource"] = "interpolated"
        recovered += 1
    print(f"interpolated {recovered}/{len(still)}; unlocated={len(still)-recovered}")

    def lookup_geo(a: str) -> dict | None:
        key = a.strip()
        g = (
            geo.get(key)
            or geo.get(normalize_address(key))
            or geo.get(street_only(key))
            or geo.get(key.title())
            or geo.get(key.lower())
            or geo.get(key.upper())
        )
        if g:
            return g
        for k in address_keys(a):
            g = geo.get(k) or cache.get(k.lower())
            if g:
                return g
        return None

    # Terminal centroids from linked addresses (raw + normalized)
    real_linked = 0
    for tid, t in terminals.items():
        pts = []
        for a in t["addresses"]:
            g = (
                geo.get(a.strip())
                or geo.get(normalize_address(a))
                or geo.get(street_only(a))
                or lookup_geo(a)
            )
            if g:
                pts.append(g)
        if pts:
            t["lat"] = sum(p["lat"] for p in pts) / len(pts)
            t["lng"] = sum(p["lng"] for p in pts) / len(pts)
            uniq = {street_only(a) for a in t["addresses"]}
            t["portCount"] = max(4, len(uniq))
            t["placeSource"] = "address_centroid"
            real_linked += 1
    print(f"terminals address-linked={real_linked}")

    # Place remaining terminals from work-sheet house clusters
    sheet_placed = 0
    for tid, t in terminals.items():
        if t.get("lat"):
            continue
        pages_t = list(t.get("sheetPages") or [])
        # gather houses on those pages
        cand_addrs = []
        for p in pages_t:
            cand_addrs.extend(page_houses.get(p, []))
        pts = []
        for a in cand_addrs:
            s = service_points.get(a)
            if s and s.get("lat"):
                # skip pure hub address noise
                if house_num(a) == 6105:
                    continue
                pts.append(s)
        if len(pts) >= 1:
            # if multiple terminals on page, spread by terminal number order
            page_terms_here = []
            for p in pages_t:
                page_terms_here.extend(page_terms.get(p, []))
            page_terms_here = sorted(set(page_terms_here), key=lambda x: (len(x), x))
            try:
                idx = page_terms_here.index(tid)
            except ValueError:
                idx = 0
            n = max(len(page_terms_here), 1)
            # pick a subset of points for this terminal
            ordered = sorted(pts, key=lambda s: (s["lng"], s["lat"]))
            if len(ordered) >= n:
                # assign contiguous cluster along street
                chunk = max(1, len(ordered) // n)
                group = ordered[idx * chunk : (idx + 1) * chunk] or ordered[idx : idx + 1]
            else:
                group = [ordered[idx % len(ordered)]]
            t["lat"] = sum(s["lat"] for s in group) / len(group)
            t["lng"] = sum(s["lng"] for s in group) / len(group)
            # small offset so terminals don't stack
            off = 0.00004 * ((idx % 5) - 2)
            t["lat"] += off
            t["lng"] += off * 0.5
            t["portCount"] = t.get("portCount") or 6
            t["placeSource"] = "sheet_cluster"
            t["addresses"] = list({s["address"] for s in group})[:12]
            sheet_placed += 1
    print(f"terminals sheet-placed={sheet_placed}")

    # Final: place any still-missing terminals along street centerlines
    located_svc = [s for s in service_points.values() if s.get("lat")]
    # Build street centerlines from services
    street_pts: dict[str, list[dict]] = defaultdict(list)
    for s in located_svc:
        street_pts[s.get("street") or "Foster Slough Rd"].append(
            {"lat": s["lat"], "lng": s["lng"], "addr": s["address"]}
        )
    centerlines: dict[str, list[dict]] = {
        st: street_centerline(pts) for st, pts in street_pts.items() if len(pts) >= 2
    }
    # main plant axis = Foster if present, else longest centerline
    main_street = next(
        (st for st in centerlines if "Foster" in st),
        max(centerlines.keys(), key=lambda s: len(centerlines[s])) if centerlines else "Foster Slough Rd",
    )
    main_cl = centerlines.get(main_street) or [
        HUB,
        {"lat": HUB["lat"], "lng": HUB["lng"] + 0.01},
    ]

    axis_placed = 0
    unloc = sorted(
        [t for t in terminals.values() if not t.get("lat")],
        key=lambda t: (len(t["terminalId"]), t["terminalId"]),
    )
    for i, t in enumerate(unloc):
        frac = (i + 1) / (len(unloc) + 1) if unloc else 0.5
        pos = frac * (len(main_cl) - 1)
        i0 = min(int(pos), len(main_cl) - 2)
        tf = pos - i0
        a, b = main_cl[i0], main_cl[i0 + 1]
        t["lat"] = a["lat"] + (b["lat"] - a["lat"]) * tf
        t["lng"] = a["lng"] + (b["lng"] - a["lng"]) * tf
        t["lat"] += 0.00005 * (1 if i % 2 == 0 else -1)
        t["portCount"] = t.get("portCount") or 6
        t["placeSource"] = "centerline"
        axis_placed += 1
    print(f"terminals centerline-placed={axis_placed}")

    located_term = [t for t in terminals.values() if t.get("lat")]
    print(
        f"located services={len(located_svc)}/{len(service_points)} "
        f"terminals={len(located_term)}/{len(terminals)} "
        f"(linked={real_linked} sheet={sheet_placed} axis={axis_placed})"
    )

    # Poles along main centerline + secondary streets
    pole_ids = sorted(poles.keys())
    pole_pts: dict[str, dict] = {}
    for i, pid in enumerate(pole_ids):
        t = i / max(len(pole_ids) - 1, 1)
        pos = t * (len(main_cl) - 1)
        i0 = min(int(pos), len(main_cl) - 2)
        tf = pos - i0
        a, b = main_cl[i0], main_cl[i0 + 1]
        lat = a["lat"] + (b["lat"] - a["lat"]) * tf
        lng = a["lng"] + (b["lng"] - a["lng"]) * tf
        # ROW offset ~6m perpendicular-ish
        off = 6 / m_per_lng(lat)
        pole_pts[pid] = {
            "lat": lat,
            "lng": lng + off * (1 if i % 2 == 0 else -1),
            "poleId": pid,
            "owner": poles[pid]["owner"],
            "printRef": poles[pid]["printRef"],
        }

    def nearest_node(p: dict, pool: list[dict]) -> dict:
        best, bd = pool[0], 1e18
        for q in pool:
            d = dist_m(p, q)
            if d < bd:
                bd, best = d, q
        return best

    def nearest_on_path(p: dict, path: list[dict]):
        best, bi, bd = path[0], 0, 1e18
        for i, q in enumerate(path):
            d = dist_m(p, q)
            if d < bd:
                bd, best, bi = d, q, i
        return best, bi

    def path_length_m(path: list[dict]) -> float:
        if len(path) < 2:
            return 0.0
        return sum(dist_m(path[i], path[i + 1]) for i in range(len(path) - 1))

    def subpath_by_distance(
        path: list[dict], start_m: float, length_m: float
    ) -> list[dict]:
        """Walk densified path; return vertices covering [start_m, start_m+length_m]."""
        if len(path) < 2 or length_m < 3:
            return []
        # accumulate
        acc = [0.0]
        for i in range(len(path) - 1):
            acc.append(acc[-1] + dist_m(path[i], path[i + 1]))
        total = acc[-1]
        if total < 3:
            return []
        s0 = max(0.0, min(start_m, total * 0.95))
        s1 = min(total, s0 + length_m)
        if s1 - s0 < 3:
            s1 = min(total, s0 + max(length_m, 15))
        out: list[dict] = []
        # start point
        for i in range(len(path) - 1):
            if acc[i] <= s0 <= acc[i + 1]:
                seg = acc[i + 1] - acc[i] or 1
                t = (s0 - acc[i]) / seg
                out.append(
                    {
                        "lat": path[i]["lat"] + (path[i + 1]["lat"] - path[i]["lat"]) * t,
                        "lng": path[i]["lng"] + (path[i + 1]["lng"] - path[i]["lng"]) * t,
                    }
                )
                break
        for i in range(len(path)):
            if s0 < acc[i] < s1:
                out.append(path[i])
        for i in range(len(path) - 1):
            if acc[i] <= s1 <= acc[i + 1]:
                seg = acc[i + 1] - acc[i] or 1
                t = (s1 - acc[i]) / seg
                out.append(
                    {
                        "lat": path[i]["lat"] + (path[i + 1]["lat"] - path[i]["lat"]) * t,
                        "lng": path[i]["lng"] + (path[i + 1]["lng"] - path[i]["lng"]) * t,
                    }
                )
                break
        # de-dupe
        cleaned = []
        for p in out:
            if not cleaned or dist_m(cleaned[-1], p) > 0.5:
                cleaned.append(p)
        return cleaned if len(cleaned) >= 2 else []

    # Street-snapped feeder backbone
    if main_cl and dist_m(HUB, main_cl[0]) > dist_m(HUB, main_cl[-1]):
        main_cl = list(reversed(main_cl))
    # snap hub onto main centerline (don't pull corridor west to print GPS)
    hub_on_main, _ = nearest_on_path(HUB, main_cl) if main_cl else (HUB, 0)
    backbone_pts = [hub_on_main] + [p for p in main_cl if dist_m(p, hub_on_main) > 12]
    backbone = densify(backbone_pts, 6)

    secondary_paths: list[tuple[str, list[dict]]] = []
    for st, cl in centerlines.items():
        if st == main_street or len(cl) < 3:
            continue
        secondary_paths.append((st, densify(cl, 5)))

    # Terminal graph per street (ordered along centerline)
    terms_by_street: dict[str, list[dict]] = defaultdict(list)
    for t in located_term:
        st = "Foster Slough Rd"
        if t.get("addresses"):
            st = street_name_of(t["addresses"][0]) or st
        terms_by_street[st].append(t)
    for st, lst in terms_by_street.items():
        cl = centerlines.get(st) or main_cl
        # order by projection index on centerline
        def sort_key(term, cl=cl):
            _, bi = nearest_on_path({"lat": term["lat"], "lng": term["lng"]}, cl)
            return bi

        lst.sort(key=sort_key)

    # ── Features ───────────────────────────────────────────────────────
    features: list[dict] = []
    cable_line_count = 0
    skipped_long = 0
    skipped_short = 0

    def feat(geom_type, coords, props, fid):
        features.append(
            {
                "type": "Feature",
                "id": fid,
                "geometry": {"type": geom_type, "coordinates": coords},
                "properties": props,
            }
        )

    def line_feat(
        path: list[dict],
        props: dict,
        fid: str,
        *,
        min_m: float = 8,
        max_m: float = 2500,
    ) -> bool:
        nonlocal cable_line_count, skipped_long, skipped_short
        if len(path) < 2:
            return False
        L = path_length_m(path)
        if L < min_m:
            skipped_short += 1
            return False
        if L > max_m:
            skipped_long += 1
            return False
        feat(
            "LineString",
            [[p["lng"], p["lat"]] for p in path],
            {**props, "lengthM": round(L, 1)},
            fid,
        )
        cable_line_count += 1
        return True

    def segment(
        a: dict,
        b: dict,
        props: dict,
        fid: str,
        *,
        min_m: float = 8,
        max_m: float = 400,
    ) -> bool:
        if a.get("lat") is None or b.get("lat") is None:
            return False
        d = dist_m(a, b)
        if d < min_m:
            return False
        if d > max_m:
            return False
        path = densify(
            [{"lat": a["lat"], "lng": a["lng"]}, {"lat": b["lat"], "lng": b["lng"]}],
            4,
        )
        return line_feat(path, props, fid, min_m=min_m, max_m=max_m)

    # Hub (map-aligned to geocoded 6105)
    feat(
        "Point",
        [HUB["lng"], HUB["lat"]],
        {
            "type": "hub",
            "layer": "hub",
            "terminalId": "H3024",
            "hubId": "H3024",
            "label": "FDH H3024 — 432-port vault",
            "address": HUB_ADDR,
            "hubType": "Vault Mount 432-port FDH",
            "status": "designed",
            "printRef": "COVER/DTL",
            "printLat": HUB_PRINT["lat"],
            "printLng": HUB_PRINT["lng"],
        },
        "hub-H3024",
    )

    # Feeder mainlines — one street-snapped path per corridor
    line_feat(
        backbone,
        {
            "type": "feeder",
            "layer": "feeder",
            "cableId": "MAINLINE-H3024",
            "fiberCount": 288,
            "typeMethod": "AER",
            "label": "Mainline · Foster Slough plant axis",
            "status": "designed",
            "progressPct": 0,
            "printRef": "WORK 1-50",
        },
        "feeder-mainline",
        min_m=50,
        max_m=8000,
    )

    for st, path in secondary_paths:
        line_feat(
            path,
            {
                "type": "feeder",
                "layer": "feeder",
                "cableId": f"STREET-{st.replace(' ', '_')[:24]}",
                "fiberCount": 144,
                "typeMethod": "UGN",
                "label": f"Feeder · {st}",
                "status": "designed",
                "progressPct": 0,
                "printRef": "WORK",
            },
            f"feeder-{st.replace(' ', '_')[:30]}",
            min_m=40,
            max_m=5000,
        )

    # Distribution: consecutive pole spans (max ~180m = realistic P-P)
    pole_chain = sorted(pole_pts.values(), key=lambda x: (x["lng"], x["lat"]))
    for i in range(len(pole_chain) - 1):
        a, b = pole_chain[i], pole_chain[i + 1]
        segment(
            a,
            b,
            {
                "type": "distribution",
                "layer": "distribution",
                "cableId": f"PP-{a['poleId']}-{b['poleId']}",
                "fromPole": a["poleId"],
                "toPole": b["poleId"],
                "status": "designed",
                "progressPct": 0,
                "label": f"P-P {a['poleId']} → {b['poleId']}",
            },
            f"pp-{i}-{a['poleId']}-{b['poleId']}",
            min_m=10,
            max_m=220,
        )

    # Distribution: consecutive terminals along each street
    for st, lst in terms_by_street.items():
        for i in range(len(lst) - 1):
            a, b = lst[i], lst[i + 1]
            segment(
                a,
                b,
                {
                    "type": "distribution",
                    "layer": "distribution",
                    "cableId": f"TT-{a['terminalId']}-{b['terminalId']}",
                    "fromNode": a["terminalId"],
                    "toNode": b["terminalId"],
                    "status": "designed",
                    "progressPct": 0,
                    "label": f"{a['terminalId']} → {b['terminalId']}",
                },
                f"tt-{st[:12]}-{i}",
                min_m=12,
                max_m=350,
            )

    # Laterals: terminal → nearest street centerline (short only)
    for t in located_term:
        term = {"lat": t["lat"], "lng": t["lng"]}
        path = backbone
        if t.get("addresses"):
            st = street_name_of(t["addresses"][0])
            if st in centerlines:
                path = densify(centerlines[st], 3)
        join, _ = nearest_on_path(term, path)
        segment(
            join,
            term,
            {
                "type": "distribution",
                "layer": "distribution",
                "cableId": f"LAT-{t['terminalId']}",
                "toTerminal": t["terminalId"],
                "fiberRange": t.get("fiberRange"),
                "status": "designed",
                "progressPct": 0,
                "printRef": t.get("printRef"),
                "label": f"Lateral → {t['terminalId']}",
            },
            f"dist-{t['terminalId']}",
            min_m=3,
            max_m=80,
        )

    # ML / bore rows: place along street centerline at print footage length
    # (preserves cable attributes without cross-plant spaghetti)
    street_paths = {"Foster Slough Rd": backbone}
    for st, path in secondary_paths:
        street_paths[st] = path
    # also all centerlines densified
    for st, cl in centerlines.items():
        street_paths.setdefault(st, densify(cl, 5))

    ml_rows = [
        r
        for r in cable_rows
        if r.get("layer") in ("distribution", "feeder", "bore")
        and (r.get("footage") or 0) >= 20
    ]
    print(f"wiring {len(ml_rows)} ML/bore rows along street centerlines…")
    wired = 0
    for i, row in enumerate(ml_rows):
        page = row.get("page") or 2
        # pick street for this page
        streets_p = page_streets.get(page) or ["Foster Slough Rd"]
        st = streets_p[0] if streets_p else "Foster Slough Rd"
        # normalize common variants
        if "60" in st:
            st_key = next((k for k in street_paths if "60" in k), "Foster Slough Rd")
        elif "64" in st:
            st_key = next((k for k in street_paths if "64" in k), "Foster Slough Rd")
        elif "76" in st:
            st_key = next((k for k in street_paths if "76" in k), "Foster Slough Rd")
        elif "70" in st:
            st_key = next((k for k in street_paths if "70" in k), "Foster Slough Rd")
        elif "61" in st:
            st_key = next((k for k in street_paths if "61" in k), "Foster Slough Rd")
        else:
            st_key = "Foster Slough Rd" if "Foster" in " ".join(street_paths) else next(iter(street_paths))
            # prefer Foster
            st_key = next((k for k in street_paths if "Foster" in k), st_key)

        path = street_paths.get(st_key) or backbone
        total = path_length_m(path)
        if total < 20:
            continue
        ft = float(row.get("footage") or 100)
        length_m = min(ft * 0.3048, 450)  # cap ~450m single span
        # distribute starts along path by index
        start_m = (i * 37.0) % max(total - length_m, 1)
        sub = subpath_by_distance(path, start_m, length_m)
        if not sub:
            continue
        layer = row.get("layer") or "distribution"
        if layer == "bore":
            # slight parallel offset
            off = 0.000025
            sub = [{"lat": p["lat"] + off, "lng": p["lng"] + off} for p in sub]
        props = {
            "type": layer if layer in ("feeder", "distribution", "bore") else "distribution",
            "layer": layer if layer in ("feeder", "distribution", "bore") else "distribution",
            "cableId": row["cableId"],
            "fiberCount": row.get("fiberCount"),
            "footage": row.get("footage"),
            "typeMethod": row.get("type"),
            "installMethod": row.get("installMethod"),
            "cableSpec": row.get("cableSpec"),
            "status": "designed",
            "progressPct": 0,
            "printRef": row.get("printRef"),
            "label": row["cableId"],
            "routeStreet": st_key,
        }
        if line_feat(
            sub,
            props,
            f"cable-{row['cableId']}-{i}",
            min_m=8,
            max_m=500,
        ):
            wired += 1

    print(
        f"cable LineStrings={cable_line_count} "
        f"(ml_wired={wired} skipped_short={skipped_short} skipped_long={skipped_long})"
    )

    # Terminals
    for t in located_term:
        feat(
            "Point",
            [t["lng"], t["lat"]],
            {
                "type": "terminal",
                "layer": "terminal",
                "terminalId": t["terminalId"],
                "fiberRange": t.get("fiberRange"),
                "portCount": t.get("portCount"),
                "addressesServed": t.get("addresses") or [],
                "status": "designed",
                "printRef": t.get("printRef"),
                "label": t["terminalId"],
                "placeSource": t.get("placeSource"),
            },
            f"term-{t['terminalId']}",
        )

    # Service points
    for a, s in service_points.items():
        if not s.get("lat"):
            continue
        feat(
            "Point",
            [s["lng"], s["lat"]],
            {
                "type": "service_point",
                "layer": "service_point",
                "address": s["address"],
                "terminal": s.get("terminal"),
                "dropFootage": s.get("dropFootage"),
                "status": s.get("status") or "designed",
                "printRef": s.get("printRef"),
                "label": s["address"],
                "street": s.get("street"),
                "geocodeSource": s.get("geocodeSource"),
            },
            f"svc-{a.replace(' ', '_')[:48]}",
        )

    # Drops: service → assigned terminal or nearest
    term_pts = [
        {"id": t["terminalId"], "lat": t["lat"], "lng": t["lng"]}
        for t in located_term
    ]
    for a, s in service_points.items():
        if not s.get("lat"):
            continue
        tid = s.get("terminal")
        t = terminals.get(tid) if tid else None
        if not t or not t.get("lat"):
            if not term_pts:
                continue
            nn = nearest_node({"lat": s["lat"], "lng": s["lng"]}, term_pts)
            t = {"lat": nn["lat"], "lng": nn["lng"], "terminalId": nn["id"]}
            tid = nn["id"]
        # drops are short last-mile only
        if dist_m(t, s) > 180:
            continue
        segment(
            {"lat": t["lat"], "lng": t["lng"]},
            {"lat": s["lat"], "lng": s["lng"]},
            {
                "type": "drop",
                "layer": "drop",
                "cableId": f"DROP-{a[:28]}",
                "address": a,
                "terminal": tid,
                "status": "designed",
                "progressPct": 0,
                "printRef": s.get("printRef"),
                "label": f"Drop {a}",
            },
            f"drop-{a.replace(' ', '_')[:48]}",
            min_m=3,
            max_m=180,
        )

    # Poles
    for pid, p in pole_pts.items():
        feat(
            "Point",
            [p["lng"], p["lat"]],
            {
                "type": "pole",
                "layer": "pole",
                "poleId": pid,
                "owner": p["owner"],
                "status": "designed",
                "printRef": p["printRef"],
                "label": pid,
            },
            f"pole-{pid}",
        )

    # Handholes near page terminals
    for i, hh in enumerate(handholes[:50]):
        page = hh.get("page") or 2
        terms_p = [t for t in located_term if page in (t.get("sheetPages") or set())]
        if not terms_p:
            terms_p = located_term or [{"lat": HUB["lat"], "lng": HUB["lng"]}]
        base = terms_p[i % len(terms_p)]
        off = 0.00005 * (1 if i % 2 == 0 else -1)
        feat(
            "Point",
            [base["lng"] + off, base["lat"] + off * 0.6],
            {
                "type": "handhole",
                "layer": "handhole",
                "hhId": hh["id"],
                "hhSize": hh["size"],
                "hhType": hh["type"],
                "status": "designed",
                "printRef": hh["printRef"],
                "label": hh["id"],
            },
            hh["id"],
        )

    kinds = Counter(f["properties"].get("layer") for f in features)
    print("layers", dict(kinds))
    print(f"total features={len(features)} LineStrings={cable_line_count}")

    fc = {
        "type": "FeatureCollection",
        "name": "H3024_Lake_Stevens_Platform",
        "crs": {"type": "name", "properties": {"name": "EPSG:4326"}},
        "metadata": {
            "projectId": "H3024",
            "workOrder": "6007959",
            "city": "Lake Stevens, WA",
            "hub": HUB,
            "hubPrint": HUB_PRINT,
            "hubAddress": HUB_ADDR,
            "sourcePdf": PDF.name,
            "pages": len(pages),
            "layerSchema": [
                "hub",
                "feeder",
                "distribution",
                "drop",
                "terminal",
                "service_point",
                "pole",
                "handhole",
                "bore",
            ],
            "platformDoc": "Digital Field Operations Platform (SHARED)",
            "stats": {
                "services": len(located_svc),
                "servicesTotal": len(service_points),
                "terminals": len(located_term),
                "terminalsLinked": real_linked,
                "cables": cable_line_count,
                "features": len(features),
                "layers": dict(kinds),
            },
        },
        "features": features,
    }

    out_path = OUT / "platform.geojson"
    out_path.write_text(json.dumps(fc), encoding="utf-8")
    print("Wrote", out_path, "features=", len(features), "kb=", out_path.stat().st_size // 1024)

    plant = {
        "source": {
            "pdf": PDF.name,
            "workOrder": "6007959",
            "hubId": "H3024",
            "hubAddress": HUB_ADDR,
            "pages": len(pages),
            "extractor": "scripts/build_h3024_platform_geojson.py",
        },
        "jobMatch": {
            "workOrders": ["6007959", "6007956"],
            "hubIds": ["H3024"],
            "city": "Lake Stevens",
        },
        "mapObjects": {
            "hub": {**HUB, "status": "planned", "print": HUB_PRINT},
            "mainlineStreet": "Foster Slough Rd",
            "backbonePath": backbone,
            "geometrySource": "street_snapped_geocode",
            "geometryResidualM": 0,
            "terminals": [
                {
                    "label": t["terminalId"],
                    "type": "MST",
                    "portCount": t.get("portCount"),
                    "footageFt": None,
                    "addressesServed": t.get("addresses"),
                    "houseNumbers": [
                        str(house_num(a)) for a in (t.get("addresses") or []) if house_num(a)
                    ],
                    "sheetPage": None,
                    "lat": t.get("lat"),
                    "lng": t.get("lng"),
                    "status": "planned",
                    "placeSource": t.get("placeSource"),
                }
                for t in located_term
            ],
            "cables": [
                {
                    "label": "MAINLINE · street-snapped",
                    "fiberCount": "288F",
                    "lengthFt": None,
                    "path": backbone,
                    "buildType": "aerial",
                    "role": "mainline",
                    "status": "planned",
                }
            ],
            "dropSites": [
                {
                    "address": f"{s['address']}, Lake Stevens, WA 98290",
                    "lat": s["lat"],
                    "lng": s["lng"],
                    "terminalLabel": s.get("terminal"),
                    "kind": "lu",
                    "street": s.get("street"),
                }
                for s in located_svc
            ],
            "notes": "H3024 print-faithful platform twin",
        },
        "stats": {
            "terminals": len(located_term),
            "terminalsLocated": len(located_term),
            "terminalsLinked": real_linked,
            "cables": cable_line_count,
            "drops": len(located_svc),
            "features": len(features),
            "layers": dict(kinds),
        },
    }
    (OUT / "plant.json").write_text(json.dumps(plant, indent=2), encoding="utf-8")
    print("Wrote plant.json")


if __name__ == "__main__":
    main()
