"""Notification package: who is told, who isn't (and why), what each person is told, on which channel.

Deterministic templates — the agent may rewrite the rationale, but recipient selection is rule-based.
"""
import json
from pathlib import Path

DATA = Path(__file__).parent / "data"
STATUS_REASON = {
    "teleworking": "Teleworking today — not commuting or on site",
    "on_detail": "On detail / travel away from this facility",
    "leave": "On approved leave today",
}
URGENCY_RANK = {"immediate": 0, "high": 1, "elevated": 2, "routine": 3}
GROUP_ORDER = {"field": 0, "commuters": 1, "in_building": 1}
PHASE_SUBJECT = {
    "advance": "ADVANCE NOTICE — possible change in operating status",
    "official": "OPERATING STATUS",
    "correction": "CORRECTION — operating status updated",
    "shelter": "SHELTER NOW",
    "review": "Operating status under review",
}


def load_roster() -> list[dict]:
    return json.loads((DATA / "employees.json").read_text())


def _channels(emp: dict, urgency: str) -> list[str]:
    ch = [emp["channel"]]
    if urgency in ("immediate", "high") and "sms" not in ch:
        ch.insert(0, "sms")
    acc = (emp.get("accessibility_needs") or "").lower()
    if "deaf" in acc or "hard of hearing" in acc:
        ch = [c for c in ch if c != "phone"] or ["sms"]
    return ch


def build_package(assessment: dict, facility: dict, loc: dict) -> dict:
    r = assessment["rules"]
    win = r["window"]
    day, date = win["day"], win["date"]
    posture, phase = r["posture"], r["phase"]
    roster = load_roster()
    recipients, excluded = [], []

    if phase == "none":
        for e in roster:
            excluded.append({"employee": _brief(e), "reason": "No notice needed — facility operating normally"})
        return {"recipients": [], "excluded": excluded, "summary": "No notification required.", "phase": phase}

    for e in roster:
        if day not in e["weekly_onsite_days"]:
            onsite = "/".join(e["weekly_onsite_days"])
            excluded.append({"employee": _brief(e), "reason": f"Not scheduled on site {day} (on-site days: {onsite})"})
            continue
        if e["today_status"] in STATUS_REASON:  # status for the operating day being decided
            excluded.append({"employee": _brief(e), "reason": STATUS_REASON[e["today_status"]]})
            continue
        group = "field" if e["work_location"] == "field" else ("in_building" if win["now_phase"] == "work_hours" else "commuters")
        act = r["group_actions"].get(group) or r["group_actions"].get("commuters") or {"urgency": "routine", "action": "Report as normal."}
        urgency = act["urgency"]
        if e["essential"] and posture in ("CLOSED", "UNSCHEDULED_TELEWORK"):
            action = "You are designated essential/emergency personnel: report as directed by your supervisor, using safe routes only. " + act["action"]
            reason = f"Scheduled on site {day}; essential personnel"
        else:
            action = act["action"]
            reason = f"Scheduled on site {day}" + (" (field crew — highest exposure)" if group == "field" else "")
        acc = e.get("accessibility_needs")
        recipients.append({
            "employee": _brief(e),
            "group": group,
            "urgency": urgency,
            "channels": _channels(e, urgency),
            "reason": reason,
            "message": _message(e, facility, loc, r, action, acc),
            "accessibility_note": acc,
        })
    recipients.sort(key=lambda x: (URGENCY_RANK[x["urgency"]], GROUP_ORDER.get(x["group"], 2), x["employee"]["name"]))
    for i, x in enumerate(recipients, 1):
        x["order"] = i
    return {
        "recipients": recipients,
        "excluded": excluded,
        "phase": phase,
        "summary": f"{len(recipients)} to notify, {len(excluded)} excluded — {PHASE_SUBJECT.get(phase, 'Notice')}",
    }


def _brief(e: dict) -> dict:
    return {k: e[k] for k in ("id", "name", "role", "work_location", "essential")}


def _message(e, facility, loc, r, action, acc) -> dict:
    win = r["window"]
    when = f"{win['day']} {win['date']}"
    subject = f"[{facility['name']} — {loc['label']}] {PHASE_SUBJECT.get(r['phase'], 'Notice')}: {r['posture_label']}"
    trig = r["primary_trigger"]
    why = f"Reason: {trig['event'] or trig['rule']}." if trig else ""
    lines = [
        f"Hi {e['name'].split()[0]},",
        f"Does this apply to you? YES — you are scheduled on site {when}.",
    ]
    if r["phase"] == "advance":
        lines.append(f"The facility is OPEN for now, but {why[8:-1] or 'a weather watch'} may change that. "
                     "A final decision will be sent by 05:00 local time before the next work day.")
    elif r["phase"] == "correction":
        from rules import POSTURE_LABELS
        lines.append(f"UPDATE: the earlier notice ({POSTURE_LABELS.get(r.get('last_posture'), r.get('last_posture'))}) is withdrawn. Operating status for {when}: {r['posture_label']}.")
    elif r["phase"] == "review":
        lines.append("Weather data is temporarily unavailable. Management is reviewing; do not travel if conditions look unsafe.")
    else:
        lines.append(f"Operating status for {when}: {r['posture_label']}. {why}")
    lines.append(f"What you should do: {action}")
    if acc:
        lines.append(f"Accessibility: we have noted your needs ({acc}). Your supervisor will contact you directly to arrange a safe plan.")
    lines.append(f"— {facility['manager']['name']}, {facility['manager']['title']}")
    return {"subject": subject, "body": "\n".join(lines)}
