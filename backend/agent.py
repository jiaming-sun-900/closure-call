"""Assessment pipeline. A Strands agent (Anthropic model) drives the tools; if no key is configured or the model
fails, the same tools run directly and templates write the text — the flow never breaks.

The recommendation ALWAYS comes from the evaluate_rules tool output captured server-side, never from LLM text.
"""
import json
import os
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutTimeout
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from pydantic import BaseModel, Field

import notify
import records
import rules
from sources import gauge as gauge_src
from sources import nws, outage as outage_src, roads as roads_src
from sources.http import SourceError

load_dotenv(Path(__file__).parent.parent / ".env")
load_dotenv(Path(__file__).parent / ".env")
AGENT_TIMEOUT_S = float(os.getenv("AGENT_TIMEOUT_S", "75"))
DATA = Path(__file__).parent / "data"
_pool = ThreadPoolExecutor(max_workers=4)
STEPS = ("get_nws_alerts", "get_forecast", "get_river_gauge", "get_power_outages", "get_road_closures",
         "get_facility_status", "get_roster", "evaluate_rules", "draft_notifications")


def load_facility_status() -> dict:
    return json.loads((DATA / "facility_status.json").read_text())


class Ctx:
    """Per-assessment state shared by the tools."""

    def __init__(self, facility: dict, at: datetime, simulate: str | None, on_event=None, target_date: str | None = None):
        self.facility, self.at, self.simulate, self.target_date = facility, at, simulate, target_date
        self.on_event = on_event or (lambda e: None)
        self.alerts = self.forecast = self.gauge = self.outage = self.roads = self.fstatus = None
        self.rules = self.package = None
        self.status: dict[str, str] = {}
        self.trace: list[dict] = []
        self.done: set[str] = set()

    def start(self, tool):
        self.on_event({"type": "step", "tool": tool, "status": "running",
                       "by": "agent" if getattr(self, "agent_phase", False) else "system"})

    def log(self, tool, t0, summary, ok=True):
        entry = {"tool": tool, "ms": int((time.time() - t0) * 1000), "summary": summary, "ok": ok,
                 "by": "agent" if getattr(self, "agent_phase", False) else "system"}
        self.trace.append(entry)
        self.done.add(tool)
        self.on_event({"type": "step", "status": "done" if ok else "error", **entry})

    def _fetch(self, tool, key, fn, summarize):
        t0 = time.time()
        self.start(tool)
        if tool in self.done:
            if getattr(self, "agent_phase", False):
                self.log(tool, t0, "returned collected data to agent")
            return getattr(self, key)
        try:
            if self.simulate == f"{key}_down" or (self.simulate == "nws_down" and key == "alerts"):
                raise SourceError("simulated outage")
            setattr(self, key, fn())
            self.status[key] = "ok"
            self.log(tool, t0, summarize(getattr(self, key)))
        except (SourceError, KeyError, StopIteration, ValueError) as e:
            setattr(self, key, None)
            self.status[key] = "error"
            self.log(tool, t0, f"FAILED: {e}"[:200], ok=False)
        return getattr(self, key)

    # ---- tools
    def get_nws_alerts(self):
        f = self.facility
        a = self._fetch("get_nws_alerts", "alerts", lambda: nws.get_active_alerts(f["lat"], f["lon"], f.get("nws_county")),
                        lambda v: f"{len(v)} alert(s): " + (", ".join(sorted({x['event'] for x in v})) or "none"))
        return {"status": self.status["alerts"], "alerts": [
            {k: x[k] for k in ("event", "severity", "certainty", "urgency", "onset", "ends", "expires", "headline")} for x in a or []]}

    def get_forecast(self):
        f = self.facility
        fc = self._fetch("get_forecast", "forecast", lambda: nws.get_hourly_forecast(f["lat"], f["lon"], hours=168),
                         lambda v: f"7-day hourly; peak wind {max(p['wind_mph'] for p in v['periods'])} mph")
        if not fc:
            return {"status": "error"}
        return {"status": "ok", "peak_wind_mph_96h": max(p["wind_mph"] for p in fc["periods"]), "next_hours": fc["periods"][:4]}

    def get_river_gauge(self):
        g = self._fetch("get_river_gauge", "gauge", lambda: gauge_src.get_river_gauge(self.facility["gauge_lid"]),
                        lambda v: f"{v['name']}: {v['stage_ft']} ft ({v['category']})")
        return {"status": "error"} if not g else {k: g[k] for k in ("name", "stage_ft", "category", "flood_stages_ft", "observed_at")} | {"forecast": g["forecast"][:8]}

    def get_power_outages(self):
        o = self._fetch("get_power_outages", "outage", lambda: outage_src.get_parish_outage(self.facility["parish"]),
                        lambda v: f"{v['customers_out']:,} / {v['customers_served']:,} Entergy customers out ({v['pct']}%)")
        return o or {"status": "error"}

    def get_road_closures(self):
        f = self.facility
        r = self._fetch("get_road_closures", "roads", lambda: roads_src.get_road_events(f["lat"], f["lon"]),
                        lambda v: f"{v['closures']} closures within {v['radius_mi']} mi; {v['weather_related_closures']} weather-related")
        return {"status": "error"} if not r else {k: r[k] for k in ("closures", "weather_related_closures", "radius_mi")}

    def get_facility_status(self):
        t0 = time.time()
        self.start("get_facility_status")
        self.fstatus = load_facility_status()
        self.status["facility"] = "ok"
        s = self.fstatus
        self.log("get_facility_status", t0, f"power {s['power']}, water {s['water']}, roof {s['roof']}, roads {s['roads']}")
        return s

    def get_roster(self):
        t0 = time.time()
        self.start("get_roster")
        roster = notify.load_roster()
        self.log("get_roster", t0, f"{len(roster)} employees: " + ", ".join(
            f"{a} {sum(e['agency'] == a for e in roster)}" for a in self.facility["agencies"]))
        return {"employees": [{k: e[k] for k in ("name", "agency", "role", "today_status", "work_location", "essential")} for e in roster]}

    def evaluate_rules(self):
        t0 = time.time()
        self.start("evaluate_rules")
        for step in STEPS[:6]:
            if step not in self.done:
                getattr(self, step)()
        self.rules = rules.evaluate(alerts=self.alerts, forecast=self.forecast, gauge=self.gauge, outage=self.outage,
                                    roads=self.roads, facility_status=self.fstatus, facility=self.facility, now=self.at,
                                    data_status=self.status, last_posture=records.last_posture(),
                                    target_date=self.target_date)
        r = self.rules
        self.log("evaluate_rules", t0, f"{r['recommended']} · level {r['level']} · {r['confidence']} · " +
                 ", ".join(f"{a['code']} {a['posture']}" for a in r["agencies"]))
        return {k: r[k] for k in ("headline", "recommended", "recommended_label", "recommended_why", "level", "level_label",
                                  "confidence", "confidence_reason", "what_would_change")} | {
            "operating_day": f"{r['window']['day']} {r['window']['date']}",
            "agencies": [{k: a[k] for k in ("code", "label", "why", "field_work", "tolerance")} for a in r["agencies"]],
            "signals": [{k: s[k] for k in ("title", "level", "observed", "threshold", "exceed_by", "basis", "source", "at")} for s in r["signals"]]}

    def draft_notifications(self):
        t0 = time.time()
        self.start("draft_notifications")
        if self.rules is None:
            self.evaluate_rules()
        self.package = notify.build_package(self.rules, self.facility)
        self.log("draft_notifications", t0, self.package["summary"])
        return {"summary": self.package["summary"], "availability": self.package["availability"],
                "roles": [{"key": _role_key(x), "to": x["to"], "subject": x["subject"], "draft": x["body"]} for x in self.package["roles"]]}


def _role_key(x):
    return x["role"] + (f":{x['agency']}" if x.get("agency") else "")


# ---------------------------------------------------------------- agent
class RoleDraft(BaseModel):
    key: str = Field(description="Role key exactly as given by draft_notifications, e.g. 'facility', 'agency:FSA', 'executive'")
    body: str = Field(description="Rewritten message body: 3 to 5 short lines, verb-first, ≤60 words")


class Briefing(BaseModel):
    rationale: str = Field(description="One paragraph (≤90 words) a manager can paste into an email")
    drafts: list[RoleDraft]


SYSTEM_PROMPT = """You are Closure Call, assisting the facility manager of the USDA Lake Charles Service Center (Calcasieu Parish, LA)
in deciding the operating status during severe weather. A human makes the decision; you prepare the evidence and the words.

Workflow:
1. Call ALL data tools in a single turn (in parallel): get_nws_alerts, get_forecast, get_river_gauge, get_power_outages,
   get_road_closures, get_facility_status, get_roster.
2. Call evaluate_rules. Its recommendation and per-agency postures are AUTHORITATIVE — never change, soften or second-guess them.
3. Call draft_notifications, then rewrite each role draft for its reader (facility manager = building, team managers = people,
   program managers = can the work continue, executive = what's affected and who can work). Keep every fact and number; do not
   add recipients or change any posture.

Rationale paragraph: lead with the recommendation and operating day, then cite the specific data points (value, threshold crossed
and by how much, source, time), confidence and why, how agencies differ, and the one change that would alter the recommendation.
Plain text, no markdown. Never use em dashes or en dashes; use commas, colons or new lines. Do not mention holidays, weekends or why a day was chosen; just name the operating day. Short, verb-first sentences."""


def _model():
    if not os.getenv("ANTHROPIC_API_KEY"):
        return None
    from strands.models.anthropic import AnthropicModel
    return AnthropicModel(client_args={"api_key": os.environ["ANTHROPIC_API_KEY"]},
                          model_id=os.getenv("MODEL_ID", "claude-haiku-5-5"), max_tokens=8000)


def model_info() -> dict:
    return {"provider": "anthropic" if os.getenv("ANTHROPIC_API_KEY") else None,
            "model_id": os.getenv("MODEL_ID", "claude-haiku-5-5") if os.getenv("ANTHROPIC_API_KEY") else None}


def _run_agent(ctx: Ctx, model) -> Briefing:
    from strands import Agent, tool

    def wrap(name, doc):
        fn = getattr(ctx, name)

        @tool(name=name, description=doc)
        def _t() -> str:
            return json.dumps(fn(), default=str)
        return _t

    tools = [wrap(n, d) for n, d in [
        ("get_nws_alerts", "NWS alerts in effect at the facility (api.weather.gov)."),
        ("get_forecast", "NWS hourly forecast (wind, precipitation) for the next 96 hours."),
        ("get_river_gauge", "Nearest river gauge: stage, official flood stages, NWS stage forecast."),
        ("get_power_outages", "Entergy Louisiana customers without power in the parish."),
        ("get_road_closures", "Louisiana 511 road closures near the facility."),
        ("get_facility_status", "Facility manager's manual building report: power, water, roof, roads."),
        ("get_roster", "Employee roster with agency, role and status for the operating day."),
        ("evaluate_rules", "Deterministic closure rules. Returns the AUTHORITATIVE recommendation and per-agency postures."),
        ("draft_notifications", "Role-based notification drafts, employee list with notify/skip reasons, availability."),
    ]]
    agent = Agent(model=model, system_prompt=SYSTEM_PROMPT, tools=tools, callback_handler=None,
                  structured_output_model=Briefing)
    result = agent("Assess the Lake Charles Service Center for the next operating day and prepare the briefing.")
    return result.structured_output


# ---------------------------------------------------------------- templates (fallback)
def template_rationale(r: dict, pkg: dict) -> str:
    w = r["window"]
    day = {"Mon": "Monday", "Tue": "Tuesday", "Wed": "Wednesday", "Thu": "Thursday", "Fri": "Friday"}.get(w["day"], w["day"])
    if r["recommended"] is None:
        return f"Weather data from NWS is unavailable, so hazards for {day} cannot be ruled out. Please decide manually."
    lbl = rules.POSTURE_LABELS[r["recommended"]].lower()
    ag = " ".join(f"{a['code']}: {a['label'].lower()}" + (f", field work {a['field_work']}." if a["field_work"] else ".") for a in r["agencies"])
    if not r["deciding"]:
        return f"For {day}, the building can stay {lbl}. No weather, river, power or road reading crossed a threshold. {ag}"
    s = r["deciding"][0]
    t = pkg["availability"]["total"]
    return (f"For {day}, we recommend the building stay {lbl}. The main driver is the {s['title'].lower()} "
            f"({s['observed'].split(' (')[0]}), which reaches hazard level {r['level']} of 4. "
            f"Agencies react differently because their risk tolerance differs. {ag} "
            f"{t['on_site']} people can work on site and {t['telework']} remotely. "
            f"{r['what_would_change'][0] if r['what_would_change'] else ''}").replace(" — ", ", ").replace("—", ",")


CACHE_PATH = DATA / "agent_cache.json"


def _fingerprint(r: dict, pkg: dict) -> str:
    """Hash of everything the agent's words depend on. Same decision inputs → reuse the cached briefing (saves API cost)."""
    import hashlib
    core = {
        "rec": r["recommended"], "level": r["level"], "conf": r["confidence"], "day": r["window"]["date"],
        "agencies": [(a["code"], a["posture"], a["field_work"]) for a in r["agencies"]],
        "signals": [(s["title"], s["level"], s["observed"], s["exceed_by"]) for s in r["signals"]],
        "change": r["what_would_change"], "avail": pkg["availability"],
        "notify": [(e["id"], e["notify"], e["reason"]) for e in pkg["employees"]],
        "model": model_info()["model_id"],
    }
    return hashlib.sha256(json.dumps(core, sort_keys=True, default=str).encode()).hexdigest()[:16]


def _cache_get(fp: str) -> dict | None:
    try:
        return json.loads(CACHE_PATH.read_text()).get(fp)
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def _cache_put(fp: str, briefing: dict):
    try:
        cache = json.loads(CACHE_PATH.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        cache = {}
    cache[fp] = briefing
    CACHE_PATH.write_text(json.dumps(cache, indent=1))


def _redact(text: str) -> str:
    key = os.getenv("ANTHROPIC_API_KEY")
    return text.replace(key, "[redacted]") if key else text


def assess(facility: dict, at: datetime | None = None, simulate: str | None = None, use_agent: bool = True,
           on_event=None, target_date: str | None = None) -> dict:
    at = at or datetime.now(timezone.utc)
    ctx = Ctx(facility, at, simulate, on_event, target_date)
    t0 = time.time()
    # 1. Deterministic pass: fetch every source in parallel, run the rules, build the notification package
    with ThreadPoolExecutor(max_workers=7) as ex:
        list(ex.map(lambda step: getattr(ctx, step)(), STEPS[:7]))
    for step in STEPS[7:]:
        getattr(ctx, step)()
    fp = _fingerprint(ctx.rules, ctx.package)
    briefing, agent_error, by, cached = None, None, "template", False
    # 2. Agent pass only when the decision inputs changed since the last call
    model = _model() if use_agent else None
    if model is not None:
        hit = _cache_get(fp)
        ctx.start("agent_write")
        ta = time.time()
        if hit:
            briefing, by, cached = hit, f"Strands agent · {hit.get('model')} (cached)", True
            ctx.log("agent_write", ta, "Inputs unchanged, reused the agent's earlier briefing")
        else:
            ctx.agent_phase = True
            fut = _pool.submit(_run_agent, ctx, model)
            try:
                b = fut.result(timeout=AGENT_TIMEOUT_S)
                nodash = lambda t: t.replace(" — ", ", ").replace("—", ", ").replace(" – ", ", ")
                briefing = {"rationale": nodash(b.rationale), "drafts": {d.key: nodash(d.body) for d in b.drafts},
                            "model": model_info()["model_id"]}
                _cache_put(fp, briefing)
                by = f"Strands agent · {model_info()['model_id']}"
                ctx.agent_phase = False
                ctx.log("agent_write", ta, "Rationale and 6 role drafts written")
            except FutTimeout:
                agent_error = f"Agent timed out after {AGENT_TIMEOUT_S:.0f}s, template used"
            except Exception as e:
                agent_error = _redact(f"Agent error ({type(e).__name__}: {e})")[:300]
            if agent_error:
                ctx.agent_phase = False
                ctx.log("agent_write", ta, "Agent unavailable, template text used", ok=False)
    pkg, r = ctx.package, ctx.rules
    if briefing:
        for role in pkg["roles"]:
            role["template_body"] = role["body"]
            role["body"] = briefing["drafts"].get(_role_key(role), role["body"])
            role["written_by"] = "agent" if _role_key(role) in briefing["drafts"] else "template"
        rationale = briefing["rationale"]
    else:
        rationale = template_rationale(r, pkg)
        for role in pkg["roles"]:
            role["written_by"] = "template"
    return {
        "id": uuid.uuid4().hex[:10],
        "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "as_of": at.astimezone(timezone.utc).isoformat(timespec="seconds"),
        "elapsed_s": round(time.time() - t0, 1),
        "simulate": simulate,
        "facility": {k: facility[k] for k in ("name", "address", "parish", "lat", "lon", "facility_source", "hours")},
        "inputs": {"alerts": ctx.alerts, "forecast": ctx.forecast, "gauge": ctx.gauge, "outage": ctx.outage,
                   "roads": ctx.roads, "facility_status": ctx.fstatus},
        "data_status": ctx.status,
        "rules": r,
        "notifications": pkg,
        "rationale": rationale,
        "rationale_by": by,
        "agent_error": agent_error,
        "trace": ctx.trace,
        "fingerprint": fp,
        "agent_cached": cached,
    }
