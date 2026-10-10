"""Rule tests — same inputs must always give the same recommendation; agencies differ only by tolerance."""
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import notify
import rules

FAC = json.loads((Path(__file__).parent.parent / "data" / "facility.json").read_text())
# Saturday 2026-10-10 15:00 CDT → Monday is Columbus Day → decision is for Tuesday 10/13
NOW = datetime(2026, 10, 10, 20, 0, tzinfo=timezone.utc)
OK_STATUS = {"power": "ok", "water": "ok", "roof": "ok", "roads": "open"}


def alert(event, severity="Severe", certainty="Observed", urgency="Immediate", hours=72, **kw):
    return {"id": f"urn:{event}:{hours}", "event": event, "severity": severity, "certainty": certainty,
            "urgency": urgency, "sent": NOW.isoformat(), "effective": NOW.isoformat(), "onset": NOW.isoformat(),
            "expires": (NOW + timedelta(hours=hours)).isoformat(), "ends": (NOW + timedelta(hours=hours)).isoformat(),
            "area": "Calcasieu", "where": "Calcasieu River", "references": [], "emergency": kw.get("emergency", False),
            "source": "test", "fetched_at": NOW.isoformat()}


def ev(alerts=(), gauge=None, outage=None, status=None, now=NOW, **kw):
    return rules.evaluate(alerts=list(alerts) if alerts is not None else None, forecast=None, gauge=gauge, outage=outage,
                          facility_status=status or OK_STATUS, facility=FAC, now=now, **kw)


def ag(r, code):
    return next(a for a in r["agencies"] if a["code"] == code)


def test_operating_day_skips_weekend_and_columbus_day():
    w = rules.operating_window(FAC, NOW)
    assert w["date"] == "2026-10-13" and w["day"] == "Tue"
    assert any("Columbus" in s for s in w["skipped"])


def test_no_hazard_is_open_everywhere():
    r = ev()
    assert r["recommended"] == "OPEN" and not r["action_needed"]
    assert all(a["posture"] == "OPEN" for a in r["agencies"])


def test_same_data_different_tolerance():
    r = ev([alert("Flood Warning")])  # level 2, lasts through Tuesday
    assert r["level"] == 2 and r["recommended"] == "OPEN"
    assert ag(r, "FSA")["posture"] == "UNSCHEDULED_TELEWORK"  # low tolerance acts at 2
    assert ag(r, "NRCS")["posture"] == "OPEN" and ag(r, "NRCS")["field_work"] == "suspended"
    assert r["action_needed"]


def test_tropical_storm_warning_is_severe():
    a = alert("Tropical Storm Warning", "Severe", "Likely", "Expected")
    a["sent"] = (NOW + timedelta(hours=30)).isoformat()  # within 36h of Tuesday commute
    r = ev([a])
    assert r["level"] == 3 and r["recommended"] == "UNSCHEDULED_TELEWORK"
    assert ag(r, "FSA")["posture"] == "CLOSED_TELEWORK"


def test_hurricane_warning_closes_with_telework():
    a = alert("Hurricane Warning", "Extreme", "Likely")
    a["sent"] = (NOW + timedelta(hours=30)).isoformat()
    r = ev([a])
    assert r["recommended"] == "CLOSED_TELEWORK" and r["confidence"] == "HIGH"


def test_stale_tropical_alert_ignored():
    r = ev([alert("Hurricane Warning", "Extreme", "Likely")])  # sent 58h before Tuesday commute → outside 36h
    assert r["level"] == 0


def test_widespread_outage_means_full_closure():
    o = {"customers_out": 60000, "customers_served": 89407, "pct": 67.1, "source": "test", "fetched_at": NOW.isoformat()}
    r = ev(outage=o)
    assert r["level"] == 4 and r["recommended"] == "CLOSED" and not r["telework_possible"]


def test_building_power_out_closes_facility():
    r = ev(status=dict(OK_STATUS, power="out"))
    assert r["recommended"] == "CLOSED_TELEWORK" and not r["facility_usable"]


def test_gauge_moderate_is_severe_with_exceedance():
    g = {"name": "Calcasieu River", "stage_ft": 6.5, "observed_at": NOW.isoformat(), "category": "moderate", "forecast": [],
         "flood_stages_ft": {"action": 4, "minor": 4, "moderate": 6, "major": 8}, "source": "test", "fetched_at": NOW.isoformat()}
    r = ev(gauge=g)
    assert r["level"] == 3 and r["deciding"][0]["exceed_by"] == "+0.5 ft"


def test_nws_failure_never_defaults_open():
    r = ev(alerts=None, data_status={"alerts": "error"})
    assert r["recommended"] != "OPEN" and r["confidence"] == "LOW"


def test_deterministic():
    a = [alert("Flood Warning"), alert("Wind Advisory", "Minor")]
    assert ev(a) == ev(a)


def test_notifications_by_status():
    r = ev([alert("Flood Warning")])
    pkg = notify.build_package(r, FAC)
    emp = {e["name"]: e for e in pkg["employees"]}
    assert not emp["Jerome Batiste"]["notify"] and "leave" in emp["Jerome Batiste"]["reason"]
    assert not emp["Grace Okafor"]["notify"]  # on detail
    assert not emp["Paul Hebert"]["notify"]  # already teleworking
    assert emp["Brian LeBlanc"]["notify"] and "field" in emp["Brian LeBlanc"]["reason"].lower()
    assert emp["Kim Nguyen"]["accessibility_needs"]
    assert "phone" not in emp["Angela Landry"]["channels"]  # deaf → text only
    roles = {x["role"] for x in pkg["roles"]}
    assert {"facility", "agency", "program", "executive"} <= roles
