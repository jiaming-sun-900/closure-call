import { useEffect, useState } from 'react'
import { api } from './api'
import Leaf from './Leaf'
import { Analyze } from './analyze'
import { Decide, Records, Settings } from './pages'
import './App.css'

const NAV = [
  ['analyze', '🔍', 'Analyze'],
  ['decide', '✅', 'Decide'],
  ['records', '📜', 'Records'],
]
const PAGES = [...NAV.map(([k]) => k), 'settings']
const pageFromHash = () => (PAGES.includes(window.location.hash.slice(1)) ? window.location.hash.slice(1) : 'analyze')

export default function App() {
  const [page, setPage] = useState(pageFromHash())
  const [facility, setFacility] = useState(null)
  const [a, setA] = useState(null)
  const [error, setError] = useState(null)
  const [simulate, setSimulate] = useState(null)
  const [chosen, setChosen] = useState(null)

  useEffect(() => {
    api.facility().then(setFacility).catch((e) => setError('Cannot reach the server: ' + e.message))
    const onHash = () => setPage(pageFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  useEffect(() => { if (a) setChosen(a.rules.recommended) }, [a])

  const go = (k) => { window.location.hash = k; setPage(k); window.scrollTo(0, 0) }

  return (
    <div className="shell">
      <aside className="side">
        <div className="logo">
          <Leaf size={46} />
          <div>
            <div className="logo-t">Closure Call</div>
            <div className="logo-s">USDA Lake Charles</div>
          </div>
        </div>
        <nav className="tabs">
          {NAV.map(([k, ic, label]) => (
            <button key={k} className={page === k ? 'on' : ''} onClick={() => go(k)}>
              <span className="nav-ic">{ic}</span><span className="nav-l">{label}</span>
            </button>
          ))}
        </nav>
        <div className="side-foot">
          <select value={simulate || ''} onChange={(e) => setSimulate(e.target.value || null)} title="Test scenarios">
            <option value="">Live data</option>
            <option value="nws_down">Test: NWS down</option>
          </select>
          <div className="quiet tiny">Rules decide. AI writes. You choose.</div>
        </div>
      </aside>
      <button className={`gear ${page === 'settings' ? 'on' : ''}`} onClick={() => go('settings')} title="Settings">⚙️</button>

      <main className="content">
        {error && <div className="alert red">⚠️ {error}</div>}
        {page === 'analyze' && <Analyze a={a} setA={setA} facility={facility} simulate={simulate} go={go} />}
        {page === 'decide' && <Decide a={a} chosen={chosen} setChosen={setChosen} go={go} />}
        {page === 'records' && <Records />}
        {page === 'settings' && <Settings />}
      </main>
    </div>
  )
}
