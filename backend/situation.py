"""Live situation for the start page: current conditions, alerts with map shapes, and a 7-day outlook.
The outlook runs the same deterministic rules for each future work day. No AI here."""
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import agent
import rules
from sources import gauge as gauge_src
from sources import nws, outage as outage_src, roads as roads_src
from sources.http import SourceError

# \ufe0f forces the color emoji glyph; without it some symbols (⛈ 🌤 🌥) render as black text icons
EMOJI = [("hurricane", "🌀"), ("tropical", "🌀"), ("thunder", "⛈\ufe0f"), ("snow", "❄\ufe0f"), ("rain", "🌧\ufe0f"),
         ("shower", "🌦\ufe0f"), ("drizzle", "🌦\ufe0f"), ("fog", "🌫\ufe0f"), ("partly", "⛅"), ("mostly cloudy", "🌥\ufe0f"),
         ("cloudy", "☁\ufe0f"), ("wind", "💨"), ("sunny", "☀\ufe0f"), ("clear", "☀\ufe0f")]


def weather_emoji(short: str) -> str:
    s = (short or "").lower()
    return next((e for k, e in EMOJI if k in s), "🌤\ufe0f")


def _try(fn):
    try:
        return fn()
    except (SourceError, KeyError, StopIteration, ValueError):
        return None


def build(facility: dict) -> dict:
    now = datetime.now(timezone.utc)
    lat, lon = facility["lat"], facility["lon"]
    alerts = _try(lambda: nws.get_active_alerts(lat, lon, facility.get("nws_county")))
    hourly = _try(lambda: nws.get_hourly_forecast(lat, lon, hours=168))
    daily = _try(lambda: nws.get_daily_forecast(lat, lon))
    gauge = _try(lambda: gauge_src.get_river_gauge(facility["gauge_lid"]))
    outage = _try(lambda: outage_src.get_parish_outage(facility["parish"]))
    roads = _try(lambda: roads_src.get_road_events(lat, lon))
    fstatus = agent.load_facility_status()

    cur = hourly["periods"][0] if hourly else None
    z = ZoneInfo(facility["timezone"])
    today = now.astimezone(z).date()
    next_day = rules.operating_window(facility, now)["date"]

    outlook = []
    for i in range(7):
        d = today + timedelta(days=i)
        ds = d.isoformat()
        day_periods = [p for p in (daily or {}).get("periods", []) if p["start"][:10] == ds]
        wx = next((p for p in day_periods if p["is_day"]), day_periods[0] if day_periods else None)
        entry = {"date": ds, "weekday": d.strftime("%a"), "label": d.strftime("%b %-d"),
                 "emoji": weather_emoji(wx["short"]) if wx else "·", "short": wx["short"] if wx else None,
                 "temp_f": wx["temp_f"] if wx else None, "precip_pct": wx["precip_pct"] if wx else None,
                 "closed": rules.closed_reason(facility, d), "is_next_workday": ds == next_day}
        # every day gets the same analysis; the office schedule is shown as information only
        if not entry["closed"] and rules.operating_window(facility, now, ds)["end"] <= now:
            entry["closed"] = "Office hours over"
        r = rules.evaluate(alerts=alerts, forecast=hourly, gauge=gauge, outage=outage, roads=roads,
                           facility_status=fstatus, facility=facility, now=now, target_date=ds,
                           data_status={"alerts": "ok" if alerts is not None else "error"})
        # confidence falls with each day further out (forecast skill drops with lead time)
        cap = "HIGH" if i < 2 else "MEDIUM" if i < 4 else "LOW"
        conf = min(r["confidence"], cap, key=rules.CONF_ORDER.index)
        entry.update(level=r["level"], level_label=r["level_label"], recommended=r["recommended"],
                     recommended_label=r["recommended_label"], confidence=conf,
                     agencies={g["code"]: g["posture"] for g in r["agencies"]})
        outlook.append(entry)

    fetched = [x for x in (alerts and alerts[0]["fetched_at"] if alerts else None, hourly and hourly["fetched_at"],
                           gauge and gauge["fetched_at"], outage and outage["fetched_at"]) if x]
    return {
        "as_of": max(fetched) if fetched else now.isoformat(timespec="seconds"),
        "current": cur and {"temp_f": cur["temp_f"], "wind_mph": cur["wind_mph"], "wind_dir": cur["wind_dir"],
                            "short": cur["short"], "emoji": weather_emoji(cur["short"])},
        "alerts": [{k: a[k] for k in ("id", "event", "severity", "ends", "expires", "where", "geometry")} for a in alerts or []],
        "river": gauge and {k: gauge[k] for k in ("name", "stage_ft", "category", "flood_stages_ft")},
        "outage": outage and {k: outage[k] for k in ("customers_out", "customers_served", "pct")},
        "roads": roads and {k: roads[k] for k in ("closures", "weather_related_closures")},
        "next_workday": next_day,
        "skipped": rules.operating_window(facility, now)["skipped"],
        "outlook": outlook,
    }
