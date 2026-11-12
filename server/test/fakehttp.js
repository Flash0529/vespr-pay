// Calls a (req, res) handler without a network: a fake request that emits the body, a fake response that records status, headers and JSON.
import { EventEmitter } from 'node:events'

export function call (handler, { method = 'GET', url, headers = {}, body, ip = '10.0.0.1' }) {
  return new Promise((resolve, reject) => {
    const req = new EventEmitter()
    Object.assign(req, { method, url, headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])), socket: { remoteAddress: ip }, resume () {} })
    const res = { headersSent: false, h: {}, setHeader (k, v) { this.h[k.toLowerCase()] = v }, writeHead (c, h = {}) { this.status = c; this.headersSent = true; for (const [k, v] of Object.entries(h)) this.h[k.toLowerCase()] = v }, end (b) { let json = null; try { json = JSON.parse(b) } catch {} resolve({ status: this.status, headers: this.h, json, raw: b }) } }
    const mine = handler(req, res)
    if (!mine) return resolve({ status: null, notMine: true })
    setImmediate(() => { if (body !== undefined) req.emit('data', Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))); req.emit('end') })
    setTimeout(() => reject(new Error('handler never answered ' + url)), 3000).unref()
  })
}
