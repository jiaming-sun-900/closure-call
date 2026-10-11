import { useEffect, useState } from 'react'

// Animate from 0 to the target value once mounted (needles turn, water rises)
function useMounted(delay = 60) {
  const [on, setOn] = useState(false)
  useEffect(() => { const t = setTimeout(() => setOn(true), delay); return () => clearTimeout(t) }, [delay])
  return on
}

/* half-circle outage gauge */
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

/* vertical water level gauge with flood lines */
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

/* wind number with flowing lines */
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

/* map: facility pin + NWS alert polygons */
/* roads status */
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
