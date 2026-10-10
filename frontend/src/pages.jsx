import { useEffect, useState } from 'react'
import { api } from './api'
import Leaf from './Leaf'
import { AlertMap, LevelScale, OutageGauge, RoadStatus, WaterGauge, Wind } from './charts'
import {
  CHANNEL, KIND_EMOJI, LEVEL, POSTURE, STATUS, agencyAction, agencyTone, agencyWord, ago, clean, dateLong,
  eventEmoji, fmt, levelTone, oneLiner, personAction,
} from './lib'

/* ---------- shared bits ---------- */
export function Evidence({ label = 'Show evidence', children }) {
  return (
    <details className="evidence">
      <summary>{label}</summary>
      <div className="evidence-body">{children}</div>
    </details>
  )
}

function SignalList({ signals }) {
  if (!signals.length) return <p className="quiet">Nothing crossed a threshold.</p>
  return (
    <ul className="sig-list">
      {signals.map((s, i) => (
        <li key={i}>
          <b>{KIND_EMOJI[s.kind]} {clean(s.title)}</b>
          <span>Observed: {clean(s.observed)}</span>
          <span>Threshold: {clean(s.threshold)}, exceeded by {clean(s.exceed_by)}</span>
          <span>Basis: {clean(s.basis)}</span>
          <span className="src">Source: {clean(s.source)}, {fmt(s.at, { month: 'short', day: 'numeric' })}</span>
        </li>
      ))}
    </ul>
  )
}

function Tag({ tone, icon, name, word, sub }) {
  return (
    <div className={`tag ${tone} fade`}>
      <div className="tag-name">{icon} {name}</div>
      <div className="tag-word">{word}</div>
      {sub && <div className="tag-sub">{sub}</div>}
    </div>
  )
}

function CopyBtn({ text }) {
  const [done, setDone] = useState(false)
  return (
    <button className="btn green" onClick={() => { navigator.clipboard?.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500) }}>
      {done ? '✓ Copied' : '📋 Copy to email'}
    </button>
  )
}

const sigsOf = (r, kind) => r.signals.filter((s) => s.kind === kind)
const maxLevel = (r, kind) => Math.max(0, ...sigsOf(r, kind).map((s) => s.level))

function useDerived(a) {
  const r = a.rules
  const { alerts, gauge, forecast, outage, roads, facility_status: fs } = a.inputs
  const live = (alerts || []).filter((x) => !/Statement/.test(x.event))
  const w0 = Date.parse(r.window.start) - 2 * 3600e3, w1 = Date.parse(r.window.end)
  const work = forecast?.periods?.filter((p) => Date.parse(p.start) >= w0 && Date.parse(p.start) < w1) || []
  const peak = work.length ? work.reduce((m, p) => (p.wind_mph > m.wind_mph ? p : m)) : null
  const fc = gauge?.forecast?.filter((p) => Date.parse(p.t) <= Date.parse(r.window.start)).pop()
  return { r, alerts, live, gauge, forecast, outage, roads, fs, peak, fc }
}

/* ---------- 🏠 Overview ---------- */
export function Overview({ a, facility, go }) {
  const { r, live, gauge, outage, roads, fs, peak, fc } = useDerived(a)
  const bTone = r.recommended ? POSTURE[r.recommended].tone : 'red'
  return (
    <div className="page">
      <section className="hero fade">
        <Leaf level={0} size={96} />
        <div className="hero-text">
          <div className="hero-date">{dateLong(r)}{r.window.skipped.length ? ', next workday after Columbus Day' : ''}</div>
          <h1>{oneLiner(r)}</h1>
          <div className="hero-chips">
            <span className={`chip ${levelTone(r.level)}`}>Hazard {r.level} of 4: {LEVEL[r.level].name}</span>
            <span className="chip blue">Confidence {r.confidence.toLowerCase()}</span>
            <span className="chip ghost">Updated {ago(a.as_of)}</span>
          </div>
        </div>
      </section>

      <section className="tags">
        <Tag tone={bTone} icon="🏢" name="Building" word={r.recommended ? POSTURE[r.recommended].word : 'Decide'} sub={r.recommended === 'OPEN' ? 'Doors open 8 AM' : null} />
        {r.agencies.map((g) => (
          <Tag key={g.code} tone={agencyTone(g)} icon={g.code === 'NRCS' ? '🌱' : '🌾'} name={g.code} word={agencyWord(g)} sub={agencyAction(g)} />
        ))}
      </section>

      <section className="tiles">
        <div className="tile wide fade" onClick={() => go('weather')}>
          <div className="tile-h">🗺 Alerts near the office <span className={`dot ${levelTone(maxLevel(r, 'nws'))}`} /></div>
          <AlertMap lat={facility.lat} lon={facility.lon} alerts={a.inputs.alerts || []} height={190} />
          <div className="tile-f">{live.length ? `${live.length} active: ${[...new Set(live.map((x) => x.event))].join(', ')}` : 'No active alerts'}</div>
        </div>
        <div className="tile fade" onClick={() => go('weather')}>
          <div className="tile-h">⚡ Power <span className={`dot ${levelTone(maxLevel(r, 'power'))}`} /></div>
          {outage ? <><OutageGauge pct={outage.pct} size={180} /><div className="tile-big">{outage.customers_out.toLocaleString()} <small>homes out</small></div></> : <Missing />}
        </div>
        <div className="tile fade" onClick={() => go('weather')}>
          <div className="tile-h">🌊 River <span className={`dot ${levelTone(maxLevel(r, 'gauge'))}`} /></div>
          {gauge ? <div className="river-row"><WaterGauge stage={gauge.stage_ft} forecast={fc?.ft} stages={gauge.flood_stages_ft} height={150} />
            <div className="tile-big">{gauge.stage_ft?.toFixed(1)} <small>ft</small></div></div> : <Missing />}
        </div>
        <div className="tile fade" onClick={() => go('weather')}>
          <div className="tile-h">💨 Wind, {r.window.day} <span className={`dot ${levelTone(maxLevel(r, 'wind'))}`} /></div>
          {peak ? <Wind mph={peak.wind_mph} /> : <div className="quiet">Forecast not out yet</div>}
        </div>
        <div className="tile fade" onClick={() => go('weather')}>
          <div className="tile-h">🚗 Roads <span className={`dot ${levelTone(maxLevel(r, 'roads'))}`} /></div>
          <RoadStatus weatherClosures={roads?.weather_related_closures || 0} manual={fs?.roads} />
        </div>
      </section>

      <section className="card fade">
        <div className="card-h">🌿 Why we recommend this</div>
        <p className="rationale">{clean(a.rationale)}</p>
        <div className="row between">
          <span className="quiet small">{a.rationale_by === 'template' ? 'Rules decide the level. Text from template.' : 'Rules decide the level. AI wrote the words.'}</span>
          <CopyBtn text={clean(a.rationale)} />
        </div>
      </section>
    </div>
  )
}
const Missing = () => <div className="quiet">Data unavailable, treated as unknown</div>

/* ---------- 🌦 Weather & data ---------- */
export function Weather({ a, facility, onSaved }) {
  const { r, alerts, live, gauge, outage, roads, fs, peak, fc, forecast } = useDerived(a)
  return (
    <div className="page">
      <h2 className="page-h">🌦 Weather and data</h2>
      <div className="grid2">
        <section className="card fade">
          <div className="card-h">🗺 NWS alerts <Lvl n={maxLevel(r, 'nws')} /></div>
          <AlertMap lat={facility.lat} lon={facility.lon} alerts={alerts || []} height={260} />
          <ul className="bul">
            {alerts == null && <li>NWS unreachable, never treated as safe</li>}
            {alerts && !live.length && <li>No active alerts for the parish</li>}
            {live.map((x) => <li key={x.id}>{eventEmoji(x.event)} <b>{x.event}</b> until {fmt(x.ends || x.expires)}</li>)}
          </ul>
          <Evidence><SignalList signals={sigsOf(r, 'nws')} />
            {(alerts || []).map((x) => <div key={x.id} className="src">{x.event}: {clean(x.where)}, fetched {fmt(x.fetched_at)}</div>)}
          </Evidence>
        </section>

        <section className="card fade">
          <div className="card-h">🌊 River level <Lvl n={maxLevel(r, 'gauge')} /></div>
          {gauge ? (
            <div className="river-big">
              <WaterGauge stage={gauge.stage_ft} forecast={fc?.ft} stages={gauge.flood_stages_ft} height={230} />
              <ul className="bul">
                <li><b>{gauge.stage_ft?.toFixed(1)} ft</b> now</li>
                {fc && <li>◀ {fc.ft} ft forecast by {r.window.day} 8 AM</li>}
                <li>Minor flooding starts at {gauge.flood_stages_ft.minor} ft</li>
                <li>{clean(gauge.name)}</li>
              </ul>
            </div>
          ) : <Missing />}
          <Evidence><SignalList signals={sigsOf(r, 'gauge')} />{gauge && <div className="src">{gauge.source}, observed {fmt(gauge.observed_at)}</div>}</Evidence>
        </section>

        <section className="card fade">
          <div className="card-h">⚡ Power outages <Lvl n={maxLevel(r, 'power')} /></div>
          {outage ? (
            <div className="center">
              <OutageGauge pct={outage.pct} />
              <ul className="bul">
                <li><b>{outage.customers_out.toLocaleString()}</b> of {outage.customers_served.toLocaleString()} homes out</li>
                <li>Statewide: {outage.state_out.toLocaleString()} out</li>
              </ul>
            </div>
          ) : <Missing />}
          <Evidence><SignalList signals={sigsOf(r, 'power')} />{outage && <div className="src">{clean(outage.source)}, utility updated {fmt(outage.updated_at)}</div>}</Evidence>
        </section>

        <section className="card fade">
          <div className="card-h">💨 Wind <Lvl n={maxLevel(r, 'wind')} /></div>
          {peak ? <Wind mph={peak.wind_mph} /> : <div className="quiet">Forecast does not reach {r.window.day} yet</div>}
          <ul className="bul">
            {peak && <li>Peak {peak.wind_mph} mph at {fmt(peak.start)}</li>}
            {peak && <li>{peak.short}</li>}
            <li>Advisory at 31 mph, warning at 40 mph</li>
          </ul>
          <Evidence><SignalList signals={sigsOf(r, 'wind')} />{forecast && <div className="src">{forecast.source}, fetched {fmt(forecast.fetched_at)}</div>}</Evidence>
        </section>

        <section className="card fade">
          <div className="card-h">🚗 Roads <Lvl n={maxLevel(r, 'roads')} /></div>
          <RoadStatus weatherClosures={roads?.weather_related_closures || 0} manual={fs?.roads} />
          <ul className="bul">
            <li>{roads ? `${roads.weather_related_closures} weather closures nearby` : 'LA 511 unavailable'}</li>
            {roads && <li>{roads.closures} work-zone closures within {roads.radius_mi} mi</li>}
          </ul>
          <Evidence><SignalList signals={sigsOf(r, 'roads')} />
            {roads?.events?.slice(0, 5).map((e, i) => <div key={i} className="src">{e.roadway}: {clean(e.description).slice(0, 90)}</div>)}
          </Evidence>
        </section>

        <FacilityCard fs={fs} level={maxLevel(r, 'facility')} onSaved={onSaved} />
      </div>
      <Evidence label="What would change the recommendation">
        <ul className="bul">{r.what_would_change.map((w, i) => <li key={i}>{clean(w)}</li>)}</ul>
      </Evidence>
    </div>
  )
}
const Lvl = ({ n }) => n > 0 ? <span className={`chip sm ${levelTone(n)}`}>{LEVEL[n].name}</span> : <span className="chip sm green">OK</span>

function FacilityCard({ fs, level, onSaved }) {
  const [s, setS] = useState(fs)
  const [saving, setSaving] = useState(false)
  useEffect(() => setS(fs), [fs])
  if (!s) return null
  const rows = [['⚡', 'power', ['ok', 'generator', 'out']], ['🚰', 'water', ['ok', 'out']], ['🏠', 'roof', ['ok', 'damaged']], ['🚗', 'roads', ['open', 'limited', 'impassable']]]
  const dirty = JSON.stringify(s) !== JSON.stringify(fs)
  return (
    <section className="card fade">
      <div className="card-h">🏢 Building check <Lvl n={level} /></div>
      <div className="fac">
        {rows.map(([ic, k, vals]) => (
          <div key={k} className="fac-row">
            <span>{ic} {k}</span>
            <div className="seg">
              {vals.map((v) => <button key={v} className={s[k] === v ? (v === 'ok' || v === 'open' ? 'on green' : 'on red') : ''} onClick={() => setS({ ...s, [k]: v })}>{v}</button>)}
            </div>
          </div>
        ))}
      </div>
      {dirty && <button className="btn green" disabled={saving} onClick={async () => { setSaving(true); await api.setStatus(s); setSaving(false); onSaved() }}>{saving ? 'Saving…' : 'Save and re-check'}</button>}
      <div className="quiet small">Reported by {fs.updated_by}{fs.updated_at ? `, ${ago(fs.updated_at)}` : ''}</div>
    </section>
  )
}

/* ---------- 🏛 Agencies ---------- */
export function Agencies({ a, facility }) {
  const r = a.rules
  return (
    <div className="page">
      <h2 className="page-h">🏛 Agencies</h2>
      <p className="tagline">🍃 Same data, different risk tolerance.</p>
      <div className="grid2">
        {r.agencies.map((g) => {
          const tone = agencyTone(g)
          return (
            <section key={g.code} className={`card agency ${tone} fade`}>
              <div className="row between">
                <div className="ag-code">{g.code === 'NRCS' ? '🌱' : '🌾'} {g.code}</div>
                <span className="chip ghost">{g.tolerance} risk tolerance</span>
              </div>
              <div className="quiet">{clean(g.name)}</div>
              <div className={`ag-word ${tone}`}>{agencyWord(g)}</div>
              <div className="ag-action">{agencyAction(g)}</div>
              <LevelScale level={r.level} th={g.thresholds} />
              <div className="ag-why">{agencyReason(g, r.level)}</div>
              <Evidence>
                <ul className="bul">
                  <li>Policy: {clean(g.tolerance_note)}</li>
                  <li>Adjust at level {g.thresholds.adjust}, close at level {g.thresholds.close}{g.thresholds.field_suspend ? `, stop field work at ${g.thresholds.field_suspend}` : ''}</li>
                  <li>Rule result: {clean(g.why)}</li>
                </ul>
              </Evidence>
            </section>
          )
        })}
      </div>
      {facility?.not_in_building && <p className="quiet small">ℹ️ Rural Development is served from Lafayette, not this building.</p>}
    </div>
  )
}
function agencyReason(g, level) {
  const th = g.thresholds
  if (g.field_work === 'suspended' && g.posture === 'OPEN') return `Level ${level} hits the field stop line, office stays below ${th.adjust}`
  if (level >= th.close) return `Level ${level} reaches the close line (${th.close})`
  if (level >= th.adjust) return `Level ${level} reaches the adjust line (${th.adjust})`
  return `Level ${level} is below the adjust line (${th.adjust})`
}

/* ---------- 👥 People & notifications ---------- */
export function People({ a }) {
  const pkg = a.notifications
  const ags = Object.fromEntries(a.rules.agencies.map((g) => [g.code, g]))
  const [tab, setTab] = useState(0)
  const role = pkg.roles[tab]
  const t = pkg.availability.total
  const nNotify = pkg.employees.filter((e) => e.notify).length
  const roleIcon = { facility: '🏢', agency: '👥', program: '📋', executive: '⭐' }
  return (
    <div className="page">
      <h2 className="page-h">👥 People and notifications</h2>
      <div className="stats">
        <Stat n={t.on_site} label={`On site ${a.rules.window.day}`} tone="green" icon="🏢" />
        <Stat n={t.telework} label="Remote" tone="blue" icon="🏠" />
        <Stat n={t.unavailable} label="Unavailable" tone="yellow" icon="🌴" />
        <Stat n={nNotify} label={`To notify of ${t.total}`} tone="red" icon="🔔" />
      </div>

      <section className="card fade">
        <div className="card-h">✉️ Drafts by role <span className="quiet small">Preview only, nothing is sent</span></div>
        <div className="role-tabs">
          {pkg.roles.map((x, i) => (
            <button key={i} className={i === tab ? 'on' : ''} onClick={() => setTab(i)}>{roleIcon[x.role]} {x.title}</button>
          ))}
        </div>
        <div className="draft">
          <div className="draft-to">To: {clean(role.to)}</div>
          <div className="draft-subj">{clean(role.subject)}</div>
          <pre>{clean(role.body)}</pre>
          {role.programs && <div className="progs">{role.programs.map((p) => <span key={p.name} className={`chip ${p.status === 'continues' ? 'green' : p.status === 'limited' ? 'yellow' : 'red'}`}>{p.name}: {p.status}</span>)}</div>}
          <div className="row between"><span className="quiet small">{role.written_by === 'agent' ? 'Drafted by AI agent' : 'Template draft'}</span><CopyBtn text={`${clean(role.subject)}\n\n${clean(role.body)}`} /></div>
        </div>
      </section>

      <section className="card fade">
        <div className="card-h">👤 Employees</div>
        {['onsite', 'teleworking', 'on_detail', 'leave'].map((g) => {
          const list = pkg.employees.filter((e) => e.status === g)
          if (!list.length) return null
          const n = list.filter((e) => e.notify).length
          return (
            <details key={g} className="group">
              <summary>
                <span>{STATUS[g].icon} {STATUS[g].label}</span>
                <span className="quiet">{list.length} {list.length === 1 ? "person" : "people"}{n ? `, ${n} to notify` : ', no messages'}</span>
              </summary>
              {list.map((e) => (
                <div key={e.id} className={`person ${e.notify ? 'yes' : 'no'}`}>
                  <span className="bell">{e.notify ? '🔔' : '🔕'}</span>
                  <span className="p-name">{e.name}</span>
                  <span className="p-ag">{e.agency}{e.work_location === 'field' ? ' 🌱 field' : ''}</span>
                  <span className="p-act">{personAction(e, ags[e.agency])}{e.accessibility_needs ? ' ♿' : ''}</span>
                  <span className="p-ch">{e.channels.map((c) => <span key={c} title={c}>{CHANNEL[c]}</span>)}</span>
                </div>
              ))}
            </details>
          )
        })}
        <Evidence label="Show accessibility notes">
          <ul className="bul">{pkg.employees.filter((e) => e.accessibility_needs).map((e) => <li key={e.id}>♿ {e.name}: {clean(e.accessibility_needs)}</li>)}</ul>
        </Evidence>
      </section>
    </div>
  )
}
function Stat({ n, label, tone, icon }) {
  return <div className={`stat ${tone} fade`}><div className="stat-n">{n}</div><div className="stat-l">{icon} {label}</div></div>
}

/* ---------- ✅ Decide ---------- */
export function Decide({ a, chosen, setChosen }) {
  const r = a.rules
  const [custom, setCustom] = useState('')
  const [reason, setReason] = useState('')
  const [by, setBy] = useState('Denise Fontenot')
  const [done, setDone] = useState(null)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const ok = chosen && reason.trim().length >= 15 && (chosen !== 'CUSTOM' || custom.trim())
  const submit = async () => {
    setBusy(true); setErr(null)
    try {
      const rec = await api.decide({ assessment_id: a.id, option: chosen, custom_text: custom, reason, decided_by: by })
      setDone(rec); setReason('')
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  const icons = { OPEN: '🟢', DELAYED_ARRIVAL: '⏰', EARLY_DEPARTURE: '🏃', UNSCHEDULED_TELEWORK: '🏠', CLOSED_TELEWORK: '💻', CLOSED: '🔒' }
  return (
    <div className="page">
      <h2 className="page-h">✅ Make the call</h2>
      <p className="tagline">The system recommends. You decide.</p>
      <div className="opts">
        {r.options.map((o) => (
          <button key={o.key} className={`opt ${o.recommended ? 'recd' : ''} ${chosen === o.key ? 'on' : ''}`} onClick={() => setChosen(o.key)}>
            {o.recommended && <span className="badge">🍃 Recommended</span>}
            <span className="opt-ic">{icons[o.key]}</span>
            <span className="opt-t">{POSTURE[o.key].action}</span>
          </button>
        ))}
        <button className={`opt ${chosen === 'CUSTOM' ? 'on' : ''}`} onClick={() => setChosen('CUSTOM')}>
          <span className="opt-ic">✏️</span><span className="opt-t">Write my own</span>
        </button>
      </div>
      {chosen === 'CUSTOM' && <input className="inp" placeholder="Your decision, for example: Open 10 AM to 2 PM" value={custom} onChange={(e) => setCustom(e.target.value)} />}
      <label className="lbl">Your reason (required)</label>
      <textarea className="inp" rows={4} placeholder="What did you weigh? This is saved with all the evidence." value={reason} onChange={(e) => setReason(e.target.value)} />
      <div className="row">
        <input className="inp by" value={by} onChange={(e) => setBy(e.target.value)} aria-label="Decided by" />
        <button className="btn green big" disabled={!ok || busy} onClick={submit}>{busy ? 'Saving…' : 'Submit decision'}</button>
      </div>
      {!ok && <div className="quiet small">Pick an option and write at least one sentence.</div>}
      {err && <div className="alert red">{err}</div>}
      {done && (
        <div className="success" onClick={() => setDone(null)}>
          <div className="success-card">
            <div className="check">✓</div>
            <div className="leaves">{Array.from({ length: 10 }).map((_, i) => <span key={i} style={{ '--i': i }}>🍃</span>)}</div>
            <h3>Decision saved</h3>
            <p>{done.record_id}: {clean(done.decision)}</p>
            <p className="quiet small">Evidence snapshot stored. Tap to close.</p>
          </div>
        </div>
      )}
    </div>
  )
}

/* ---------- 📜 Records ---------- */
export function Records() {
  const [list, setList] = useState(null)
  const [detail, setDetail] = useState({})
  useEffect(() => { api.records().then(setList).catch(() => setList([])) }, [])
  const load = async (id) => { if (!detail[id]) { const d = await api.record(id); setDetail((m) => ({ ...m, [id]: d })) } }
  return (
    <div className="page">
      <h2 className="page-h">📜 Decision record</h2>
      {!list ? <p className="quiet">Loading…</p> : !list.length ? <p className="quiet">No decisions yet.</p> : list.map((r) => (
        <section key={r.record_id} className="card rec fade">
          <div className="row between">
            <div>
              <div className="quiet small">{r.record_id}, for {r.operating_day}</div>
              <div className="rec-dec">{clean(r.decision)}</div>
              <div className="quiet small">By {r.decided_by}, {fmt(r.decided_at, { month: 'short', day: 'numeric' })}</div>
            </div>
            <span className={`chip ${r.followed_recommendation ? 'green' : 'yellow'}`}>{r.followed_recommendation ? 'Followed advice' : 'Overrode advice'}</span>
          </div>
          <p className="rec-reason">“{clean(r.reason)}”</p>
          <details className="evidence" onToggle={(e) => e.target.open && load(r.record_id)}>
            <summary>Show evidence</summary>
            <div className="evidence-body">{detail[r.record_id] ? <Snapshot e={detail[r.record_id].evidence} /> : 'Loading…'}</div>
          </details>
        </section>
      ))}
    </div>
  )
}
function Snapshot({ e }) {
  const r = e.rules, i = e.inputs
  return (
    <ul className="bul">
      <li>Data as of {fmt(e.as_of, { month: 'short', day: 'numeric' })}</li>
      <li>System advice: {POSTURE[r.recommended]?.action || 'none'}, hazard {r.level} of 4</li>
      <li>{r.agencies.map((g) => `${g.code}: ${agencyAction(g)}`).join('; ')}</li>
      <li>🌊 {i.gauge ? `${i.gauge.stage_ft} ft at ${clean(i.gauge.name)}` : 'river data missing'}</li>
      <li>⚡ {i.outage ? `${i.outage.customers_out} of ${i.outage.customers_served} out` : 'outage data missing'}</li>
      <li>⚠️ {i.alerts ? (i.alerts.map((x) => x.event).join(', ') || 'no alerts') : 'NWS missing'}</li>
      <li>🏢 Power {i.facility_status?.power}, water {i.facility_status?.water}, roof {i.facility_status?.roof}, roads {i.facility_status?.roads}</li>
      <SignalList signals={r.signals} />
    </ul>
  )
}

/* ---------- ⚙️ Settings (localhost only) ---------- */
export function Settings({ onSaved }) {
  const [st, setSt] = useState(null)
  const [key, setKey] = useState('')
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { api.settings().then(setSt).catch((e) => setMsg({ tone: 'red', text: e.message })) }, [])
  const save = async () => {
    setBusy(true); setMsg(null)
    try { const r = await api.saveKey(key); setSt(r); setKey(''); setMsg({ tone: 'green', text: '✅ Key saved' }); onSaved?.() }
    catch (e) { setMsg({ tone: 'red', text: e.message }) } finally { setBusy(false) }
  }
  const test = async () => {
    setBusy(true); setMsg(null)
    try { const r = await api.testKey(); setMsg({ tone: 'green', text: `✅ Connected, using ${r.model_id}` }) }
    catch (e) { setMsg({ tone: 'red', text: e.message }) } finally { setBusy(false) }
  }
  return (
    <div className="page">
      <h2 className="page-h">⚙️ Settings</h2>
      <p className="tagline">Local demo only. In production the key comes from the server.</p>
      <section className="card fade settings">
        <div className="card-h">🔑 Anthropic API key</div>
        {st && <div className="row"><span className={`chip ${st.key_set ? 'green' : 'yellow'}`}>{st.key_set ? `Saved, ends in ${st.key_last4}` : 'No key yet'}</span>
          {st.model_id && <span className="chip blue">Model: {st.model_id}</span>}</div>}
        <input className="inp" type="password" autoComplete="off" placeholder="sk-ant-..." value={key} onChange={(e) => setKey(e.target.value)} />
        <div className="row">
          <button className="btn green" disabled={busy || key.length < 20} onClick={save}>Save key</button>
          <button className="btn" disabled={busy || !st?.key_set} onClick={test}>Test connection</button>
        </div>
        {msg && <div className={`alert ${msg.tone}`}>{msg.text}</div>}
        <ul className="bul small quiet">
          <li>Stored only in the local .env file</li>
          <li>Never saved in records or evidence</li>
          <li>AI runs only when the data changes</li>
        </ul>
      </section>
    </div>
  )
}
