import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api'
import Leaf from './Leaf'
import { Agencies, Decide, Overview, People, Records, Settings, Weather } from './pages'
import './App.css'

const NAV = [
  ['overview', '🏠', 'Overview'],
  ['weather', '🌦', 'Weather and data'],
  ['agencies', '🏛', 'Agencies'],
  ['people', '👥', 'People and notices'],
  ['decide', '✅', 'Make the call'],
  ['records', '📜', 'Decision record'],
  ['settings', '⚙️', 'Settings'],
]
const pageFromHash = () => (NAV.some(([k]) => k === window.location.hash.slice(1)) ? window.location.hash.slice(1) : 'overview')

export default function App() {
  const [page, setPage] = useState(pageFromHash())
  const [facility, setFacility] = useState(null)
  const [a, setA] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [simulate, setSimulate] = useState(null)
  const [chosen, setChosen] = useState(null)
  const reqId = useRef(0)

  const run = useCallback(async (sim = simulate) => {
    const id = ++reqId.current
    setLoading(true); setError(null)
    try {
      const res = await api.assess({ simulate: sim })
      if (id === reqId.current) { setA(res); setChosen(res.rules.recommended) }
    } catch (e) {
      if (id === reqId.current) setError(e.message)
    } finally {
      if (id === reqId.current) setLoading(false)
    }
  }, [simulate])

  useEffect(() => {
    api.facility().then(setFacility).catch((e) => setError('Cannot reach the server: ' + e.message))
    run()
    const onHash = () => setPage(pageFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const go = (k) => { window.location.hash = k; setPage(k); window.scrollTo(0, 0) }

  return (
    <div className="shell">
      <aside className="side">
        <div className="logo">
          <Leaf level={a?.rules.level ?? 0} size={44} />
          <div>
            <div className="logo-t">Closure Call</div>
            <div className="logo-s">USDA Lake Charles</div>
          </div>
        </div>
        <nav>
          {NAV.filter(([k]) => k !== 'settings').map(([k, ic, label]) => (
            <button key={k} className={page === k ? 'on' : ''} onClick={() => go(k)}>
              <span className="nav-ic">{ic}</span><span className="nav-l">{label}</span>
            </button>
          ))}
        </nav>
        <div className="side-foot">
          <button className={`nav-settings ${page === 'settings' ? 'on' : ''}`} onClick={() => go('settings')}>⚙️ Settings</button>
          <button className="btn ghost full" onClick={() => run()} disabled={loading}>{loading ? '⏳ Checking…' : '🔄 Re-check data'}</button>
          <select value={simulate || ''} onChange={(e) => { const v = e.target.value || null; setSimulate(v); run(v) }}>
            <option value="">Live data</option>
            <option value="nws_down">Test: NWS down</option>
          </select>
          <div className="quiet tiny">Rules decide. AI writes. You choose.</div>
        </div>
      </aside>

      <main className={`content ${loading && a ? 'busy' : ''}`}>
        {error && <div className="alert red">⚠️ {error}</div>}
        {page === 'records' ? <Records /> : page === 'settings' ? <Settings onSaved={() => run()} /> : !a || !facility ? (
          <div className="loading"><Leaf level={1} size={110} /><p>Checking the weather for Lake Charles…</p></div>
        ) : (
          <div key={page + a.id}>
            {page === 'overview' && <Overview a={a} facility={facility} go={go} />}
            {page === 'weather' && <Weather a={a} facility={facility} onSaved={() => run()} />}
            {page === 'agencies' && <Agencies a={a} facility={facility} />}
            {page === 'people' && <People a={a} />}
            {page === 'decide' && <Decide a={a} chosen={chosen} setChosen={setChosen} />}
          </div>
        )}
      </main>
    </div>
  )
}
