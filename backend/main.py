import json
import os
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import agent
import records
import rules

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
    updated_by: str = "Denise Fontenot"


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


class DecisionIn(BaseModel):
    assessment_id: str
    option: str  # one of rules.POSTURES or "CUSTOM"
    custom_text: str | None = None
    reason: str
    decided_by: str = "Denise Fontenot"


@app.post("/decision")
def decision(body: DecisionIn):
    a = _load_assessment(body.assessment_id)
    if not a:
        raise HTTPException(404, "Assessment not found — run an assessment first")
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
        "decided_by": body.decided_by,
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
