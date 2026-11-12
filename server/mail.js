// VESPR outbound mail: one small interface, injectable transports.
//   createMailer({ transport, from, allowTo }) -> { send({ to, subject, text }) }
//   createFakeTransport()  records messages in memory; used by tests and the local demo, sends nothing
//   createSmtpTransport()  talks SMTP submission (port 587 STARTTLS or 465 implicit TLS, AUTH PLAIN) to a relay such as Stalwart
//   mailerFromEnv(env)     builds a mailer from VESPR_MAIL_* settings, or null when VESPR_MAIL_ENABLED is not '1'
// Zero dependencies (node:net, node:tls). Nothing here runs unless the operator turns mail on.
import net from 'node:net'
import tls from 'node:tls'

const BAD_HEADER = /[\r\n]/
const ADDRESS = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/

export function createFakeTransport () {
  const sent = []
  return { sent, send: async msg => { sent.push({ ...msg }) } }
}

export function createMailer ({ transport, from, allowTo = [] }) {
  if (!transport || typeof transport.send !== 'function') throw new Error('mail transport required')
  if (!ADDRESS.test(String(from || ''))) throw new Error('a valid from address is required')
  const allow = allowTo.map(a => a.toLowerCase())
  return {
    async send ({ to, subject, text }) {
      to = String(to || '').trim()
      subject = String(subject || '')
      text = String(text || '')
      if (!ADDRESS.test(to) || BAD_HEADER.test(to) || BAD_HEADER.test(subject)) throw new Error('invalid recipient or subject')
      // While mail is being tested only the listed addresses may receive anything
      if (allow.length && !allow.includes(to.toLowerCase())) throw new Error('recipient is not on the allow-list')
      await transport.send({ from, to, subject, text })
    }
  }
}

// Minimal SMTP client. secure: true = implicit TLS (465); otherwise STARTTLS is used when the server offers it (587),
// and requireTls: true refuses to send credentials or mail over plaintext.
export function createSmtpTransport ({ host, port = 587, secure = false, user = '', pass = '', requireTls = true, heloName = 'vespr.local', timeoutMs = 15000 }) {
  return {
    send: msg => new Promise((resolve, reject) => {
      let sock
      let buf = ''
      let waiter = null
      let done = false
      const fail = err => { if (!done) { done = true; try { sock && sock.destroy() } catch {} reject(err instanceof Error ? err : new Error(String(err))) } }
      const timer = setTimeout(() => fail(new Error('SMTP timeout')), timeoutMs)
      const finish = () => { if (!done) { done = true; clearTimeout(timer); try { sock.end() } catch {} resolve() } }

      const onData = chunk => {
        buf += chunk.toString('utf8')
        // a reply is complete at a line "NNN text" (a dash after the code means more lines follow)
        const lines = buf.split('\r\n')
        for (let i = 0; i < lines.length - 1; i++) {
          if (/^\d{3} /.test(lines[i]) || /^\d{3}$/.test(lines[i])) {
            const reply = lines.slice(0, i + 1)
            buf = lines.slice(i + 1).join('\r\n')
            if (waiter) { const w = waiter; waiter = null; w(reply) }
            return
          }
        }
      }
      const read = () => new Promise(r => { waiter = r })
      const cmd = async (line, ok) => {
        sock.write(line + '\r\n')
        const reply = await read()
        const code = Number(reply[reply.length - 1].slice(0, 3))
        if (!ok.includes(code)) throw new Error(`SMTP ${code} after ${line.split(' ')[0]}`)
        return reply
      }
      const bind = s => { sock = s; sock.on('data', onData); sock.on('error', fail); sock.on('close', () => fail(new Error('SMTP connection closed'))) }

      ;(async () => {
        const connected = new Promise((res, rej) => {
          const s = secure ? tls.connect({ host, port, servername: host }, res) : net.connect({ host, port }, res)
          s.once('error', rej)
          bind(s)
        })
        await connected
        let greeting = await read()
        if (Number(greeting[greeting.length - 1].slice(0, 3)) !== 220) throw new Error('SMTP greeting refused')
        let ehlo = await cmd(`EHLO ${heloName}`, [250])
        if (!secure && ehlo.some(l => /STARTTLS/i.test(l))) {
          await cmd('STARTTLS', [220])
          sock.removeAllListeners('data'); sock.removeAllListeners('close')
          const upgraded = tls.connect({ socket: sock, servername: host })
          await new Promise((res, rej) => { upgraded.once('secureConnect', res); upgraded.once('error', rej) })
          bind(upgraded)
          ehlo = await cmd(`EHLO ${heloName}`, [250])
        } else if (!secure && requireTls) {
          throw new Error('relay does not offer STARTTLS and requireTls is set')
        }
        if (user) await cmd(`AUTH PLAIN ${Buffer.from(`\0${user}\0${pass}`).toString('base64')}`, [235])
        await cmd(`MAIL FROM:<${msg.from}>`, [250])
        await cmd(`RCPT TO:<${msg.to}>`, [250, 251])
        await cmd('DATA', [354])
        const body = msg.text.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..')
        const headers = [`From: ${msg.from}`, `To: ${msg.to}`, `Subject: ${msg.subject}`, `Date: ${new Date().toUTCString()}`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8']
        await cmd(`${headers.join('\r\n')}\r\n\r\n${body}\r\n.`, [250])
        try { await cmd('QUIT', [221]) } catch {}
        finish()
      })().catch(fail)
    })
  }
}

// VESPR_MAIL_ENABLED=1, VESPR_MAIL_SMTP_HOST, _PORT, _SECURE (1 = implicit TLS), _USER, _PASS, VESPR_MAIL_FROM, VESPR_MAIL_ALLOW_TO (comma list)
export function mailerFromEnv (env = process.env) {
  if (env.VESPR_MAIL_ENABLED !== '1') return null
  if (!env.VESPR_MAIL_SMTP_HOST || !env.VESPR_MAIL_FROM) throw new Error('VESPR_MAIL_ENABLED=1 needs VESPR_MAIL_SMTP_HOST and VESPR_MAIL_FROM')
  return createMailer({
    transport: createSmtpTransport({
      host: env.VESPR_MAIL_SMTP_HOST,
      port: Number(env.VESPR_MAIL_SMTP_PORT || 587),
      secure: env.VESPR_MAIL_SMTP_SECURE === '1',
      user: env.VESPR_MAIL_SMTP_USER || '',
      pass: env.VESPR_MAIL_SMTP_PASS || ''
    }),
    from: env.VESPR_MAIL_FROM,
    allowTo: String(env.VESPR_MAIL_ALLOW_TO || '').split(',').map(s => s.trim()).filter(Boolean)
  })
}
