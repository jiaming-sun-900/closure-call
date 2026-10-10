"""Rule tests — same inputs must always give the same posture (GOALS G2.1/G2.2/G3)."""
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import notify
import rules

FAC = json.loads((Path(__file__).parent.parent / "data" / "facility.json").read_text())
LOC = FAC["locations"]["panama_city"]
# Wednesday 2026-10-07 22:00 CDT → decision is for Thursday
NOW = datetime(2026, 10, 8, 3, 0, tzinfo=timezone.utc)


def alert(event, severity="Severe", certainty="Likely", urgency="Expected", hours=24, msg="Alert", **kw):
    return {"id": f"urn:{event}:{hours}", "event": event, "severity": severity, "certainty": certainty,
            "urgency": urgency, "message_type": msg, "sent": NOW.isoformat(), "effective": NOW.isoformat(),
            "onset": NOW.isoformat(), "expires": (NOW + timedelta(hours=hours)).isoformat(),
            "ends": (NOW + timedelta(hours=hours)).isoformat(), "area": "Bay", "references": [],
            "emergency": kw.get("emergency", False), "source": "test", "fetched_at": NOW.isoformat()}


def ev(alerts, gauge=None, forecast=None, last=None, loc=LOC, now=NOW):
    return rules.evaluate(alerts=alerts, forecast=forecast, gauge=gauge, facility=FAC, loc=loc, now=now, last_posture=last)


def test_no_alerts_is_open():
    r = ev([])
    assert r["posture"] == "OPEN" and r["phase"] == "none" and r["window"]["day"] == "Thu"


def test_hurricane_warning_closes():
    r = ev([alert("Hurricane Warning", "Extreme", urgency="Immediate")])
    assert r["posture"] == "CLOSED" and r["confidence"] == "HIGH" and r["phase"] == "official"


def test_hurricane_watch_is_advance_notice():
    r = ev([alert("Hurricane Watch", certainty="Possible", urgency="Future")])
    assert r["posture"] == "OPEN" and r["phase"] == "advance" and r["confidence"] == "MEDIUM"


def test_two_alerts_take_most_severe():
    r = ev([alert("Flood Watch", urgency="Future"), alert("Hurricane Warning", "Extreme", urgency="Immediate")])
    assert r["posture"] == "CLOSED" and len(r["triggers"]) == 2
    assert r["primary_trigger"]["event"] == "Hurricane Warning"


def test_nws_failure_never_defaults_open():
    r = rules.evaluate(alerts=None, forecast=None, gauge=None, facility=FAC, loc=LOC, now=NOW,
                       data_status={"nws": "error"})
    assert r["posture"] != "OPEN" and r["needs_review"] and r["confidence"] == "LOW"


def test_nws_failure_keeps_last_known_posture():
    r = rules.evaluate(alerts=None, forecast=None, gauge=None, facility=FAC, loc=LOC, now=NOW,
                       last_posture="CLOSED", data_status={"nws": "error"})
    assert r["posture"] == "CLOSED" and r["confidence"] == "LOW"


def test_cancellation_produces_correction():
    r = ev([], last="CLOSED")
    assert r["posture"] == "OPEN" and r["phase"] == "correction"


def test_flash_flood_emergency_closes():
    r = ev([alert("Flash Flood Warning", urgency="Immediate", emergency=True)])
    assert r["posture"] == "CLOSED"


def test_gauge_above_moderate_closes_with_exceedance():
    g = {"name": "Test Creek", "stage_ft": 35.5, "observed_at": NOW.isoformat(), "category": "moderate",
         "flood_stages_ft": {"action": 28, "minor": 30, "moderate": 34, "major": 38}, "source": "test", "fetched_at": NOW.isoformat()}
    r = ev([alert("Flood Warning")], gauge=g)
    assert r["posture"] == "CLOSED"
    assert r["primary_trigger"]["exceed_by"] == "+1.50 ft above moderate"


def test_storm_surge_only_matters_in_surge_zone():
    a = [alert("Storm Surge Warning", "Extreme", urgency="Immediate")]
    assert ev(a)["posture"] == "CLOSED"
    inland = dict(LOC, in_surge_zone=False)
    assert ev(a, loc=inland)["posture"] == "OPEN"


def test_unknown_alert_uses_generic_fallback():
    r = ev([alert("Extreme Heat Warning", "Severe", urgency="Expected")])
    assert r["posture"] == "UNSCHEDULED_TELEWORK" and r["primary_trigger"]["rule_id"] == "GENERIC_SEVERE"


def test_deterministic():
    a = [alert("Hurricane Warning", "Extreme", urgency="Immediate"), alert("Flood Watch", urgency="Future")]
    assert ev(a) == ev(a)


def test_notifications_follow_schedule_and_field_first():
    r = ev([alert("Hurricane Warning", "Extreme", urgency="Immediate")])
    pkg = notify.build_package({"rules": r}, FAC, LOC)
    names = {x["employee"]["name"] for x in pkg["recipients"]}
    excluded = {x["employee"]["name"]: x["reason"] for x in pkg["excluded"]}
    assert pkg["recipients"][0]["group"] == "field"
    assert "Robert Hayes" in excluded and "leave" in excluded["Robert Hayes"]
    assert "Linda Park" in excluded  # not on site Thursdays
    assert "Linda Park" not in names
    for x in pkg["recipients"]:
        assert "Does this apply to you? YES" in x["message"]["body"]
        assert "What you should do:" in x["message"]["body"]


def test_accessibility_called_out():
    r = ev([alert("Hurricane Warning", "Extreme", urgency="Immediate")])
    pkg = notify.build_package({"rules": r}, FAC, LOC)
    aisha = next(x for x in pkg["recipients"] if x["employee"]["name"] == "Aisha Brown")
    assert "Accessibility" in aisha["message"]["body"]
