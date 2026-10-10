"""Entergy Louisiana outages by parish (public JSON behind Entergy's outage map; refreshes ~2 min)."""
from datetime import datetime, timezone

from .http import get_json

URL = "https://entergy.datacapable.com/datacapable/v1/entergy/EntergyLouisiana/county"


def get_parish_outage(parish: str) -> dict:
    rows, fetched_at = get_json(URL, ttl=120)
    key = parish.upper().replace(" PARISH", "")
    row = next(r for r in rows if r["county"] == key)
    served, out = row["customersServed"], row["customersAffected"]
    return {
        "provider": "Entergy Louisiana",
        "parish": parish,
        "customers_served": served,
        "customers_out": out,
        "pct": round(100 * out / served, 2) if served else None,
        "state_out": sum(r["customersAffected"] for r in rows),
        "state_served": sum(r["customersServed"] for r in rows),
        "updated_at": datetime.fromtimestamp(row["lastUpdatedTime"] / 1000, timezone.utc).isoformat(timespec="seconds"),
        "source": "Entergy outage map data — entergy.datacapable.com …/EntergyLouisiana/county",
        "fetched_at": fetched_at,
    }
