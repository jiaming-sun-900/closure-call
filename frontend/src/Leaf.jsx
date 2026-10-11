// Leaf mascot: upright, symmetric leaf (pointed tip on top, stem straight down) with a centered smiling face.
export default function Leaf({ size = 72 }) {
  return (
    <svg className="leaf" width={size} height={size} viewBox="0 0 100 100" role="img" aria-label="Closure Call leaf">
      <defs>
        <linearGradient id="leafg" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#2f9e5b" />
          <stop offset="1" stopColor="#86d69a" />
        </linearGradient>
      </defs>
      <path d="M50 81 L50 97" stroke="#1f7a43" strokeWidth="4" strokeLinecap="round" />
      <path d="M50 5 C64 20 79 38 79 55 C79 70 66 80 50 82 C34 80 21 70 21 55 C21 38 36 20 50 5 Z"
        fill="url(#leafg)" stroke="#1f7a43" strokeWidth="2.5" strokeLinejoin="round" />
      <ellipse cx="37" cy="33" rx="5" ry="9" fill="#fff" opacity=".3" transform="rotate(25 37 33)" />
      <circle cx="42" cy="50" r="3.6" fill="#1d3a2a" />
      <circle cx="58" cy="50" r="3.6" fill="#1d3a2a" />
      <circle cx="43.2" cy="48.8" r="1.2" fill="#fff" />
      <circle cx="59.2" cy="48.8" r="1.2" fill="#fff" />
      <ellipse cx="35" cy="59" rx="4.2" ry="2.6" fill="#ff9aa2" opacity=".75" />
      <ellipse cx="65" cy="59" rx="4.2" ry="2.6" fill="#ff9aa2" opacity=".75" />
      <path d="M43 59 Q50 66 57 59" stroke="#1d3a2a" strokeWidth="2.8" fill="none" strokeLinecap="round" />
    </svg>
  )
}
