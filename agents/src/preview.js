// Serves a running process to a browser at /preview/<token>/ . The token is the only credential (like a share link): anyone
// who has it can view the page while the process runs. HTML is rewritten so root-absolute links and assets stay under the prefix.
import http from 'node:http'

const PREFIX = /^\/preview\/([0-9a-f]{24})(\/.*)?$/

export function rewriteHtml (html, base) {
  const rewritten = html.replace(/\b(src|href|action)=(["'])\/(?!\/)/gi, `$1=$2${base}`) // first, so the <base> tag below is not rewritten again
  return /<head[^>]*>/i.test(rewritten) ? rewritten.replace(/<head([^>]*)>/i, `<head$1><base href="${base}">`) : `<base href="${base}">${rewritten}`
}

// Returns true when the request was a preview request (handled), false to let the caller carry on.
export function previewHandler (processes) {
  return (req, res) => {
    const u = new URL(req.url, 'http://x'); const m = PREFIX.exec(u.pathname)
    if (!m) return false
    const rec = processes.byToken(m[1])
    if (!rec || rec.status === 'exited') { res.writeHead(rec ? 410 : 404, { 'Content-Type': 'text/plain' }); res.end(rec ? 'That preview has stopped.' : 'No such preview.'); return true }
    if (!m[2]) { res.writeHead(308, { Location: `/preview/${m[1]}/${u.search}` }); res.end(); return true }
    const base = `/preview/${m[1]}/`
    const upstreamPath = rec.keepPrefix ? u.pathname + u.search : m[2] + u.search
    const headers = { ...req.headers, host: `127.0.0.1:${rec.port}`, 'accept-encoding': 'identity' }
    delete headers.authorization; delete headers.connection
    const up = http.request({ host: rec.host, port: rec.port, method: req.method, path: upstreamPath, headers }, upRes => {
      const type = String(upRes.headers['content-type'] || '')
      const out = { ...upRes.headers, 'referrer-policy': 'no-referrer' }
      if (!rec.keepPrefix && /text\/html/i.test(type)) {
        const chunks = []; upRes.on('data', c => chunks.push(c))
        upRes.on('end', () => {
          const body = Buffer.from(rewriteHtml(Buffer.concat(chunks).toString('utf8'), base))
          delete out['content-length']; out['content-length'] = body.length
          if (out.location && String(out.location).startsWith('/')) out.location = base + String(out.location).slice(1)
          res.writeHead(upRes.statusCode, out); res.end(body)
        })
      } else {
        if (out.location && !rec.keepPrefix && String(out.location).startsWith('/')) out.location = base + String(out.location).slice(1)
        res.writeHead(upRes.statusCode, out); upRes.pipe(res)
      }
    })
    up.on('error', () => { if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' }); res.end('The previewed app is not answering (it may still be starting).') })
    req.pipe(up)
    return true
  }
}
