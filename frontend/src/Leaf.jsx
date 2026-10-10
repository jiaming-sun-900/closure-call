// Leaf mascot. Expression follows the hazard level: 0 happy, 1 calm, 2 worried, 3 nervous, 4 panicked.
export default function Leaf({ level = 0, size = 72 }) {
  const l = Math.max(0, Math.min(4, level))
  const eyes = [
    <g key="e"><path d="M38 52 q4 -5 8 0" /><path d="M58 52 q4 -5 8 0" /></g>, // happy arcs
    <g key="e"><circle cx="42" cy="52" r="2.6" className="fill" /><circle cx="62" cy="52" r="2.6" className="fill" /></g>,
    <g key="e"><circle cx="42" cy="53" r="2.6" className="fill" /><circle cx="62" cy="53" r="2.6" className="fill" /><path d="M37 45 l8 -3" /><path d="M67 45 l-8 -3" /></g>,
    <g key="e"><circle cx="42" cy="52" r="4" /><circle cx="42" cy="52" r="1.6" className="fill" /><circle cx="62" cy="52" r="4" /><circle cx="62" cy="52" r="1.6" className="fill" /></g>,
    <g key="e"><circle cx="42" cy="51" r="5" /><circle cx="62" cy="51" r="5" /><circle cx="42" cy="51" r="1.4" className="fill" /><circle cx="62" cy="51" r="1.4" className="fill" /></g>,
  ][l]
  const mouth = [
    <path key="m" d="M42 62 q10 10 20 0" />,
    <path key="m" d="M45 63 q7 4 14 0" />,
    <path key="m" d="M44 66 q8 -5 16 0" />,
    <path key="m" d="M43 65 l4 -3 l4 3 l4 -3 l4 3 l4 -3" />,
    <ellipse key="m" cx="52" cy="66" rx="5" ry="6" />,
  ][l]
  return (
    <svg className={`leaf leaf-l${l}`} width={size} height={size} viewBox="0 0 104 104" role="img" aria-label={`Leaf mascot, level ${l}`}>
      <path className="leaf-stem" d="M52 96 q-2 -10 0 -18" />
      <path className="leaf-body" d="M52 80 C18 72 12 36 30 18 C40 8 64 8 74 18 C92 36 86 72 52 80 Z" />
      <path className="leaf-vein" d="M52 78 L52 24" />
      {l === 0 && <><circle cx="34" cy="60" r="4" className="blush" /><circle cx="70" cy="60" r="4" className="blush" /></>}
      <g className="face">{eyes}{mouth}</g>
      {l >= 3 && <path className="sweat" d="M78 34 q4 6 0 9 q-4 -3 0 -9 Z" />}
    </svg>
  )
}
