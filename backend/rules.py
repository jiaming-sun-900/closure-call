"""Deterministic closure rules. NO LLM here — same inputs always give the same recommendation.

Two steps:
 1. Every input (NWS alert, forecast, river gauge, power outage, facility status) becomes a *signal* with a
    hazard level 0–4, the threshold it crossed, by how much, and the basis for that cutoff.
 2. Each agency maps the same hazard level to an operating posture using its OWN risk tolerance.
"""
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

LEVELS = ["None", "Watch", "Elevated", "Severe", "Extreme"]
POSTURES = ["OPEN", "DELAYED_ARRIVAL", "EARLY_DEPARTURE", "UNSCHEDULED_TELEWORK", "CLOSED_TELEWORK", "CLOSED"]
POSTURE_LABELS = {
    "OPEN": "Open",
    "DELAYED_ARRIVAL": "Delayed arrival",
    "EARLY_DEPARTURE": "Early departure",
    "UNSCHEDULED_TELEWORK": "Unscheduled leave / telework",
    "CLOSED_TELEWORK": "Facility closed — telework continues",
    "CLOSED": "Closed",
}
OPM_BASIS = "OPM Dismissal & Closure Procedures — operating status categories"
DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
SEVERITY_RANK = {"Unknown": 0, "Minor": 1, "Moderate": 2, "Severe": 3, "Extreme": 4}
CERTAINTY_CONF = {"Observed": "HIGH", "Likely": "HIGH", "Possible": "MEDIUM", "Unlikely": "LOW", "Unknown": "LOW"}
CONF_ORDER = ["LOW", "MEDIUM", "HIGH"]

# NWS event → (hazard level, basis). Tropical products carry no 'ends', so they use the 36/48h NWS definitions.
EVENT_LEVELS = {
    "Hurricane Warning": (4, "NWS: hurricane conditions (winds ≥74 mph) expected within 36 h"),
    "Storm Surge Warning": (4, "NWS: life-threatening inundation expected within 36 h (applies if facility is in surge zone)"),
    "Extreme Wind Warning": (4, "NWS: extreme sustained winds ≥115 mph imminent"),
    "Tropical Storm Warning": (3, "NWS: tropical-storm winds 39–73 mph expected within 36 h"),
    "High Wind Warning": (3, "NWS: sustained ≥40 mph or gusts ≥58 mph"),
    "Flash Flood Warning": (3, "NWS: flash flooding imminent or occurring — 'Turn Around, Don't Drown'"),
    "Flood Warning": (2, "NWS: flooding imminent or occurring (river/areal)"),
    "Wind Advisory": (1, "NWS: sustained 31–39 mph or gusts 46–57 mph"),
    "Hurricane Watch": (1, "NWS: hurricane conditions possible within 48 h → advance notice"),
    "Tropical Storm Watch": (1, "NWS: tropical-storm conditions possible within 48 h → advance notice"),
    "Storm Surge Watch": (1, "NWS: life-threatening inundation possible within 48 h → advance notice"),
    "Flood Watch": (1, "NWS: conditions favorable for flooding → advance notice"),
    "Flash Flood Watch": (1, "NWS: conditions favorable for flash flooding → advance notice"),
    "Tornado Watch": (1, "NWS/SPC: tornadoes possible → be ready to shelter"),
}
TROPICAL = {"Hurricane Warning": 36, "Tropical Storm Warning": 36, "Storm Surge Warning": 36,
            "Hurricane Watch": 48, "Tropical Storm Watch": 48, "Storm Surge Watch": 48}
INFO_EVENTS = {"Tropical Cyclone Local Statement", "Rip Current Statement", "Beach Hazards Statement",
               "Special Weather Statement", "Hydrologic Outlook", "Coastal Flood Statement", "Air Quality Alert"}
MARINE_HINTS = ("Marine", "Small Craft", "Gale", "Hurricane Force Wind", "Brisk Wind", "Hazardous Seas")

GAUGE_LEVELS = [("major", 4), ("moderate", 3), ("minor", 2), ("action", 1)]
GAUGE_BASIS = "NWS/NWPS flood categories: action → minor (roads) → moderate (structures, evacuations) → major"
# Share of parish electric customers without power
OUTAGE_LEVELS = [(50, 4), (25, 3), (10, 2), (3, 1)]
OUTAGE_BASIS = "Utility outage share: ≥10% indicates multi-day restoration; ≥50% telework generally impossible"
WIND_LEVELS = [(58, 4), (40, 3), (31, 2), (25, 1)]
WIND_BASIS = "NWS Wind Advisory (31–39 mph) / High Wind Warning (≥40 mph sustained) criteria"


def _t(s):
    return datetime.fromisoformat(s) if s else None


# ------------------------------------------------------------------ operating day
def closed_reason(facility: dict, day: date) -> str | None:
    holidays = {date.fromisoformat(d): n for d, n in facility.get("holidays", {}).items()}
    if day in holidays:
        return holidays[day].replace(" (federal holiday)", "")
    if DAYS[day.weekday()] not in facility["operating_days"]:
        return "Weekend"
    return None


def operating_window(facility: dict, now: datetime, target: str | None = None) -> dict:
    """The work day this decision is about: today if before close on an operating day, else the next one
    (skipping weekends and federal holidays). `target` (YYYY-MM-DD) picks a specific day instead."""
    z = ZoneInfo(facility["timezone"])
    local = now.astimezone(z)
    h0, h1 = (time.fromisoformat(facility["hours"][k]) for k in ("start", "end"))
    holidays = {date.fromisoformat(d): n for d, n in facility.get("holidays", {}).items()}
    if target:
        day = date.fromisoformat(target)
        start, end = datetime.combine(day, h0, z), datetime.combine(day, h1, z)
        commute = start - timedelta(hours=facility.get("commute_window_hours", 2))
        phase = "before_commute" if local < commute else "commute" if local < start else "work_hours"
        return {"date": day.isoformat(), "day": DAYS[day.weekday()], "start": start, "end": end, "commute_start": commute,
                "now_phase": phase, "is_today": day == local.date(), "skipped": [], "chosen": True,
                "closed": closed_reason(facility, day)}
    day, skipped = local.date(), []
    for _ in range(10):
        start, end = datetime.combine(day, h0, z), datetime.combine(day, h1, z)
        dname = DAYS[day.weekday()]
        if dname in facility["operating_days"] and day not in holidays and local < end:
            commute = start - timedelta(hours=facility.get("commute_window_hours", 2))
            phase = "before_commute" if local < commute else "commute" if local < start else "work_hours"
            return {"date": day.isoformat(), "day": dname, "start": start, "end": end, "commute_start": commute,
                    "now_phase": phase, "is_today": day == local.date(), "skipped": skipped}
        if day in holidays:
            skipped.append(f"{dname} {day.isoformat()}: {holidays[day]}")
        day += timedelta(days=1)
    raise ValueError("no operating day found")


def _overlaps(s0, s1, w0, w1) -> bool:
    return (s0 is None or s0 < w1) and (s1 is None or s1 > w0)


def _sig(kind, level, *, title, observed, threshold, exceed_by, basis, source, at, start=None, end=None,
         certainty=None, shelter=False, alert_id=None):
    return {"kind": kind, "level": level, "level_label": LEVELS[level], "title": title, "observed": observed,
            "threshold": threshold, "exceed_by": exceed_by, "basis": basis, "source": source, "at": at,
            "start": start.isoformat() if start else None, "end": end.isoformat() if end else None,
            "certainty": certainty, "shelter": shelter, "alert_id": alert_id}


# ------------------------------------------------------------------ signals
def alert_signal(a: dict, win: dict, fac: dict) -> dict | None:
    ev = a["event"]
    if ev in INFO_EVENTS or any(h in ev for h in MARINE_HINTS):
        return None
    start = _t(a.get("onset")) or _t(a.get("effective"))
    end = _t(a.get("ends")) or _t(a.get("expires"))
    w0, w1 = win["commute_start"], win["end"]
    if ev in TROPICAL:
        sent = _t(a.get("sent")) or start
        if sent and w0 - sent > timedelta(hours=TROPICAL[ev]):
            return None
        end = None  # tropical products persist until cancelled
    elif not _overlaps(start, end, w0, w1):
        return None
    obs = f"{a.get('where') or a.get('area', '')} — {a['severity']} · {a['certainty']} · {a['urgency']}"
    if a.get("scope") == "parish":
        obs += " (parish-wide alert; affects commutes)"
    common = dict(source=a["source"], at=a["fetched_at"], start=start, end=end, certainty=a["certainty"], alert_id=a["id"])
    if ev == "Tornado Warning":
        return _sig("nws", 4, title=ev, observed=obs, threshold="Any Tornado Warning", exceed_by="Shelter now",
                    basis="NWS: take shelter immediately; OPM 'Shelter in Place'", shelter=True, **common)
    if ev == "Flash Flood Warning" and a.get("emergency"):
        return _sig("nws", 4, title="Flash Flood EMERGENCY", observed=obs, threshold="Emergency wording",
                    exceed_by="Highest flash-flood tier", basis="NWS: severe threat to human life", **common)
    if ev == "Storm Surge Warning" and not fac.get("in_surge_zone"):
        return _sig("nws", 2, title=ev, observed=obs + " (facility outside surge zone)", threshold="Facility in surge zone",
                    exceed_by="Not in zone — commute routes may flood", basis=EVENT_LEVELS[ev][1], **common)
    if ev in EVENT_LEVELS:
        lvl, basis = EVENT_LEVELS[ev]
        until = f"until {end.astimezone(win['start'].tzinfo):%a %-I:%M %p}" if end else "until cancelled"
        return _sig("nws", lvl, title=ev, observed=obs, threshold=f"{ev} covering the work day",
                    exceed_by=f"In effect {until}", basis=basis, **common)
    # fallback for any other alert: CAP severity × urgency
    r = SEVERITY_RANK.get(a["severity"], 0)
    lvl = 4 if r >= 4 and a["urgency"] == "Immediate" else 3 if r >= 3 and a["urgency"] in ("Immediate", "Expected") else 1 if r >= 3 else 0
    if lvl == 0:
        return None
    return _sig("nws", lvl, title=ev, observed=obs, threshold="CAP severity × urgency (fallback rule)",
                exceed_by=f"{a['severity']}/{a['urgency']}", basis="CAP v1.2 severity/urgency fields", **common)


def gauge_signal(g: dict | None, win: dict) -> dict | None:
    if not g or g.get("stage_ft") is None:
        return None
    fs = g["flood_stages_ft"]
    # use the NWS forecast stage at the start of the work day when one exists
    fc = [p for p in g.get("forecast", []) if _t(p["t"]) <= win["start"]]
    if fc:
        stage, when = fc[-1]["ft"], f"forecast for {win['day']} {win['start']:%-I %p}"
    else:
        stage, when = g["stage_ft"], "observed"
    for cat, lvl in GAUGE_LEVELS:
        if cat in fs and stage >= fs[cat]:
            return _sig("gauge", lvl, title=f"River at {cat} flood stage", observed=f"{g['name']}: {stage:.1f} ft ({when})",
                        threshold=f"{cat.title()} flood stage {fs[cat]} ft", exceed_by=f"+{stage - fs[cat]:.1f} ft",
                        basis=GAUGE_BASIS, source=g["source"], at=g["fetched_at"])
    return None


def wind_signal(fc: dict | None, win: dict) -> dict | None:
    if not fc:
        return None
    ps = [p for p in fc["periods"] if win["commute_start"] <= _t(p["start"]) < win["end"]]
    if not ps:
        return None
    peak = max(ps, key=lambda p: p["wind_mph"])
    for mph, lvl in WIND_LEVELS:
        if peak["wind_mph"] >= mph:
            return _sig("wind", lvl, title="Forecast wind during work day", observed=f"{peak['wind_mph']} mph at {_t(peak['start']):%a %-I %p}",
                        threshold=f"≥{mph} mph", exceed_by=f"+{peak['wind_mph'] - mph} mph", basis=WIND_BASIS,
                        source=fc["source"], at=fc["fetched_at"], start=_t(peak["start"]), end=_t(peak["end"]))
    return None


def outage_signal(o: dict | None) -> dict | None:
    if not o or o.get("pct") is None:
        return None
    for pct, lvl in OUTAGE_LEVELS:
        if o["pct"] >= pct:
            return _sig("power", lvl, title="Parish power outages", observed=f"{o['customers_out']:,} of {o['customers_served']:,} customers out ({o['pct']:.1f}%)",
                        threshold=f"≥{pct}% of customers", exceed_by=f"+{o['pct'] - pct:.1f} pts", basis=OUTAGE_BASIS,
                        source=o["source"], at=o["fetched_at"])
    return None


def road_signal(rd: dict | None) -> dict | None:
    if not rd:
        return None
    n = rd.get("weather_related_closures", 0)
    if n == 0:
        return None
    lvl = 3 if n >= 3 else 2
    return _sig("roads", lvl, title="Weather-related road closures", observed=f"{n} full closure(s) within {rd['radius_mi']} mi",
                threshold="≥1 weather closure → Elevated; ≥3 → Severe", exceed_by=f"{n} closure(s)",
                basis="LA DOTD 511 closures; NWS 'Turn Around, Don't Drown'", source=rd["source"], at=rd["fetched_at"])


def facility_signals(st: dict | None) -> list[dict]:
    """Building manager's manual report — the ground truth no API has."""
    if not st:
        return []
    out, src, at = [], f"Facility status report by {st.get('updated_by', 'facility manager')}", st.get("updated_at")
    if st.get("power") == "out":
        out.append(_sig("facility", 4, title="Building has no power", observed="Power: out", threshold="Building systems unusable",
                        exceed_by="Facility unusable", basis="Facility cannot safely operate without power", source=src, at=at))
    if st.get("water") == "out":
        out.append(_sig("facility", 4, title="Building has no water", observed="Water: out", threshold="No potable water / restrooms",
                        exceed_by="Facility unusable", basis="OSHA 29 CFR 1910.141 sanitation requirements", source=src, at=at))
    if st.get("roof") == "damaged":
        out.append(_sig("facility", 4, title="Roof damage", observed="Roof: damaged", threshold="Structural safety",
                        exceed_by="Facility unusable", basis="Do not occupy until inspected", source=src, at=at))
    if st.get("roads") in ("limited", "impassable"):
        lvl = 3 if st["roads"] == "impassable" else 2
        out.append(_sig("roads", lvl, title=f"Roads {st['roads']}", observed=f"Access roads: {st['roads']}", threshold="Safe commute",
                        exceed_by="No safe access" if lvl == 3 else "Detours / partial flooding",
                        basis="LA DOTD road status; NWS 'Turn Around, Don't Drown'", source=src, at=at))
    return out


# ------------------------------------------------------------------ postures
def _timed(w: dict, sigs: list[dict]) -> tuple[str, str]:
    """Pick delayed / early / full-day based on when the hazard overlaps the work day."""
    starts = [_t(s["start"]) for s in sigs if s["start"]]
    ends = [_t(s["end"]) for s in sigs if s["end"]]
    s0 = min(starts) if len(starts) == len(sigs) and starts else None
    s1 = max(ends) if len(ends) == len(sigs) and ends else None
    tz = w["start"].tzinfo
    if s1 is not None and s1 <= w["start"] + timedelta(hours=3):
        return "DELAYED_ARRIVAL", f"hazard ends {s1.astimezone(tz):%-I:%M %p}, within 3 h of opening"
    if s0 is not None and s0 >= w["start"] + timedelta(hours=1):
        return "EARLY_DEPARTURE", f"hazard begins {s0.astimezone(tz):%-I:%M %p}, during work hours"
    return "UNSCHEDULED_TELEWORK", "hazard covers the commute and most of the work day"


def posture_for(profile: dict, level: int, w: dict, sigs: list[dict], facility_usable: bool, telework_possible: bool) -> tuple[str, str]:
    """Map hazard level → posture with an agency-specific tolerance profile."""
    th = profile["thresholds"]
    if not facility_usable:
        return ("CLOSED_TELEWORK" if telework_possible else "CLOSED"), "building reported unusable"
    if level >= th["close"]:
        return ("CLOSED_TELEWORK" if telework_possible else "CLOSED"), f"hazard level {level} ≥ close threshold {th['close']}"
    if level >= th["adjust"]:
        p, why = _timed(w, [s for s in sigs if s["level"] >= th["adjust"]])
        return p, f"hazard level {level} ≥ adjust threshold {th['adjust']}; {why}"
    return "OPEN", f"hazard level {level} below adjust threshold {th['adjust']}"


def field_status(profile: dict, level: int) -> str | None:
    if not profile.get("field_staff"):
        return None
    fth = profile["thresholds"].get("field_suspend", 2)
    return "suspended" if level >= fth else "restricted" if level >= fth - 1 else "normal"


# ------------------------------------------------------------------ main entry
def evaluate(*, alerts, forecast, gauge, outage, facility_status, facility: dict, now: datetime, roads=None,
             data_status: dict | None = None, last_posture: str | None = None, target_date: str | None = None) -> dict:
    data_status = data_status or {}
    w = operating_window(facility, now, target_date)
    sigs, ignored = [], []
    for a in alerts or []:
        s = alert_signal(a, w, facility)
        (sigs.append(s) if s else ignored.append(a["event"]))
    for s in (gauge_signal(gauge, w), wind_signal(forecast, w), outage_signal(outage), road_signal(roads)):
        if s:
            sigs.append(s)
    sigs += facility_signals(facility_status)
    sigs.sort(key=lambda s: s["level"], reverse=True)

    level = sigs[0]["level"] if sigs else 0
    deciding = [s for s in sigs if s["level"] == level and level > 0]
    shelter = any(s["shelter"] for s in sigs)
    facility_usable = not any(s["kind"] == "facility" for s in sigs)
    telework_possible = not (outage and (outage.get("pct") or 0) >= 50)
    nws_missing = alerts is None

    # confidence: NWS certainty of the deciding alert, lowered when inputs are missing
    certs = [s["certainty"] for s in deciding if s["certainty"]]
    if nws_missing:
        conf, conf_reason = "LOW", "NWS alerts unavailable — hazards cannot be ruled out"
    elif certs:
        conf = max((CERTAINTY_CONF.get(c, "LOW") for c in certs), key=CONF_ORDER.index)
        conf_reason = f"NWS certainty '{certs[0]}' on {deciding[0]['title']}"
    elif deciding:
        conf, conf_reason = "HIGH", f"Direct observation ({deciding[0]['title']})"
    else:
        conf, conf_reason = "HIGH", "All sources responded; nothing crossed a threshold"
    missing = [k for k, v in data_status.items() if v == "error" and k != "nws"]
    if missing and conf != "LOW":
        conf = CONF_ORDER[CONF_ORDER.index(conf) - 1]
        conf_reason += f"; lowered — {', '.join(missing)} unavailable"

    building_profile = facility["building_profile"]
    b_posture, b_why = posture_for(building_profile, level, w, sigs, facility_usable, telework_possible)
    if nws_missing and b_posture == "OPEN":
        b_posture = last_posture if last_posture and last_posture != "OPEN" else None
        b_why = "NWS data missing — the system never defaults to Open"

    agencies = []
    for code, prof in facility["agencies"].items():
        p, why = posture_for(prof, level, w, sigs, facility_usable, telework_possible)
        if b_posture and POSTURES.index(p) < POSTURES.index(b_posture):
            p, why = b_posture, why + "; raised to match building status"
        agencies.append({"code": code, "name": prof["name"], "tolerance": prof["tolerance"], "posture": p,
                         "label": POSTURE_LABELS[p], "why": why, "thresholds": prof["thresholds"],
                         "field_work": field_status(prof, level), "tolerance_note": prof["tolerance_note"]})

    advance = any(s["title"].endswith("Watch") for s in sigs)
    action_needed = (b_posture != "OPEN" or shelter or
                     any(a["posture"] != "OPEN" or a["field_work"] in ("restricted", "suspended") for a in agencies))
    when = f"{w['day']} {w['start']:%b %-d}"
    if b_posture is None:
        headline = "Decision needed — weather data unavailable"
    elif shelter:
        headline = "Action needed now — shelter in place"
    elif action_needed:
        headline = f"Action needed for {when}"
    elif advance:
        headline = f"No change yet — watch in effect for {when}"
    else:
        headline = f"No action needed for {when}"

    return {
        "action_needed": action_needed,
        "headline": headline,
        "level": level, "level_label": LEVELS[level],
        "recommended": b_posture,
        "recommended_label": POSTURE_LABELS.get(b_posture, "Manual decision required"),
        "recommended_why": b_why,
        "agencies": agencies,
        "signals": sigs,
        "deciding": deciding,
        "ignored_alerts": ignored,
        "shelter": shelter, "advance": advance,
        "facility_usable": facility_usable, "telework_possible": telework_possible,
        "confidence": conf, "confidence_reason": conf_reason,
        "what_would_change": what_would_change(level, sigs, gauge, w, building_profile),
        "window": {"date": w["date"], "day": w["day"], "start": w["start"].isoformat(), "end": w["end"].isoformat(),
                   "now_phase": w["now_phase"], "is_today": w["is_today"], "skipped": w["skipped"],
                   "chosen": w.get("chosen", False), "closed": w.get("closed")},
        "options": [{"key": k, "label": v, "recommended": k == b_posture} for k, v in POSTURE_LABELS.items()],
        "opm_basis": OPM_BASIS,
        "last_posture": last_posture,
    }


def what_would_change(level, sigs, gauge, w, prof) -> list[str]:
    out = []
    th = prof["thresholds"]
    top = sigs[0] if sigs else None
    if top and level > 0:
        same = [s for s in sigs if s["level"] == level]
        lower = next((s for s in sigs if s["level"] < level), None)
        names = ", ".join(sorted({s["title"] for s in same}))
        out.append(f"If {'all ' + str(len(same)) + ' level-' + str(level) + ' inputs' if len(same) > 1 else 'the ' + names} "
                   f"clear before {w['start']:%a %-I %p} ({names}), the hazard drops to {lower['level_label'] if lower else 'None'}.")
    if gauge and gauge.get("stage_ft") is not None:
        fs = gauge["flood_stages_ft"]
        for cat, lvl in sorted(GAUGE_LEVELS, key=lambda x: x[1]):
            if cat in fs and lvl > level:
                out.append(f"If {gauge['name']} reaches {cat} flood stage ({fs[cat]} ft; now {gauge['stage_ft']:.1f} ft) "
                           f"→ level {lvl} ({LEVELS[lvl]}).")
                break
    if level < th["close"]:
        out.append("A Tropical Storm / Hurricane Warning, ≥25% parish outages, or loss of building power would close the facility.")
    return out[:4]
