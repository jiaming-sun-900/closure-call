import { useEffect, useState } from 'react'
import { api } from './api'
import { SignalList } from './flow'
import { POSTURE, agencyAction, clean, fmt } from './lib'

/* ---------- ✅ Decide ---------- */
export function Decide({ a, chosen, setChosen, go }) {
  if (!a) return <div className="page start fade"><h2 className="page-h">✅ Make the call</h2><p className="quiet">Run an analysis first.</p><button className="btn green huge" onClick={() => go('start')}>🚀 Start analysis</button></div>
  return <DecideInner a={a} chosen={chosen} setChosen={setChosen} />
}

function DecideInner({ a, chosen, setChosen }) {
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
    <section className="card fade settings">
      <div className="card-h">🧹 Clear test records</div>
      <div className="quiet small">For rehearsals only. Records cannot be deleted from the record page. Cleared records are archived on this computer.</div>
      <div className="row" style={{ marginTop: 10 }}>
        {step === 0 && <button className="btn" onClick={() => { setStep(1); setMsg(null) }}>Clear test records…</button>}
        {step === 1 && <><span className="alert red" style={{ margin: 0 }}>Are you sure? This empties the decision record.</span>
          <button className="btn red-btn" onClick={clear}>Yes, clear</button><button className="btn" onClick={() => setStep(0)}>Cancel</button></>}
      </div>
      {msg && <div className="alert green">{msg}</div>}
    </section>
  )
}

function ResetFacility() {
  const [msg, setMsg] = useState(null)
  const reset = async () => {
    await api.setStatus({ power: 'ok', water: 'ok', roof: 'ok', roads: 'open', notes: '', updated_by: 'Denise Fontenot' })
    setMsg('Building check reset: power, water, roof ok, roads open')
  }
  return (
    <section className="card fade settings">
      <div className="card-h">🏢 Building check</div>
      <div className="small">Test values (like power out) stay until reset. Re-analyze afterwards.</div>
      <div className="row" style={{ marginTop: 10 }}><button className="btn green" onClick={reset}>Reset building check to all normal</button></div>
      {msg && <div className="alert green">{msg}</div>}
    </section>
  )
}
