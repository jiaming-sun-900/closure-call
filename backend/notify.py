"""Role-based notification package (display only — nothing is sent).

Recipients are chosen by rules; the agent may rewrite the wording of the drafts, never who gets them.
"""
import json
from datetime import date
from pathlib import Path

DATA = Path(__file__).parent / "data"
ON_SITE_POSTURES = ("OPEN", "DELAYED_ARRIVAL", "EARLY_DEPARTURE")
STATUS_LABEL = {"onsite": "Scheduled on site", "teleworking": "Teleworking", "on_detail": "On detail / travel", "leave": "On leave"}


def load_roster() -> list[dict]:
    return json.loads((DATA / "employees.json").read_text())


def _channels(e: dict, urgent: bool) -> list[str]:
    ch = [e["channel"]]
    if urgent and "sms" not in ch:
        ch.insert(0, "sms")
    if "deaf" in (e.get("accessibility_needs") or "").lower():
        ch = [c for c in ch if c != "phone"] or ["sms"]
    return ch


def _employee_action(e: dict, ag: dict, r: dict) -> tuple[bool, str, str]:
    """→ (notify?, reason, what to do)."""
    p, fw, st = ag["posture"], ag["field_work"], e["today_status"]
    if st == "leave":
        return False, "On approved leave — no change for them", ""
    if st == "on_detail":
        return False, "On detail away from this facility — local status does not apply", ""
    if r["shelter"] and st == "onsite":
        return True, "On site during a shelter-in-place warning", "Take shelter now — interior room, lowest floor, away from windows."
    if st == "teleworking":
        if p == "CLOSED":
            return True, "Teleworking, but telework is suspended (facility fully closed)", "Stop work; you are on weather and safety leave."
        return False, "Already teleworking — status change does not affect them", ""
    if e["work_location"] == "field" and fw in ("suspended", "restricted") and p in ON_SITE_POSTURES:
        if fw == "suspended":
            return True, "Field crew — field work suspended", "Do not go to field sites. Do office work, using safe routes only."
        return True, "Field crew — field work restricted", "Avoid low-lying sites and river bottoms; check in with your supervisor before each visit."
    if p == "OPEN":
        return False, "Office open as normal — no action needed", ""
    if p == "DELAYED_ARRIVAL":
        return True, "Scheduled on site — arrival delayed", "Arrive by the delayed start time; avoid flooded roads."
    if p == "EARLY_DEPARTURE":
        return True, "Scheduled on site — early departure", "Leave at the early departure time; do not drive through water."
    if p == "UNSCHEDULED_TELEWORK":
        if e["telework_ready"]:
            return True, "Scheduled on site — unscheduled telework authorized", "Telework from home, or take unscheduled leave. Do not commute through flooded areas."
        return True, "Scheduled on site — not telework-ready", "Take unscheduled leave, or come in only if safe; tell your supervisor."
    if p == "CLOSED_TELEWORK":
        if e["telework_ready"]:
            return True, "Facility closed — telework-ready", "Do not come in. Telework your normal hours."
        if e["essential"]:
            return True, "Facility closed — essential personnel", "Do not come in unless your supervisor calls you in."
        return True, "Facility closed — not telework-ready", "Do not come in. You are on weather and safety leave."
    return True, "Facility closed", "Do not come in. You are on weather and safety leave."


def program_status(prog: dict, ag: dict) -> tuple[str, str]:
    p, fw = ag["posture"], ag["field_work"]
    if prog["needs"] == "field":
        if fw == "suspended" or p not in ON_SITE_POSTURES:
            return "paused", "Field visits rescheduled until field work resumes"
        if fw == "restricted":
            return "limited", "Only sites away from flooded / low-lying areas"
        return "continues", "Normal"
    if prog["needs"] == "customers":
        if p == "OPEN":
            return "continues", "Walk-in service normal"
        if p in ("DELAYED_ARRIVAL", "EARLY_DEPARTURE"):
            return "limited", "Reduced walk-in hours"
        return "paused", "Walk-in customers rescheduled; phone intake only"
    if p == "OPEN":
        return "continues", "Normal"
    if p in ("DELAYED_ARRIVAL", "EARLY_DEPARTURE"):
        return "limited", "Reduced on-site hours"
    if prog["telework_ok"] and p != "CLOSED":
        return "continues", "Continues by telework"
    return "paused", "Paused until the facility reopens"


def build_package(r: dict, facility: dict) -> dict:
    roster = load_roster()
    w = r["window"]
    when = date.fromisoformat(w["date"]).strftime("%A, %b %-d")
    ags = {a["code"]: a for a in r["agencies"]}
    urgent = r["shelter"] or r["level"] >= 3
    sig = r["deciding"][0] if r["deciding"] else None
    why = f"{sig['title']} — {sig['observed']}" if sig else "no hazard above threshold"

    # ---- employees
    employees = []
    for e in roster:
        notify, reason, todo = _employee_action(e, ags[e["agency"]], r)
        employees.append({"id": e["id"], "name": e["name"], "agency": e["agency"], "role": e["role"],
                          "status": e["today_status"], "status_label": STATUS_LABEL[e["today_status"]],
                          "work_location": e["work_location"], "essential": e["essential"],
                          "notify": notify, "reason": reason, "action": todo,
                          "channels": _channels(e, urgent) if notify else [],
                          "accessibility_needs": e.get("accessibility_needs") if notify else None})

    # ---- who can work on the operating day
    avail = {}
    for code, ag in ags.items():
        c = {"on_site": 0, "telework": 0, "unavailable": 0}
        for e in (e for e in roster if e["agency"] == code):
            if e["today_status"] in ("leave", "on_detail"):
                c["unavailable"] += 1
            elif ag["posture"] in ON_SITE_POSTURES and e["today_status"] == "onsite":
                c["on_site"] += 1  # field crews blocked from sites still work from the office
            elif e["telework_ready"] and ag["posture"] != "CLOSED":
                c["telework"] += 1
            else:
                c["unavailable"] += 1
        c["total"] = sum(1 for e in roster if e["agency"] == code)
        avail[code] = c
    tot = {k: sum(v[k] for v in avail.values()) for k in ("on_site", "telework", "unavailable", "total")}

    # ---- programs
    programs = {code: [{"name": p["name"], **dict(zip(("status", "note"), program_status(p, ag)))}
                       for p in facility["agencies"][code].get("programs", [])] for code, ag in ags.items()}
    affected = [p["name"] for ps in programs.values() for p in ps if p["status"] != "continues"]

    # ---- role briefings
    roles = [{
        "role": "facility", "title": "Facility manager", "to": facility["manager"]["name"], "concern": "The building",
        "subject": f"{facility['name']}: {r['recommended_label'] or 'decision needed'}, {when}",
        "body": "\n".join([
            f"Recommended building status for {when}: {r['recommended_label']}.",
            f"Driver: {why}.",
            "Building: " + ("reported unusable — keep closed until inspected." if not r["facility_usable"] else
                           "no damage reported. Re-check power, water, roof and parking-lot flooding before opening."),
            "Prep: move records and IT gear off the floor, clear drains, confirm generator fuel.",
        ]),
    }]
    for code, ag in ags.items():
        mgr = next((e for e in roster if e["agency"] == code and e["essential"]), None)
        staff = [x for x in employees if x["agency"] == code]
        roles.append({
            "role": "agency", "agency": code, "title": f"{code} team manager", "to": mgr["name"] if mgr else code,
            "concern": "Your people",
            "subject": f"{code} staffing for {when}: {ag['label']}",
            "body": "\n".join([
                f"{code}: {ag['label']} — {ag['tolerance']} risk tolerance ({ag['tolerance_note']}).",
                *([f"Field work: {ag['field_work'].upper()}."] if ag["field_work"] else []),
                f"Message {sum(x['notify'] for x in staff)} of {len(staff)} staff; {sum(not x['notify'] for x in staff)} need nothing (reasons listed).",
                f"Availability: {avail[code]['on_site']} on site · {avail[code]['telework']} telework · {avail[code]['unavailable']} unavailable.",
                *[f"Accessibility — {x['name']}: {x['accessibility_needs']}" for x in staff if x["accessibility_needs"]],
            ]),
        })
    for code in ags:
        roles.append({
            "role": "program", "agency": code, "title": f"{code} program manager", "to": f"{code} program leads",
            "concern": "Can the work continue?", "programs": programs[code],
            "subject": f"{code} program continuity, {when}",
            "body": "\n".join(f"{p['name']}: {p['status'].upper()} — {p['note']}" for p in programs[code]),
        })
    roles.append({
        "role": "executive", "title": "Executive summary", "to": "Office of the Secretary (via State Executive Director)",
        "concern": "What's affected · who can work",
        "subject": f"Weather status: {facility['name']}, {facility['parish']}, {when}",
        "body": "\n".join([
            f"BLUF: {r['recommended_label']} on {when}. Hazard {r['level']}/4 ({r['level_label']}), confidence {r['confidence']}.",
            f"Cause: {why}.",
            "Agencies: " + "; ".join(f"{c} {a['label']}" + (f" (field work {a['field_work']})" if a["field_work"] else "") for c, a in ags.items()) + ".",
            f"{w['day']} workforce ({tot['total']}): {tot['on_site']} on site, {tot['telework']} telework, {tot['unavailable']} unavailable.",
            "Affected services: " + (", ".join(affected) if affected else "none") + ".",
        ]),
    })
    n = sum(x["notify"] for x in employees)
    return {"roles": roles, "employees": employees, "programs": programs,
            "availability": {"by_agency": avail, "total": tot, "day": when},
            "summary": f"{n} of {len(employees)} employees to notify · {len(roles)} role briefings"}
