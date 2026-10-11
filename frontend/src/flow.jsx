import { useEffect, useRef, useState } from 'react'
import { api } from './api'
import Leaf from './Leaf'
import { AlertMap, LevelScale, OutageGauge, RoadStatus, WaterGauge, Wind } from './charts'
import {
  AGENCY_FULL, AGENCY_NAME, CHANNEL, KIND_EMOJI, LEVEL, POSTURE, STATUS, agencyAction, agencyTone, agencyWord, ago, clean,
  dayLong, fmt, levelTone, oneLiner, personAction,
} from './lib'

const FACILITY = 'USDA Lake Charles Service Center'
const PLACE = 'Calcasieu Parish, Louisiana'

export const STEP_META = {
  get_nws_alerts: ['🌀', 'NWS alerts'],
  get_forecast: ['💨', 'Hourly forecast'],
  get_river_gauge: ['🌊', 'River level'],
  get_power_outages: ['⚡', 'Entergy outages'],
  get_road_closures: ['🚗', 'LA 511 roads'],
  get_facility_status: ['🏢', 'Building check'],
  get_roster: ['👥', 'Staff roster'],
  evaluate_rules: ['⚖️', 'Rules engine sets the hazard level'],
  draft_notifications: ['📨', 'Notices prepared'],
  agent_write: ['✍️', 'Strands agent writes the rationale and notices'],
}
const DATA_TOOLS = Object.keys(STEP_META).slice(0, 7)
const shortSummary = (s = '') => clean(s)
  .replace(/^7-day hourly; /, '')
  .replace(/ Entergy customers out/, ' homes out')
  .replace(/\s*·\s*FSA.*$/, '')
  .replace(/; /g, ', ')
  .replace(/ \(Saltwater Barrier\)/, '')

/* ------------------------------------------------------------------ shared */
export function Evidence({ label = 'Show evidence', children }) {
  return <details className="evidence"><summary>{label}</summary><div className="evidence-body">{children}</div></details>
}
export function SignalList({ signals }) {
  if (!signals.length) return <p>Nothing crossed a threshold.</p>
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
export function CopyBtn({ text, label = '📋 Copy to email' }) {
  const [done, setDone] = useState(false)
  return (
    <button className="btn green" onClick={() => { navigator.clipboard?.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500) }}>
      {done ? '✓ Copied' : label}
    </button>
  )
}
function FacilityTitle({ small }) {
  return (
    <div className={`fac-title ${small ? 'small' : ''}`}>
      <div className="fac-name">{FACILITY}</div>
      <div className="fac-place">📍 {PLACE}</div>
    </div>
  )
}
function DateLines({ asOf, dayIso, skipped, live = true }) {
  return (
    <div className="date-lines">
      <div>🕒 <b>Data updated:</b> {ago(asOf)}{live ? ' (live)' : ''}</div>
      {dayIso && <div>📅 <b>Decision for:</b> {dayLong(dayIso)}</div>}
    </div>
  )
}

/* ------------------------------------------------------------------ 7-day outlook */
export function Outlook({ days, selected, onPick, busy }) {
  if (!days) return null
  return (
    <section className="outlook">
      <h2 className="sec-h">7-day outlook</h2>
      <div className="days">
        {days.map((d) => {
          const tone = d.closed ? 'grey' : levelTone(d.level)
          return (
            <button key={d.date} className={`day ${tone} ${selected === d.date ? 'sel' : ''}`} disabled={!!d.closed || busy}
              onClick={() => onPick(d.date)} title={d.short || ''}>
              {d.date === days[0].date && <div className="day-today">Today</div>}
              <div className="day-w">{d.weekday}</div>
              <div className="day-d">{d.label}</div>
              <div className="day-e">{d.emoji}</div>
              {d.closed ? <div className="day-closed">Office closed</div> : (
                <>
                  <div className="day-lv">Hazard {d.level}</div>
                  <div className="day-c">Confidence {d.confidence.toLowerCase()}</div>
                </>
              )}
            </button>
          )
        })}
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ start page */
export function StartPage({ situation, onStart, selected, setSelected }) {
  const s = situation
  const riverTone = !s?.river ? 'grey' : s.river.stage_ft >= (s.river.flood_stages_ft.moderate || 99) ? 'red' : s.river.stage_ft >= (s.river.flood_stages_ft.minor || 99) ? 'yellow' : 'green'
  const outTone = !s?.outage ? 'grey' : s.outage.pct >= 25 ? 'red' : s.outage.pct >= 3 ? 'yellow' : 'green'
  const windTone = !s?.current ? 'grey' : s.current.wind_mph >= 40 ? 'red' : s.current.wind_mph >= 25 ? 'yellow' : 'green'
  return (
    <div className="page startpage fade">
      <header className="sp-head">
        <div>
          <h1 className="sp-name">{FACILITY}</h1>
          <div className="sp-meta">
            <span>📍 5417 Gerstner Memorial Dr, Lake Charles, {PLACE}</span>
            {s && <span>📅 Decision for {dayLong(selected || s.next_workday)}</span>}
          </div>
        </div>
        <div className="start-col">
          <button className="start-btn" onClick={() => onStart()}>Start analysis</button>
          <div className="start-note">🕒 Data updated {s ? ago(s.as_of) : '…'}</div>
        </div>
      </header>

      <section className="sp-live">
        <div className="sp-map">
          <AlertMap lat={30.163142} lon={-93.17974} alerts={s?.alerts || []} height="100%" zoom={8} labels
            wind={s?.current && { dir: s.current.wind_dir, mph: s.current.wind_mph }} hideWindBadge />
        </div>
        <div className="sp-stats">
          <LiveStat icon={s?.current?.emoji || '🌡'} label="Temperature" value={s?.current ? `${s.current.temp_f}°F` : '…'} note={s?.current?.short} tone="blue" />
          <LiveStat icon="💨" label="Wind" value={s?.current ? `${s.current.wind_mph} mph` : '…'} note={s?.current ? `From the ${({ N: 'north', S: 'south', E: 'east', W: 'west' })[s.current.wind_dir] || s.current.wind_dir}` : ''} tone={windTone} />
          <LiveStat icon="🌊" label="Calcasieu River" value={s?.river ? `${s.river.stage_ft.toFixed(1)} ft` : '…'} note={s?.river ? `Minor flood at ${s.river.flood_stages_ft.minor} ft` : ''} tone={riverTone} />
          <LiveStat icon="⚡" label="Power outages" value={s?.outage ? s.outage.customers_out.toLocaleString() : '…'} note={s?.outage ? `of ${s.outage.customers_served.toLocaleString()} homes` : ''} tone={outTone} />
        </div>
      </section>

      <Outlook days={s?.outlook} selected={selected || s?.next_workday} onPick={(d) => { setSelected(d); onStart(d) }} />
    </div>
  )
}
function LiveStat({ icon, label, value, note, tone, wide }) {
  return (
    <div className={`livestat ${tone} ${wide ? 'wide' : ''}`}>
      <div className="ls-l">{icon} {label}</div>
      <div className="ls-v">{value}</div>
      <div className="ls-n">{note}</div>
    </div>
  )
}

/* ------------------------------------------------------------------ progress */
export function Progress({ sq, dayIso }) {
  const running = sq.order.filter((t) => sq.steps[t]?.status === 'running')
  const card = (tool) => {
    const st = sq.steps[tool]
    const [ic, label] = STEP_META[tool]
    const state = !st ? 'wait' : st.status
    return (
      <div key={tool} className={`pcard ${state} ${running.includes(tool) ? 'now' : ''}`}>
        <div className="pc-ic">{ic}</div>
        <div className="pc-main">
          <div className="pc-l">{label}</div>
          <div className="pc-r">{state === 'running' ? 'Checking…' : state === 'done' ? shortSummary(st.summary) : state === 'error' ? 'Unavailable' : 'Waiting'}</div>
        </div>
        <div className="pc-s">{state === 'running' ? <span className="spin" /> : state === 'done' ? '✓' : state === 'error' ? '!' : ''}</div>
      </div>
    )
  }
  const wide = (tool) => {
    const st = sq.steps[tool]
    const [ic, label] = STEP_META[tool]
    const state = !st ? 'wait' : st.status
    return (
      <div key={tool} className={`pwide ${state}`}>
        <div className="pc-ic big">{ic}</div>
        <div className="pc-main">
          <div className="pc-l">{label}</div>
          <div className="pc-r">{state === 'running' ? 'Working…' : state === 'done' ? shortSummary(st.summary) : state === 'error' ? shortSummary(st.summary) : 'Waiting'}</div>
          {tool === 'agent_write' && sq.agentCalls.length > 0 && <div className="agent-calls">{sq.agentCalls.map((t, i) => <span key={i} className="pop">🤖 {t}</span>)}</div>}
        </div>
        <div className="pc-s">{state === 'running' ? <span className="spin big" /> : state === 'done' ? '✓' : ''}</div>
      </div>
    )
  }
  return (
    <div className="progress-screen fade">
      <div className="ps-head">
        <Leaf size={52} />
        <div>
          <div className="ps-t">Analyzing {FACILITY}</div>
          <div className="ps-s">For {dayLong(dayIso)}. Seven live checks run in parallel, then the rules decide.</div>
        </div>
      </div>
      <div className="pgrid">{DATA_TOOLS.map(card)}</div>
      {wide('evaluate_rules')}
      {wide('agent_write')}
      <div className="built center">Built with the Strands Agents SDK</div>
    </div>
  )
}

/* ------------------------------------------------------------------ results */
const maxLevel = (r, kind) => Math.max(0, ...r.signals.filter((s) => s.kind === kind).map((s) => s.level))
const Missing = () => <div>Data unavailable, treated as unknown</div>

export function ResultsPage({ a, facility, situation, onReplay, onReanalyze, onPickDay, onDecide, pendingQuestion, clearPending, busy }) {
  const [scenario, setScenario] = useState(null)
  useEffect(() => { window.scrollTo(0, 0) }, [a.id])
  const r = scenario ? scenario.rules : a.rules
  const inp = scenario ? { ...a.inputs, ...scenario.inputs } : a.inputs
  const live = (a.inputs.alerts || []).filter((x) => !/Statement/.test(x.event))
  const w0 = Date.parse(r.window.start) - 2 * 3600e3, w1 = Date.parse(r.window.end)
  const work = inp.forecast?.periods?.filter((p) => Date.parse(p.start) >= w0 && Date.parse(p.start) < w1) || []
  const peak = work.length ? work.reduce((m, p) => (p.wind_mph > m.wind_mph ? p : m)) : null
  const fc = inp.gauge?.forecast?.filter((p) => Date.parse(p.t) <= Date.parse(r.window.start)).pop()
  const bTone = r.recommended ? POSTURE[r.recommended].tone : 'red'
  const avail = scenario ? scenario.availability : a.notifications.availability

  return (
    <div className="page results-page">
      <div className="res-top">
        <div>
          <FacilityTitle small />
          <DateLines asOf={a.as_of} dayIso={a.rules.window.date} skipped={a.rules.window.skipped} />
        </div>
        <div className="row">
          <button className="btn green" onClick={onReplay}>▶ Replay analysis</button>
          <button className="btn green" onClick={onReanalyze} disabled={busy}>🔄 Re-analyze</button>
        </div>
      </div>

      <div className="res-grid">
        <div className="res-main">
          {scenario && (
            <div className="hypo-bar">
              <span>🧪 Hypothetical, not saved: {scenario.changed.join(', ')}</span>
              <button className="btn sm" onClick={() => setScenario(null)}>Back to live data</button>
            </div>
          )}
          <section className={`hero reveal ${scenario ? 'hypo' : ''}`} key={'h' + (scenario ? scenario.changed.join() : 'live')}>
            <div className="hero-text">
              <h1>{oneLiner(r)}</h1>
              <div className="hero-chips">
                <span className={`chip ${levelTone(r.level)}`}>Hazard {r.level} of 4: {LEVEL[r.level].name}</span>
                <span className="chip blue">Confidence {r.confidence.toLowerCase()}</span>
              </div>
            </div>
          </section>

          <section className="tags">
            <Tag tone={bTone} icon="🏢" name="Building" word={r.recommended ? POSTURE[r.recommended].word : 'Decide'} sub={r.recommended ? POSTURE[r.recommended].action : 'Weather data missing'} />
            {r.agencies.map((g) => <Tag key={g.code + r.level} tone={agencyTone(g)} icon={g.code === 'NRCS' ? '🌱' : '🌾'} name={AGENCY_FULL[g.code]} word={agencyWord(g)} sub={agencyAction(g)} />)}
          </section>

          <section className="tiles">
            <div className="tile wide reveal">
              <div className="tile-h">🗺 Alerts near the office <span className={`dot ${levelTone(maxLevel(r, 'nws'))}`} /></div>
              <AlertMap lat={facility.lat} lon={facility.lon} alerts={a.inputs.alerts || []} height={230} />
              <div className="tile-f">{live.length ? `${live.length} active: ${[...new Set(live.map((x) => x.event))].join(', ')}` : 'No active alerts'}</div>
            </div>
            <div className="tile reveal">
              <div className="tile-h">🌊 River <span className={`dot ${levelTone(maxLevel(r, 'gauge'))}`} /></div>
              {inp.gauge ? <div className="river-row"><WaterGauge key={inp.gauge.stage_ft} stage={inp.gauge.stage_ft} forecast={fc?.ft} stages={inp.gauge.flood_stages_ft} height={170} />
                <div className="keynum">{inp.gauge.stage_ft?.toFixed(1)}<small>ft</small></div></div> : <Missing />}
            </div>
            <div className="tile reveal">
              <div className="tile-h">⚡ Power <span className={`dot ${levelTone(maxLevel(r, 'power'))}`} /></div>
              {inp.outage ? <><OutageGauge key={inp.outage.pct} pct={inp.outage.pct} size={190} /><div className="keynum c">{inp.outage.customers_out.toLocaleString()}<small>homes out</small></div></> : <Missing />}
            </div>
            <div className="tile reveal">
              <div className="tile-h">💨 Wind, {r.window.day} <span className={`dot ${levelTone(maxLevel(r, 'wind'))}`} /></div>
              {peak ? <Wind mph={peak.wind_mph} /> : <div>Forecast not out yet</div>}
            </div>
            <div className="tile reveal">
              <div className="tile-h">🚗 Roads <span className={`dot ${levelTone(maxLevel(r, 'roads'))}`} /></div>
              <RoadStatus weatherClosures={inp.roads?.weather_related_closures || 0} manual={inp.facility_status?.roads} />
            </div>
          </section>

          {situation?.outlook && <Outlook days={situation.outlook} selected={a.rules.window.date} onPick={onPickDay} busy={busy} />}

          <div className="blocks">
            <Block icon="⚖️" title="Thresholds and sources" sub={`${r.signals.length} signals`}>
              <SignalList signals={r.signals} />
              <h4>What would change this</h4>
              <ul className="bul">{r.what_would_change.map((w, i) => <li key={i}>{clean(w)}</li>)}</ul>
            </Block>
            <Block icon="🏛" title="Agencies" sub="Same data, different risk tolerance">
              <div className="grid2">
                {r.agencies.map((g) => (
                  <div key={g.code} className={`agency ${agencyTone(g)}`}>
                    <div className="ag-code">{AGENCY_NAME[g.code]} ({g.code})</div>
                    <span className="chip ghost">{g.tolerance} risk tolerance</span>
                    <div className={`ag-word ${agencyTone(g)}`}>{agencyWord(g)}</div>
                    <div className="ag-action">{agencyAction(g)}</div>
                    <LevelScale level={r.level} th={g.thresholds} />
                    <div className="small">{clean(g.tolerance_note)}</div>
                  </div>
                ))}
              </div>
              <p className="small">ℹ️ Rural Development is served from Lafayette, not this building.</p>
            </Block>
            {!scenario && <Notices a={a} />}
            <Block icon="👥" title="People" sub={`${avail.total.on_site} on site, ${avail.total.telework} remote, ${avail.total.unavailable} unavailable`}>
              {!scenario ? <People a={a} /> : <p>Staff details are shown for live data only.</p>}
            </Block>
            {!scenario && <Block icon="🏢" title="Building check" sub="Manual report"><FacilityCheck fs={a.inputs.facility_status} onSaved={onReanalyze} /></Block>}
          </div>
          <div className="center go"><button className="btn green huge" onClick={onDecide}>Go to decision →</button></div>
        </div>

        <aside className="res-side">
          <section className="card">
            <div className="card-h">🌿 Why we recommend this</div>
            <p className="rationale">{clean(a.rationale)}</p>
            <div className="row between">
              <span className="small">{a.rationale_by === 'template' ? 'Rules decide the level. Template text.' : 'Rules decide the level. The agent wrote the words.'}</span>
              <CopyBtn text={clean(a.rationale)} />
            </div>
          </section>
          <Ask a={a} onScenario={setScenario} pending={pendingQuestion} clearPending={clearPending} />
        </aside>
      </div>
    </div>
  )
}

function Block({ icon, title, sub, children }) {
  return (
    <details className="block">
      <summary><span>{icon} {title}</span>{sub && <span className="block-sub">{sub}</span>}</summary>
      <div className="block-body">{children}</div>
    </details>
  )
}
function Tag({ tone, icon, name, word, sub }) {
  return (
    <div className={`tag ${tone} reveal`}>
      <div className="tag-name">{icon} {name}</div>
      <div className="tag-word">{word}</div>
      {sub && <div className="tag-sub">{sub}</div>}
    </div>
  )
}

function Notices({ a }) {
  const pkg = a.notifications
  const [tab, setTab] = useState(0)
  const role = pkg.roles[tab]
  const roleIcon = { facility: '🏢', agency: '👥', program: '📋', executive: '⭐' }
  const title = (x) => x.agency ? x.title.replace(x.agency, AGENCY_NAME[x.agency]) : x.title
  return (
    <Block icon="✉️" title="Notice drafts" sub="6 roles, preview only">
      <div className="role-tabs">
        {pkg.roles.map((x, i) => <button key={i} className={i === tab ? 'on' : ''} onClick={() => setTab(i)}>{roleIcon[x.role]} {title(x)}</button>)}
      </div>
      <div className="draft">
        <div className="draft-to">To: {clean(role.to)}</div>
        <div className="draft-subj">{clean(role.subject)}</div>
        <pre>{clean(role.body)}</pre>
        {role.programs && <div className="progs">{role.programs.map((p) => <span key={p.name} className={`chip ${p.status === 'continues' ? 'green' : p.status === 'limited' ? 'yellow' : 'red'}`}>{p.name}: {p.status}</span>)}</div>}
        <div className="row between"><span className="small">{role.written_by === 'agent' ? 'Drafted by the agent' : 'Template draft'}</span><CopyBtn text={`${clean(role.subject)}\n\n${clean(role.body)}`} label="📋 Copy" /></div>
      </div>
    </Block>
  )
}

function People({ a }) {
  const pkg = a.notifications
  const ags = Object.fromEntries(a.rules.agencies.map((g) => [g.code, g]))
  const t = pkg.availability.total
  return (
    <>
      <div className="stats">
        <Stat n={t.on_site} label="On site" tone="green" icon="🏢" />
        <Stat n={t.telework} label="Remote" tone="blue" icon="🏠" />
        <Stat n={t.unavailable} label="Unavailable" tone="yellow" icon="🌴" />
        <Stat n={pkg.employees.filter((e) => e.notify).length} label="To notify" tone="red" icon="🔔" />
      </div>
      {['onsite', 'teleworking', 'on_detail', 'leave'].map((g) => {
        const list = pkg.employees.filter((e) => e.status === g)
        if (!list.length) return null
        const n = list.filter((e) => e.notify).length
        return (
          <details key={g} className="group">
            <summary><span>{STATUS[g].icon} {STATUS[g].label}</span><span>{list.length} {list.length === 1 ? 'person' : 'people'}{n ? `, ${n} to notify` : ', no messages'}</span></summary>
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
    </>
  )
}
function Stat({ n, label, tone, icon }) {
  return <div className={`stat ${tone}`}><div className="stat-n">{n}</div><div className="stat-l">{icon} {label}</div></div>
}

function FacilityCheck({ fs, onSaved }) {
  const [s, setS] = useState(fs)
  const [saving, setSaving] = useState(false)
  useEffect(() => setS(fs), [fs])
  if (!s) return null
  const rows = [['⚡', 'power', ['ok', 'generator', 'out']], ['🚰', 'water', ['ok', 'out']], ['🏠', 'roof', ['ok', 'damaged']], ['🚗', 'roads', ['open', 'limited', 'impassable']]]
  const dirty = JSON.stringify(s) !== JSON.stringify(fs)
  return (
    <div className="fac">
      {rows.map(([ic, k, vals]) => (
        <div key={k} className="fac-row">
          <span>{ic} {k}</span>
          <div className="seg">{vals.map((v) => <button key={v} className={s[k] === v ? (v === 'ok' || v === 'open' ? 'on green' : 'on red') : ''} onClick={() => setS({ ...s, [k]: v })}>{v}</button>)}</div>
        </div>
      ))}
      {dirty && <button className="btn green" disabled={saving} onClick={async () => { setSaving(true); await api.setStatus(s); setSaving(false); onSaved() }}>{saving ? 'Saving…' : 'Save and re-analyze'}</button>}
      <div className="small">Reported by {fs.updated_by}{fs.updated_at ? `, ${ago(fs.updated_at)}` : ''}</div>
    </div>
  )
}

/* ------------------------------------------------------------------ ask the agent */
const QUICK = ['What if the river rises to 6 feet?', 'What if outages reach 30%?', 'Why is FSA teleworking?']

function Ask({ a, onScenario, pending, clearPending }) {
  const [msgs, setMsgs] = useState([])
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const box = useRef(null)
  useEffect(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight }, [msgs, busy]) // scroll inside the chat, never the page
  const send = async (question) => {
    if (!question.trim() || busy) return
    setMsgs((m) => [...m, { who: 'me', text: question }])
    setQ(''); setBusy(true)
    try {
      const res = await api.ask(a.id, question)
      setMsgs((m) => [...m, { who: 'agent', text: clean(res.answer), tools: res.trace, hypo: !!res.scenario }])
      onScenario(res.scenario || null)
    } catch (e) {
      setMsgs((m) => [...m, { who: 'agent', text: e.message }])
    } finally { setBusy(false) }
  }
  useEffect(() => { if (pending) { send(pending); clearPending() } }, [pending]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <section className="card ask">
      <div className="card-h">🤖 Ask the agent</div>
      <div className="small">Hypotheticals run through the same rules and are never saved.</div>
      <div className="msgs" ref={box}>
        {msgs.map((m, i) => (
          <div key={i} className={`msg ${m.who}`}>
            {m.who === 'agent' && <Leaf size={28} />}
            <div className="bubble">
              {m.text}
              {m.tools?.length > 0 && <div className="tools">{m.tools.map((t, j) => <span key={j}>🔧 {t}</span>)}{m.hypo && <span className="hy">🧪 hypothetical</span>}</div>}
            </div>
          </div>
        ))}
        {busy && <div className="msg agent"><Leaf size={28} /><div className="bubble typing"><span /><span /><span /></div></div>}
      </div>
      <div className="quick">{QUICK.map((x) => <button key={x} disabled={busy} onClick={() => send(x)}>{x}</button>)}</div>
      <form className="ask-row" onSubmit={(e) => { e.preventDefault(); send(q) }}>
        <input className="inp" placeholder="Ask about this recommendation…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn green" disabled={busy || !q.trim()}>Ask</button>
      </form>
    </section>
  )
}

/* ------------------------------------------------------------------ step queue (shared by live runs and replays) */
export function useStepQueue() {
  const [steps, setSteps] = useState({})
  const [order, setOrder] = useState([])
  const [agentCalls, setAgentCalls] = useState([])
  const q = useRef([])
  const timer = useRef(null)
  const apply = (ev) => {
    if (ev.by === 'agent' && ev.tool !== 'agent_write') {
      if (ev.status !== 'running') setAgentCalls((c) => [...c, ev.tool])
      return
    }
    setOrder((o) => (o.includes(ev.tool) ? o : [...o, ev.tool]))
    setSteps((s) => ({ ...s, [ev.tool]: { ...s[ev.tool], ...ev } }))
  }
  const pump = () => {
    if (!q.current.length) { timer.current = null; return }
    apply(q.current.shift())
    timer.current = setTimeout(pump, 200)
  }
  const push = (ev) => { q.current.push(ev); if (!timer.current) pump() }
  const reset = () => { q.current = []; clearTimeout(timer.current); timer.current = null; setSteps({}); setOrder([]); setAgentCalls([]) }
  const drained = () => new Promise((res) => { const t = setInterval(() => { if (!q.current.length && !timer.current) { clearInterval(t); res() } }, 80) })
  return { steps, order, agentCalls, push, reset, drained }
}
