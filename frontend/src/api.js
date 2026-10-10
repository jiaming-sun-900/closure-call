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

export const api = {
  facility: () => req('/facility'),
  setStatus: (body) => req('/facility/status', { method: 'PUT', body }),
  assess: (body) => req('/assess', { method: 'POST', body }),
  decide: (body) => req('/decision', { method: 'POST', body }),
  records: () => req('/records'),
  settings: () => req('/settings'),
  saveKey: (api_key) => req('/settings/key', { method: 'PUT', body: { api_key } }),
  testKey: () => req('/settings/test', { method: 'POST' }),
  record: (id) => req(`/records/${id}`),
}
