// An axios adapter that answers the PayPal server SDK from a fake PayPal (server/test/fakepaypal.js): the SDK's own request building, authentication and error handling run for real, only the network is replaced.
import { Readable } from 'node:stream'
export const adapterFor = (fake, calls = []) => async config => {
  const url = new URL(config.url, config.baseURL); const h = {}; for (const [k, v] of Object.entries(config.headers && config.headers.toJSON ? config.headers.toJSON() : config.headers || {})) h[k.toLowerCase()] = v
  const body = typeof config.data === 'string' ? config.data : config.data ? String(config.data) : undefined
  const method = String(config.method).toUpperCase(); calls.push({ method, path: url.pathname, headers: h, body })
  const r = await fake.fetch(url.href, { method, headers: h, body }); const text = await r.text()
  return { data: config.responseType === 'stream' ? Readable.from([text]) : text, status: r.status, statusText: String(r.status), headers: { 'content-type': 'application/json' }, config, request: {} }
}
