"""River gauge stage, forecast, and official flood categories from NOAA NWPS (most gauges are USGS-operated)."""
from .http import SourceError, get_json

BASE = "https://api.water.noaa.gov/nwps/v1/gauges"


def get_river_gauge(lid: str) -> dict:
    data, fetched_at = get_json(f"{BASE}/{lid}", ttl=300)
    obs = data["status"]["observed"]
    cats = {k: v["stage"] for k, v in data["flood"]["categories"].items() if v["stage"] not in (None, -9999)}
    stage = obs.get("primary")
    if stage is None or stage <= -999:
        stage = None
    forecast = []
    try:
        sf, _ = get_json(f"{BASE}/{lid}/stageflow", ttl=600)
        forecast = [{"t": p["validTime"], "ft": p["primary"]} for p in sf.get("forecast", {}).get("data", [])
                    if p.get("primary") is not None and p["primary"] > -999]
    except SourceError:
        pass
    return {
        "lid": lid,
        "name": data["name"],
        "usgs_id": data.get("usgsId") or None,
        "stage_ft": stage,
        "observed_at": obs.get("validTime"),
        "category": obs.get("floodCategory"),
        "flood_stages_ft": cats,  # action / minor / moderate / major
        "forecast": forecast,
        "source": f"NOAA NWPS api.water.noaa.gov/nwps/v1/gauges/{lid}",
        "fetched_at": fetched_at,
    }
