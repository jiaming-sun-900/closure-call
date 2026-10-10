"""Louisiana 511 (511la.org) closures and weather events near the facility — public map data, no key."""
import math

from .http import SourceError, get_json

BASE = "https://www.511la.org/map"
WEATHER_WORDS = ("flood", "water", "debris", "tree", "wash", "storm", "hurricane")


def _miles(a, b):
    dlat, dlon = (a[0] - b[0]) * 69.0, (a[1] - b[1]) * 69.0 * math.cos(math.radians(a[0]))
    return math.hypot(dlat, dlon)


def get_road_events(lat: float, lon: float, radius_mi: float = 15, max_details: int = 12) -> dict:
    items, fetched_at = [], None
    for layer in ("Closures", "WeatherEvents", "Incidents"):
        data, fetched_at = get_json(f"{BASE}/mapIcons/{layer}", ttl=300)
        for it in data.get("item2", []):
            loc = it.get("location") or [None, None]
            if loc[0] is None:
                continue
            d = _miles((lat, lon), loc)
            if d <= radius_mi:
                items.append({"layer": layer, "id": it["itemId"], "miles": round(d, 1)})
    items.sort(key=lambda x: x["miles"])
    events = []
    for it in items[:max_details]:
        try:
            det, _ = get_json(f"{BASE}/data/{it['layer']}/{it['id']}", ttl=600)
        except SourceError:
            continue
        desc = (det.get("description") or "").strip()
        events.append({
            "layer": it["layer"], "miles": it["miles"], "roadway": det.get("roadway"),
            "description": desc[:200], "full_closure": bool(det.get("isFullClosure")),
            "weather_related": it["layer"] == "WeatherEvents" or any(w in desc.lower() for w in WEATHER_WORDS),
            "updated": det.get("lastUpdated"),
        })
    return {
        "radius_mi": radius_mi,
        "total": len(items),
        "closures": sum(1 for i in items if i["layer"] == "Closures"),
        "weather_related_closures": sum(1 for e in events if e["weather_related"] and e["full_closure"] and e["layer"] != "WeatherEvents"),
        "events": events,
        "source": "Louisiana 511 (511la.org) map data",
        "fetched_at": fetched_at,
    }
