"""Shared HTTP client with short timeouts and a small TTL cache (venue Wi-Fi is slow)."""
import time
from datetime import datetime, timezone

import httpx

USER_AGENT = "(ClosureCall HackMidwest 2026, jiaming.s@wustl.edu)"
_client = httpx.Client(timeout=8.0, headers={"User-Agent": USER_AGENT, "Accept": "application/geo+json, application/json"})
_cache: dict[str, tuple[float, dict]] = {}


class SourceError(Exception):
    pass


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def get_json(url: str, params: dict | None = None, ttl: float = 60.0) -> tuple[dict, str]:
    """Return (json, fetched_at). Raises SourceError on failure."""
    key = url + "?" + "&".join(f"{k}={v}" for k, v in sorted((params or {}).items()))
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < ttl:
        return hit[1]["data"], hit[1]["fetched_at"]
    try:
        r = _client.get(url, params=params)
        r.raise_for_status()
        data = r.json()
    except Exception as e:  # network, timeout, bad JSON
        raise SourceError(f"{url}: {e}") from e
    entry = {"data": data, "fetched_at": now_iso()}
    _cache[key] = (time.time(), entry)
    return data, entry["fetched_at"]
