import json
import os
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import agent
import notify
import records
import rules

DATA = Path(__file__).parent / "data"
app = FastAPI(title="Closure Call")
app.add_middleware(CORSMiddleware, allow_origins=os.getenv("CORS_ORIGINS", "*").split(","),
                   allow_methods=["*"], allow_headers=["*"])

_assessments: dict[str, dict] = {}


def load_facility() -> dict:
    return json.loads((DATA / "facility.json").read_text())


def save_facility(f: dict):
    (DATA / "facility.json").write_text(json.dumps(f, indent=2))


@app.get("/health")
def health():
    return {"ok": True, "model": agent.model_info()}


@app.get("/facility")
def get_facility():
    f = load_facility()
    return {**f, "model": agent.model_info()}


class LocationIn(BaseModel):
    location: str


@app.put("/facility/location")
def set_location(body: LocationIn):
    f = load_facility()
    if body.location not in f["locations"]:
        raise HTTPException(400, f"unknown location {body.location}")
    f["current_location"] = body.location
    save_facility(f)
    return f


@app.get("/thresholds")
def thresholds():
    return {"thresholds": rules.THRESHOLDS, "postures": rules.POSTURE_LABELS, "opm_basis": rules.OPM_BASIS}


class AssessIn(BaseModel):
    mode: str = "live"  # live | replay
    at: str | None = None  # ISO time for replay
    replay: str | None = None  # replay id, e.g. "isaias"
    simulate: str | None = None  # "nws_down" to demo the failure path
    use_agent: bool = True


@app.post("/assess")
def assess(body: AssessIn):
    f = load_facility()
    location = f["current_location"]
    at = None
    if body.mode == "replay":
        rp = f["replays"].get(body.replay or "isaias")
        if not rp:
            raise HTTPException(400, "unknown replay")
        location = rp["location"]
        at = datetime.fromisoformat(body.at or rp["moments"][0]["at"])
    snapshot = f["replays"][body.replay or "isaias"].get("snapshot") if body.mode == "replay" else None
    a = agent.assess(f, location, body.mode, at, body.simulate, body.use_agent, snapshot)
    _assessments[a["id"]] = a
    return a


@app.get("/notifications/preview")
def notifications_preview(assessment_id: str):
    a = _assessments.get(assessment_id)
    if not a:
        raise HTTPException(404, "assessment not found — run /assess first")
    return a["notifications"]


class DecisionIn(BaseModel):
    assessment_id: str
    action: str  # confirm | override
    final_posture: str | None = None
    decided_by: str = "Dana Whitfield"
    reason: str | None = None


@app.post("/decision")
def decision(body: DecisionIn):
    a = _assessments.get(body.assessment_id)
    if not a:
        raise HTTPException(404, "assessment not found — run /assess first")
    rec_posture = a["rules"]["posture"]
    if body.action == "confirm":
        if rec_posture is None:
            raise HTTPException(400, "No recommendation to confirm — choose a posture (override) with a reason")
        final = rec_posture
    elif body.action == "override":
        if body.final_posture not in rules.POSTURES:
            raise HTTPException(400, "final_posture must be one of " + ", ".join(rules.POSTURES))
        if not (body.reason or "").strip():
            raise HTTPException(400, "Overriding the recommendation requires a reason")
        final = body.final_posture
    else:
        raise HTTPException(400, "action must be confirm or override")

    entry = {
        "record_id": f"rec-{len(records.all_records()) + 1:04d}",
        "decided_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "as_of": a["as_of"],
        "mode": a["mode"],
        "location": a["location"],
        "location_label": a["location_label"],
        "recommended_posture": rec_posture,
        "final_posture": final,
        "action": body.action,
        "overridden": final != rec_posture,
        "override_reason": body.reason if body.action == "override" else None,
        "decided_by": body.decided_by,
        "phase": a["rules"]["phase"],
        "confidence": a["rules"]["confidence"],
        "rationale": a["rationale"],
        "rationale_by": a["rationale_by"],
        "notification_summary": a["notifications"]["summary"],
        "snapshot": a,  # full inputs (with sources + timestamps), rule result, notifications, agent trace
    }
    records.append(entry)
    return {k: v for k, v in entry.items() if k != "snapshot"}


@app.get("/records")
def get_records(full: bool = False):
    recs = records.all_records()
    recs.sort(key=lambda r: r["decided_at"], reverse=True)
    return recs if full else [{k: v for k, v in r.items() if k != "snapshot"} for r in recs]


@app.get("/records/{record_id}")
def get_record(record_id: str):
    for r in records.all_records():
        if r["record_id"] == record_id:
            return r
    raise HTTPException(404, "record not found")


@app.get("/roster")
def roster():
    return notify.load_roster()
