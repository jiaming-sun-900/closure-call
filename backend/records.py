"""Append-only decision record (JSONL). Never rewritten — each line is what was known and decided at that moment."""
import json
from pathlib import Path

PATH = Path(__file__).parent / "data" / "records.jsonl"


def append(entry: dict) -> dict:
    with PATH.open("a") as f:
        f.write(json.dumps(entry, default=str) + "\n")
    return entry


def all_records() -> list[dict]:
    if not PATH.exists():
        return []
    return [json.loads(l) for l in PATH.read_text().splitlines() if l.strip()]


def last_posture(location: str, mode: str, before: str | None = None) -> str | None:
    """Most recent human-decided posture for this location/mode (optionally before a replay time)."""
    best = None
    for r in all_records():
        if r["location"] != location or r["mode"] != mode:
            continue
        if before and r["as_of"] > before:
            continue
        if best is None or r["as_of"] >= best["as_of"]:
            best = r
    return best["final_posture"] if best else None
