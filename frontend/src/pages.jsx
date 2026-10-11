import { useEffect, useState } from 'react'
import { api } from './api'
import { SignalList } from './flow'
import { POSTURE, agencyAction, clean, dayLong, fmt } from './lib'

/* ---------- Decide ---------- */
export function Decide({ a, chosen, setChosen, go }) {
  if (!a) return <div className="page start fade"><h2 className="page-h">Make the Call</h2><p className="quiet">Run an analysis first.</p><button className="btn green huge" onClick={() => go('start')}>Start Analysis</button></div>
  return <DecideInner a={a} chosen={chosen} setChosen={setChosen} />
}

function DecideInner({ a, chosen, setChosen }) {
  const r = a.rules
  const [custom, setCustom] = useState('')
  const [reason, setReason] = useState('')
  const [by, setBy] = useState('')
  const [done, setDone] = useState(null)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const ok = chosen && by.trim() && reason.trim().length >= 15 && (chosen !== 'CUSTOM' || custom.trim())
  const submit = async () => {
    setBusy(true); setErr(null)
    try {
      const rec = await api.decide({ assessment_id: a.id, option: chosen, custom_text: custom, reason, decided_by: by })
      setDone(rec); setReason('')
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  return (
    <div className="page">
      <h2 className="page-h">Make the Call</h2>
      <section className="dec-sec">
        <h3 className="dec-h">1. Building Status for {dayLong(r.window.date)}</h3>
        <div className="radios" role="radiogroup">
          {[...r.options.map((o) => ({ key: o.key, label: POSTURE[o.key].action, rec: o.recommended })), { key: 'CUSTOM', label: 'Write my own' }].map((o) => (
            <label key={o.key} className={`radio ${chosen === o.key ? 'on' : ''}`}>
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
        <div className="success" onClick={() => setDone(null)}>
          <div className="success-card">
            <div className="check">✓</div>
            <h3>Decision saved</h3>
            <p>{done.record_id}: {clean(done.decision)}</p>
            <p className="quiet small">Evidence snapshot stored. Tap to close.</p>
          </div>
        </div>
      )}
    </div>
  )
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
    <ul className="bul">
      <li>Data as of {fmt(e.as_of, { month: 'short', day: 'numeric' })}</li>
      <li>System advice: {POSTURE[r.recommended]?.action || 'none'}, hazard {r.level} of 4</li>
      <li>{r.agencies.map((g) => `${g.code}: ${agencyAction(g)}`).join('; ')}</li>
      <li>River: {i.gauge ? `${i.gauge.stage_ft} ft at ${clean(i.gauge.name)}` : 'river data missing'}</li>
      <li>Power: {i.outage ? `${i.outage.customers_out} of ${i.outage.customers_served} out` : 'outage data missing'}</li>
      <li>Alerts: {i.alerts ? (i.alerts.map((x) => x.event).join(', ') || 'no alerts') : 'NWS missing'}</li>
      <li>Building: power {i.facility_status?.power}, water {i.facility_status?.water}, roof {i.facility_status?.roof}, roads {i.facility_status?.roads}</li>
      <SignalList signals={r.signals} />
    </ul>
  )
}

/* ---------- Settings (localhost only) ---------- */
export function Settings({ onSaved, simulate, setSimulate }) {
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
    <div className="page">
      <h2 className="page-h">Settings</h2>
      <p className="tagline">Local demo only. In production the key comes from the server.</p>
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
      <section className="card fade settings">
        <div className="card-h">Test Mode</div>
        <div className="small">Simulates an NWS outage to show the system never defaults to Open when weather data is missing.</div>
        <div className="row" style={{ marginTop: 10 }}>
          <div className="seg">
            <button className={!simulate ? 'on green' : ''} onClick={() => setSimulate(null)}>Live data</button>
            <button className={simulate === 'nws_down' ? 'on red' : ''} onClick={() => setSimulate('nws_down')}>Simulate NWS outage</button>
          </div>
        </div>
      </section>
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
    <section className="card fade settings">
      <div className="card-h">Clear Test Records</div>
      <div className="quiet small">For rehearsals only. Records cannot be deleted from the record page. Cleared records are archived on this computer.</div>
      <div className="row" style={{ marginTop: 10 }}>
        {step === 0 && <button className="btn" onClick={() => { setStep(1); setMsg(null) }}>Clear test records…</button>}
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
    setMsg('Building check reset: power, water, roof ok, roads open')
  }
  return (
    <section className="card fade settings">
      <div className="card-h">Building Check</div>
      <div className="small">Test values (like power out) stay until reset. Re-analyze afterwards.</div>
      <div className="row" style={{ marginTop: 10 }}><button className="btn green" onClick={reset}>Reset Building Check to All Normal</button></div>
      {msg && <div className="alert green">{msg}</div>}
    </section>
  )
}

export function About() {
  return (
    <div className="page fade about">
      <h2 className="page-h">About Us</h2>
      <p className="about-lead">Data-driven weather analysis for USDA facility closure decisions.</p>
      <ul className="bul">
        <li>Live NWS, NOAA river, Entergy power and LA 511 road data</li>
        <li>Deterministic rules set the hazard level</li>
        <li>An AI agent built with the Strands Agents SDK writes the rationale and notices</li>
        <li>A human makes the final call, with every decision on record</li>
      </ul>
      <p className="small">Built at Hack Midwest 2026 for the USDA Closure Call challenge.</p>
    </div>
  )
}
