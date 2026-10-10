// Leaf mascot: a real leaf shape (pointed tip, midrib, stem) with a friendly smiling face.
export default function Leaf({ size = 72 }) {
  return (
    <svg className="leaf" width={size} height={size} viewBox="0 0 100 100" role="img" aria-label="Closure Call leaf">
      <defs>
        <linearGradient id="leafg" x1="0.1" y1="0.9" x2="0.9" y2="0.1">
          <stop offset="0" stopColor="#2f9e5b" />
          <stop offset="1" stopColor="#86d69a" />
        </linearGradient>
      </defs>
      {/* stem */}
      <path d="M30 94 C33 88 36 83 40 79" stroke="#1f7a43" strokeWidth="4" fill="none" strokeLinecap="round" />
      {/* blade: rounded base, pointed tip at top right */}
      <path d="M40 80 C20 74 10 54 18 36 C26 18 50 8 90 8 C88 40 80 62 64 74 C56 80 48 82 40 80 Z"
        fill="url(#leafg)" stroke="#1f7a43" strokeWidth="2.5" strokeLinejoin="round" />
      {/* midrib and side veins */}
      <path d="M40 80 C52 62 66 38 88 10" stroke="#1f7a43" strokeWidth="2" fill="none" opacity=".25" strokeLinecap="round" />
      <path d="M58 52 L72 54 M66 40 L80 38 M50 64 L60 70 M54 46 L44 36 M62 34 L56 22" stroke="#1f7a43" strokeWidth="1.5" opacity=".15" strokeLinecap="round" />
      <ellipse cx="34" cy="34" rx="7" ry="3.5" fill="#fff" opacity=".35" transform="rotate(-35 34 34)" />
      {/* face */}
      <circle cx="38" cy="50" r="3.4" fill="#1d3a2a" />
      <circle cx="54" cy="46" r="3.4" fill="#1d3a2a" />
      <circle cx="39.1" cy="48.9" r="1.1" fill="#fff" />
      <circle cx="55.1" cy="44.9" r="1.1" fill="#fff" />
      <ellipse cx="32" cy="58" rx="4" ry="2.6" fill="#ff9aa2" opacity=".75" />
      <ellipse cx="61" cy="52" rx="4" ry="2.6" fill="#ff9aa2" opacity=".75" />
      <path d="M41 57 Q48 62 54 54" stroke="#1d3a2a" strokeWidth="2.6" fill="none" strokeLinecap="round" />
    </svg>
  )
}
