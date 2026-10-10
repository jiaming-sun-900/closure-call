// Leaf mascot: a friendly smiling leaf (dot eyes, small smile, rosy cheeks).
export default function Leaf({ size = 72 }) {
  return (
    <svg className="leaf" width={size} height={size} viewBox="0 0 100 100" role="img" aria-label="Closure Call leaf">
      <defs>
        <linearGradient id="leafg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7dd08f" />
          <stop offset="1" stopColor="#2f9e5b" />
        </linearGradient>
      </defs>
      <path className="leaf-stem" d="M50 88 C50 82 51 78 53 74" />
      <path d="M50 76 C22 72 14 46 24 28 C32 14 48 10 64 14 C82 20 88 42 80 58 C74 70 64 76 50 76 Z"
        fill="url(#leafg)" stroke="#1f7a43" strokeWidth="2.5" />
      <path d="M52 72 C56 56 60 40 68 22" stroke="#1f7a43" strokeWidth="2" fill="none" opacity=".18" strokeLinecap="round" />
      <ellipse cx="36" cy="30" rx="7" ry="4" fill="#fff" opacity=".35" transform="rotate(-30 36 30)" />
      <circle cx="40" cy="46" r="3.6" fill="#1d3a2a" />
      <circle cx="60" cy="46" r="3.6" fill="#1d3a2a" />
      <circle cx="41.2" cy="44.8" r="1.2" fill="#fff" />
      <circle cx="61.2" cy="44.8" r="1.2" fill="#fff" />
      <ellipse cx="33" cy="54" rx="4.5" ry="3" fill="#ff9aa2" opacity=".7" />
      <ellipse cx="67" cy="54" rx="4.5" ry="3" fill="#ff9aa2" opacity=".7" />
      <path d="M44 54 Q50 60 56 54" stroke="#1d3a2a" strokeWidth="2.6" fill="none" strokeLinecap="round" />
    </svg>
  )
}
