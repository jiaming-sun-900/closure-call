"""National Weather Service API (api.weather.gov) — public, no key, User-Agent required."""
import re
from datetime import datetime

from .http import SourceError, get_json

BASE = "https://api.weather.gov"


def _parse_time(s: str | None) -> datetime | None:
    return datetime.fromisoformat(s) if s else None


def normalize_alert(feature: dict, fetched_at: str, source: str) -> dict:
    p = feature["properties"]
    desc = (p.get("description") or "")
    return {
        "id": p["id"],
        "event": p["event"],
        "headline": p.get("headline") or p["event"],
        "severity": p.get("severity", "Unknown"),
        "certainty": p.get("certainty", "Unknown"),
        "urgency": p.get("urgency", "Unknown"),
        "status": p.get("status"),
        "message_type": p.get("messageType"),
        "sent": p.get("sent"),
        "effective": p.get("effective"),
        "onset": p.get("onset"),
        "expires": p.get("expires"),
        "ends": p.get("ends"),
        "area": p.get("areaDesc", ""),
        "sender": p.get("senderName", ""),
        "references": [r["identifier"] for r in p.get("references", [])],
        "emergency": "FLASH FLOOD EMERGENCY" in desc.upper(),
        "description": desc[:600],
        "instruction": (p.get("instruction") or "")[:400],
        "source": source,
        "fetched_at": fetched_at,
    }


def get_point(lat: float, lon: float) -> dict:
    data, fetched_at = get_json(f"{BASE}/points/{lat},{lon}", ttl=86400)
    p = data["properties"]
    return {
        "forecast_hourly_url": p["forecastHourly"],
        "office": p.get("cwa"),
        "county": p.get("county"),
        "zone": p.get("forecastZone"),
        "fetched_at": fetched_at,
    }


def get_active_alerts(lat: float, lon: float) -> list[dict]:
    url = f"{BASE}/alerts/active"
    data, fetched_at = get_json(url, {"point": f"{lat},{lon}"}, ttl=60)
    src = f"NWS api.weather.gov/alerts/active?point={lat},{lon}"
    return [normalize_alert(f, fetched_at, src) for f in data.get("features", [])
            if f["properties"].get("status") == "Actual"]


def get_alert_history(lat: float, lon: float, start: str, snapshot: str | None = None) -> list[dict]:
    """All alerts (incl. updates/cancels) for the point since `start` — NWS keeps ~7 days.

    If `snapshot` is given, read the saved raw API response instead (captured from the same endpoint).
    """
    if snapshot:
        import json, os
        from pathlib import Path
        path = Path(__file__).parent.parent / "data" / "snapshots" / snapshot
        data = json.loads(path.read_text())
        captured = datetime.fromtimestamp(os.path.getmtime(path)).astimezone().isoformat(timespec="seconds")
        src = f"NWS api.weather.gov/alerts?point={lat},{lon} (raw response saved {captured[:16]})"
        return [normalize_alert(f, captured, src) for f in data.get("features", [])
                if f["properties"].get("status") == "Actual"]
    url = f"{BASE}/alerts"
    data, fetched_at = get_json(url, {"point": f"{lat},{lon}", "start": start}, ttl=3600)
    src = f"NWS api.weather.gov/alerts?point={lat},{lon}&start={start}"
    return [normalize_alert(f, fetched_at, src) for f in data.get("features", [])
            if f["properties"].get("status") == "Actual"]


def alerts_active_at(history: list[dict], t: datetime) -> list[dict]:
    """Reconstruct which alerts were in effect at time t from the raw history.

    An alert is in effect if it was sent by t, hasn't ended/expired, and hasn't been
    superseded by a later Update/Cancel (sent by t) that references it.
    """
    sent_by_t = [a for a in history if _parse_time(a["sent"]) <= t]
    superseded = {ref for a in sent_by_t for ref in a["references"]}
    active = []
    for a in sent_by_t:
        if a["message_type"] == "Cancel" or a["id"] in superseded:
            continue
        end = _parse_time(a["ends"]) or _parse_time(a["expires"])
        if end and end <= t:
            continue
        active.append(a)
    return active


def cancelled_between(history: list[dict], t0: datetime, t1: datetime) -> list[dict]:
    return [a for a in history if a["message_type"] == "Cancel" and t0 < _parse_time(a["sent"]) <= t1]


_WIND_RE = re.compile(r"(\d+)")


def get_hourly_forecast(lat: float, lon: float, hours: int = 48) -> dict:
    pt = get_point(lat, lon)
    data, fetched_at = get_json(pt["forecast_hourly_url"], ttl=600)
    periods = []
    for p in data["properties"]["periods"][:hours]:
        speeds = [int(x) for x in _WIND_RE.findall(p.get("windSpeed") or "")]
        periods.append({
            "start": p["startTime"],
            "end": p["endTime"],
            "wind_mph": max(speeds) if speeds else 0,
            "precip_pct": (p.get("probabilityOfPrecipitation") or {}).get("value") or 0,
            "short": p.get("shortForecast", ""),
        })
    return {"periods": periods, "source": f"NWS hourly forecast ({pt['office']})", "fetched_at": fetched_at}


__all__ = ["SourceError", "get_active_alerts", "get_alert_history", "alerts_active_at",
           "cancelled_between", "get_hourly_forecast", "get_point"]
