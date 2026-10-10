"""River gauge stage + official flood categories from NOAA NWPS (most gauges are USGS-operated)."""
from .http import get_json

BASE = "https://api.water.noaa.gov/nwps/v1/gauges"


def get_river_gauge(lid: str) -> dict:
    data, fetched_at = get_json(f"{BASE}/{lid}", ttl=300)
    obs = data["status"]["observed"]
    cats = {k: v["stage"] for k, v in data["flood"]["categories"].items() if v["stage"] not in (None, -9999)}
    stage = obs.get("primary")
    if stage is None or stage <= -999:
        stage = None
    return {
        "lid": lid,
        "name": data["name"],
        "usgs_id": data.get("usgsId") or None,
        "stage_ft": stage,
        "observed_at": obs.get("validTime"),
        "category": obs.get("floodCategory"),
        "flood_stages_ft": cats,  # action / minor / moderate / major
        "source": f"NOAA NWPS api.water.noaa.gov/nwps/v1/gauges/{lid}",
        "fetched_at": fetched_at,
    }
