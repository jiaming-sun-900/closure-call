"""Assessment pipeline. A Strands agent drives the tools; if no model is configured (or it fails),
the same tools run directly and a template writes the rationale — the flow never breaks.

The posture ALWAYS comes from the evaluate_rules tool output captured server-side, never from LLM text.
"""
import json
import os
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutTimeout
from datetime import datetime, timedelta, timezone

import notify
import records
import rules
from sources import gauge as gauge_src
from sources import nws
from sources.http import SourceError

AGENT_TIMEOUT_S = float(os.getenv("AGENT_TIMEOUT_S", "45"))
_pool = ThreadPoolExecutor(max_workers=4)


class Ctx:
    """Per-assessment state shared by the tools."""

    def __init__(self, facility: dict, location: str, mode: str, at: datetime, simulate: str | None,
                 snapshot: str | None = None):
        self.facility, self.location, self.mode, self.at, self.simulate = facility, location, mode, at, simulate
        self.snapshot = snapshot
        self.loc = facility["locations"][location]
        self.alerts = self.forecast = self.gauge = self.rules = self.package = None
        self.status: dict[str, str] = {}
        self.trace: list[dict] = []
        self.done: set[str] = set()

    def log(self, tool: str, t0: float, summary: str, ok: bool = True):
        self.trace.append({"tool": tool, "ms": int((time.time() - t0) * 1000), "summary": summary, "ok": ok})
        self.done.add(tool)

    # ---- tool implementations (plain functions; wrapped for Strands below) ----
    def get_nws_alerts(self) -> dict:
        t0 = time.time()
        try:
            if self.simulate == "nws_down":
                raise SourceError("simulated NWS outage")
            if self.mode == "replay":
                hist = nws.get_alert_history(self.loc["lat"], self.loc["lon"], _history_start(self.at), snapshot=self.snapshot)
                self.alerts = nws.alerts_active_at(hist, self.at)
            else:
                self.alerts = nws.get_active_alerts(self.loc["lat"], self.loc["lon"])
            self.status["nws"] = "ok"
            self.log("get_nws_alerts", t0, f"{len(self.alerts)} alert(s): " + (", ".join(sorted({a['event'] for a in self.alerts})) or "none"))
        except SourceError as e:
            self.alerts, self.status["nws"] = None, "error"
            self.log("get_nws_alerts", t0, f"FAILED: {e}", ok=False)
        return {"status": self.status["nws"], "alerts": [
            {k: a[k] for k in ("event", "severity", "certainty", "urgency", "onset", "expires", "area")} for a in (self.alerts or [])]}

    def get_forecast(self) -> dict:
        t0 = time.time()
        if self.mode == "replay":
            self.status["forecast"] = "n/a"
            self.log("get_forecast", t0, "Skipped — historical hourly forecasts are not archived by NWS API")
            return {"status": "n/a"}
        try:
            self.forecast = nws.get_hourly_forecast(self.loc["lat"], self.loc["lon"])
            self.status["forecast"] = "ok"
            peak = max(self.forecast["periods"][:24], key=lambda p: p["wind_mph"])
            self.log("get_forecast", t0, f"next 24h peak wind {peak['wind_mph']} mph")
            return {"status": "ok", "peak_wind_mph_24h": peak["wind_mph"], "next_hours": self.forecast["periods"][:6]}
        except (SourceError, KeyError) as e:
            self.status["forecast"] = "error"
            self.log("get_forecast", t0, f"FAILED: {e}", ok=False)
            return {"status": "error"}

    def get_river_gauge(self) -> dict:
        t0 = time.time()
        if self.mode == "replay":
            self.status["gauge"] = "n/a"
            self.log("get_river_gauge", t0, "Skipped in replay (live gauge would not reflect the past)")
            return {"status": "n/a"}
        try:
            self.gauge = gauge_src.get_river_gauge(self.loc["gauge_lid"])
            self.status["gauge"] = "ok"
            self.log("get_river_gauge", t0, f"{self.gauge['name']}: {self.gauge['stage_ft']} ft ({self.gauge['category']})")
            return {"status": "ok", **{k: self.gauge[k] for k in ("name", "stage_ft", "category", "flood_stages_ft", "observed_at")}}
        except (SourceError, KeyError) as e:
            self.status["gauge"] = "error"
            self.log("get_river_gauge", t0, f"FAILED: {e}", ok=False)
            return {"status": "error"}

    def get_roster(self) -> dict:
        t0 = time.time()
        roster = notify.load_roster()
        self.log("get_roster", t0, f"{len(roster)} employees")
        return {"employees": [{k: e[k] for k in ("name", "role", "work_location", "weekly_onsite_days", "today_status", "essential")} for e in roster]}

    def evaluate_rules(self) -> dict:
        t0 = time.time()
        if "get_nws_alerts" not in self.done:
            self.get_nws_alerts()
        as_of = self.at.isoformat() if self.mode == "replay" else None
        last = records.last_posture(self.location, self.mode, before=as_of)
        self.rules = rules.evaluate(alerts=self.alerts, forecast=self.forecast, gauge=self.gauge, facility=self.facility,
                                    loc=self.loc, now=self.at, last_posture=last, data_status=self.status)
        r = self.rules
        self.log("evaluate_rules", t0, f"{r['posture']} ({r['confidence']}) via {r['primary_trigger']['rule_id'] if r['primary_trigger'] else 'no trigger'}")
        p = r["primary_trigger"]
        return {"posture": r["posture"], "posture_label": r["posture_label"], "phase": r["phase"], "confidence": r["confidence"],
                "confidence_reason": r["confidence_reason"], "operating_day": f"{r['window']['day']} {r['window']['date']}",
                "deciding_rule": p and {k: p[k] for k in ("rule", "observed", "threshold", "exceed_by", "basis", "source", "at")},
                "other_triggers": [t["rule"] + " → " + t["posture"] for t in r["triggers"][1:]],
                "what_would_change": r["what_would_change"]}

    def draft_notifications(self) -> dict:
        t0 = time.time()
        if self.rules is None:
            self.evaluate_rules()
        self.package = notify.build_package({"rules": self.rules}, self.facility, self.loc)
        self.log("draft_notifications", t0, self.package["summary"])
        return {"summary": self.package["summary"],
                "recipients": [f"{x['order']}. {x['employee']['name']} ({x['group']}, {x['urgency']})" for x in self.package["recipients"]],
                "excluded": [f"{x['employee']['name']}: {x['reason']}" for x in self.package["excluded"]]}


def _history_start(at: datetime) -> str:
    return (at - timedelta(days=4)).astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


SYSTEM_PROMPT = """You are Closure Call, an assistant to a USDA facility manager deciding the facility's operating status during severe weather.
Workflow — call the tools in this order: get_nws_alerts, get_forecast, get_river_gauge, get_roster, evaluate_rules, draft_notifications.
Rules you must follow:
- The operating posture is decided ONLY by evaluate_rules. Never change, soften, or second-guess it. Use its posture_label verbatim.
- You do not make the decision; a human manager does. You are writing a recommendation.
Final answer: ONE paragraph (max 110 words) the manager can paste into an email. Include: the recommended posture and operating day,
the deciding alert/measurement with its source and time, the threshold crossed and by how much, the confidence and why,
how many employees will be notified, and the one change that would alter the recommendation. Plain text, no markdown, no preamble."""


def _model():
    provider = os.getenv("MODEL_PROVIDER", "").lower()
    model_id = os.getenv("MODEL_ID")
    if provider == "bedrock":
        from strands.models.bedrock import BedrockModel
        return BedrockModel(model_id=model_id or "us.anthropic.claude-sonnet-4-20250514-v1:0",
                            region_name=os.getenv("AWS_REGION", "us-west-2"), temperature=0.2)
    if provider == "anthropic":
        from strands.models.anthropic import AnthropicModel
        return AnthropicModel(client_args={"api_key": os.environ["ANTHROPIC_API_KEY"]},
                              model_id=model_id or "claude-sonnet-5-5", max_tokens=800)
    if provider == "openai":  # OpenAI-compatible endpoints, e.g. Akamai inference
        from strands.models.openai import OpenAIModel
        return OpenAIModel(client_args={"api_key": os.environ.get("OPENAI_API_KEY", "none"),
                                        "base_url": os.getenv("OPENAI_BASE_URL")},
                           model_id=model_id, params={"temperature": 0.2, "max_tokens": 800})
    return None


def model_info() -> dict:
    return {"provider": os.getenv("MODEL_PROVIDER") or None, "model_id": os.getenv("MODEL_ID") or None}


def _run_agent(ctx: Ctx, model) -> str:
    from strands import Agent, tool

    @tool
    def get_nws_alerts() -> str:
        """Fetch National Weather Service alerts currently in effect at the facility location."""
        return json.dumps(ctx.get_nws_alerts(), default=str)

    @tool
    def get_forecast() -> str:
        """Fetch the NWS hourly forecast (wind, precipitation) for the facility."""
        return json.dumps(ctx.get_forecast(), default=str)

    @tool
    def get_river_gauge() -> str:
        """Fetch the nearest river gauge stage and its official flood stages."""
        return json.dumps(ctx.get_river_gauge(), default=str)

    @tool
    def get_roster() -> str:
        """Get the facility employee roster with schedules and status."""
        return json.dumps(ctx.get_roster(), default=str)

    @tool
    def evaluate_rules() -> str:
        """Run the deterministic closure rules on the collected data. Returns the authoritative posture."""
        return json.dumps(ctx.evaluate_rules(), default=str)

    @tool
    def draft_notifications() -> str:
        """Build the notification package: recipients in priority order, excluded employees with reasons, drafts."""
        return json.dumps(ctx.draft_notifications(), default=str)

    agent = Agent(model=model, system_prompt=SYSTEM_PROMPT, callback_handler=None,
                  tools=[get_nws_alerts, get_forecast, get_river_gauge, get_roster, evaluate_rules, draft_notifications])
    result = agent("Assess the facility now and write the recommendation paragraph.")
    return str(result).strip()


def template_rationale(ctx: Ctx) -> str:
    r, pkg = ctx.rules, ctx.package
    w = r["window"]
    if r["needs_review"]:
        return (f"Weather data from the National Weather Service could not be retrieved at {datetime.now(timezone.utc):%H:%M} UTC, "
                f"so Closure Call cannot rule out hazards for {w['day']} {w['date']}. No OPEN recommendation is given; "
                f"confidence is LOW. Please decide manually and re-run the assessment once data is restored.")
    p = r["primary_trigger"]
    if not p or r["posture"] == "OPEN" and r["phase"] == "none":
        return (f"Recommendation for {w['day']} {w['date']}: {r['posture_label']}. No NWS alert in effect for the facility "
                f"meets a closure threshold, and river and wind readings are below action levels (confidence {r['confidence']}). "
                f"{r['what_would_change'][0]}")
    return (f"Recommendation for {w['day']} {w['date']}: {r['posture_label']}. Deciding input: {p['observed']} "
            f"(source: {p['source']}, retrieved {p['at']}). Threshold: {p['threshold']} — {p['exceed_by']}. "
            f"Basis: {p['basis']}. Confidence {r['confidence']} ({r['confidence_reason']}). "
            f"{pkg['summary']}. What would change this: {r['what_would_change'][0]}")


def assess(facility: dict, location: str, mode: str = "live", at: datetime | None = None,
           simulate: str | None = None, use_agent: bool = True, snapshot: str | None = None) -> dict:
    at = at or datetime.now(timezone.utc)
    ctx = Ctx(facility, location, mode, at, simulate, snapshot)
    model = _model() if use_agent else None
    rationale_by, agent_error = "template", None
    text = None
    if model is not None:
        fut = _pool.submit(_run_agent, ctx, model)
        try:
            text = fut.result(timeout=AGENT_TIMEOUT_S)
            rationale_by = f"agent:{os.getenv('MODEL_PROVIDER')}/{os.getenv('MODEL_ID') or 'default'}"
        except FutTimeout:
            agent_error = f"Agent timed out after {AGENT_TIMEOUT_S:.0f}s"
        except Exception as e:  # model/credential errors must not break the demo
            agent_error = f"Agent error: {type(e).__name__}: {e}"[:300]
    # Make sure every step ran even if the agent skipped one (or no agent at all)
    for step in ("get_nws_alerts", "get_forecast", "get_river_gauge", "get_roster", "evaluate_rules", "draft_notifications"):
        if step not in ctx.done:
            getattr(ctx, step)()
    if not text:
        text, rationale_by = template_rationale(ctx), "template"

    return {
        "id": uuid.uuid4().hex[:10],
        "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "as_of": at.astimezone(timezone.utc).isoformat(timespec="seconds"),
        "mode": mode,
        "simulate": simulate,
        "location": location,
        "location_label": ctx.loc["label"],
        "inputs": {"alerts": ctx.alerts, "forecast": ctx.forecast, "gauge": ctx.gauge},
        "data_status": ctx.status,
        "rules": ctx.rules,
        "notifications": ctx.package,
        "rationale": text,
        "rationale_by": rationale_by,
        "agent_error": agent_error,
        "trace": ctx.trace,
    }
