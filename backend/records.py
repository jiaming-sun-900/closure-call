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


def last_posture() -> str | None:
    """Most recent human-decided posture (used to detect corrections and as the fallback when data is missing)."""
    recs = all_records()
    return recs[-1].get("posture") if recs else None
