"""'Ask the agent': a Strands agent answers questions about the current assessment and runs hypothetical
scenarios through the SAME deterministic rules. Scenarios are never saved to the decision record."""
import copy
import hashlib
import json
from datetime import datetime, timedelta
from pathlib import Path

from pydantic import BaseModel, Field

import notify
import rules
from agent import _model, _redact, model_info

CACHE = Path(__file__).parent / "data" / "whatif_cache.json"

SYSTEM = """You are Closure Call's assistant for the USDA Lake Charles Service Center (Calcasieu Parish, LA).
The facility manager asks about the current recommendation or a hypothetical.
- For "why" questions, call get_situation and explain from the evidence.
- For "what if" questions, call simulate with the changed inputs. The rules engine decides the outcome; never invent a level.
Answer in at most 3 short sentences (under 60 words), plain text, verb-first, no markdown. Never use em dashes or en dashes.
State clearly when the answer is a hypothetical."""


class Answer(BaseModel):
    answer: str = Field(description="At most 3 short sentences, under 60 words")


def _situation(a: dict) -> dict:
    r = a["rules"]
    return {
        "operating_day": f"{r['window']['day']} {r['window']['date']}",
        "building": r["recommended_label"], "hazard_level": r["level"], "confidence": r["confidence"],
        "agencies": [{"code": g["code"], "posture": g["label"], "field_work": g["field_work"], "tolerance": g["tolerance"],
                      "thresholds": g["thresholds"], "why": g["why"]} for g in r["agencies"]],
        "signals": [{k: s[k] for k in ("title", "level", "observed", "threshold", "exceed_by", "basis")} for s in r["signals"]],
        "river": a["inputs"]["gauge"] and {k: a["inputs"]["gauge"][k] for k in ("name", "stage_ft", "flood_stages_ft")},
        "outage": a["inputs"]["outage"] and {k: a["inputs"]["outage"][k] for k in ("customers_out", "customers_served", "pct")},
        "what_would_change": r["what_would_change"],
    }


def simulate(a: dict, facility: dict, *, river_ft=None, outage_pct=None, wind_mph=None, building_power=None,
             building_water=None, roof=None, roads=None, new_alert=None) -> dict:
    """Re-run the rules on the assessment's inputs with some values replaced."""
    inp = copy.deepcopy(a["inputs"])
    now = datetime.fromisoformat(a["as_of"])
    target = a["rules"]["window"]["date"] if a["rules"]["window"].get("chosen") else None
    win = rules.operating_window(facility, now, target)
    changed = []
    if river_ft is not None and inp.get("gauge"):
        inp["gauge"].update(stage_ft=float(river_ft), forecast=[])
        changed.append(f"river {river_ft} ft")
    if outage_pct is not None and inp.get("outage"):
        o = inp["outage"]
        o["pct"] = float(outage_pct)
        o["customers_out"] = int(o["customers_served"] * float(outage_pct) / 100)
        changed.append(f"outages {outage_pct}%")
    if wind_mph is not None and inp.get("forecast"):
        for p in inp["forecast"]["periods"]:
            if win["commute_start"] <= datetime.fromisoformat(p["start"]) < win["end"]:
                p["wind_mph"] = int(wind_mph)
        changed.append(f"wind {wind_mph} mph")
    fs = dict(inp.get("facility_status") or {})
    for k, v in (("power", building_power), ("water", building_water), ("roof", roof), ("roads", roads)):
        if v:
            fs[k] = v
            changed.append(f"{k} {v}")
    alerts = list(inp.get("alerts") or [])
    if new_alert:
        sev = "Extreme" if "Hurricane" in new_alert else "Severe"
        alerts.append({"id": f"hypothetical:{new_alert}", "event": new_alert, "severity": sev, "certainty": "Likely",
                       "urgency": "Expected", "sent": now.isoformat(), "effective": now.isoformat(), "onset": now.isoformat(),
                       "expires": (win["end"] + timedelta(hours=6)).isoformat(), "ends": (win["end"] + timedelta(hours=6)).isoformat(),
                       "where": "Calcasieu Parish (hypothetical)", "area": "Calcasieu", "references": [], "emergency": False,
                       "source": "hypothetical scenario", "fetched_at": now.isoformat()})
        changed.append(new_alert)
    r = rules.evaluate(alerts=alerts, forecast=inp.get("forecast"), gauge=inp.get("gauge"), outage=inp.get("outage"),
                       roads=inp.get("roads"), facility_status=fs, facility=facility, now=now, target_date=target)
    pkg = notify.build_package(r, facility)
    return {"changed": changed, "rules": r, "availability": pkg["availability"],
            "inputs": {"gauge": inp.get("gauge"), "outage": inp.get("outage"), "facility_status": fs, "forecast": inp.get("forecast")}}


def ask(a: dict, facility: dict, question: str) -> dict:
    key = hashlib.sha256(f"{a.get('fingerprint')}|{question.strip().lower()}".encode()).hexdigest()[:16]
    try:
        cache = json.loads(CACHE.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        cache = {}
    if key in cache:
        return {**cache[key], "cached": True}

    model = _model()
    if model is None:
        return {"answer": "Add an Anthropic key in Settings to ask the agent.", "scenario": None, "trace": []}

    from strands import Agent, tool
    state = {"scenario": None, "trace": []}

    @tool
    def get_situation() -> str:
        """Current recommendation, per-agency postures and thresholds, and the evidence (signals) behind them."""
        state["trace"].append("get_situation")
        return json.dumps(_situation(a), default=str)

    @tool
    def simulate_scenario(river_ft: float | None = None, outage_pct: float | None = None, wind_mph: float | None = None,
                          building_power: str | None = None, building_water: str | None = None, roof: str | None = None,
                          roads: str | None = None, new_alert: str | None = None) -> str:
        """Re-run the deterministic closure rules with hypothetical inputs. Only pass what changes.

        Args:
            river_ft: Calcasieu River stage in feet (minor flood 4, moderate 6, major 8)
            outage_pct: percent of parish electric customers without power
            wind_mph: sustained wind during the work day, mph
            building_power: "ok", "generator" or "out"
            building_water: "ok" or "out"
            roof: "ok" or "damaged"
            roads: "open", "limited" or "impassable"
            new_alert: an NWS event name, e.g. "Tropical Storm Warning", "Hurricane Warning", "Flash Flood Warning"
        """
        state["trace"].append("simulate_scenario")
        sc = simulate(a, facility, river_ft=river_ft, outage_pct=outage_pct, wind_mph=wind_mph, building_power=building_power,
                      building_water=building_water, roof=roof, roads=roads, new_alert=new_alert)
        state["scenario"] = sc
        r = sc["rules"]
        return json.dumps({"changed": sc["changed"], "building": r["recommended_label"], "hazard_level": r["level"],
                           "agencies": [{"code": g["code"], "posture": g["label"], "field_work": g["field_work"]} for g in r["agencies"]],
                           "deciding": [s["title"] + ": " + s["observed"] for s in r["deciding"]],
                           "availability": sc["availability"]["total"]}, default=str)

    agent = Agent(model=model, system_prompt=SYSTEM, tools=[get_situation, simulate_scenario], callback_handler=None,
                  structured_output_model=Answer)
    try:
        res = agent(question)
        text = res.structured_output.answer.replace(" — ", ", ").replace("—", ", ").replace(" – ", ", ")
    except Exception as e:
        return {"answer": _redact(f"The agent could not answer ({type(e).__name__}).")[:200], "scenario": None, "trace": state["trace"]}
    out = {"answer": text, "scenario": state["scenario"], "trace": state["trace"], "model": model_info()["model_id"]}
    cache[key] = out
    CACHE.write_text(json.dumps(cache, default=str))
    return {**out, "cached": False}
