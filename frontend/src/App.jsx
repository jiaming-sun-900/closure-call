import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api'
import './App.css'

const LEVEL_NAMES = ['None', 'Watch', 'Elevated', 'Severe', 'Extreme']
const POSTURE_SEV = { OPEN: 0, DELAYED_ARRIVAL: 1, EARLY_DEPARTURE: 2, UNSCHEDULED_TELEWORK: 2, CLOSED_TELEWORK: 3, CLOSED: 4 }
const QS = new URLSearchParams(window.location.search)

const fmt = (iso, opts = {}) =>
  iso ? new Date(iso).toLocaleString('en-US', { timeZone: 'America/Chicago', weekday: 'short', hour: 'numeric', minute: '2-digit', ...opts }) : '—'
const ago = (iso) => {
  if (!iso) return '—'
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000)
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : fmt(iso)
}
const lv = (n) => `lv${Math.max(0, Math.min(4, n ?? 0))}`

export default function App() {
  const [view, setView] = useState(QS.get('view') || 'dash')
  const [facility, setFacility] = useState(null)
  const [a, setA] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [simulate, setSimulate] = useState(null)
  const [chosen, setChosen] = useState(null)
  const decisionRef = useRef(null)
  const reqId = useRef(0)

  const run = useCallback(async (sim = simulate) => {
    const id = ++reqId.current
    setLoading(true)
    setError(null)
    try {
      const res = await api.assess({ simulate: sim })
      if (id === reqId.current) { setA(res); setChosen(res.rules.recommended) }
    } catch (e) {
      if (id === reqId.current) setError(e.message)
    } finally {
      if (id === reqId.current) setLoading(false)
    }
  }, [simulate])

  useEffect(() => {
    api.facility().then(setFacility).catch((e) => setError('Backend unreachable — ' + e.message))
    run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pick = (key) => {
    setChosen(key)
    decisionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <div className="mark">CC</div>
          <div>
            <div className="name">Closure Call</div>
            <div className="sub">{facility?.name || 'USDA Service Center'} · {facility?.parish}</div>
          </div>
        </div>
        <nav className="views">
          <button className={view === 'dash' ? 'on' : ''} onClick={() => setView('dash')}>Dashboard</button>
          <button className={view === 'records' ? 'on' : ''} onClick={() => setView('records')}>Decision record</button>
        </nav>
        <div className="actions">
          <select value={simulate || ''} onChange={(e) => { const v = e.target.value || null; setSimulate(v); run(v) }} title="Test scenarios">
            <option value="">Live data</option>
            <option value="nws_down">Test: NWS outage</option>
          </select>
          <button className="btn" onClick={() => run()} disabled={loading}>{loading ? 'Assessing…' : '↻ Re-assess'}</button>
        </div>
      </header>

      {error && <div className="err">⚠ {error}</div>}

      {view === 'records' ? <Records /> : !a ? (
        <div className="boot"><div className="spinner" />Pulling NWS, river, Entergy and LA 511 data…<br /><small>The agent is gathering evidence</small></div>
      ) : (
        <main className={loading ? 'busy' : ''}>
          <Bluf a={a} chosen={chosen} onPick={pick} />
          <Why a={a} />
          <DataCards a={a} onStatusSaved={() => run()} />
          <Agencies a={a} facility={facility} />
          <Notifications a={a} />
          <div ref={decisionRef}><Decision a={a} chosen={chosen} setChosen={setChosen} /></div>
          <Trace a={a} />
        </main>
      )}
    </div>
  )
}

/* ---------------- BLUF ---------------- */
function Bluf({ a, chosen, onPick }) {
  const r = a.rules
  const [copied, setCopied] = useState(false)
  return (
    <section className={`bluf ${lv(r.level)}`}>
      <div className="bluf-top">
        <div>
          <div className={`headline ${r.action_needed ? 'act' : ''}`}>{r.headline}</div>
          <div className="bluf-sum">
            Building {r.recommended_label.toLowerCase()}
            {r.agencies.map((g) => <span key={g.code}> · <b>{g.code}</b> {g.label.toLowerCase()}{g.field_work && g.field_work !== 'normal' ? `, field work ${g.field_work}` : ''}</span>)}
          </div>
          <div className="bluf-meta">
            <span className={`pill ${lv(r.level)}`}>Hazard {r.level}/4 · {r.level_label}</span>
            <span className="pill">Confidence {r.confidence}</span>
            {r.window.skipped.map((s) => <span key={s} className="pill ghost">{s.split(': ')[0].split(' ')[0]} skipped · {s.split(': ')[1].replace(' (federal holiday)', '')}</span>)}
            <span className="muted">as of {fmt(a.as_of)} · {a.elapsed_s}s</span>
          </div>
        </div>
        <div className="rec">
          <div className="rec-k">Recommended — building</div>
          <div className={`rec-v ${lv(POSTURE_SEV[r.recommended] ?? 4)}`}>{r.recommended_label}</div>
          <div className="rec-why">{r.recommended_why}</div>
        </div>
      </div>

      <div className="options">
        {r.options.map((o) => (
          <button key={o.key} onClick={() => onPick(o.key)}
            className={`opt ${o.recommended ? 'recd ' + lv(POSTURE_SEV[o.key]) : ''} ${chosen === o.key ? 'chosen' : ''}`}>
            {o.recommended && <span className="star">Recommended</span>}
            {o.label}
          </button>
        ))}
        <button className={`opt ${chosen === 'CUSTOM' ? 'chosen' : ''}`} onClick={() => onPick('CUSTOM')}>Custom…</button>
      </div>

      <div className="rationale">
        <p>{a.rationale}</p>
        <div className="rationale-foot">
          <span className="muted">{a.rationale_by === 'template' ? 'Template text (no model key)' : `Written by ${a.rationale_by}`} · level decided by rules, not AI</span>
          <button className="btn sm" onClick={() => { navigator.clipboard?.writeText(a.rationale); setCopied(true); setTimeout(() => setCopied(false), 1500) }}>
            {copied ? '✓ Copied' : 'Copy for email'}
          </button>
        </div>
        {a.agent_error && <div className="muted small">{a.agent_error}</div>}
      </div>
    </section>
  )
}

/* ---------------- WHY ---------------- */
function Why({ a }) {
  const r = a.rules
  return (
    <section className="panel">
      <h2>Why <span>thresholds crossed</span></h2>
      {r.signals.length === 0 ? <p className="muted">Nothing crossed a threshold.</p> : (
        <div className="why-list">
          {r.signals.map((s, i) => (
            <div key={i} className={`why ${lv(s.level)}`}>
              <div className="why-lv">{s.level}</div>
              <div className="why-main">
                <div className="why-title">{s.title}</div>
                <div className="why-obs">{s.observed}</div>
                <div className="why-grid">
                  <div><span>Threshold</span>{s.threshold}</div>
                  <div><span>Exceeded by</span>{s.exceed_by}</div>
                  <div><span>Basis</span>{s.basis}</div>
                  <div><span>Source</span>{s.source} · {ago(s.at)}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="change">
        <div className="change-k">What would change this</div>
        <ul>{r.what_would_change.map((w, i) => <li key={i}>{w}</li>)}</ul>
      </div>
    </section>
  )
}

/* ---------------- DATA CARDS ---------------- */
function DataCards({ a, onStatusSaved }) {
  const { alerts, gauge, forecast, outage, roads, facility_status: fs } = a.inputs
  const r = a.rules
  const sigLevel = (kind) => Math.max(0, ...r.signals.filter((s) => s.kind === kind).map((s) => s.level))
  const st = a.data_status
  const relevant = (alerts || []).filter((x) => !['Tropical Cyclone Local Statement'].includes(x.event))
  const w0 = Date.parse(r.window.start) - 2 * 3600e3, w1 = Date.parse(r.window.end)
  const workWind = forecast?.periods?.filter((p) => Date.parse(p.start) >= w0 && Date.parse(p.start) < w1) || []
  const peak = workWind.length ? workWind.reduce((m, p) => (p.wind_mph > m.wind_mph ? p : m)) : null
  const fc = gauge?.forecast?.filter((p) => Date.parse(p.t) <= Date.parse(r.window.start)).pop()
  return (
    <section className="cards">
      <Card title="NWS alerts" level={sigLevel('nws')} status={st.alerts} source="api.weather.gov" at={alerts?.[0]?.fetched_at}>
        {alerts == null ? <Missing /> : relevant.length === 0 ? <Big v="0" u="active" /> : (
          <>
            <Big v={relevant.length} u={relevant.length === 1 ? 'alert' : 'alerts'} />
            {relevant.slice(0, 3).map((x) => (
              <div key={x.id} className="line"><b>{x.event}</b> until {fmt(x.ends || x.expires)}<div className="muted small">{x.where || x.area}</div></div>
            ))}
          </>
        )}
      </Card>
      <Card title="River stage" level={sigLevel('gauge')} status={st.gauge} source="NOAA NWPS" at={gauge?.fetched_at}>
        {!gauge ? <Missing /> : (
          <>
            <Big v={gauge.stage_ft?.toFixed(1)} u="ft" />
            <Meter value={gauge.stage_ft} stages={gauge.flood_stages_ft} />
            <div className="line small">{gauge.name}</div>
            <div className="line small">Minor flood {gauge.flood_stages_ft.minor} ft · {fc ? `forecast ${fc.ft} ft by ${r.window.day} 8 AM` : 'no forecast'}</div>
          </>
        )}
      </Card>
      <Card title={`Wind · ${r.window.day} work day`} level={sigLevel('wind')} status={st.forecast} source="NWS hourly forecast" at={forecast?.fetched_at}>
        {!forecast ? <Missing /> : peak ? (
          <>
            <Big v={peak.wind_mph} u="mph peak" />
            <div className="line small">{fmt(peak.start)} · {peak.short}</div>
            <div className="line small muted">Wind Advisory ≥31 · High Wind ≥40 mph</div>
          </>
        ) : <div className="muted">Forecast does not reach {r.window.day} yet</div>}
      </Card>
      <Card title="Power outages" level={sigLevel('power')} status={st.outage} source="Entergy Louisiana" at={outage?.fetched_at}>
        {!outage ? <Missing /> : (
          <>
            <Big v={outage.customers_out.toLocaleString()} u="customers out" />
            <div className="line small">{outage.pct}% of {outage.customers_served.toLocaleString()} in {outage.parish}</div>
            <div className="line small muted">Statewide {outage.state_out.toLocaleString()} out · utility updated {ago(outage.updated_at)}</div>
          </>
        )}
      </Card>
      <Card title="Roads" level={sigLevel('roads')} status={st.roads} source="LA 511" at={roads?.fetched_at}>
        {!roads ? <Missing /> : (
          <>
            <Big v={roads.weather_related_closures} u="weather closures" />
            <div className="line small">{roads.closures} closures within {roads.radius_mi} mi (construction/maintenance)</div>
            {roads.events?.filter((e) => e.full_closure).slice(0, 2).map((e, i) => <div key={i} className="line small muted">{e.roadway}: {e.description.slice(0, 70)}…</div>)}
          </>
        )}
      </Card>
      <FacilityCard fs={fs} level={sigLevel('facility')} onSaved={onStatusSaved} />
    </section>
  )
}

function Card({ title, level, status, source, at, children }) {
  return (
    <div className={`card ${lv(level)}`}>
      <div className="card-h">
        <span>{title}</span>
        {level > 0 && <span className={`dot ${lv(level)}`}>{LEVEL_NAMES[level]}</span>}
      </div>
      <div className="card-b">{children}</div>
      <div className="card-f">{status === 'error' ? '⚠ source unavailable' : `${source} · ${ago(at)}`}</div>
    </div>
  )
}
const Big = ({ v, u }) => <div className="big"><b>{v}</b><span>{u}</span></div>
const Missing = () => <div className="missing">Data unavailable — treated as unknown, never as safe</div>

function Meter({ value, stages }) {
  const max = (stages.major || value * 1.5) * 1.1
  const pct = (x) => `${Math.min(100, (x / max) * 100)}%`
  return (
    <div className="meter">
      <div className="meter-fill" style={{ width: pct(value) }} />
      {Object.entries(stages).map(([k, v]) => <div key={k} className={`tick t-${k}`} style={{ left: pct(v) }} title={`${k} ${v} ft`} />)}
    </div>
  )
}

function FacilityCard({ fs, level, onSaved }) {
  const [s, setS] = useState(fs)
  const [saving, setSaving] = useState(false)
  useEffect(() => setS(fs), [fs])
  if (!s) return null
  const opts = { power: ['ok', 'generator', 'out'], water: ['ok', 'out'], roof: ['ok', 'damaged'], roads: ['open', 'limited', 'impassable'] }
  const dirty = JSON.stringify(s) !== JSON.stringify(fs)
  const save = async () => { setSaving(true); await api.setStatus(s); setSaving(false); onSaved() }
  return (
    <div className={`card ${lv(level)}`}>
      <div className="card-h"><span>Facility status · manual</span>{level > 0 && <span className={`dot ${lv(level)}`}>{LEVEL_NAMES[level]}</span>}</div>
      <div className="card-b fac">
        {Object.entries(opts).map(([k, vals]) => (
          <div key={k} className="fac-row">
            <span>{k}</span>
            <div className="seg">
              {vals.map((v) => <button key={v} className={s[k] === v ? `on ${v === 'ok' || v === 'open' ? '' : 'bad'}` : ''} onClick={() => setS({ ...s, [k]: v })}>{v}</button>)}
            </div>
          </div>
        ))}
        {dirty && <button className="btn sm primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save & re-assess'}</button>}
      </div>
      <div className="card-f">Reported by {fs.updated_by} · {fs.updated_at ? ago(fs.updated_at) : 'not yet updated'}</div>
    </div>
  )
}

/* ---------------- AGENCIES ---------------- */
function Agencies({ a, facility }) {
  const r = a.rules
  return (
    <section className="panel">
      <h2>By agency <span>same data · different risk tolerance</span></h2>
      <div className="agencies">
        {r.agencies.map((g) => (
          <div key={g.code} className={`agency ${lv(POSTURE_SEV[g.posture])}`}>
            <div className="ag-h">
              <div className="ag-code">{g.code}</div>
              <span className="pill ghost">{g.tolerance} tolerance</span>
            </div>
            <div className="ag-name">{g.name}</div>
            <div className={`ag-posture ${lv(POSTURE_SEV[g.posture])}`}>{g.label}</div>
            {g.field_work && <div className={`ag-field ${g.field_work}`}>Field work: <b>{g.field_work}</b></div>}
            <LevelScale level={r.level} th={g.thresholds} />
            <div className="small muted">{g.tolerance_note}</div>
            <div className="small">{g.why}</div>
          </div>
        ))}
      </div>
      {facility?.not_in_building && Object.entries(facility.not_in_building).map(([k, v]) => <div key={k} className="small muted note">{v}</div>)}
    </section>
  )
}

function LevelScale({ level, th }) {
  return (
    <div className="scale">
      {[0, 1, 2, 3, 4].map((n) => {
        const tag = n === th.close ? 'close' : n === th.adjust ? 'adjust' : n === th.field_suspend ? 'field stop' : ''
        return (
          <div key={n} className={`sc ${lv(n)} ${n <= level ? 'filled' : ''} ${n === level ? 'cur' : ''}`}>
            <span>{n}</span>{tag && <em>{tag}</em>}
          </div>
        )
      })}
    </div>
  )
}

/* ---------------- NOTIFICATIONS ---------------- */
function Notifications({ a }) {
  const pkg = a.notifications
  const [tab, setTab] = useState(0)
  const role = pkg.roles[tab]
  const groups = ['onsite', 'teleworking', 'on_detail', 'leave']
  const glabel = { onsite: 'Scheduled on site', teleworking: 'Teleworking', on_detail: 'On detail', leave: 'On leave' }
  const t = pkg.availability.total
  return (
    <section className="panel">
      <h2>Notifications <span>by role · drafts only, nothing is sent</span></h2>
      <div className="avail">
        <div><b>{t.on_site}</b><span>on site {pkg.availability.day.split(' ')[0]}</span></div>
        <div><b>{t.telework}</b><span>telework</span></div>
        <div><b>{t.unavailable}</b><span>unavailable</span></div>
        <div><b>{pkg.employees.filter((e) => e.notify).length}</b><span>to notify of {t.total}</span></div>
      </div>
      <div className="roles">
        {pkg.roles.map((x, i) => (
          <button key={i} className={i === tab ? 'on' : ''} onClick={() => setTab(i)}>
            {x.title}<small>{x.concern}</small>
          </button>
        ))}
      </div>
      <div className="msg">
        <div className="msg-h"><span>To: {role.to}</span><span className="muted">{role.written_by === 'agent' ? 'drafted by agent' : 'template'}</span></div>
        <div className="msg-s">{role.subject}</div>
        <pre>{role.body}</pre>
        {role.programs && (
          <div className="progs">
            {role.programs.map((p) => <span key={p.name} className={`prog ${p.status}`}>{p.name}: {p.status}</span>)}
          </div>
        )}
      </div>
      <div className="emp">
        {groups.map((g) => {
          const list = pkg.employees.filter((e) => e.status === g)
          if (!list.length) return null
          return (
            <div key={g} className="emp-g">
              <div className="emp-gh">{glabel[g]} <span>{list.length}</span></div>
              {list.map((e) => (
                <div key={e.id} className={`emp-r ${e.notify ? 'yes' : 'no'}`}>
                  <span className="emp-n">{e.notify ? '●' : '○'}</span>
                  <div className="emp-who"><b>{e.name}</b> <span className="muted">{e.agency} · {e.role}{e.work_location === 'field' ? ' · field' : ''}</span></div>
                  <div className="emp-why">{e.reason}{e.accessibility_needs && <div className="acc">♿ {e.accessibility_needs}</div>}</div>
                  <div className="emp-ch">{e.channels.map((c) => <span key={c}>{c}</span>)}</div>
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </section>
  )
}

/* ---------------- DECISION ---------------- */
function Decision({ a, chosen, setChosen }) {
  const r = a.rules
  const [custom, setCustom] = useState('')
  const [reason, setReason] = useState('')
  const [by, setBy] = useState('Denise Fontenot')
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { setMsg(null) }, [a.id])
  const ok = chosen && reason.trim().length >= 15 && (chosen !== 'CUSTOM' || custom.trim())
  const submit = async () => {
    setBusy(true)
    try {
      const rec = await api.decide({ assessment_id: a.id, option: chosen, custom_text: custom, reason, decided_by: by })
      setMsg({ ok: true, text: `${rec.record_id} saved — "${rec.decision}" by ${rec.decided_by}, with full evidence snapshot.` })
      setReason('')
    } catch (e) {
      setMsg({ ok: false, text: e.message })
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="panel decision">
      <h2>Decision <span>a human decides · reason required</span></h2>
      <div className="dec-opts">
        {r.options.map((o) => (
          <label key={o.key} className={`dec-o ${chosen === o.key ? 'on' : ''} ${o.recommended ? 'recd' : ''}`}>
            <input type="radio" name="opt" checked={chosen === o.key} onChange={() => setChosen(o.key)} />
            {o.label}{o.recommended && <em>recommended</em>}
          </label>
        ))}
        <label className={`dec-o ${chosen === 'CUSTOM' ? 'on' : ''}`}>
          <input type="radio" name="opt" checked={chosen === 'CUSTOM'} onChange={() => setChosen('CUSTOM')} />Custom
        </label>
      </div>
      {chosen === 'CUSTOM' && <input className="inp" placeholder="Describe your decision, e.g. Open 10:00–14:00, FSA counter closed" value={custom} onChange={(e) => setCustom(e.target.value)} />}
      <textarea className="inp" rows={4} placeholder="Reason (required) — what you weighed and why. This goes into the permanent record."
        value={reason} onChange={(e) => setReason(e.target.value)} />
      <div className="dec-foot">
        <input className="inp by" value={by} onChange={(e) => setBy(e.target.value)} />
        <button className="btn primary" disabled={!ok || busy} onClick={submit}>{busy ? 'Saving…' : 'Submit decision'}</button>
      </div>
      {!ok && <div className="muted small">Pick an option and write at least one sentence of reasoning to submit.</div>}
      {msg && <div className={msg.ok ? 'okmsg' : 'err'}>{msg.text}</div>}
    </section>
  )
}

function Trace({ a }) {
  return (
    <details className="panel trace">
      <summary>Agent tool calls · {a.trace.length} steps · {a.rationale_by}</summary>
      <ol>{a.trace.map((t, i) => <li key={i} className={t.ok ? '' : 'bad'}><code>{t.tool}</code> <span className="muted">{t.ms} ms</span> {t.summary}</li>)}</ol>
    </details>
  )
}

/* ---------------- RECORDS ---------------- */
function Records() {
  const [list, setList] = useState(null)
  const [open, setOpen] = useState(null)
  const [detail, setDetail] = useState(null)
  useEffect(() => { api.records().then(setList) }, [])
  const toggle = async (id) => {
    if (open === id) return setOpen(null)
    setOpen(id); setDetail(null)
    setDetail(await api.record(id))
  }
  if (!list) return <div className="boot">Loading…</div>
  if (!list.length) return <div className="boot">No decisions yet. Submit one from the dashboard.</div>
  return (
    <main className="records">
      {list.map((r) => (
        <div key={r.record_id} className="panel rec-item">
          <div className="rec-h" onClick={() => toggle(r.record_id)}>
            <div>
              <div className="rec-id">{r.record_id} · {r.operating_day}</div>
              <div className="rec-dec">{r.decision}</div>
              <div className="muted small">by {r.decided_by} · {fmt(r.decided_at, { month: 'short', day: 'numeric' })} · system recommended “{r.recommended_label}” {r.followed_recommendation ? '✓ followed' : '— overridden'}</div>
            </div>
            <span className={`pill ${lv(r.level)}`}>Hazard {r.level}/4 · {r.confidence}</span>
          </div>
          <div className="rec-reason">“{r.reason}”</div>
          {open === r.record_id && (detail ? <Evidence e={detail.evidence} /> : <div className="muted">Loading evidence…</div>)}
        </div>
      ))}
    </main>
  )
}

function Evidence({ e }) {
  const r = e.rules
  const inp = e.inputs
  return (
    <div className="evidence">
      <h3>Evidence snapshot · data as of {fmt(e.as_of, { month: 'short', day: 'numeric' })}</h3>
      <div className="ev-grid">
        <div><span>NWS alerts</span>{inp.alerts ? inp.alerts.map((x) => <div key={x.id}>{x.event} — {x.severity}/{x.certainty} · fetched {fmt(x.fetched_at)}</div>) : 'unavailable'}</div>
        <div><span>River</span>{inp.gauge ? `${inp.gauge.name}: ${inp.gauge.stage_ft} ft (${inp.gauge.category}) · ${fmt(inp.gauge.fetched_at)}` : 'unavailable'}</div>
        <div><span>Power</span>{inp.outage ? `${inp.outage.customers_out} / ${inp.outage.customers_served} out · ${fmt(inp.outage.fetched_at)}` : 'unavailable'}</div>
        <div><span>Roads</span>{inp.roads ? `${inp.roads.weather_related_closures} weather closures · ${fmt(inp.roads.fetched_at)}` : 'unavailable'}</div>
        <div><span>Facility</span>{inp.facility_status ? `power ${inp.facility_status.power}, water ${inp.facility_status.water}, roof ${inp.facility_status.roof}, roads ${inp.facility_status.roads}` : '—'}</div>
        <div><span>Rules</span>{r.recommended_label} · level {r.level} · {r.agencies.map((g) => `${g.code} ${g.label}`).join('; ')}</div>
      </div>
      <h3>Thresholds crossed</h3>
      <ul className="small">{r.signals.map((s, i) => <li key={i}>{s.title}: {s.observed} — {s.threshold}, {s.exceed_by} ({s.source})</li>)}</ul>
      <h3>Rationale shown to the decision-maker</h3>
      <p className="small">{e.rationale}</p>
      <h3>Notifications prepared</h3>
      <div className="small">{e.notifications.summary}</div>
    </div>
  )
}
