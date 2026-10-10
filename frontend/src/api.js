const BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000'

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
  setLocation: (location) => req('/facility/location', { method: 'PUT', body: { location } }),
  assess: (body) => req('/assess', { method: 'POST', body }),
  decide: (body) => req('/decision', { method: 'POST', body }),
  records: () => req('/records'),
  record: (id) => req(`/records/${id}`),
}
