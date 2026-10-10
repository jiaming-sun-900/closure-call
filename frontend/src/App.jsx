import { useEffect, useRef, useState } from 'react'
import { api, streamAssess } from './api'
import Leaf from './Leaf'
import { Progress, ResultsPage, StartPage, useStepQueue } from './flow'
import { Decide, Records, Settings } from './pages'
import './App.css'

const NAV = [
  ['start', '🚀', 'Start analysis'],
  ['results', '📊', 'Results'],
  ['decide', '✅', 'Decide'],
  ['records', '📜', 'Records'],
]
const PAGES = [...NAV.map(([k]) => k), 'settings']
const pageFromHash = () => (PAGES.includes(window.location.hash.slice(1)) ? window.location.hash.slice(1) : 'start')

export default function App() {
  const [page, setPage] = useState(pageFromHash())
  const [facility, setFacility] = useState(null)
  const [situation, setSituation] = useState(null)
  const [a, setA] = useState(null)
  const [error, setError] = useState(null)
  const [simulate, setSimulate] = useState(null)
  const [chosen, setChosen] = useState(null)
  const [selectedDay, setSelectedDay] = useState(null)
  const [running, setRunning] = useState(null) // null | 'live' | 'replay'
  const [pendingQ, setPendingQ] = useState(null)
  const sq = useStepQueue()
  const stop = useRef(null)

  const loadSituation = () => api.situation().then(setSituation).catch(() => {})
  useEffect(() => {
    api.facility().then(setFacility).catch((e) => setError('Cannot reach the server: ' + e.message))
    loadSituation()
    const onHash = () => setPage(pageFromHash())
    window.addEventListener('hashchange', onHash)
    return () => { window.removeEventListener('hashchange', onHash); stop.current?.() }
  }, [])

  const go = (k) => { window.location.hash = k; setPage(k); window.scrollTo(0, 0) }

  const start = (day = selectedDay, question = null) => {
    stop.current?.()
    sq.reset(); setError(null); setRunning('live')
    if (question) setPendingQ(question)
    const target = day && situation && day !== situation.next_workday ? day : null
    stop.current = streamAssess(simulate, async (ev) => {
      if (ev.type === 'step') sq.push(ev)
      else if (ev.type === 'result') {
        await sq.drained()
        setTimeout(() => {
          setA(ev.assessment); setChosen(ev.assessment.rules.recommended); setRunning(null); go('results'); loadSituation()
        }, 500)
      } else if (ev.type === 'error') { setError(ev.message); setRunning(null) }
    }, target)
  }
  const replay = () => {
    if (!a) return
    sq.reset(); setRunning('replay')
    a.trace.forEach((t) => { if (t.by !== 'agent' || t.tool === 'agent_write') sq.push({ type: 'step', tool: t.tool, status: 'running', by: t.by }) })
    a.trace.forEach((t) => sq.push({ type: 'step', ...t, status: t.ok ? 'done' : 'error' }))
    sq.drained().then(() => setTimeout(() => setRunning(null), 900))
  }

  const dayIso = (a && running === 'replay') ? a.rules.window.date : (selectedDay || situation?.next_workday || a?.rules.window.date)

  return (
    <div className="shell">
      <aside className="side">
        <div className="logo" onClick={() => go('start')}>
          <Leaf size={44} />
          <div>
            <div className="logo-t">Closure Call</div>
            <div className="logo-s">USDA Weather Decisions</div>
          </div>
        </div>
        <nav className="tabs">
          {NAV.map(([k, ic, label]) => (
            <button key={k} className={page === k && !running ? 'on' : ''} onClick={() => { if (running === 'replay') setRunning(null); go(k) }}
              disabled={k === 'results' && !a}>
              <span className="nav-ic">{ic}</span><span className="nav-l">{label}</span>
            </button>
          ))}
        </nav>
        <div className="side-foot">
          <select value={simulate || ''} onChange={(e) => setSimulate(e.target.value || null)} title="Test scenarios">
            <option value="">Live data</option>
            <option value="nws_down">Test: NWS down</option>
          </select>
          <div className="tiny">Rules decide. AI writes. You choose.</div>
        </div>
      </aside>
      <button className={`gear ${page === 'settings' ? 'on' : ''}`} onClick={() => go('settings')} title="Settings">⚙️</button>

      <main className="content">
        {error && <div className="alert red">⚠️ {error}</div>}
        {running ? <Progress sq={sq} dayIso={dayIso || new Date().toISOString().slice(0, 10)} /> : (
          <>
            {page === 'start' && <StartPage situation={situation} selected={selectedDay} setSelected={setSelectedDay}
              onStart={(d) => start(d)} />}
            {page === 'results' && (a ? <ResultsPage a={a} facility={facility || a.facility} situation={situation} busy={!!running}
              onReplay={replay} onReanalyze={() => start(a.rules.window.chosen ? a.rules.window.date : null)}
              onPickDay={(d) => { setSelectedDay(d); start(d) }} onDecide={() => go('decide')}
              pendingQuestion={pendingQ} clearPending={() => setPendingQ(null)} /> : <StartPage situation={situation} selected={selectedDay} setSelected={setSelectedDay} onStart={(d) => start(d)} />)}
            {page === 'decide' && <Decide a={a} chosen={chosen} setChosen={setChosen} go={go} />}
            {page === 'records' && <Records />}
            {page === 'settings' && <Settings />}
          </>
        )}
      </main>
    </div>
  )
}
