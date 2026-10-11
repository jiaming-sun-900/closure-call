import { useEffect, useRef, useState } from 'react'
import { api, streamAssess } from './api'
import Leaf from './Leaf'
import { Progress, ResultsPage, StartPage, useStepQueue } from './flow'
import { About, Decide, Records, Settings } from './pages'
import './App.css'

const NAV = [
  ['start', 'Start Analysis'],
  ['results', 'Results'],
  ['decide', 'Decide'],
  ['records', 'Records'],
]
const PAGES = [...NAV.map(([k]) => k), 'about', 'settings']
// the last analysis survives a page refresh
const saved = (k) => { try { return JSON.parse(localStorage.getItem('cc:' + k)) } catch { return null } }
const save = (k, v) => { try { v == null ? localStorage.removeItem('cc:' + k) : localStorage.setItem('cc:' + k, JSON.stringify(v)) } catch { /* storage full or blocked */ } }
const pageFromHash = () => (PAGES.includes(window.location.hash.slice(1)) ? window.location.hash.slice(1) : 'start')

export default function App() {
  const [page, setPage] = useState(pageFromHash())
  const [facility, setFacility] = useState(null)
  const [situation, setSituation] = useState(null)
  const [a, setA] = useState(() => saved('assessment'))
  const [error, setError] = useState(null)
  const [simulate, setSimulate] = useState(null)
  const [chosen, setChosen] = useState(() => saved('chosen'))
  const [selectedDay, setSelectedDay] = useState(null)
  const [running, setRunning] = useState(null) // null | 'live'
  const [pendingQ, setPendingQ] = useState(null)
  const sq = useStepQueue()
  const stop = useRef(null)

  useEffect(() => save('assessment', a), [a])
  useEffect(() => save('chosen', chosen), [chosen])

  const loadSituation = () => api.situation().then(setSituation).catch(() => {})
  useEffect(() => {
    api.facility().then(setFacility).catch((e) => setError('Cannot reach the server: ' + e.message))
    loadSituation()
    const onHash = () => setPage(pageFromHash())
    window.addEventListener('hashchange', onHash)
    return () => { window.removeEventListener('hashchange', onHash); stop.current?.() }
  }, [])

  const go = (k) => { window.location.hash = k; setPage(k); window.scrollTo(0, 0) }

  const start = (day = null, question = null) => {
    stop.current?.()
    sq.reset(); setError(null); setRunning('live')
    if (question) setPendingQ(question)
    const target = day || null
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

  const dayIso = selectedDay || situation?.next_workday || a?.rules.window.date

  return (
    <div className="shell">
      <aside className="side">
        <div className="logo" onClick={() => go('start')}>
          <Leaf size={64} />
          <div className="logo-t">Closure Call</div>
        </div>
        <nav className="tabs">
          {NAV.map(([k, label]) => (
            <button key={k} className={page === k && !running ? 'on' : ''} onClick={() => go(k)}
              disabled={k === 'results' && !a}>
              <span className="nav-l">{label}</span>
            </button>
          ))}
        </nav>
        <nav className="tabs side-bottom">
          <button className={page === 'about' && !running ? 'on' : ''} onClick={() => go('about')}><span className="nav-l">About Us</span></button>
          <button className={page === 'settings' && !running ? 'on' : ''} onClick={() => go('settings')}><span className="nav-l">Settings</span></button>
        </nav>
      </aside>

      <main className="content">
        {error && <div className="alert red">{error}</div>}
        {running ? <Progress sq={sq} dayIso={dayIso || new Date().toISOString().slice(0, 10)} /> : (
          <>
            {page === 'start' && <StartPage onStart={() => { setSelectedDay(null); start(null) }} />}
            {page === 'results' && (a ? <ResultsPage a={a} facility={facility || a.facility} situation={situation} busy={!!running}
              onReanalyze={() => start(a.rules.window.chosen ? a.rules.window.date : null)} onDecide={() => go('decide')}
              onPickDay={(d) => { setSelectedDay(d); start(d) }}
              pendingQuestion={pendingQ} clearPending={() => setPendingQ(null)} /> : <StartPage onStart={() => { setSelectedDay(null); start(null) }} />)}
            {page === 'decide' && <Decide a={a} chosen={chosen} setChosen={setChosen} go={go} />}
            {page === 'records' && <Records />}
            {page === 'settings' && <Settings simulate={simulate} setSimulate={setSimulate} />}
            {page === 'about' && <About />}
          </>
        )}
      </main>
    </div>
  )
}
