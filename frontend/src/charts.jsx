import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// Animate from 0 to the target value once mounted (needles turn, water rises)
function useMounted(delay = 60) {
  const [on, setOn] = useState(false)
  useEffect(() => { const t = setTimeout(() => setOn(true), delay); return () => clearTimeout(t) }, [delay])
  return on
}

/* ⚡ half-circle outage gauge */
export function OutageGauge({ pct = 0, size = 220 }) {
  const on = useMounted()
  const max = 50 // scale tops out at 50% of customers
  const angle = -90 + Math.min(1, (on ? pct : 0) / max) * 180
  const arc = (from, to, color) => {
    const r = 80, cx = 100, cy = 100
    const a0 = Math.PI * (1 - from / max), a1 = Math.PI * (1 - to / max)
    const p = (a) => `${cx + r * Math.cos(a)} ${cy - r * Math.sin(a)}`
    return <path d={`M ${p(a0)} A ${r} ${r} 0 0 1 ${p(a1)}`} stroke={color} strokeWidth="18" fill="none" />
  }
  return (
    <svg viewBox="-14 -12 228 132" width={size} className="gauge">
      {arc(0, 3, 'var(--green)')}
      {arc(3, 10, 'var(--yellow-soft)')}
      {arc(10, 25, 'var(--yellow)')}
      {arc(25, 50, 'var(--red)')}
      {[0, 10, 25, 50].map((v) => {
        const a = Math.PI * (1 - v / max)
        return <text key={v} x={100 + 100 * Math.cos(a)} y={104 - 98 * Math.sin(a)} className="gauge-t">{v}%</text>
      })}
      <g className="needle" style={{ transform: `rotate(${angle}deg)` }}>
        <line x1="100" y1="100" x2="100" y2="34" />
        <circle cx="100" cy="100" r="7" />
      </g>
    </svg>
  )
}

/* 🌊 vertical water level gauge with flood lines */
export function WaterGauge({ stage, forecast, stages = {}, height = 200 }) {
  const on = useMounted(120)
  const top = Math.max(stages.major || 0, stage || 0, forecast || 0) * 1.2 || 10
  const y = (v) => height - (v / top) * height
  const lines = [['minor', 'Minor', 'var(--yellow)'], ['moderate', 'Moderate', 'var(--red-soft)'], ['major', 'Major', 'var(--red)']]
  return (
    <svg viewBox={`0 0 150 ${height + 10}`} height={height + 10} className="water">
      <rect x="20" y="0" width="44" height={height} rx="10" className="tube" />
      <rect x="20" width="44" rx="10" className="water-fill"
        style={{ y: on ? y(stage || 0) : height, height: on ? height - y(stage || 0) : 0 }} />
      <g className="wave" style={{ transform: `translateY(${on ? y(stage || 0) - 4 : height}px)` }}>
        <path d="M20 4 q5.5 -4 11 0 t11 0 t11 0 t11 0" />
      </g>
      {lines.map(([k, label, c]) => stages[k] != null && (
        <g key={k}>
          <line x1="14" x2="70" y1={y(stages[k])} y2={y(stages[k])} stroke={c} strokeWidth="2" strokeDasharray="4 3" />
          <text x="74" y={y(stages[k]) + 4} className="water-t" fill={c}>{label} {stages[k]} ft</text>
        </g>
      ))}
      {forecast != null && (
        <g>
          <path d={`M10 ${y(forecast)} l-8 -5 v10 z`} className="fc-mark" />
        </g>
      )}
    </svg>
  )
}

/* 💨 wind number with flowing lines */
export function Wind({ mph = 0 }) {
  const speed = Math.max(0.6, 4 - mph / 15) // faster wind, faster lines
  return (
    <div className="wind">
      <div className="wind-lines" style={{ '--spd': `${speed}s` }}>
        {[0, 1, 2, 3].map((i) => <span key={i} style={{ animationDelay: `${i * speed / 4}s`, top: `${12 + i * 20}%` }} />)}
      </div>
      <div className="wind-num"><b>{mph}</b><small>mph</small></div>
    </div>
  )
}

/* 🗺 map: facility pin + NWS alert polygons */
const RADAR_FRAMES = ['m50m', 'm40m', 'm30m', 'm20m', 'm10m', '']
export function AlertMap({ lat, lon, alerts = [], height = 220, zoom = 9, radar = false, wind = null, labels = false }) {
  const el = useRef(null)
  const map = useRef(null)
  const [frame, setFrame] = useState(RADAR_FRAMES.length - 1)
  useEffect(() => {
    if (!el.current) return
    if (!map.current) {
      map.current = L.map(el.current, { zoomControl: false, attributionControl: true, scrollWheelZoom: false })
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Esri, OpenStreetMap contributors', maxZoom: 16,
      }).addTo(map.current)
    }
    const m = map.current
    m.eachLayer((ly) => { if (!(ly instanceof L.TileLayer)) m.removeLayer(ly) })
    const shapes = []
    alerts.filter((a) => a.geometry).forEach((a) => {
      const warn = /warning/i.test(a.event)
      const layer = L.geoJSON(a.geometry, {
        style: { color: warn ? '#d64545' : '#d9a21b', weight: 2, fillOpacity: 0.18 },
      }).bindTooltip(a.event, labels ? { permanent: true, direction: 'center', className: 'area-label' } : {}).addTo(m)
      shapes.push(layer)
    })
    const icon = L.divIcon({ className: 'pin', html: '<div class="pin-dot">🏢</div>', iconSize: [34, 34], iconAnchor: [17, 17] })
    L.marker([lat, lon], { icon }).bindTooltip('USDA Lake Charles Service Center').addTo(m)
    const group = shapes.length ? L.featureGroup(shapes).getBounds().extend([lat, lon]) : null
    if (group) m.fitBounds(group, { padding: [16, 16], maxZoom: 11 })
    else m.setView([lat, lon], zoom)
    setTimeout(() => m.invalidateSize(), 50)
  }, [lat, lon, alerts, zoom])
  useEffect(() => {
    if (!radar || !map.current) return
    // NOAA NEXRAD composite via Iowa Environmental Mesonet tiles (free, no key), last 50 minutes looped
    const layers = RADAR_FRAMES.map((f) => L.tileLayer(`https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913${f ? '-' + f : ''}/{z}/{x}/{y}.png`,
      { opacity: 0, zIndex: 5, attribution: 'NEXRAD via IEM' }).addTo(map.current))
    let i = 0
    const t = setInterval(() => {
      layers.forEach((ly, j) => ly.setOpacity(j === i ? 0.6 : 0))
      setFrame(i)
      i = (i + 1) % layers.length
    }, 700)
    return () => { clearInterval(t); layers.forEach((ly) => ly.remove()) }
  }, [radar])
  const dirDeg = { N: 0, NNE: 22, NE: 45, ENE: 67, E: 90, ESE: 112, SE: 135, SSE: 157, S: 180, SSW: 202, SW: 225, WSW: 247, W: 270, WNW: 292, NW: 315, NNW: 337 }
  return (
    <div className="map-wrap" style={{ height }}>
      <div ref={el} className="map" style={{ height }} />
      {labels && alerts.some((a) => a.geometry) && (
        <div className="map-legend">
          {[...new Set(alerts.filter((a) => a.geometry).map((a) => a.event))].map((ev) => (
            <span key={ev}><i className={/warning/i.test(ev) ? 'sw red' : 'sw yellow'} />{ev} area (NWS)</span>
          ))}
          <span><i className="sw arrow">➝</i>Wind direction</span>
        </div>
      )}
      {wind && wind.dir && <WindField deg={(dirDeg[wind.dir] ?? 0) + 180} mph={wind.mph} />}
      {radar && <div className="map-badge">📡 Radar, last 50 min {frame === RADAR_FRAMES.length - 1 ? '(now)' : `(-${(RADAR_FRAMES.length - 1 - frame) * 10} min)`}</div>}
      {wind && wind.dir && (
        <div className="map-wind" title={`Wind from the ${wind.dir}`}>
          <div className="wind-arrow" style={{ transform: `rotate(${(dirDeg[wind.dir] ?? 0) + 90}deg)` }}>➤</div>
          <div><b>{wind.mph} mph</b><span>from the {({ N: 'north', S: 'south', E: 'east', W: 'west' })[wind.dir] || wind.dir}</span></div>
        </div>
      )}
    </div>
  )
}

/* 🚗 roads status */
export function RoadStatus({ weatherClosures = 0, manual = 'open' }) {
  const bad = manual === 'impassable' || weatherClosures >= 3
  const warn = !bad && (manual === 'limited' || weatherClosures > 0)
  const tone = bad ? 'red' : warn ? 'yellow' : 'green'
  const word = bad ? 'Blocked' : warn ? 'Slow' : 'Clear'
  return (
    <div className={`road ${tone}`}>
      <div className="road-lane"><span className="car">🚗</span></div>
      <div className="road-word">{word}</div>
    </div>
  )
}

/* level scale used on agency cards */
export function LevelScale({ level, th }) {
  return (
    <div className="scale">
      {[0, 1, 2, 3, 4].map((n) => {
        const tag = n === th.close ? 'Close' : n === th.adjust ? 'Adjust' : n === th.field_suspend ? 'Stop field' : ''
        return (
          <div key={n} className={`sc sc${n} ${n <= level ? 'on' : ''} ${n === level ? 'cur' : ''}`}>
            <b>{n}</b>{tag && <i>{tag}</i>}
            {n === level && <span className="you">Now</span>}
          </div>
        )
      })}
    </div>
  )
}

/* 💨 wind vector field: a grid of arrows pointing where the wind blows, drifting gently */
function WindField({ deg, mph }) {
  const cols = 9, rows = 6
  const len = Math.min(34, 14 + mph * 0.8)
  const dur = Math.max(1.2, 4 - mph / 12)
  return (
    <svg className="windfield" viewBox="0 0 900 600" preserveAspectRatio="none">
      {Array.from({ length: rows * cols }).map((_, i) => {
        const x = (i % cols) * 100 + 50 + (Math.floor(i / cols) % 2 ? 25 : -25)
        const y = Math.floor(i / cols) * 100 + 50
        return (
          <g key={i} transform={`translate(${x} ${y}) rotate(${deg - 90})`}>
            <g className="wf-arrow" style={{ animationDuration: `${dur}s`, animationDelay: `${(i % 5) * dur / 5}s` }}>
              <line x1={-len / 2} y1="0" x2={len / 2} y2="0" />
              <path d={`M${len / 2} 0 l-7 -5 M${len / 2} 0 l-7 5`} />
            </g>
          </g>
        )
      })}
    </svg>
  )
}
