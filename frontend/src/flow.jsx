import { useEffect, useRef, useState } from 'react'
import { api } from './api'
import Leaf from './Leaf'
import { OutageGauge, RoadStatus, WaterGauge, Wind } from './charts'
import {
  AGENCY_FULL, AGENCY_NAME, CHANNEL, LEVEL, POSTURE, STATUS, ago, clean,
  fmt, levelTone, personAction,
} from './lib'

const FACILITY = 'USDA Lake Charles Service Center'

export const STEP_META = {
  get_nws_alerts: ['NWS alerts'],
  get_forecast: ['Hourly forecast'],
  get_river_gauge: ['River level'],
  get_power_outages: ['Entergy outages'],
  get_road_closures: ['LA 511 roads'],
  get_facility_status: ['Building check'],
  get_roster: ['Staff roster'],
  evaluate_rules: ['Rules engine sets the hazard level'],
  draft_notifications: ['Notices prepared'],
  agent_write: ['Strands agent writes the rationale and notices'],
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
          <b>{clean(s.title)}</b>
          <span>Observed: {clean(s.observed)}</span>
          <span>Threshold: {clean(s.threshold)}, exceeded by {clean(s.exceed_by)}</span>
          <span>Basis: {clean(s.basis)}</span>
          <span className="src">Source: {clean(s.source)}, {fmt(s.at, { month: 'short', day: 'numeric' })}</span>
        </li>
      ))}
    </ul>
  )
}
export function CopyBtn({ text, label = 'Copy to email' }) {
  const [done, setDone] = useState(false)
  return (
    <button className="btn green" onClick={() => { navigator.clipboard?.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500) }}>
      {done ? '✓ Copied' : label}
    </button>
  )
}
function DateLines({ asOf, live = true }) {
  return (
    <div className="date-lines">
      <div><b>Data updated:</b> {ago(asOf)}{live ? ' (live)' : ''}</div>
    </div>
  )
}

/* ------------------------------------------------------------------ 7-day outlook */
export function Outlook({ days, nextDay }) {
  if (!days) return null
  return (
    <section className="fc">
      <h2 className="fc-h">7-day forecast</h2>
      <div className="fc-list">
        {days.map((d) => {
          const badge = d.date === days[0].date ? 'Today' : d.date === nextDay ? 'Next workday' : null
          return (
            <div key={d.date} className={`fc-row ${d.date === nextDay ? 'next' : ''} ${d.closed ? 'off' : ''}`} title={d.short || ''}>
              <div className="fc-day"><b>{d.weekday}</b><span>{d.label}</span></div>
              <div className="fc-e">{d.emoji}</div>
              <div className="fc-wx">{d.temp_f != null ? `${d.temp_f}°` : ''}{d.precip_pct ? <span> 💧{d.precip_pct}%</span> : null}</div>
              <div className="fc-rec">
                {badge && <span className="fc-badge">{badge}</span>}
                <span>{d.closed ? 'Office closed' : `${POSTURE[d.recommended]?.word || 'Decide'}, hazard ${d.level}`}</span>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ start page */
export function StartPage({ onStart }) {
  return (
    <div className="page startpage simple fade">
      <div className="sp-center">
        <h1 className="sp-name">{FACILITY}</h1>
        <button className="start-btn" onClick={() => onStart()}>Start analysis</button>
      </div>
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
    const [label] = STEP_META[tool]
    const state = !st ? 'wait' : st.status
    return (
      <div key={tool} className={`pcard ${state} ${running.includes(tool) ? 'now' : ''}`}>
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
    const [label] = STEP_META[tool]
    const state = !st ? 'wait' : st.status
    return (
      <div key={tool} className={`pwide ${state}`}>
        <div className="pc-main">
          <div className="pc-l">{label}</div>
          <div className="pc-r">{state === 'running' ? 'Working…' : state === 'done' ? shortSummary(st.summary) : state === 'error' ? shortSummary(st.summary) : 'Waiting'}</div>
          {tool === 'agent_write' && sq.agentCalls.length > 0 && <div className="agent-calls">{sq.agentCalls.map((t, i) => <span key={i} className="pop">{t}</span>)}</div>}
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
          <div className="ps-s">Seven live checks run in parallel, then the rules decide.</div>
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

const agencyLine = (g) => {
  const bits = [POSTURE[g.posture].action]
  if (g.field_work === 'suspended') bits.push('stop field work')
  if (g.field_work === 'restricted') bits.push('limit field work')
  return bits.join(', ')
}

export function ResultsPage({ a, situation, onReplay, onReanalyze, onDecide, pendingQuestion, clearPending, busy }) {
  const [scenario, setScenario] = useState(null)
  useEffect(() => { window.scrollTo(0, 0) }, [a.id])
  const r = scenario ? scenario.rules : a.rules
  const inp = scenario ? { ...a.inputs, ...scenario.inputs } : a.inputs
  const live = (a.inputs.alerts || []).filter((x) => !/Statement/.test(x.event))
  const w0 = Date.parse(r.window.start) - 2 * 3600e3, w1 = Date.parse(r.window.end)
  const work = inp.forecast?.periods?.filter((p) => Date.parse(p.start) >= w0 && Date.parse(p.start) < w1) || []
  const peak = work.length ? work.reduce((m, p) => (p.wind_mph > m.wind_mph ? p : m)) : null
  const fc = inp.gauge?.forecast?.filter((p) => Date.parse(p.t) <= Date.parse(r.window.start)).pop()
  const avail = scenario ? scenario.availability : a.notifications.availability
  const nowWind = scenario?.inputs?.forecast ? peak : inp.forecast?.periods?.[0]
  // later days that look worse than the next workday
  const worse = (situation?.outlook || []).filter((d) => !d.closed && d.date > r.window.date && d.level > r.level)

  return (
    <div className="page results-page">
      <div className="res-grid">
        <div className="res-main">
          <div className="res-head">
            <h1 className="res-name">{FACILITY}</h1>
            <DateLines asOf={a.as_of} />
          </div>

          <section className="tiles">
            <div className="tile reveal">
              <div className="tile-h">River <span className={`dot ${levelTone(maxLevel(r, 'gauge'))}`} /></div>
              {inp.gauge ? <div className="river-row"><WaterGauge key={inp.gauge.stage_ft} stage={inp.gauge.stage_ft} forecast={fc?.ft} stages={inp.gauge.flood_stages_ft} height={170} />
                <div className="keynum">{inp.gauge.stage_ft?.toFixed(1)}<small>ft</small></div></div> : <Missing />}
            </div>
            <div className="tile reveal">
              <div className="tile-h">Power <span className={`dot ${levelTone(maxLevel(r, 'power'))}`} /></div>
              {inp.outage ? <><OutageGauge key={inp.outage.pct} pct={inp.outage.pct} size={190} /><div className="keynum c">{inp.outage.customers_out.toLocaleString()}<small>homes out</small></div></> : <Missing />}
            </div>
            <div className="tile reveal">
              <div className="tile-h">Wind now <span className={`dot ${levelTone(maxLevel(r, 'wind'))}`} /></div>
              {nowWind ? <Wind mph={nowWind.wind_mph} /> : <Missing />}
              {peak && !scenario && <div className="tile-f">Peak {peak.wind_mph} mph on {r.window.day}</div>}
            </div>
            <div className="tile reveal">
              <div className="tile-h">Roads <span className={`dot ${levelTone(maxLevel(r, 'roads'))}`} /></div>
              <RoadStatus weatherClosures={inp.roads?.weather_related_closures || 0} manual={inp.facility_status?.roads} />
            </div>
          </section>

          {scenario && (
            <div className="hypo-bar">
              <span>Hypothetical, not saved: {scenario.changed.join(', ')}</span>
              <button className="btn sm" onClick={() => setScenario(null)}>Back to live data</button>
            </div>
          )}
          <section className={`card rec ${scenario ? 'hypo' : ''}`} key={'r' + (scenario ? scenario.changed.join() : 'live')}>
            <div className="card-h">Agent recommendation</div>
            <div className="tldr-h">TL;DR, next workday ({r.window.day})</div>
            <ul className="tldr">
              <li><b>Building:</b> {r.recommended ? POSTURE[r.recommended].action : 'Weather data missing, decide manually'}</li>
              {r.agencies.map((g) => <li key={g.code}><b>{AGENCY_FULL[g.code] || g.code}:</b> {agencyLine(g)}</li>)}
              <li><b>Hazard:</b> {r.level} of 4 ({LEVEL[r.level].name}), confidence {r.confidence.toLowerCase()}</li>
              {live.length > 0 && <li><b>Active NWS alerts:</b> {[...new Set(live.map((x) => x.event))].join(', ')}</li>}
              {worse.length > 0 && <li><b>Heads up:</b> {worse.map((d) => `${d.weekday} ${d.label} hazard ${d.level} (${POSTURE[d.recommended]?.word || 'decide'})`).join(', ')}</li>}
            </ul>
            {scenario ? <p className="small">The paragraph below is for live data. Hypotheticals are never saved.</p> : null}
            <p className="rationale">{clean(a.rationale)}</p>
            <div className="row between">
              <span className="small">{a.rationale_by === 'template' ? 'Rules decide the level. Template text.' : 'Rules decide the level. The agent wrote the words.'}</span>
              <CopyBtn text={clean(a.rationale)} />
            </div>
          </section>
        </div>

        <aside className="res-side">
          <div className="side-btns">
            <button className="btn green" onClick={onReplay}>Replay analysis</button>
            <button className="btn green" onClick={onReanalyze} disabled={busy}>Re-analyze</button>
          </div>
          {situation?.outlook && <Outlook days={situation.outlook} nextDay={r.window.date} />}
          <Ask a={a} onScenario={setScenario} pending={pendingQuestion} clearPending={clearPending} />
        </aside>
      </div>

      <div className="blocks">
        <Block title="Thresholds and sources" sub={`${r.signals.length} signals`}>
          <SignalList signals={r.signals} />
          <h4>What would change this</h4>
          <ul className="bul">{r.what_would_change.map((w, i) => <li key={i}>{clean(w)}</li>)}</ul>
        </Block>
        {!scenario && <Notices a={a} />}
        <Block title="People" sub={`${avail.total.on_site} on site, ${avail.total.telework} remote, ${avail.total.unavailable} unavailable`}>
          {!scenario ? <People a={a} /> : <p>Staff details are shown for live data only.</p>}
        </Block>
        {!scenario && <Block title="Building check" sub="Manual report"><FacilityCheck fs={a.inputs.facility_status} onSaved={onReanalyze} /></Block>}
      </div>
      <div className="center go"><button className="btn green huge" onClick={onDecide}>Go to decision →</button></div>
    </div>
  )
}
function Block({ title, sub, children }) {
  return (
    <details className="block">
      <summary><span>{title}</span>{sub && <span className="block-sub">{sub}</span>}</summary>
      <div className="block-body">{children}</div>
    </details>
  )
}

function Notices({ a }) {
  const pkg = a.notifications
  const [tab, setTab] = useState(0)
  const role = pkg.roles[tab]
  const title = (x) => x.agency ? x.title.replace(x.agency, AGENCY_NAME[x.agency]) : x.title
  return (
    <Block title="Notice drafts" sub="6 roles, preview only">
      <div className="role-tabs">
        {pkg.roles.map((x, i) => <button key={i} className={i === tab ? 'on' : ''} onClick={() => setTab(i)}>{title(x)}</button>)}
      </div>
      <div className="draft">
        <div className="draft-to">To: {clean(role.to)}</div>
        <div className="draft-subj">{clean(role.subject)}</div>
        <pre>{clean(role.body)}</pre>
        {role.programs && <div className="progs">{role.programs.map((p) => <span key={p.name} className={`chip ${p.status === 'continues' ? 'green' : p.status === 'limited' ? 'yellow' : 'red'}`}>{p.name}: {p.status}</span>)}</div>}
        <div className="row between"><span className="small">{role.written_by === 'agent' ? 'Drafted by the agent' : 'Template draft'}</span><CopyBtn text={`${clean(role.subject)}\n\n${clean(role.body)}`} label="Copy" /></div>
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
        <Stat n={t.on_site} label="On site" tone="green" />
        <Stat n={t.telework} label="Remote" tone="blue" />
        <Stat n={t.unavailable} label="Unavailable" tone="yellow" />
        <Stat n={pkg.employees.filter((e) => e.notify).length} label="To notify" tone="red" />
      </div>
      {['onsite', 'teleworking', 'on_detail', 'leave'].map((g) => {
        const list = pkg.employees.filter((e) => e.status === g)
        if (!list.length) return null
        const n = list.filter((e) => e.notify).length
        return (
          <details key={g} className="group">
            <summary><span>{STATUS[g].label}</span><span>{list.length} {list.length === 1 ? 'person' : 'people'}{n ? `, ${n} to notify` : ', no messages'}</span></summary>
            {list.map((e) => (
              <div key={e.id} className={`person ${e.notify ? 'yes' : 'no'}`}>
                <span className="bell" title={e.notify ? 'Notify' : 'Not notified'} />
                <span className="p-name">{e.name}</span>
                <span className="p-ag">{e.agency}{e.work_location === 'field' ? ', field' : ''}</span>
                <span className="p-act">{personAction(e, ags[e.agency])}{e.accessibility_needs ? ' (accessibility needs)' : ''}</span>
                <span className="p-ch">{e.channels.map((c) => <span key={c} className="ch">{CHANNEL[c]}</span>)}</span>
              </div>
            ))}
          </details>
        )
      })}
    </>
  )
}
function Stat({ n, label, tone }) {
  return <div className={`stat ${tone}`}><div className="stat-n">{n}</div><div className="stat-l">{label}</div></div>
}

function FacilityCheck({ fs, onSaved }) {
  const [s, setS] = useState(fs)
  const [saving, setSaving] = useState(false)
  useEffect(() => setS(fs), [fs])
  if (!s) return null
  const rows = [['power', ['ok', 'generator', 'out']], ['water', ['ok', 'out']], ['roof', ['ok', 'damaged']], ['roads', ['open', 'limited', 'impassable']]]
  const dirty = JSON.stringify(s) !== JSON.stringify(fs)
  return (
    <div className="fac">
      {rows.map(([k, vals]) => (
        <div key={k} className="fac-row">
          <span>{k}</span>
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
      <div className="card-h">Ask the agent</div>
      <div className="small">Hypotheticals run through the same rules and are never saved.</div>
      <div className="msgs" ref={box}>
        {msgs.map((m, i) => (
          <div key={i} className={`msg ${m.who}`}>
            {m.who === 'agent' && <Leaf size={28} />}
            <div className="bubble">
              {m.text}
              {m.tools?.length > 0 && <div className="tools">{m.tools.map((t, j) => <span key={j}>{t}</span>)}{m.hypo && <span className="hy">hypothetical</span>}</div>}
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
