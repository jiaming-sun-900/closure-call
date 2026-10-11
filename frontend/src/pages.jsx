import { useEffect, useState } from 'react'
import { api } from './api'
import { CopyBtn, SignalTable, Sources } from './flow'
import Leaf from './Leaf'
import { POSTURE, agencyAction, clean, dayLong, fmt } from './lib'

/* ---------- Decide ---------- */
export function Decide({ a, situation, chosen, setChosen, go }) {
  if (!a) return <div className="page start fade"><h2 className="page-h">Make the Call</h2><p className="quiet">Run an analysis first.</p><button className="btn green huge" onClick={() => go('start')}>Start Analysis</button></div>
  return <DecideInner a={a} situation={situation} chosen={chosen} setChosen={setChosen} go={go} />
}

function DecideInner({ a, situation, chosen, setChosen, go }) {
  const r = a.rules
  const [custom, setCustom] = useState('')
  const [reason, setReason] = useState('')
  const [by, setBy] = useState('')
  const [done, setDone] = useState(null)
  const [popup, setPopup] = useState(false)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const ok = chosen && by.trim() && reason.trim().length >= 15 && (chosen !== 'CUSTOM' || custom.trim())
  const submit = async () => {
    setBusy(true); setErr(null)
    try {
      const rec = await api.decide({ assessment_id: a.id, option: chosen, custom_text: custom, reason, decided_by: by })
      setDone(rec); setPopup(true); setReason('')
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  return (
    <div className="page decide-page">
      <h2 className="page-h">Make the Call</h2>
      <p className="dec-when">{whenNote(r.window, situation?.outlook?.[0])}</p>
      <section className="dec-sec">
        <h3 className="dec-h">1. Building Status for {dayLong(r.window.date)}</h3>
        <div className="radios" role="radiogroup">
          {[...r.options.map((o) => ({ key: o.key, label: POSTURE[o.key].action, rec: o.recommended })), { key: 'CUSTOM', label: 'Write My Own' }].map((o) => (
            <label key={o.key} className={`radio ${chosen === o.key ? 'on' : ''} ${o.key === 'CUSTOM' ? 'custom' : ''}`}>
              <input type="radio" name="decision" checked={chosen === o.key} onChange={() => setChosen(o.key)} />
              <span className="radio-t">{o.label}</span>
              {o.rec && <span className="radio-rec">Recommended</span>}
            </label>
          ))}
        </div>
        {chosen === 'CUSTOM' && <input className="inp" placeholder="Your decision, for example: Open 10 AM to 2 PM" value={custom} onChange={(e) => setCustom(e.target.value)} />}
      </section>
      <section className="dec-sec">
        <h3 className="dec-h">2. Your Reason</h3>
        <textarea className="inp" rows={4} placeholder="What did you weigh? This is saved with all the evidence." value={reason} onChange={(e) => setReason(e.target.value)} />
      </section>
      <section className="dec-sec">
        <h3 className="dec-h">3. Decided By</h3>
        <div className="row">
          <input className="inp by" value={by} placeholder="Your name and title" onChange={(e) => setBy(e.target.value)} aria-label="Decided by" />
          <button className="btn green big" disabled={!ok || busy} onClick={submit}>{busy ? 'Saving…' : 'Submit Decision'}</button>
        </div>
      </section>
      {!ok && <div className="quiet small">Pick an option, write at least one sentence, and enter your name.</div>}
      {err && <div className="alert red">{err}</div>}
      {done && (
        <section className="dec-sec">
          <h3 className="dec-h">4. Share the Decision</h3>
          <pre className="share">{shareText(done, a)}</pre>
          <CopyBtn text={shareText(done, a)} label="Copy to Email" />
        </section>
      )}
      {done && popup && (
        <div className="success" onClick={() => setPopup(false)}>
          <div className="success-card">
            <div className="check">✓</div>
            <h3>Decision Saved</h3>
            <p>{done.record_id}: {clean(done.decision)}</p>
            <p className="success-note">Your decision and all its evidence are saved in Records.</p>
            <div className="row center-row">
              <button className="btn green" onClick={(e) => { e.stopPropagation(); go('records') }}>View in Records</button>
              <button className="btn">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// which day this decision is for, and why it is not today
function whenNote(w, today) {
  const day = dayLong(w.date)
  if (w.is_today) return w.closed ? `Today, ${day}, the office is normally closed (${w.closed.toLowerCase()}). You can still record a decision.` : `You are deciding the building status for today, ${day}.`
  const t = today ? dayLong(today.date) : 'Today'
  const why = !today?.closed ? '' : today.closed === 'Office hours over' ? ' Office hours are over for today, so no decision is needed today.' : ` The office is closed today (${today.closed.toLowerCase()}), so no decision is needed today.`
  return `Today is ${t}.${why} You can decide the building status for ${day}${w.chosen ? ', the day you picked' : ', the next workday'}.`
}

// the message a manager pastes into an email after deciding
function shareText(d, a) {
  const actions = d.followed_recommendation && a.points ? '\n\nActions:\n' + a.points.actions.map((x, i) => `${i + 1}. ${clean(x)}`).join('\n') : ''
  return `USDA Lake Charles Service Center\nOperating status for ${dayLong(a.rules.window.date)}: ${clean(d.decision)}\n\nReason: ${clean(d.reason)}${actions}\n\nDecided by ${d.decided_by}, ${fmt(d.decided_at)}. Record ${d.record_id}.`
}

/* ---------- Records ---------- */
export function Records() {
  const [list, setList] = useState(null)
  const [detail, setDetail] = useState({})
  useEffect(() => { api.records().then(setList).catch(() => setList([])) }, [])
  const load = async (id) => { if (!detail[id]) { const d = await api.record(id); setDetail((m) => ({ ...m, [id]: d })) } }
  return (
    <div className="page">
      <h2 className="page-h">Decision Record</h2>
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
    <>
    <ul className="bul">
      <li>Data as of {fmt(e.as_of, { month: 'short', day: 'numeric' })}</li>
      <li>System advice: {POSTURE[r.recommended]?.action || 'none'}, hazard {r.level} of 4</li>
      <li>{r.agencies.map((g) => `${g.code}: ${agencyAction(g)}`).join('; ')}</li>
    </ul>
    <h4 className="blk-h">Data Sources</h4>
    <Sources inputs={i} status={e.data_status || {}} />
    <h4 className="blk-h">Thresholds Crossed</h4>
    <SignalTable signals={r.signals} />
    </>
  )
}

/* ---------- Settings (localhost only) ---------- */
export function Settings({ onSaved }) {
  const [st, setSt] = useState(null)
  const [key, setKey] = useState('')
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { api.settings().then(setSt).catch((e) => setMsg({ tone: 'red', text: e.message })) }, [])
  const save = async () => {
    setBusy(true); setMsg(null)
    try { const r = await api.saveKey(key); setSt(r); setKey(''); setMsg({ tone: 'green', text: 'Key saved' }); onSaved?.() }
    catch (e) { setMsg({ tone: 'red', text: e.message }) } finally { setBusy(false) }
  }
  const test = async () => {
    setBusy(true); setMsg(null)
    try { const r = await api.testKey(); setMsg({ tone: 'green', text: `Connected, using ${r.model_id}` }) }
    catch (e) { setMsg({ tone: 'red', text: e.message }) } finally { setBusy(false) }
  }
  return (
    <div className="page settings-page">
      <h2 className="page-h">Settings</h2>
      <section className="card fade settings">
        <div className="card-h">Anthropic API Key</div>
        {st && <div className="row"><span className={`chip ${st.key_set ? 'green' : 'yellow'}`}>{st.key_set ? `Saved, ends in ${st.key_last4}` : 'No key yet'}</span>
          {st.model_id && <span className="chip blue">Model: {st.model_id}</span>}</div>}
        <input className="inp" type="password" autoComplete="off" placeholder="sk-ant-..." value={key} onChange={(e) => setKey(e.target.value)} />
        <div className="row">
          <button className="btn green" disabled={busy || key.length < 20} onClick={save}>Save Key</button>
          <button className="btn" disabled={busy || !st?.key_set} onClick={test}>Test Connection</button>
        </div>
        {msg && <div className={`alert ${msg.tone}`}>{msg.text}</div>}
        <ul className="bul small quiet">
          <li>Stored only in the local .env file</li>
          <li>Never saved in records or evidence</li>
          <li>AI runs only when the data changes</li>
        </ul>
      </section>
      <ResetFacility />
      <ClearRecords />
    </div>
  )
}

function ClearRecords() {
  const [step, setStep] = useState(0)
  const [msg, setMsg] = useState(null)
  const clear = async () => {
    try { const r = await api.clearRecords(); setMsg(`Archived ${r.cleared} test records`); setStep(0) }
    catch (e) { setMsg(e.message) }
  }
  return (
    <section className="card fade settings danger">
      <div className="card-h">Clear Test Records</div>
      <div className="quiet small">For rehearsals only. Records cannot be deleted from the record page. Cleared records are archived on this computer.</div>
      <div className="row" style={{ marginTop: 10 }}>
        {step === 0 && <button className="btn red-btn" onClick={() => { setStep(1); setMsg(null) }}>Clear Test Records</button>}
        {step === 1 && <><span className="alert red" style={{ margin: 0 }}>Are you sure? This empties the decision record.</span>
          <button className="btn red-btn" onClick={clear}>Yes, Clear</button><button className="btn" onClick={() => setStep(0)}>Cancel</button></>}
      </div>
      {msg && <div className="alert green">{msg}</div>}
    </section>
  )
}

function ResetFacility() {
  const [msg, setMsg] = useState(null)
  const reset = async () => {
    await api.setStatus({ power: 'ok', water: 'ok', roof: 'ok', roads: 'open', notes: '', updated_by: 'Facility Manager' })
    setMsg('Self-reported checks reset: power, water, roof ok, roads open')
  }
  return (
    <section className="card fade settings">
      <div className="card-h">Self-Reported Checks</div>
      <div className="small">Test values (like power out) stay until reset. Re-analyze afterwards.</div>
      <div className="row" style={{ marginTop: 10 }}><button className="btn green" onClick={reset}>Reset Self-Reported Checks to All Normal</button></div>
      {msg && <div className="alert green">{msg}</div>}
    </section>
  )
}

const HOW = [
  ['Gather', 'Seven live checks: NWS alerts and forecast, NOAA river gauge, Entergy outages, LA 511 roads, building checks and the staff roster.'],
  ['Apply Rules', 'Fixed rules compare each reading with a published threshold and set the hazard level. Same data, same result.'],
  ['Write', 'A Strands agent writes the recommendation, the reasons and a notice for each role. It cannot change the level.'],
  ['Decide', 'The manager picks the status and writes a reason. The decision and all evidence go on record.'],
]
const STACK = ['Anthropic Claude Haiku 5.5', 'National Weather Service', 'NOAA Water', 'Entergy Outages', 'LA 511', 'FastAPI', 'React']

export function About() {
  return (
    <div className="page fade about">
      <div className="about-hero">
        <Leaf size={84} />
        <div>
          <h2 className="about-name">Closure Call</h2>
          <p className="about-lead">Helps a USDA facility manager decide if the office opens in severe weather, and tells the right people.</p>
        </div>
      </div>
      <section className="about-sec">
        <h3 className="about-h">The Problem</h3>
        <p className="about-p">When a storm comes, a manager checks many websites, decides alone, and writes many messages to two agencies. Notices go out late, and nobody can see later why the call was made.</p>
      </section>
      <section className="about-sec">
        <h3 className="about-h">How It Works</h3>
        <ol className="about-steps">
          {HOW.map(([t, d], i) => <li key={t}><span className="about-n">{i + 1}</span><b>{t}</b><span>{d}</span></li>)}
        </ol>
      </section>
      <section className="about-sec">
        <h3 className="about-h">Built With</h3>
        <div className="about-sdk">Strands Agents SDK</div>
        <div className="about-stack">{STACK.map((x) => <span key={x}>{x}</span>)}</div>
      </section>
      <p className="about-team">Made by Chris and Zoe at Hack Midwest 2026 for the USDA Closure Call challenge.</p>
    </div>
  )
}
