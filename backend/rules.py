"""Deterministic closure rules. NO LLM here — same inputs always give the same posture.

Every threshold carries a `basis` citing where the cutoff comes from.
"""
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

POSTURES = ["OPEN", "DELAYED_ARRIVAL", "EARLY_DEPARTURE", "UNSCHEDULED_TELEWORK", "CLOSED"]
POSTURE_LABELS = {
    "OPEN": "Open",
    "DELAYED_ARRIVAL": "Open — Delayed Arrival",
    "EARLY_DEPARTURE": "Open — Early Departure",
    "UNSCHEDULED_TELEWORK": "Open — Unscheduled Leave / Telework",
    "CLOSED": "Closed",
}
# OPM Washington, DC-area Dismissal & Closure Procedures operating-status categories
OPM_BASIS = "OPM Dismissal & Closure Procedures — operating status categories"
DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
SEVERITY_RANK = {"Unknown": 0, "Minor": 1, "Moderate": 2, "Severe": 3, "Extreme": 4}
CERTAINTY_CONF = {"Observed": "HIGH", "Likely": "HIGH", "Possible": "MEDIUM", "Unlikely": "LOW", "Unknown": "LOW"}
CONF_ORDER = ["LOW", "MEDIUM", "HIGH"]

# Thresholds (each with its basis) — one place so the UI can show the whole table.
THRESHOLDS = {
    "HU_WARNING": {"desc": "Hurricane Warning in effect for the facility's zone", "posture": "CLOSED",
                   "basis": "NWS: Hurricane Warning = hurricane conditions (sustained winds ≥74 mph) expected within 36 hours"},
    "HU_WATCH": {"desc": "Hurricane / Tropical Storm Watch in effect", "posture": "OPEN", "advance": True,
                 "basis": "NWS: Watch = conditions possible within 48 hours → advance notice, final call later"},
    "TS_WARNING": {"desc": "Tropical Storm Warning overlapping the work day", "posture": "UNSCHEDULED_TELEWORK",
                   "basis": "NWS: Tropical Storm Warning = sustained winds 39–73 mph expected within 36 hours"},
    "SURGE_WARNING": {"desc": "Storm Surge Warning and facility is in a surge zone", "posture": "CLOSED",
                      "basis": "NWS: Storm Surge Warning = life-threatening inundation expected within 36 hours"},
    "FF_EMERGENCY": {"desc": "Flash Flood Emergency", "posture": "CLOSED",
                     "basis": "NWS: Flash Flood Emergency = severe threat to life, catastrophic damage"},
    "FF_WARNING": {"desc": "Flash Flood Warning overlapping commute or work hours", "posture": "DELAYED_ARRIVAL",
                   "basis": "NWS: Flash Flood Warning = flash flooding imminent/occurring; 'Turn Around, Don't Drown'"},
    "GAUGE_MODERATE": {"desc": "Nearby river stage ≥ moderate flood stage", "posture": "CLOSED",
                       "basis": "NWS/NWPS flood categories: moderate = some inundation of structures and roads, evacuations possible"},
    "GAUGE_MINOR": {"desc": "Nearby river stage ≥ minor flood stage", "posture": "UNSCHEDULED_TELEWORK",
                    "basis": "NWS/NWPS flood categories: minor = minimal property damage, some public threat (road closures)"},
    "FLOOD_WARNING": {"desc": "Flood Warning in effect (gauge below flood stage or unavailable)", "posture": "DELAYED_ARRIVAL",
                      "basis": "NWS: Flood Warning = flooding imminent or occurring"},
    "FLOOD_WATCH": {"desc": "Flood / Flash Flood Watch in effect", "posture": "OPEN", "advance": True,
                    "basis": "NWS: Watch = conditions favorable for flooding"},
    "WIND_COMMUTE": {"desc": "Forecast sustained wind ≥ 40 mph during commute window", "posture": "DELAYED_ARRIVAL",
                     "basis": "NWS High Wind Warning criteria: sustained ≥40 mph or gusts ≥58 mph"},
    "TORNADO_WARNING": {"desc": "Tornado Warning — shelter in place (notification urgency, not a posture)", "posture": "OPEN",
                        "shelter": True, "basis": "NWS: Tornado Warning = take shelter now; OPM 'Shelter in Place' category"},
    "GENERIC_EXTREME": {"desc": "Other alert: Extreme severity + Immediate urgency", "posture": "CLOSED",
                        "basis": "CAP v1.2 severity/urgency fields (fallback rule)"},
    "GENERIC_SEVERE": {"desc": "Other alert: Severe severity + Immediate/Expected urgency", "posture": "UNSCHEDULED_TELEWORK",
                       "basis": "CAP v1.2 severity/urgency fields (fallback rule)"},
    "GENERIC_FUTURE": {"desc": "Other alert: Severe/Extreme but Future urgency", "posture": "OPEN", "advance": True,
                       "basis": "CAP v1.2 urgency = Future → advance notice only (fallback rule)"},
    "GENERIC_INFO": {"desc": "Other alert: Moderate or lower severity", "posture": "OPEN",
                     "basis": "CAP v1.2 severity ≤ Moderate → informational (fallback rule)"},
}
# Statements/advisories that never move the posture on their own
INFO_EVENTS = {"Tropical Cyclone Local Statement", "Rip Current Statement", "Beach Hazards Statement",
               "Special Weather Statement", "Hydrologic Outlook", "Small Craft Advisory", "Coastal Flood Statement",
               "High Surf Advisory", "High Surf Warning", "Coastal Flood Advisory"}
MARINE_HINTS = ("Marine", "Small Craft", "Gale", "Storm Warning", "Hurricane Force Wind")


def _t(s):
    return datetime.fromisoformat(s) if s else None


def operating_window(facility: dict, tz: str, now: datetime) -> dict:
    """Which work day is this decision about? Today if before close on an operating day, else the next one."""
    z = ZoneInfo(tz)
    local = now.astimezone(z)
    h0 = time.fromisoformat(facility["hours"]["start"])
    h1 = time.fromisoformat(facility["hours"]["end"])
    day = local.date()
    for _ in range(8):
        dname = DAYS[day.weekday()]
        start = datetime.combine(day, h0, z)
        end = datetime.combine(day, h1, z)
        if dname in facility["operating_days"] and local < end:
            commute = start - timedelta(hours=facility.get("commute_window_hours", 2))
            phase = "before_commute" if local < commute else "commute" if local < start else "work_hours"
            return {"date": day.isoformat(), "day": dname, "start": start, "end": end, "commute_start": commute,
                    "now_phase": phase, "is_today": day == local.date()}
        day += timedelta(days=1)
    raise ValueError("no operating day found")


def _window_overlap(alert: dict, w0: datetime, w1: datetime) -> bool:
    a0 = _t(alert.get("onset")) or _t(alert.get("effective"))
    a1 = _t(alert.get("ends")) or _t(alert.get("expires"))
    return (a0 is None or a0 < w1) and (a1 is None or a1 > w0)


def _tropical_relevant(alert: dict, win: dict, hours: int) -> bool:
    """Tropical Watches/Warnings carry no 'ends' (expires = next update), so use the NWS definition:
    conditions possible (Watch, 48h) / expected (Warning, 36h) from issuance."""
    sent = _t(alert.get("sent")) or _t(alert.get("effective"))
    return sent is None or win["commute_start"] - sent <= timedelta(hours=hours)


def _trig(rule_id, *, observed, threshold, exceed_by, source, at, alert=None, posture=None, note=None):
    th = THRESHOLDS[rule_id]
    return {"rule_id": rule_id, "rule": th["desc"], "posture": posture or th["posture"],
            "observed": observed, "threshold": threshold, "exceed_by": exceed_by,
            "basis": th["basis"], "source": source, "at": at, "alert_id": alert["id"] if alert else None,
            "event": alert["event"] if alert else None, "advance": th.get("advance", False),
            "shelter": th.get("shelter", False), "note": note,
            "certainty": alert["certainty"] if alert else None}


def classify_alert(a: dict, win: dict, loc: dict) -> dict | None:
    ev = a["event"]
    sev, urg = a["severity"], a["urgency"]
    obs = f"{ev} — severity {sev}, certainty {a['certainty']}, urgency {urg}"
    kw = dict(source=a["source"], at=a["fetched_at"], alert=a)
    w0, w1 = win["commute_start"], win["end"]
    if any(h in ev for h in MARINE_HINTS):
        return None
    if ev in INFO_EVENTS:
        return None
    if ev in ("Hurricane Warning", "Tropical Storm Warning", "Storm Surge Warning") and not _tropical_relevant(a, win, 36):
        return None
    if ev in ("Hurricane Watch", "Tropical Storm Watch", "Storm Surge Watch") and not _tropical_relevant(a, win, 48):
        return None
    if ev == "Hurricane Warning":
        return _trig("HU_WARNING", observed=obs, threshold="Any Hurricane Warning for the zone",
                     exceed_by="Warning issued (top of hurricane scale)", **kw)
    if ev in ("Hurricane Watch", "Tropical Storm Watch", "Storm Surge Watch"):
        return _trig("HU_WATCH", observed=obs, threshold="Watch → advance notice",
                     exceed_by="Watch issued; upgrade to Warning would trigger closure", **kw)
    if ev == "Tropical Storm Warning":
        onset = _t(a.get("onset")) or _t(a.get("effective"))
        posture = "EARLY_DEPARTURE" if onset and onset > win["start"] else "UNSCHEDULED_TELEWORK"
        return _trig("TS_WARNING", observed=obs, threshold="Tropical-storm-force winds during commute/work window",
                     exceed_by="Onset during work hours" if posture == "EARLY_DEPARTURE" else "In effect before/through commute",
                     posture=posture, **kw)
    if ev == "Storm Surge Warning":
        if loc.get("in_surge_zone"):
            return _trig("SURGE_WARNING", observed=obs, threshold="Facility inside mapped surge zone",
                         exceed_by="Facility is in surge zone", **kw)
        return None
    if ev == "Flash Flood Warning" and a.get("emergency"):
        return _trig("FF_EMERGENCY", observed=obs + " (EMERGENCY wording)", threshold="Flash Flood Emergency issued",
                     exceed_by="Highest flash-flood tier", **kw)
    if ev == "Flash Flood Warning":
        if not _window_overlap(a, w0, w1):
            return _trig("FF_WARNING", observed=obs, threshold="Must overlap commute/work window",
                         exceed_by="Ends before commute", posture="OPEN", note="Ends before the work day", **kw)
        end = _t(a.get("ends")) or _t(a.get("expires"))
        long = end is None or end > win["start"] + timedelta(hours=3)
        during_work = win["now_phase"] == "work_hours"
        posture = "EARLY_DEPARTURE" if during_work else ("UNSCHEDULED_TELEWORK" if long else "DELAYED_ARRIVAL")
        return _trig("FF_WARNING", observed=obs,
                     threshold="Flash flooding during commute (delay ≤3h) / longer → telework",
                     exceed_by=f"Warning runs until {end.astimezone(win['start'].tzinfo):%a %H:%M}" if end else "Open-ended",
                     posture=posture, **kw)
    if ev in ("Flood Watch", "Flash Flood Watch"):
        if not _window_overlap(a, w0, w1):
            return None
        return _trig("FLOOD_WATCH", observed=obs, threshold="Watch → advance notice",
                     exceed_by="Watch issued; a Warning or rising gauge would change posture", **kw)
    if ev == "Flood Warning":
        if not _window_overlap(a, w0, w1):
            return None
        return _trig("FLOOD_WARNING", observed=obs, threshold="Flood Warning overlapping work day",
                     exceed_by="Warning in effect", **kw)
    if ev == "Tornado Warning":
        return _trig("TORNADO_WARNING", observed=obs, threshold="Any Tornado Warning", exceed_by="Take shelter now", **kw)
    if ev == "Tornado Watch":
        return _trig("GENERIC_FUTURE", observed=obs, threshold="Watch → be ready to shelter",
                     exceed_by="Watch issued", posture="OPEN", **kw)
    # ---- fallback: any other alert, by CAP severity/urgency
    if not _window_overlap(a, w0, w1):
        return None
    r = SEVERITY_RANK.get(sev, 0)
    if r >= 4 and urg == "Immediate":
        return _trig("GENERIC_EXTREME", observed=obs, threshold="severity=Extreme AND urgency=Immediate",
                     exceed_by="Extreme/Immediate", **kw)
    if r >= 3 and urg in ("Immediate", "Expected"):
        return _trig("GENERIC_SEVERE", observed=obs, threshold="severity≥Severe AND urgency∈{Immediate, Expected}",
                     exceed_by=f"{sev}/{urg}", **kw)
    if r >= 3:
        return _trig("GENERIC_FUTURE", observed=obs, threshold="severity≥Severe, urgency Future",
                     exceed_by=f"{sev}/{urg}", **kw)
    return _trig("GENERIC_INFO", observed=obs, threshold="severity≤Moderate", exceed_by="Below action threshold", **kw)


def classify_gauge(g: dict, has_flood_alert: bool) -> dict | None:
    if not g or g.get("stage_ft") is None:
        return None
    st, fs = g["stage_ft"], g["flood_stages_ft"]
    kw = dict(source=g["source"], at=g["fetched_at"])
    obs = f"{g['name']}: {st:.2f} ft (observed {g['observed_at']})"
    if "moderate" in fs and st >= fs["moderate"]:
        return _trig("GAUGE_MODERATE", observed=obs, threshold=f"Moderate flood stage {fs['moderate']} ft",
                     exceed_by=f"+{st - fs['moderate']:.2f} ft above moderate", **kw)
    if "minor" in fs and st >= fs["minor"]:
        return _trig("GAUGE_MINOR", observed=obs, threshold=f"Minor flood stage {fs['minor']} ft",
                     exceed_by=f"+{st - fs['minor']:.2f} ft above minor", **kw)
    return None


def classify_wind(fc: dict, win: dict) -> dict | None:
    if not fc:
        return None
    commute = [p for p in fc["periods"] if win["commute_start"] <= _t(p["start"]) < win["start"]]
    if not commute:
        return None
    peak = max(commute, key=lambda p: p["wind_mph"])
    if peak["wind_mph"] >= 40:
        return _trig("WIND_COMMUTE", observed=f"Peak sustained wind {peak['wind_mph']} mph at {peak['start']}",
                     threshold="Sustained wind ≥ 40 mph during commute", exceed_by=f"+{peak['wind_mph'] - 40} mph",
                     source=fc["source"], at=fc["fetched_at"])
    return None


def _hazard_of(t: dict | None) -> str | None:
    if not t:
        return None
    rid = t["rule_id"]
    if rid in ("HU_WARNING", "HU_WATCH", "TS_WARNING", "SURGE_WARNING", "WIND_COMMUTE"):
        return "hurricane"
    if rid.startswith(("FF_", "FLOOD_", "GAUGE_")):
        return "flood"
    if rid == "TORNADO_WARNING":
        return "tornado"
    return "generic"


def _group_actions(posture: str, hazard: str | None, phase: str, win: dict, shelter: bool) -> dict:
    """Per-group instructions — separate from the facility posture."""
    in_bldg = win["now_phase"] == "work_hours"
    office_group = "in_building" if in_bldg else "commuters"
    acts = {"field": {"urgency": "routine", "action": "No change — continue scheduled field work."},
            office_group: {"urgency": "routine", "action": "Report as normal."}}
    if shelter:
        acts["field"] = {"urgency": "immediate", "action": "Take shelter NOW in the nearest sturdy building or low ground away from vehicles. Check in with your supervisor when safe."}
        acts[office_group] = {"urgency": "immediate", "action": "Move to the interior shelter area (ground floor, no windows) now." if in_bldg else "Do not travel. Shelter where you are until the warning expires."}
        return acts
    if phase == "advance":
        if hazard == "flood":
            acts["field"] = {"urgency": "elevated", "action": "Avoid low-lying sites and stream crossings; plan routes on high ground."}
        else:
            acts["field"] = {"urgency": "elevated", "action": "Plan to finish field work early; secure equipment and vehicles."}
        acts[office_group] = {"urgency": "elevated", "action": "Possible change in operating status — watch for the final decision."}
        return acts
    if posture == "OPEN":
        return acts
    if hazard == "hurricane":
        acts["field"] = {"urgency": "immediate", "action": "Stop field work, secure equipment, and return/head home now while roads are passable."}
        acts[office_group] = ({"urgency": "high", "action": "Leave early as directed; do not wait for conditions to worsen."} if in_bldg else
                              {"urgency": "high", "action": "Do NOT travel to the office."})
    elif hazard == "flood":
        acts["field"] = {"urgency": "high", "action": "Stay away from low-lying areas, creeks and river bottoms; do not drive through water."}
        acts[office_group] = ({"urgency": "high", "action": "Leave only by routes with no low-water crossings; if roads are flooded, stay in the building."} if in_bldg else
                              {"urgency": "immediate", "action": "Do NOT drive through flooded roads — Turn Around, Don't Drown."})
    else:
        acts["field"] = {"urgency": "high", "action": "Suspend field work and return to a safe location."}
        acts[office_group] = {"urgency": "high", "action": "Follow the operating status below."}
    return acts


def evaluate(*, alerts: list[dict] | None, forecast: dict | None, gauge: dict | None,
             facility: dict, loc: dict, now: datetime, last_posture: str | None = None,
             data_status: dict | None = None) -> dict:
    data_status = data_status or {}
    win = operating_window(facility, loc["timezone"], now)
    nws_missing = alerts is None

    triggers, ignored = [], []
    for a in alerts or []:
        t = classify_alert(a, win, loc)
        (triggers if t else ignored).append(t or {"event": a["event"], "reason": "Informational / marine / outside work window"})
    g = classify_gauge(gauge, any(t["event"] and "Flood" in t["event"] for t in triggers))
    if g:
        triggers.append(g)
    w = classify_wind(forecast, win)
    if w:
        triggers.append(w)

    # A Flood Warning paired with a gauge above flood stage → gauge rule decides (more specific)
    if g:
        triggers = [t for t in triggers if t["rule_id"] != "FLOOD_WARNING"] + [
            dict(t, posture="OPEN", note="Superseded by gauge reading") for t in triggers if t["rule_id"] == "FLOOD_WARNING"]

    rank = lambda t: (POSTURES.index(t["posture"]), not t["advance"], t["shelter"])
    triggers.sort(key=rank, reverse=True)
    primary = triggers[0] if triggers else None
    posture = primary["posture"] if primary else "OPEN"
    shelter = any(t["shelter"] for t in triggers)
    advance = posture == "OPEN" and any(t["advance"] for t in triggers)

    # Confidence: from NWS certainty of the deciding alert; degraded by missing data
    if primary and primary.get("certainty"):
        conf = CERTAINTY_CONF.get(primary["certainty"], "LOW")
        conf_reason = f"NWS certainty '{primary['certainty']}' on {primary['event']}"
    elif primary:
        conf, conf_reason = "HIGH", "Direct measurement (" + primary["rule_id"] + ")"
    else:
        conf, conf_reason = "HIGH", "No qualifying alerts; all sources responded"
    degraded = [k for k, v in data_status.items() if v == "error" and k != "nws"]
    if degraded and conf != "LOW":
        conf = CONF_ORDER[CONF_ORDER.index(conf) - 1]
        conf_reason += f"; lowered because {', '.join(degraded)} unavailable"

    needs_review = False
    if nws_missing:
        # Never default to OPEN when we can't see the weather
        needs_review = True
        conf, conf_reason = "LOW", "NWS alerts unavailable — cannot rule out hazards"
        if posture == "OPEN":
            posture = last_posture if last_posture and last_posture != "OPEN" else None

    if posture is None:
        phase = "review"
    elif shelter:
        phase = "shelter"
    elif last_posture and last_posture != "OPEN" and POSTURES.index(posture) < POSTURES.index(last_posture):
        phase = "correction"
    elif advance:
        phase = "advance"
    elif posture != "OPEN":
        phase = "official"
    else:
        phase = "none"

    hazard = _hazard_of(primary)
    return {
        "posture": posture,
        "posture_label": POSTURE_LABELS.get(posture, "No recommendation — manual review required"),
        "needs_review": needs_review,
        "phase": phase,
        "hazard": hazard,
        "confidence": conf,
        "confidence_reason": conf_reason,
        "primary_trigger": primary,
        "triggers": triggers,
        "ignored_alerts": ignored,
        "what_would_change": _what_would_change(posture, primary, triggers, gauge, win),
        "group_actions": _group_actions(posture or "OPEN", hazard, phase, win, shelter),
        "window": {"date": win["date"], "day": win["day"], "start": win["start"].isoformat(),
                   "end": win["end"].isoformat(), "now_phase": win["now_phase"], "is_today": win["is_today"]},
        "opm_basis": OPM_BASIS,
        "last_posture": last_posture,
    }


def _what_would_change(posture, primary, triggers, gauge, win) -> list[str]:
    out = []
    if primary and primary["alert_id"]:
        out.append(f"If the {primary['event']} is cancelled or expires before {win['start']:%a %H:%M}, "
                   f"the recommendation drops to the next-highest trigger"
                   + (f" ({triggers[1]['posture']})." if len(triggers) > 1 else " (OPEN)."))
    if primary and primary["rule_id"] == "HU_WATCH":
        out.append("If the Watch is upgraded to a Hurricane Warning → CLOSED.")
    if primary and primary["rule_id"] == "TS_WARNING":
        out.append("If upgraded to a Hurricane Warning → CLOSED.")
    if primary and primary["rule_id"] in ("FF_WARNING", "FLOOD_WARNING", "FLOOD_WATCH"):
        out.append("If the wording changes to FLASH FLOOD EMERGENCY → CLOSED.")
    if gauge and gauge.get("stage_ft") is not None:
        fs = gauge["flood_stages_ft"]
        for cat, post in (("minor", "UNSCHEDULED_TELEWORK"), ("moderate", "CLOSED")):
            if cat in fs and gauge["stage_ft"] < fs[cat] and POSTURES.index(post) > POSTURES.index(posture or "OPEN"):
                out.append(f"If {gauge['name']} rises {fs[cat] - gauge['stage_ft']:.2f} ft to {cat} flood stage "
                           f"({fs[cat]} ft) → {post}.")
                break
    if not out:
        out.append("A new Warning for the facility's zone, or forecast winds ≥40 mph during the commute, would raise the posture.")
    return out
