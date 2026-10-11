# Closure Call 🍃

**Hack Midwest 2026 · USDA AI Challenge "Closure Call" · Best Use of Strands Agents SDK · Akamai Cloud AI Challenge**

### Live demo: **https://172-236-110-231.ip.linodeusercontent.com**
Runs on Akamai Cloud (Linode, Chicago) with HTTPS. No login. Live NWS data.

Built by Jiaming Sun and Zoe at Hack Midwest 2026.

Severe weather is coming. Should the USDA Lake Charles Service Center (Calcasieu Parish, LA) open tomorrow, and who needs to be told what?

Closure Call gives the facility manager a **fast, consistent recommendation with a clear record of evidence**. Rules decide the level. AI writes the words. A human makes the call.

## What it does
- **Live data, every value with source and timestamp**: NWS alerts and hourly forecast (api.weather.gov), river stage and NWS flood forecast (NOAA NWPS), Entergy Louisiana outages by parish, Louisiana 511 road closures, plus the building manager's manual check (power, water, roof, roads).
- **Deterministic rules** (`backend/rules.py`): every input becomes a hazard level 0 to 4 with the threshold crossed, by how much, and the basis (NWS product definitions, NWPS flood categories, OPM operating status categories). Same inputs, same answer. If NWS is down, it never defaults to Open.
- **Per-agency recommendations**: same data, different risk tolerance. FSA (walk-in customer office, low tolerance) and NRCS (field-heavy, stops field work early) get their own posture.
- **Next operating day aware**: skips weekends and federal holidays (Columbus Day → Tuesday).
- **Role-based notifications** (drafts only): facility manager, agency team managers, program managers, executive summary; every employee is listed with notify or skip and why, grouped by today's status.
- **Human decision with evidence**: pick an OPM option or write your own, a reason is required, and the full data snapshot is saved to an append-only decision record.

## Strands Agents SDK
`backend/agent.py` builds a Strands `Agent` (Anthropic Claude Haiku 5.5) with 9 tools: `get_nws_alerts`, `get_forecast`, `get_river_gauge`, `get_power_outages`, `get_road_closures`, `get_facility_status`, `get_roster`, `evaluate_rules`, `draft_notifications`.
The agent gathers data (data tools in parallel), calls the rules engine, then writes the rationale and role drafts via structured output.
**Guardrail**: the posture comes only from the `evaluate_rules` tool result captured server-side; the agent cannot change it. If no key is set or the model fails, the same tools run directly and templates write the text. Agent results are cached by an input fingerprint so unchanged data never triggers a new model call.

## Hazard types
Two hazard types handled in depth: **hurricane and wind** (tropical watches/warnings, high wind, forecast wind) and **flooding** (flood and flash flood alerts, Calcasieu River flood stages). Any other NWS alert goes through a CAP severity × urgency fallback rule. Power, roads and building checks are impact signals.

## Deployment (Akamai Cloud)
FastAPI serves the API and the built frontend from one origin behind Caddy (automatic HTTPS) on a Linode Nanode in Chicago. See `deploy/`.

## Run locally
```bash
# backend
cd backend && uv venv .venv && uv pip install --python .venv/bin/python fastapi "uvicorn[standard]" httpx pytest python-dotenv "strands-agents[anthropic]"
.venv/bin/uvicorn main:app --port 8000
# frontend
cd frontend && npm install && npm run dev   # http://localhost:5173
```
Add your Anthropic key on the ⚙️ Settings page (localhost only, stored in `.env`, never committed), or copy `.env.example` to `.env`.
Tests: `cd backend && .venv/bin/python -m pytest -q`

## Data sources
- National Weather Service API: https://www.weather.gov/documentation/services-web-api
- NOAA National Water Prediction Service: https://water.noaa.gov
- USDA Service Center Locator (facility, agencies): https://www.farmers.gov/working-with-us/service-center-locator
- Entergy Louisiana outage map data
- Louisiana 511: https://www.511la.org

Employees are synthetic. Office hours (8:00 to 4:30) are assumed.
