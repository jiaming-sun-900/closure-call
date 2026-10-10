import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api'
import './App.css'

const POSTURES = ['OPEN', 'DELAYED_ARRIVAL', 'EARLY_DEPARTURE', 'UNSCHEDULED_TELEWORK', 'CLOSED']
const POSTURE_LABEL = {
  OPEN: 'Open',
  DELAYED_ARRIVAL: 'Delayed Arrival',
  EARLY_DEPARTURE: 'Early Departure',
  UNSCHEDULED_TELEWORK: 'Unscheduled Leave / Telework',
  CLOSED: 'Closed',
}
const PHASE_LABEL = {
  none: 'No action needed',
  advance: 'Advance notice',
  official: 'Official notice',
  correction: 'Correction',
  shelter: 'Shelter now',
  review: 'Manual review',
}
const GROUP_LABEL = { field: 'Field crew', commuters: 'Commuters', in_building: 'In building' }

const fmtTime = (iso, tz) =>
  iso
    ? new Date(iso).toLocaleString('en-US', {
        timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
      })
    : '—'

const QS = new URLSearchParams(window.location.search) // deep links: ?mode=replay&at=...&tab=notify

export default function App() {
  const [facility, setFacility] = useState(null)
  const [mode, setMode] = useState(QS.get('mode') === 'replay' ? 'replay' : 'live')
  const [replayAt, setReplayAt] = useState(QS.get('at'))
  const [assessment, setAssessment] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState(QS.get('tab') || 'overview')
  const [records, setRecords] = useState([])
  const [simulate, setSimulate] = useState(null)
  const reqId = useRef(0)

  const replay = facility?.replays?.isaias
  const locKey = mode === 'replay' ? replay?.location : facility?.current_location
  const loc = facility?.locations?.[locKey]
  const tz = loc?.timezone

  const loadRecords = useCallback(() => api.records().then(setRecords).catch(() => {}), [])

  const runAssess = useCallback(async (opts = {}) => {
    const id = ++reqId.current
    setLoading(true)
    setError(null)
    try {
      const body = { mode: opts.mode ?? mode, simulate: opts.simulate !== undefined ? opts.simulate : simulate }
      if (body.mode === 'replay') {
        body.replay = 'isaias'
        body.at = opts.at ?? replayAt
      }
      const a = await api.assess(body)
      if (id === reqId.current) setAssessment(a)
    } catch (e) {
      if (id === reqId.current) setError(e.message)
    } finally {
      if (id === reqId.current) setLoading(false)
    }
  }, [mode, replayAt, simulate])

  useEffect(() => {
    api.facility().then((f) => {
      setFacility(f)
      setReplayAt((cur) => cur || f.replays.isaias.moments[0].at)
    }).catch((e) => setError('Backend unreachable: ' + e.message))
    loadRecords()
  }, [loadRecords])

  useEffect(() => {
    if (facility) runAssess()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facility?.current_location, mode, simulate])

  const changeLocation = async (key) => {
    const f = await api.setLocation(key)
    setFacility((prev) => ({ ...prev, ...f }))
  }

  if (!facility) {
    return <div className="boot">{error || 'Loading Closure Call…'}</div>
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">⛈</span>
          <div>
            <div className="title">Closure Call</div>
            <div className="sub">{facility.name} · {loc?.label}</div>
          </div>
        </div>
        <div className="controls">
          <div className="seg">
            <button className={mode === 'live' ? 'on' : ''} onClick={() => setMode('live')}>● Live</button>
            <button className={mode === 'replay' ? 'on' : ''} onClick={() => setMode('replay')}>⏪ Replay: Isaias</button>
          </div>
          {mode === 'live' && (
            <select value={facility.current_location} onChange={(e) => changeLocation(e.target.value)}>
              {Object.entries(facility.locations).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          )}
          <select value={simulate || ''} onChange={(e) => setSimulate(e.target.value || null)} title="Test scenarios">
            <option value="">Real data</option>
            <option value="nws_down">Test: NWS outage</option>
          </select>
          <button className="primary" onClick={() => runAssess()} disabled={loading}>{loading ? 'Assessing…' : 'Re-assess'}</button>
        </div>
      </header>

      {mode === 'replay' && replay && (
        <ReplayBar replay={replay} at={replayAt} tz={tz} loading={loading}
          onChange={setReplayAt} onCommit={(at) => runAssess({ at })} />
      )}

      {error && <div className="banner error">⚠ {error}</div>}

      <nav className="tabs">
        {[['overview', 'Recommendation'], ['notify', 'Notifications'], ['records', 'Decision Record']].map(([k, l]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => { setTab(k); if (k === 'records') loadRecords() }}>{l}</button>
        ))}
      </nav>

      <main className={loading ? 'dim' : ''}>
        {!assessment && <div className="empty">Pulling live data from the National Weather Service…</div>}
        {assessment && tab === 'overview' && (
          <Overview a={assessment} tz={tz} onDecided={() => { loadRecords(); runAssess() }} />
        )}
        {assessment && tab === 'notify' && <Notifications a={assessment} />}
        {tab === 'records' && <Records records={records} />}
      </main>
      <footer className="foot">
        Data: NWS api.weather.gov · NOAA NWPS river gauges · Rules: deterministic (NWS / OPM thresholds) ·
        Agent: Strands Agents SDK{facility.model?.provider ? ` (${facility.model.provider})` : ' (template mode)'} · A human makes the final call.
      </footer>
    </div>
  )
}

function ReplayBar({ replay, at, tz, loading, onChange, onCommit }) {
  const t0 = Date.parse(replay.start), t1 = Date.parse(replay.end)
  const cur = Date.parse(at)
  const step = 30 * 60 * 1000
  const toIso = (ms) => new Date(ms).toISOString().replace('.000', '')
  return (
    <div className="replay">
      <div className="replay-head">
        <strong>{replay.label}</strong>
        <span className="replay-time">{fmtTime(at, tz)}{loading ? ' · evaluating…' : ''}</span>
      </div>
      <input type="range" min={t0} max={t1} step={step} value={cur}
        onChange={(e) => onChange(toIso(+e.target.value))}
        onMouseUp={(e) => onCommit(toIso(+e.target.value))}
        onTouchEnd={(e) => onCommit(toIso(+e.target.value))}
        onKeyUp={(e) => onCommit(toIso(+e.target.value))} />
      <div className="moments">
        {replay.moments.map((m) => (
          <button key={m.at} className={m.at === at ? 'on' : ''} onClick={() => { onChange(m.at); onCommit(m.at) }}>
            {m.label}
          </button>
        ))}
      </div>
      <div className="note">Real NWS alert history replayed through the same rules + agent as live mode.</div>
    </div>
  )
}

function Overview({ a, tz, onDecided }) {
  const r = a.rules
  const posture = r.posture || 'REVIEW'
  return (
    <div className="grid">
      <section className={`card posture p-${posture}`}>
        <div className="posture-top">
          <span className={`phase ph-${r.phase}`}>{PHASE_LABEL[r.phase]}</span>
          <span className={`conf c-${r.confidence}`}>Confidence: {r.confidence}</span>
        </div>
        <div className="posture-label">{r.posture_label}</div>
        <div className="posture-day">
          Recommendation for <strong>{r.window.day} {r.window.date}</strong> · hours {fmtTime(r.window.start, tz).split(', ').pop()}
          {' · '}as of {fmtTime(a.as_of, tz)}
        </div>
        <div className="conf-reason">{r.confidence_reason}</div>
        {r.needs_review && <div className="banner error">NWS data unavailable — the system will not recommend OPEN. Decide manually.</div>}
        {r.phase === 'correction' && <div className="banner warn">Previous decision was <strong>{r.last_posture}</strong>. Conditions improved → correction notice will be sent.</div>}
      </section>

      <section className="card">
        <h3>Rationale <small>{a.rationale_by.startsWith('agent') ? `written by ${a.rationale_by}` : 'template (no model configured)'}</small></h3>
        <p className="rationale">{a.rationale}</p>
        <CopyButton text={a.rationale} />
        {a.agent_error && <div className="muted small">Agent fallback: {a.agent_error}</div>}
      </section>

      <Decision a={a} onDecided={onDecided} />

      <section className="card wide">
        <h3>Why — thresholds crossed</h3>
        {r.triggers.length === 0 ? <p className="muted">No input crossed a threshold.</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th></th><th>Input (observed)</th><th>Threshold</th><th>Exceeded by</th><th>→ Posture</th><th>Basis</th><th>Source · time</th></tr></thead>
              <tbody>
                {r.triggers.map((t, i) => (
                  <tr key={i} className={i === 0 ? 'deciding' : ''}>
                    <td>{i === 0 ? '★' : ''}</td>
                    <td>{t.observed}{t.note ? <div className="muted small">{t.note}</div> : null}</td>
                    <td>{t.threshold}</td>
                    <td>{t.exceed_by}</td>
                    <td><span className={`chip p-${t.posture}`}>{POSTURE_LABEL[t.posture]}{t.advance ? ' + notice' : ''}{t.shelter ? ' + SHELTER' : ''}</span></td>
                    <td className="small">{t.basis}</td>
                    <td className="small">{t.source}<br />{fmtTime(t.at, tz)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <h4>What would change this recommendation</h4>
        <ul>{r.what_would_change.map((w, i) => <li key={i}>{w}</li>)}</ul>
      </section>

      <Inputs a={a} tz={tz} />
      <Trace a={a} />
    </div>
  )
}

function CopyButton({ text }) {
  const [done, setDone] = useState(false)
  return (
    <button className="ghost" onClick={() => { navigator.clipboard?.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500) }}>
      {done ? '✓ Copied' : '⧉ Copy for email'}
    </button>
  )
}

function Decision({ a, onDecided }) {
  const [override, setOverride] = useState(false)
  const [posture, setPosture] = useState(a.rules.posture || 'CLOSED')
  const [reason, setReason] = useState('')
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { setMsg(null); setOverride(false); setReason(''); setPosture(a.rules.posture || 'CLOSED') }, [a.id, a.rules.posture])

  const submit = async (action) => {
    setBusy(true)
    try {
      const body = { assessment_id: a.id, action }
      if (action === 'override') Object.assign(body, { final_posture: posture, reason })
      const rec = await api.decide(body)
      setMsg(`✓ ${rec.record_id}: ${POSTURE_LABEL[rec.final_posture]} ${rec.overridden ? '(override)' : '(confirmed)'} by ${rec.decided_by}`)
      onDecided?.()
    } catch (e) {
      setMsg('⚠ ' + e.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="card">
      <h3>Manager decision</h3>
      <p className="muted small">The system recommends. A human decides. Every decision is recorded.</p>
      {!override ? (
        <div className="row">
          <button className="primary" disabled={busy || !a.rules.posture} onClick={() => submit('confirm')}>
            ✓ Confirm {a.rules.posture ? POSTURE_LABEL[a.rules.posture] : ''}
          </button>
          <button className="ghost" onClick={() => setOverride(true)}>Override…</button>
        </div>
      ) : (
        <div className="override">
          <select value={posture} onChange={(e) => setPosture(e.target.value)}>
            {POSTURES.map((p) => <option key={p} value={p}>{POSTURE_LABEL[p]}</option>)}
          </select>
          <textarea placeholder="Reason for overriding (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="row">
            <button className="primary" disabled={busy || !reason.trim()} onClick={() => submit('override')}>Record override</button>
            <button className="ghost" onClick={() => setOverride(false)}>Cancel</button>
          </div>
        </div>
      )}
      {msg && <div className="small decision-msg">{msg}</div>}
    </section>
  )
}

function Inputs({ a, tz }) {
  const { alerts, gauge, forecast } = a.inputs
  const peak = forecast?.periods?.length ? forecast.periods.slice(0, 24).reduce((m, p) => (p.wind_mph > m.wind_mph ? p : m)) : null
  return (
    <section className="card wide">
      <h3>Inputs <small>every value with its source and retrieval time</small></h3>
      <div className="status-row">
        {Object.entries(a.data_status).map(([k, v]) => <span key={k} className={`chip s-${v.replace('/', '')}`}>{k}: {v}</span>)}
      </div>
      <h4>NWS alerts in effect ({alerts ? alerts.length : 'unavailable'})</h4>
      {alerts?.length ? (
        <div className="alerts">
          {alerts.map((al) => (
            <div key={al.id} className="alert">
              <div><strong>{al.event}</strong> <span className="muted">· {al.severity} / {al.certainty} / {al.urgency}</span></div>
              <div className="small">{al.area}</div>
              <div className="small muted">Effective {fmtTime(al.effective, tz)} · Expires {fmtTime(al.ends || al.expires, tz)} · {al.sender}</div>
            </div>
          ))}
        </div>
      ) : <p className="muted">{alerts ? 'No active alerts for this point.' : 'NWS unreachable.'}</p>}
      {a.rules.ignored_alerts.length > 0 && (
        <p className="small muted">Not decision-relevant: {a.rules.ignored_alerts.map((x) => x.event).join(', ')}</p>
      )}
      <div className="two">
        <div>
          <h4>River gauge</h4>
          {gauge ? (
            <div className="small">
              <strong>{gauge.name}</strong><br />
              Stage {gauge.stage_ft ?? '—'} ft · category <strong>{gauge.category}</strong><br />
              Flood stages: {Object.entries(gauge.flood_stages_ft).map(([k, v]) => `${k} ${v} ft`).join(' · ')}<br />
              <span className="muted">{gauge.source} · observed {fmtTime(gauge.observed_at, tz)}</span>
            </div>
          ) : <p className="muted small">{a.data_status.gauge === 'n/a' ? 'Not used in replay.' : 'Unavailable.'}</p>}
        </div>
        <div>
          <h4>Hourly forecast</h4>
          {peak ? (
            <div className="small">
              Next 24h peak wind <strong>{peak.wind_mph} mph</strong> at {fmtTime(peak.start, tz)}<br />
              Now: {forecast.periods[0].short}, precip {forecast.periods[0].precip_pct}%<br />
              <span className="muted">{forecast.source} · fetched {fmtTime(forecast.fetched_at, tz)}</span>
            </div>
          ) : <p className="muted small">{a.data_status.forecast === 'n/a' ? 'Not archived for replay.' : 'Unavailable.'}</p>}
        </div>
      </div>
    </section>
  )
}

function Trace({ a }) {
  return (
    <section className="card wide">
      <details>
        <summary><strong>Agent tool calls</strong> <span className="muted small">({a.trace.length} steps · {a.rationale_by})</span></summary>
        <ol className="trace">
          {a.trace.map((t, i) => (
            <li key={i} className={t.ok ? '' : 'bad'}><code>{t.tool}</code> <span className="muted">{t.ms} ms</span> — {t.summary}</li>
          ))}
        </ol>
      </details>
    </section>
  )
}

function Notifications({ a }) {
  const pkg = a.notifications
  const ga = a.rules.group_actions
  return (
    <div className="grid">
      <section className="card wide">
        <h3>Notification package <small>{pkg.summary}</small></h3>
        <div className="groups">
          {Object.entries(ga).map(([g, v]) => (
            <div key={g} className={`group u-${v.urgency}`}>
              <div className="g-name">{GROUP_LABEL[g] || g}</div>
              <div className="g-urg">{v.urgency}</div>
              <div className="small">{v.action}</div>
            </div>
          ))}
        </div>
        <p className="muted small">Channels are labeled only — nothing is actually sent.</p>
      </section>
      <section className="card wide">
        <h3>Notify ({pkg.recipients.length}) <small>in send order</small></h3>
        {pkg.recipients.length === 0 && <p className="muted">No one needs to be notified.</p>}
        {pkg.recipients.map((x) => <Recipient key={x.employee.id} x={x} />)}
      </section>
      <section className="card wide">
        <h3>Not notified ({pkg.excluded.length}) <small>and why</small></h3>
        <ul className="excluded">
          {pkg.excluded.map((x) => (
            <li key={x.employee.id}><strong>{x.employee.name}</strong> <span className="muted">{x.employee.role}</span> — {x.reason}</li>
          ))}
        </ul>
      </section>
    </div>
  )
}

function Recipient({ x }) {
  const [open, setOpen] = useState(x.order === 1)
  return (
    <div className={`recipient u-${x.urgency}`}>
      <div className="r-head" onClick={() => setOpen(!open)}>
        <span className="r-order">{x.order}</span>
        <div className="r-who">
          <strong>{x.employee.name}</strong> <span className="muted small">{x.employee.role}</span>
          <div className="small">
            <span className="chip">{GROUP_LABEL[x.group]}</span>
            <span className={`chip u-${x.urgency}`}>{x.urgency}</span>
            {x.channels.map((c) => <span key={c} className="chip ch">{c}</span>)}
            {x.employee.essential && <span className="chip ess">essential</span>}
            {x.accessibility_note && <span className="chip acc">♿ accessibility</span>}
          </div>
          <div className="small muted">Why included: {x.reason}</div>
        </div>
        <span className="r-toggle">{open ? '▾' : '▸'}</span>
      </div>
      {open && (
        <div className="msg">
          <div className="msg-subj">{x.message.subject}</div>
          <pre>{x.message.body}</pre>
        </div>
      )}
    </div>
  )
}

function Records({ records }) {
  const [openId, setOpenId] = useState(null)
  const [detail, setDetail] = useState(null)
  const open = async (id) => {
    if (openId === id) { setOpenId(null); return }
    setOpenId(id)
    setDetail(await api.record(id))
  }
  if (!records.length) return <div className="empty">No decisions recorded yet. Confirm or override a recommendation to create one.</div>
  return (
    <div className="timeline">
      {records.map((r) => (
        <div key={r.record_id} className="tl-item">
          <div className="tl-dot" />
          <div className="tl-body card">
            <div className="tl-head" onClick={() => open(r.record_id)}>
              <div>
                <strong>{r.record_id}</strong> · {r.location_label} · <span className="muted">{r.mode}</span>
                <div className="small muted">Decided {fmtTime(r.decided_at)} by {r.decided_by} · data as of {fmtTime(r.as_of)}</div>
              </div>
              <div className="tl-postures">
                <span className={`chip p-${r.recommended_posture}`}>Rec: {POSTURE_LABEL[r.recommended_posture] || 'none'}</span>
                <span className={`chip p-${r.final_posture}`}>Final: {POSTURE_LABEL[r.final_posture]}</span>
                {r.overridden && <span className="chip warn">override</span>}
              </div>
            </div>
            {r.override_reason && <div className="small"><strong>Override reason:</strong> {r.override_reason}</div>}
            {openId === r.record_id && detail && <Snapshot rec={detail} />}
          </div>
        </div>
      ))}
    </div>
  )
}

function Snapshot({ rec }) {
  const s = rec.snapshot
  return (
    <div className="snapshot">
      <h4>What was known at {fmtTime(s.as_of)}</h4>
      <div className="small">Data status: {Object.entries(s.data_status).map(([k, v]) => `${k} ${v}`).join(' · ')}</div>
      <ul className="small">
        {(s.inputs.alerts || []).map((al) => (
          <li key={al.id}>{al.event} ({al.severity}/{al.certainty}/{al.urgency}) — {al.source}, fetched {al.fetched_at}</li>
        ))}
        {s.inputs.gauge && <li>{s.inputs.gauge.name}: {s.inputs.gauge.stage_ft} ft — {s.inputs.gauge.source}</li>}
      </ul>
      <h4>Rule result</h4>
      <div className="small">{s.rules.posture_label} · confidence {s.rules.confidence} · phase {s.rules.phase}</div>
      <ul className="small">{s.rules.triggers.map((t, i) => <li key={i}>{t.rule} — {t.exceed_by} → {t.posture}</li>)}</ul>
      <h4>Rationale ({s.rationale_by})</h4>
      <p className="small">{s.rationale}</p>
      <h4>Notifications</h4>
      <div className="small">{s.notifications.summary}</div>
      <h4>Agent trace</h4>
      <ol className="small">{s.trace.map((t, i) => <li key={i}>{t.tool}: {t.summary}</li>)}</ol>
    </div>
  )
}
