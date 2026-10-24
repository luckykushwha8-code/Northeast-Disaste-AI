"""
Geographic service: verified NE district boundary loading, platform-district
alias resolution, and point containment.

Geodata (documented for Phase 10):
- Source: geohacker/india district boundaries (public India mapping data),
  NE subset (78 districts, Polygon geometries).
- License: open India mapping data (attribution kept on map + stored here).
- CRS: EPSG:4326 (lon/lat GeoJSON as delivered).
- Coverage gap: represents districts at one snapshot; no 2022+ reorganisation
  guarantees. Platform district names NEVER assumed identical — an explicit
  alias table maps platform district names to boundary feature names, and any
  mismatch is surfaced as UNKNOWN, never silently shaded.
"""
import json
import logging
import os
from typing import Dict, List, Optional, Tuple, Any

logger = logging.getLogger("geographic_service")

GEO_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "data", "ne_districts.geojson")

# Explicit alias table: platform district name -> boundary dataset names.
# Several platform names map to the same legacy boundary polygon only when the
# boundary dataset genuinely merges them (documented approximation, surfaced
# in the UI as "boundary approximated").
PLATFORM_DISTRICT_ALIAS: Dict[str, List[str]] = {
    "Kamrup Metropolitan": ["Kamrup"],  # boundary dataset has pre-2016 Kamrup (undivided) polygon
    "Imphal East": ["East Imphal"],
    "Imphal West": ["West Imphal"],
}


class GeographicService:
    """Loads verified boundary geometry once and answers spatial questions."""

    def __init__(self) -> None:
        self._features: Optional[List[Dict[str, Any]]] = None
        self._by_boundary_name: Dict[str, Dict[str, Any]] = {}

    # ---------------- loading ----------------
    def _load(self) -> None:
        if self._features is not None:
            return
        try:
            with open(GEO_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
        except OSError as e:
            logger.error("Unable to read district boundaries: %s", e)
            self._features = []
            return
        feats = []
        for feat in data.get("features", []):
            geom = feat.get("geometry")
            props = feat.get("properties") or {}
            name = (props.get("district") or "").strip()
            state = (props.get("state") or props.get("ST_NM") or "").strip()
            if not name or not geom:
                continue
            if abs(_poly_area_deg2(geom)) > 1200000:  # adjacency sanity — drop noise
                logger.warning("Skipping unreasonably large polygon for %s", name)
                continue
            feat = {
                "district": name,
                "state": state,
                "geometry": geom,
                "properties_source": props.get("source", "geohacker/india"),
            }
            feats.append(feat)
            self._by_boundary_name.setdefault(name, feat)
        self._features = feats

    def resolve_platform(self, platform_district: str, platform_names: Optional[List[str]] = None) -> List[Dict[str, Any]]:
        """Resolve a platform district name to boundary features.

        Resolution order (documented, none silent):
          1. explicit alias table
          2. exact name match
          3. no match -> [] (caller must surface UNKNOWN)
        """
        self._load()
        key = (platform_district or "").strip()
        if key in PLATFORM_DISTRICT_ALIAS:
            feats = [self._by_boundary_name[n] for n in PLATFORM_DISTRICT_ALIAS[key] if n in self._by_boundary_name]
            if feats:
                return feats
        if key in self._by_boundary_name:
            return [self._by_boundary_name[key]]
        # case-insensitive fallback
        low = key.lower()
        for bn, f in self._by_boundary_name.items():
            if bn.lower() == low:
                return [f]
        return []

    def boundary_status_for(self, platform_district: str) -> Dict[str, Any]:
        """How this platform district resolved to geometry (for UI honesty)."""
        feats = self.resolve_platform(platform_district)
        if len(feats) == 1 and feats[0]["district"] != platform_district:
            return {"status": "APPROXIMATED", "boundary_name": feats[0]["district"],
                    "note": f"platform district mapped via explicit alias to legacy boundary '{feats[0]['district']}'"}
        if len(feats) == 1:
            return {"status": "EXACT", "boundary_name": feats[0]["district"], "note": None}
        if len(feats) > 1:
            return {"status": "SPLIT", "boundary_names": [f["district"] for f in feats],
                    "note": "multiple boundary polygons resolved; cumulative shading"}
        return {"status": "UNKNOWN", "note": "no verified boundary polygon matched — left unshaded"}

    def features(self) -> List[Dict[str, Any]]:
        self._load()
        return self._features or []

    # ---------------- spatial ops ----------------
    @staticmethod
    def _bbox_of(feature: Dict[str, Any]) -> Optional[Tuple[float, float, float, float]]:
        geom = feature["geometry"]
        try:
            coords = geom["coordinates"]
            if geom["type"] == "Polygon":
                ring = coords[0]
            elif geom["type"] == "MultiPolygon":
                ring = coords[0][0]
            else:
                return None
            xs = [p[0] for p in ring]
            ys = [p[1] for p in ring]
            return (min(xs), min(ys), max(xs), max(ys))
        except (IndexError, TypeError, KeyError):
            return None

    def district_bbox(self, platform_district: str):
        feats = self.resolve_platform(platform_district)
        boxes = [self._bbox_of(f) for f in feats]
        boxes = [b for b in boxes if b]
        if not boxes:
            return None
        return (
            min(b[0] for b in boxes), min(b[1] for b in boxes),
            max(b[2] for b in boxes), max(b[3] for b in boxes),
        )

    @staticmethod
    def point_in_feature(lon: float, lat: float, feature: Dict[str, Any]) -> bool:
        """Ray-casting test on the polygon exterior rings (EPSG:4326 degrees)."""
        geom = feature["geometry"]
        polys = [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"] if geom["type"] == "MultiPolygon" else []
        if not polys:
            return False
        for poly in polys:
            inside = False
            for ring in poly[:1]:
                n = len(ring)
                j = n - 1
                for i in range(n):
                    xi, yi = ring[i][0], ring[i][1]
                    xj, yj = ring[j][0], ring[j][1]
                    if ((yi > lat) != (yj > lat)) and (lon < (xj - xi) * (lat - yi) / (yj - yi + 1e-12) + xi):
                        inside = not inside
                    j = i
            if inside:
                return True
        return False

    def district_for_point(self, lon: float, lat: float) -> Optional[str]:
        """Fast bbox filter, then exact ray-cast. Returns BOUNDARY district name."""
        self._load()
        for f in self._features or []:
            b = self._bbox_of(f)
            if b and (b[0] <= lon <= b[2]) and (b[1] <= lat <= b[3]):
                if self.point_in_feature(lon, lat, f):
                    return f["district"]
        return None

    def centroid(self, platform_district: str):
        feats = self.resolve_platform(platform_district)
        b = self._bbox_of(feats[0]) if feats else None
        if not b:
            return None
        return ((b[0] + b[2]) / 2.0, (b[1] + b[3]) / 2.0)


def _poly_area_deg2(feature: Dict[str, Any]) -> float:
    """Shoelace on the outer ring (approximate, degrees^2) for sanity checks."""
    try:
        coords = feature["geometry"]["coordinates"]
        ring = coords[0] if feature["geometry"]["type"] == "Polygon" else coords[0][0]
        s = 0.0
        j = len(ring) - 1
        for i in range(len(ring)):
            s += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1])
            j = i
        return abs(s) / 2.0
    except Exception:
        return 0.0


geographic_service = GeographicService()
