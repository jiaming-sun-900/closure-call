import json
import os
from datetime import datetime, timezone
from pathlib import Path

import re

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import queue
import threading

from fastapi.responses import StreamingResponse

import agent
import records
import rules
import situation
import whatif

DATA = Path(__file__).parent / "data"
app = FastAPI(title="Closure Call")
app.add_middleware(CORSMiddleware, allow_origins=os.getenv("CORS_ORIGINS", "*").split(","),
                   allow_methods=["*"], allow_headers=["*"])
ASSESS_DIR = DATA / "assessments"  # persisted so a backend restart never loses the evidence behind a pending decision
ASSESS_DIR.mkdir(exist_ok=True)


def _save_assessment(a: dict):
    (ASSESS_DIR / f"{a['id']}.json").write_text(json.dumps(a, default=str))


def _load_assessment(aid: str) -> dict | None:
    p = ASSESS_DIR / f"{aid}.json"
    return json.loads(p.read_text()) if aid.isalnum() and p.exists() else None


def load_facility() -> dict:
    return json.loads((DATA / "facility.json").read_text())


@app.get("/health")
def health():
    return {"ok": True, "model": agent.model_info()}


@app.get("/facility")
def get_facility():
    return {**load_facility(), "status": agent.load_facility_status(), "model": agent.model_info()}


class FacilityStatusIn(BaseModel):
    power: str = "ok"  # ok | generator | out
    water: str = "ok"  # ok | out
    roof: str = "ok"  # ok | damaged
    roads: str = "open"  # open | limited | impassable
    notes: str = ""
    updated_by: str = "Facility Manager"


@app.put("/facility/status")
def set_facility_status(body: FacilityStatusIn):
    st = body.model_dump() | {"updated_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    (DATA / "facility_status.json").write_text(json.dumps(st, indent=2))
    return st


@app.get("/thresholds")
def thresholds():
    f = load_facility()
    return {"event_levels": rules.EVENT_LEVELS, "gauge": rules.GAUGE_BASIS, "outage": rules.OUTAGE_LEVELS,
            "wind": rules.WIND_LEVELS, "building": f["building_profile"], "agencies": f["agencies"], "postures": rules.POSTURE_LABELS}


class AssessIn(BaseModel):
    simulate: str | None = None  # e.g. "nws_down" to demo the failure path
    use_agent: bool = True


@app.post("/assess")
def assess(body: AssessIn):
    a = agent.assess(load_facility(), simulate=body.simulate, use_agent=body.use_agent)
    _save_assessment(a)
    return a


@app.get("/situation")
def get_situation():
    return situation.build(load_facility())


@app.get("/assess/stream")
def assess_stream(simulate: str | None = None, date: str | None = None):
    """Server-sent events: one event per tool start/finish, then the full assessment."""
    q: queue.Queue = queue.Queue()

    def work():
        try:
            if date and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
                raise ValueError("bad date")
            a = agent.assess(load_facility(), simulate=simulate, on_event=q.put, target_date=date)
            _save_assessment(a)
            q.put({"type": "result", "assessment": a})
        except Exception as e:  # never leave the client hanging
            q.put({"type": "error", "message": f"{type(e).__name__}: {e}"[:200]})
        q.put(None)

    threading.Thread(target=work, daemon=True).start()

    def gen():
        while (ev := q.get()) is not None:
            yield f"data: {json.dumps(ev, default=str)}\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


class AskIn(BaseModel):
    assessment_id: str
    question: str


@app.post("/ask")
def ask(body: AskIn):
    a = _load_assessment(body.assessment_id)
    if not a:
        raise HTTPException(404, "Run an analysis first")
    q = body.question.strip()
    if not q or len(q) > 300:
        raise HTTPException(400, "Ask a short question")
    return whatif.ask(a, load_facility(), q)


class DecisionIn(BaseModel):
    assessment_id: str
    option: str  # one of rules.POSTURES or "CUSTOM"
    custom_text: str | None = None
    reason: str
    decided_by: str


@app.post("/decision")
def decision(body: DecisionIn):
    a = _load_assessment(body.assessment_id)
    if not a:
        raise HTTPException(404, "Assessment not found — run an assessment first")
    if not body.decided_by.strip():
        raise HTTPException(400, "Enter the name of the person deciding")
    if not body.reason or len(body.reason.strip()) < 15:
        raise HTTPException(400, "A reason paragraph is required (at least a sentence)")
    if body.option == "CUSTOM":
        if not (body.custom_text or "").strip():
            raise HTTPException(400, "Describe the custom decision")
        label, posture = body.custom_text.strip(), None
    elif body.option in rules.POSTURES:
        label, posture = rules.POSTURE_LABELS[body.option], body.option
    else:
        raise HTTPException(400, "Unknown option")
    r = a["rules"]
    entry = {
        "record_id": f"DR-{len(records.all_records()) + 1:04d}",
        "decided_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "decided_by": body.decided_by.strip(),
        "operating_day": f"{r['window']['day']} {r['window']['date']}",
        "decision": label,
        "posture": posture,
        "recommended": r["recommended"],
        "recommended_label": r["recommended_label"],
        "followed_recommendation": posture == r["recommended"],
        "reason": body.reason.strip(),
        "level": r["level"], "confidence": r["confidence"],
        "evidence": a,  # complete snapshot: every input with source + timestamp, rule result, drafts, agent trace
    }
    records.append(entry)
    return {k: v for k, v in entry.items() if k != "evidence"}


@app.get("/records")
def get_records():
    return [{k: v for k, v in r.items() if k != "evidence"} for r in reversed(records.all_records())]


@app.get("/records/{record_id}")
def get_record(record_id: str):
    for r in records.all_records():
        if r["record_id"] == record_id:
            return r
    raise HTTPException(404, "record not found")


# ---------------------------------------------------------------- settings (localhost only)
# The API key lives only in .env / process env. It is never written to records, evidence snapshots or logs.
# For a public deployment set ALLOW_KEY_UI=0 and provide ANTHROPIC_API_KEY as a server environment variable.
ENV_PATH = Path(__file__).parent.parent / ".env"


def _local_only(request: Request):
    if os.getenv("ALLOW_KEY_UI", "1") == "0" or request.client.host not in ("127.0.0.1", "::1", "localhost"):
        raise HTTPException(403, "Settings are only available on localhost")


def _write_env(updates: dict):
    lines = ENV_PATH.read_text().splitlines() if ENV_PATH.exists() else []
    keys = set(updates)
    lines = [l for l in lines if l.split("=", 1)[0].strip() not in keys]
    lines += [f"{k}={v}" for k, v in updates.items()]
    ENV_PATH.write_text("\n".join(lines) + "\n")
    ENV_PATH.chmod(0o600)
    os.environ.update(updates)


def _models(key: str) -> list[dict]:
    r = httpx.get("https://api.anthropic.com/v1/models", params={"limit": 100}, timeout=10,
                  headers={"x-api-key": key, "anthropic-version": "2023-06-01"})
    if r.status_code != 200:
        raise HTTPException(400, f"Anthropic rejected the key (HTTP {r.status_code})")
    return r.json().get("data", [])


def _latest_haiku(models: list[dict]) -> str | None:
    haikus = [m for m in models if "haiku" in m["id"]]
    haikus.sort(key=lambda m: m.get("created_at", ""), reverse=True)
    return haikus[0]["id"] if haikus else None


@app.get("/settings")
def get_settings(request: Request):
    _local_only(request)
    key = os.getenv("ANTHROPIC_API_KEY", "")
    return {"key_set": bool(key), "key_last4": key[-4:] if key else None, "model_id": os.getenv("MODEL_ID")}


class KeyIn(BaseModel):
    api_key: str


@app.put("/settings/key")
def set_key(body: KeyIn, request: Request):
    _local_only(request)
    key = body.api_key.strip()
    if not re.fullmatch(r"sk-ant-[A-Za-z0-9_\-]{20,}", key):
        raise HTTPException(400, "That does not look like an Anthropic API key")
    model = _latest_haiku(_models(key))  # validates the key and picks the newest Haiku
    _write_env({"ANTHROPIC_API_KEY": key, **({"MODEL_ID": model} if model else {})})
    return {"key_set": True, "key_last4": key[-4:], "model_id": os.getenv("MODEL_ID")}


@app.post("/settings/test")
def test_key(request: Request):
    _local_only(request)
    key = os.getenv("ANTHROPIC_API_KEY")
    if not key:
        raise HTTPException(400, "No key saved yet")
    models = _models(key)
    model = os.getenv("MODEL_ID")
    return {"ok": True, "model_id": model, "model_available": any(m["id"] == model for m in models),
            "latest_haiku": _latest_haiku(models)}


class ClearIn(BaseModel):
    confirm: str


@app.post("/settings/clear-records")
def clear_records(body: ClearIn, request: Request):
    """Testing only: archives (never silently deletes) the record file. Not exposed on the records page."""
    _local_only(request)
    if body.confirm != "CLEAR":
        raise HTTPException(400, "Type CLEAR to confirm")
    n = len(records.all_records())
    if records.PATH.exists():
        records.PATH.rename(records.PATH.with_name(f"records.cleared-{datetime.now():%Y%m%d-%H%M%S}.jsonl"))
    return {"cleared": n}


# ---------------------------------------------------------------- deployed: serve the built frontend from the same origin
DIST = Path(__file__).parent.parent / "frontend" / "dist"
if DIST.exists() and os.getenv("SERVE_FRONTEND") == "1":
    from fastapi.staticfiles import StaticFiles
    app.mount("/", StaticFiles(directory=DIST, html=True), name="frontend")
