const BASE = import.meta.env.VITE_API_BASE || `http://${window.location.hostname}:8000`

async function req(path, opts = {}) {
  const r = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.detail || `HTTP ${r.status}`)
  return data
}

export const streamAssess = (simulate, onEvent, date) => {
  const qs = new URLSearchParams()
  if (simulate) qs.set('simulate', simulate)
  if (date) qs.set('date', date)
  const es = new EventSource(BASE + '/assess/stream' + (qs.toString() ? `?${qs}` : ''))
  es.onmessage = (m) => {
    const ev = JSON.parse(m.data)
    onEvent(ev)
    if (ev.type === 'result' || ev.type === 'error') es.close()
  }
  es.onerror = () => { es.close(); onEvent({ type: 'error', message: 'Connection to the server was lost' }) }
  return () => es.close()
}

export const api = {
  facility: () => req('/facility'),
  situation: () => req('/situation'),
  setStatus: (body) => req('/facility/status', { method: 'PUT', body }),
  assess: (body) => req('/assess', { method: 'POST', body }),
  decide: (body) => req('/decision', { method: 'POST', body }),
  records: () => req('/records'),
  settings: () => req('/settings'),
  saveKey: (api_key) => req('/settings/key', { method: 'PUT', body: { api_key } }),
  testKey: () => req('/settings/test', { method: 'POST' }),
  record: (id) => req(`/records/${id}`),
  ask: (assessment_id, question) => req('/ask', { method: 'POST', body: { assessment_id, question } }),
  clearRecords: () => req('/settings/clear-records', { method: 'POST', body: { confirm: 'CLEAR' } }),
}
