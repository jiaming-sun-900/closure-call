// Shared display helpers. Backend text is sanitized here so no long dashes reach the screen.

export const clean = (s) => (s == null ? '' : String(s).replace(/\s*[—–]\s*/g, ', ').replace(/,\s*,/g, ','))

// color meaning: green = safe / recommended / selected, yellow = caution, red = alert, blue = info
export const POSTURE = {
  OPEN: { word: 'Open', action: 'Open as normal', tone: 'green' },
  DELAYED_ARRIVAL: { word: 'Delayed', action: 'Delay arrival', tone: 'yellow' },
  EARLY_DEPARTURE: { word: 'Early out', action: 'Dismiss early', tone: 'yellow' },
  UNSCHEDULED_TELEWORK: { word: 'Telework', action: 'Switch to telework', tone: 'yellow' },
  CLOSED_TELEWORK: { word: 'Remote', action: 'Close building, work remotely', tone: 'red' },
  CLOSED: { word: 'Closed', action: 'Close fully', tone: 'red' },
}
export const LEVEL = [
  { name: 'Calm', tone: 'green', mood: 'Happy' },
  { name: 'Watch', tone: 'blue', mood: 'Calm' },
  { name: 'Elevated', tone: 'yellow', mood: 'Worried' },
  { name: 'Severe', tone: 'red', mood: 'Nervous' },
  { name: 'Extreme', tone: 'red', mood: 'Panicked' },
]
export const levelTone = (n) => LEVEL[Math.max(0, Math.min(4, n || 0))].tone

export const KIND_EMOJI = { nws: '⚠️', gauge: '🌊', wind: '💨', power: '⚡', roads: '🚗', facility: '🏢' }
export const eventEmoji = (ev = '') =>
  /hurricane|tropical|surge/i.test(ev) ? '🌀' : /flood/i.test(ev) ? '🌊' : /wind/i.test(ev) ? '💨' : /tornado/i.test(ev) ? '🌪' : '⚠️'

export const agencyTone = (g) =>
  POSTURE[g.posture].tone === 'green' && g.field_work && g.field_work !== 'normal' ? 'yellow' : POSTURE[g.posture].tone

// One word for each agency tag; the subline says the field work part
export const agencyWord = (g) => POSTURE[g.posture].word
export const agencyAction = (g) => {
  const parts = []
  if (g.posture !== 'OPEN') parts.push(POSTURE[g.posture].action)
  if (g.field_work === 'suspended') parts.push('Stop field work')
  if (g.field_work === 'restricted') parts.push('Limit field work')
  return parts.length ? parts.join(', ') : 'Work as usual'
}

const DAY_FULL = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday' }
export const dayName = (r) => DAY_FULL[r.window.day] || r.window.day

// "Tuesday: building open, FSA teleworks, NRCS stops field work"
const VERB = { OPEN: 'stays open', DELAYED_ARRIVAL: 'arrives late', EARLY_DEPARTURE: 'leaves early',
  UNSCHEDULED_TELEWORK: 'teleworks', CLOSED_TELEWORK: 'works remotely', CLOSED: 'stays home' }
export function oneLiner(r) {
  if (!r.recommended) return `${dayName(r)}: weather data missing, decide manually`
  const b = { OPEN: 'building open', DELAYED_ARRIVAL: 'delayed arrival', EARLY_DEPARTURE: 'early dismissal',
    UNSCHEDULED_TELEWORK: 'telework day', CLOSED_TELEWORK: 'building closed, work remotely', CLOSED: 'building closed' }[r.recommended]
  const ag = r.agencies.map((g) => {
    const bits = []
    if (g.posture !== r.recommended) bits.push(VERB[g.posture])
    if (g.field_work === 'suspended') bits.push('stops field work')
    if (g.field_work === 'restricted') bits.push('limits field work')
    return bits.length ? `${g.code} ${bits.join(' and ')}` : null
  }).filter(Boolean)
  return `${dayName(r)}: ${[b, ...ag].join(', ')}`
}

export const fmt = (iso, opts = {}) =>
  iso ? new Date(iso).toLocaleString('en-US', { timeZone: 'America/Chicago', weekday: 'short', hour: 'numeric', minute: '2-digit', ...opts }) : ''
export const ago = (iso) => {
  if (!iso) return ''
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000)
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : fmt(iso)
}
export const dateLong = (r) =>
  new Date(r.window.start).toLocaleDateString('en-US', { timeZone: 'America/Chicago', weekday: 'long', month: 'long', day: 'numeric' })

// Short, verb-first action for one employee row
export function personAction(e, ag) {
  if (e.status === 'leave') return 'On leave, no message'
  if (e.status === 'on_detail') return 'Away on detail, no message'
  if (e.status === 'teleworking' && !e.notify) return 'Already remote, no message'
  if (e.work_location === 'field' && ag.field_work === 'suspended') return 'Stop field work, do office work'
  if (e.work_location === 'field' && ag.field_work === 'restricted') return 'Avoid low-lying field sites'
  const notReady = /not telework-ready/.test(e.reason)
  switch (ag.posture) {
    case 'OPEN': return 'Work as usual'
    case 'DELAYED_ARRIVAL': return 'Arrive late'
    case 'EARLY_DEPARTURE': return 'Leave early'
    case 'UNSCHEDULED_TELEWORK': return notReady ? 'Take leave, or come in if safe' : 'Switch to telework'
    case 'CLOSED_TELEWORK': return notReady ? 'Stay home, paid weather leave' : 'Telework from home'
    default: return 'Stay home'
  }
}
export const STATUS = {
  onsite: { icon: '🏢', label: 'Scheduled on site' },
  teleworking: { icon: '🏠', label: 'Teleworking' },
  on_detail: { icon: '✈️', label: 'On detail' },
  leave: { icon: '🌴', label: 'On leave' },
}
export const CHANNEL = { sms: '📱', email: '✉️', phone: '📞' }
