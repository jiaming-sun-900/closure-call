import { useEffect, useRef, useState } from 'react'
import { api, streamAssess } from './api'
import Leaf from './Leaf'
import { AlertMap, LevelScale, OutageGauge, RoadStatus, WaterGauge, Wind } from './charts'
import {
  CHANNEL, KIND_EMOJI, LEVEL, POSTURE, STATUS, agencyAction, agencyTone, agencyWord, ago, clean, dateLong,
  fmt, levelTone, oneLiner, personAction,
} from './lib'

export const STEP_META = {
  get_nws_alerts: ['🌀', 'Checking NWS alerts'],
  get_forecast: ['💨', 'Reading the hourly forecast'],
  get_river_gauge: ['🌊', 'Checking the river level'],
  get_power_outages: ['⚡', 'Checking Entergy outages'],
  get_road_closures: ['🚗', 'Checking LA 511 roads'],
  get_facility_status: ['🏢', 'Reading the building check'],
  get_roster: ['👥', 'Loading the staff roster'],
  evaluate_rules: ['⚖️', 'Rules engine sets the level'],
  draft_notifications: ['📨', 'Preparing notices'],
  agent_write: ['✍️', 'Strands agent writes the rationale'],
}
const shortSummary = (tool, s = '') => clean(s)
  .replace(/^96 h hourly; /, '')
  .replace(/ Entergy customers out/, ' homes out')
  .replace(/\s*·\s*FSA.*$/, '')
  .replace(/; /g, ', ')

/* ------------------------------------------------------------------ progress (flight-search style) */
function useStepQueue() {
  // Events are played back with a small minimum gap so parallel calls are visible and cached runs still "play"
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
    timer.current = setTimeout(pump, 170)
  }
  const push = (ev) => { q.current.push(ev); if (!timer.current) pump() }
  const reset = () => { q.current = []; clearTimeout(timer.current); timer.current = null; setSteps({}); setOrder([]); setAgentCalls([]) }
  const drained = () => new Promise((res) => { const t = setInterval(() => { if (!q.current.length && !timer.current) { clearInterval(t); res() } }, 80) })
  return { steps, order, agentCalls, push, reset, drained }
}

function Progress({ sq, done }) {
  return (
    <div className="progress fade">
      <div className="progress-head">
        <Leaf size={56} />
        <div>
          <div className="progress-t">{done ? 'Analysis complete' : 'Analyzing Lake Charles Service Center…'}</div>
          <div className="quiet small">7 data checks run in parallel, then the rules decide</div>
        </div>
      </div>
      <ul className="steps">
        {sq.order.map((tool) => {
          const s = sq.steps[tool]
          const [ic, label] = STEP_META[tool] || ['🔧', tool]
          return (
            <li key={tool} className={`step ${s.status}`}>
              <span className="step-ic">{ic}</span>
              <span className="step-l">{label}</span>
              <span className="step-r">
                {s.status === 'running' ? <span className="spin" /> : s.status === 'done' ? <><b>✓</b> {shortSummary(tool, s.summary)}</> : <><b>!</b> {shortSummary(tool, s.summary)}</>}
              </span>
              {tool === 'agent_write' && sq.agentCalls.length > 0 && (
                <div className="agent-calls">{sq.agentCalls.map((t, i) => <span key={i} className="pop">🤖 {t}</span>)}</div>
              )}
            </li>
          )
        })}
      </ul>
      <div className="built">Built with the Strands Agents SDK</div>
    </div>
  )
}

/* ------------------------------------------------------------------ shared bits */
export function Evidence({ label = 'Show evidence', children, open }) {
  return (
    <details className="evidence" open={open}>
      <summary>{label}</summary>
      <div className="evidence-body">{children}</div>
    </details>
  )
}
function Block({ icon, title, sub, children, delay = 0 }) {
  return (
    <details className="block reveal" style={{ animationDelay: `${delay}s` }}>
      <summary><span>{icon} {title}</span>{sub && <span className="quiet">{sub}</span>}</summary>
      <div className="block-body">{children}</div>
    </details>
  )
}
export function SignalList({ signals }) {
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
export function CopyBtn({ text, label = '📋 Copy to email' }) {
  const [done, setDone] = useState(false)
  return (
    <button className="btn green" onClick={() => { navigator.clipboard?.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500) }}>
      {done ? '✓ Copied' : label}
    </button>
  )
}
const maxLevel = (r, kind) => Math.max(0, ...r.signals.filter((s) => s.kind === kind).map((s) => s.level))

/* ------------------------------------------------------------------ results */
function Results({ a, facility, scenario, onBackToLive, onStatusSaved }) {
  const r = scenario ? scenario.rules : a.rules
  const inp = scenario ? { ...a.inputs, ...scenario.inputs } : a.inputs
  const live = (a.inputs.alerts || []).filter((x) => !/Statement/.test(x.event))
  const w0 = Date.parse(r.window.start) - 2 * 3600e3, w1 = Date.parse(r.window.end)
  const work = inp.forecast?.periods?.filter((p) => Date.parse(p.start) >= w0 && Date.parse(p.start) < w1) || []
  const peak = work.length ? work.reduce((m, p) => (p.wind_mph > m.wind_mph ? p : m)) : null
  const fc = inp.gauge?.forecast?.filter((p) => Date.parse(p.t) <= Date.parse(r.window.start)).pop()
  const bTone = r.recommended ? POSTURE[r.recommended].tone : 'red'
  const pkg = a.notifications
  const avail = scenario ? scenario.availability : pkg.availability
  let d = 0
  const next = () => (d += 0.12)
  return (
    <div className={`results ${scenario ? 'hypo' : ''}`}>
      {scenario && (
        <div className="hypo-bar">
          <span>🧪 Hypothetical, not saved: {scenario.changed.join(', ')}</span>
          <button className="btn sm" onClick={onBackToLive}>Back to live data</button>
        </div>
      )}
      <section className="hero reveal" style={{ animationDelay: `${next()}s` }} key={'h' + (scenario ? 1 : 0)}>
        <Leaf size={84} />
        <div className="hero-text">
          <div className="hero-date">{dateLong(r)}{r.window.skipped.length ? ', next workday after Columbus Day' : ''}</div>
          <h1>{oneLiner(r)}</h1>
          <div className="hero-chips">
            <span className={`chip ${levelTone(r.level)}`}>Hazard {r.level} of 4: {LEVEL[r.level].name}</span>
            <span className="chip blue">Confidence {r.confidence.toLowerCase()}</span>
            {!scenario && <span className="chip ghost">Data {ago(a.as_of)}</span>}
          </div>
        </div>
      </section>

      <section className="tags">
        <Tag delay={next()} tone={bTone} icon="🏢" name="Building" word={r.recommended ? POSTURE[r.recommended].word : 'Decide'} sub={r.recommended ? POSTURE[r.recommended].action : 'Weather data missing'} />
        {r.agencies.map((g) => <Tag key={g.code + r.level} delay={next()} tone={agencyTone(g)} icon={g.code === 'NRCS' ? '🌱' : '🌾'} name={g.code} word={agencyWord(g)} sub={agencyAction(g)} />)}
      </section>

      <section className="tiles">
        <div className="tile wide reveal" style={{ animationDelay: `${next()}s` }}>
          <div className="tile-h">🗺 Alerts near the office <span className={`dot ${levelTone(maxLevel(r, 'nws'))}`} /></div>
          <AlertMap lat={facility.lat} lon={facility.lon} alerts={a.inputs.alerts || []} height={190} />
          <div className="tile-f">{live.length ? `${live.length} active: ${[...new Set(live.map((x) => x.event))].join(', ')}` : 'No active alerts'}</div>
        </div>
        <div className="tile reveal" style={{ animationDelay: `${next()}s` }}>
          <div className="tile-h">⚡ Power <span className={`dot ${levelTone(maxLevel(r, 'power'))}`} /></div>
          {inp.outage ? <><OutageGauge key={inp.outage.pct} pct={inp.outage.pct} size={170} /><div className="tile-big">{inp.outage.customers_out.toLocaleString()} <small>homes out</small></div></> : <Missing />}
        </div>
        <div className="tile reveal" style={{ animationDelay: `${next()}s` }}>
          <div className="tile-h">🌊 River <span className={`dot ${levelTone(maxLevel(r, 'gauge'))}`} /></div>
          {inp.gauge ? <div className="river-row"><WaterGauge key={inp.gauge.stage_ft} stage={inp.gauge.stage_ft} forecast={fc?.ft} stages={inp.gauge.flood_stages_ft} height={150} />
            <div className="tile-big">{inp.gauge.stage_ft?.toFixed(1)} <small>ft</small></div></div> : <Missing />}
        </div>
        <div className="tile reveal" style={{ animationDelay: `${next()}s` }}>
          <div className="tile-h">💨 Wind, {r.window.day} <span className={`dot ${levelTone(maxLevel(r, 'wind'))}`} /></div>
          {peak ? <Wind mph={peak.wind_mph} /> : <div className="quiet">Forecast not out yet</div>}
        </div>
        <div className="tile reveal" style={{ animationDelay: `${next()}s` }}>
          <div className="tile-h">🚗 Roads <span className={`dot ${levelTone(maxLevel(r, 'roads'))}`} /></div>
          <RoadStatus weatherClosures={inp.roads?.weather_related_closures || 0} manual={inp.facility_status?.roads} />
        </div>
      </section>

      {!scenario && (
        <section className="card reveal" style={{ animationDelay: `${next()}s` }}>
          <div className="card-h">🌿 Why we recommend this</div>
          <p className="rationale">{clean(a.rationale)}</p>
          <div className="row between">
            <span className="quiet small">{a.rationale_by === 'template' ? 'Rules decide the level. Text from template.' : 'Rules decide the level. The agent wrote the words.'}</span>
            <CopyBtn text={clean(a.rationale)} />
          </div>
        </section>
      )}

      <div className="blocks">
        <Block icon="⚖️" title="Thresholds and sources" sub={`${r.signals.length} signals`} delay={next()}>
          <SignalList signals={r.signals} />
          <h4>What would change this</h4>
          <ul className="bul">{r.what_would_change.map((w, i) => <li key={i}>{clean(w)}</li>)}</ul>
        </Block>
        <Block icon="🏛" title="Agencies" sub="Same data, different risk tolerance" delay={next()}>
          <div className="grid2">
            {r.agencies.map((g) => (
              <div key={g.code} className={`agency ${agencyTone(g)}`}>
                <div className="row between"><b className="ag-code">{g.code}</b><span className="chip ghost">{g.tolerance} tolerance</span></div>
                <div className={`ag-word ${agencyTone(g)}`}>{agencyWord(g)}</div>
                <div className="ag-action">{agencyAction(g)}</div>
                <LevelScale level={r.level} th={g.thresholds} />
                <div className="quiet small">{clean(g.tolerance_note)}</div>
              </div>
            ))}
          </div>
          <p className="quiet small">ℹ️ Rural Development is served from Lafayette, not this building.</p>
        </Block>
        {!scenario && <Notices a={a} delay={next()} />}
        <Block icon="👥" title="People" sub={`${avail.total.on_site} on site, ${avail.total.telework} remote, ${avail.total.unavailable} unavailable`} delay={next()}>
          {!scenario ? <People a={a} /> : <p className="quiet">Staff details are shown for live data only.</p>}
        </Block>
        {!scenario && (
          <Block icon="🏢" title="Building check" sub="Manual report" delay={next()}>
            <FacilityCheck fs={a.inputs.facility_status} onSaved={onStatusSaved} />
          </Block>
        )}
      </div>
    </div>
  )
}
const Missing = () => <div className="quiet">Data unavailable, treated as unknown</div>

function Tag({ tone, icon, name, word, sub, delay }) {
  return (
    <div className={`tag ${tone} reveal`} style={{ animationDelay: `${delay}s` }}>
      <div className="tag-name">{icon} {name}</div>
      <div className="tag-word">{word}</div>
      {sub && <div className="tag-sub">{sub}</div>}
    </div>
  )
}

function Notices({ a, delay }) {
  const pkg = a.notifications
  const [tab, setTab] = useState(0)
  const role = pkg.roles[tab]
  const roleIcon = { facility: '🏢', agency: '👥', program: '📋', executive: '⭐' }
  return (
    <Block icon="✉️" title="Notice drafts" sub="6 roles, preview only" delay={delay}>
      <div className="role-tabs">
        {pkg.roles.map((x, i) => <button key={i} className={i === tab ? 'on' : ''} onClick={() => setTab(i)}>{roleIcon[x.role]} {x.title}</button>)}
      </div>
      <div className="draft">
        <div className="draft-to">To: {clean(role.to)}</div>
        <div className="draft-subj">{clean(role.subject)}</div>
        <pre>{clean(role.body)}</pre>
        {role.programs && <div className="progs">{role.programs.map((p) => <span key={p.name} className={`chip ${p.status === 'continues' ? 'green' : p.status === 'limited' ? 'yellow' : 'red'}`}>{p.name}: {p.status}</span>)}</div>}
        <div className="row between"><span className="quiet small">{role.written_by === 'agent' ? 'Drafted by the agent' : 'Template draft'}</span><CopyBtn text={`${clean(role.subject)}\n\n${clean(role.body)}`} label="📋 Copy" /></div>
      </div>
    </Block>
  )
}

function People({ a }) {
  const pkg = a.notifications
  const ags = Object.fromEntries(a.rules.agencies.map((g) => [g.code, g]))
  const t = pkg.availability.total
  const nNotify = pkg.employees.filter((e) => e.notify).length
  return (
    <>
      <div className="stats">
        <Stat n={t.on_site} label="On site" tone="green" icon="🏢" />
        <Stat n={t.telework} label="Remote" tone="blue" icon="🏠" />
        <Stat n={t.unavailable} label="Unavailable" tone="yellow" icon="🌴" />
        <Stat n={nNotify} label="To notify" tone="red" icon="🔔" />
      </div>
      {['onsite', 'teleworking', 'on_detail', 'leave'].map((g) => {
        const list = pkg.employees.filter((e) => e.status === g)
        if (!list.length) return null
        const n = list.filter((e) => e.notify).length
        return (
          <details key={g} className="group">
            <summary><span>{STATUS[g].icon} {STATUS[g].label}</span><span className="quiet">{list.length} {list.length === 1 ? 'person' : 'people'}{n ? `, ${n} to notify` : ', no messages'}</span></summary>
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
      <div className="quiet small">Reported by {fs.updated_by}{fs.updated_at ? `, ${ago(fs.updated_at)}` : ''}</div>
    </div>
  )
}

/* ------------------------------------------------------------------ ask the agent */
const QUICK = ['What if the river rises to 6 feet?', 'What if outages reach 30%?', 'Why is FSA teleworking?']

function Ask({ a, onScenario }) {
  const [msgs, setMsgs] = useState([])
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const endRef = useRef(null)
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }) }, [msgs])
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
  return (
    <section className="card ask reveal">
      <div className="card-h">🤖 Ask the agent <span className="quiet small">Hypotheticals run through the same rules</span></div>
      <div className="msgs">
        {msgs.map((m, i) => (
          <div key={i} className={`msg ${m.who}`}>
            {m.who === 'agent' && <Leaf size={30} />}
            <div className="bubble">
              {m.text}
              {m.tools?.length > 0 && <div className="tools">{m.tools.map((t, j) => <span key={j}>🔧 {t}</span>)}{m.hypo && <span className="hy">🧪 hypothetical, not saved</span>}</div>}
            </div>
          </div>
        ))}
        {busy && <div className="msg agent"><Leaf size={30} /><div className="bubble typing"><span /><span /><span /></div></div>}
        <div ref={endRef} />
      </div>
      <div className="quick">{QUICK.map((x) => <button key={x} disabled={busy} onClick={() => send(x)}>{x}</button>)}</div>
      <form className="ask-row" onSubmit={(e) => { e.preventDefault(); send(q) }}>
        <input className="inp" placeholder="Ask about this recommendation…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn green" disabled={busy || !q.trim()}>Ask</button>
      </form>
    </section>
  )
}

/* ------------------------------------------------------------------ page */
export function Analyze({ a, setA, facility, simulate, go }) {
  const sq = useStepQueue()
  const [phase, setPhase] = useState(a ? 'results' : 'start')
  const [error, setError] = useState(null)
  const [scenario, setScenario] = useState(null)
  const stop = useRef(null)
  useEffect(() => () => stop.current?.(), [])

  const start = () => {
    sq.reset(); setError(null); setScenario(null); setPhase('running')
    stop.current = streamAssess(simulate, async (ev) => {
      if (ev.type === 'step') sq.push(ev)
      else if (ev.type === 'result') {
        await sq.drained()
        setTimeout(() => { setA(ev.assessment); setPhase('results') }, 450)
      } else if (ev.type === 'error') { setError(ev.message); setPhase(a ? 'results' : 'start') }
    })
  }
  const replay = () => {
    sq.reset(); setPhase('replay')
    const tr = a.trace
    tr.forEach((t) => { if (t.by !== 'agent' || t.tool === 'agent_write') sq.push({ type: 'step', tool: t.tool, status: 'running', by: t.by }) })
    tr.forEach((t) => sq.push({ type: 'step', ...t, status: t.ok ? 'done' : 'error' }))
  }

  if (phase === 'start') {
    return (
      <div className="page start fade">
        <Leaf size={150} />
        <h1>Should the office open?</h1>
        <p className="quiet">{facility?.name}, {facility?.parish}</p>
        <button className="btn green huge" onClick={start}>🔍 Start analysis</button>
        {error && <div className="alert red">{error}</div>}
        <div className="built">Live NWS, river, power and road data · Built with the Strands Agents SDK</div>
      </div>
    )
  }
  if (phase === 'running' || phase === 'replay') {
    const done = phase === 'replay' && sq.order.length > 0 && sq.order.every((t) => sq.steps[t].status !== 'running')
    return (
      <div className="page">
        <Progress sq={sq} done={done} />
        {phase === 'replay' && <div className="center"><button className="btn green" onClick={() => setPhase('results')}>Back to results</button></div>}
      </div>
    )
  }
  return (
    <div className="page">
      <div className="row between toolbar">
        <span className="quiet small">{a.agent_cached ? 'Data unchanged, agent result reused' : `Analysis took ${a.elapsed_s}s`}</span>
        <div className="row">
          <button className="btn sm" onClick={replay}>▶ Replay analysis</button>
          <button className="btn sm" onClick={start}>🔄 Re-analyze</button>
        </div>
      </div>
      <Results a={a} facility={facility} scenario={scenario} onBackToLive={() => setScenario(null)} onStatusSaved={start} />
      <Ask a={a} onScenario={setScenario} />
      <div className="center go"><button className="btn green huge" onClick={() => go('decide')}>Go to decision →</button></div>
    </div>
  )
}
