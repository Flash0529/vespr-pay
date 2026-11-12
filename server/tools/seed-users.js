// Create verified accounts for named people in an accounts data folder, with a random password each. Sends nothing (no email, no SMS).
//   node server/tools/seed-users.js --data <DATA dir of the server> --out <password file, mode 0600, keep it outside the repo> email [email ...]
// Passwords are written only to the --out file; the terminal shows the emails and the file name, never a password.
// Run it on the machine that holds the server's DATA folder, with the server stopped or between sign-ins (it rewrites auth/users.json).
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { hashPassword } from '../auth.js'

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
const makePassword = (n = 20) => Array.from({ length: n }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('')

export function seedUsers ({ dataDir, outFile, emails, now = () => Date.now() }) {
  const authDir = path.join(dataDir, 'auth')
  fs.mkdirSync(authDir, { recursive: true })
  const usersFile = path.join(authDir, 'users.json')
  let users = {}
  try { users = JSON.parse(fs.readFileSync(usersFile, 'utf8')) } catch {}
  const created = []
  const skipped = []
  let lines = ''
  for (const raw of emails) {
    const email = String(raw).trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('not an email address: ' + raw)
    if (Object.values(users).some(u => u.email === email)) { skipped.push(email); continue }
    const password = makePassword()
    const { hash, salt } = hashPassword(password)
    const id = crypto.randomBytes(16).toString('hex')
    users[id] = {
      id, email, name: email.split('@')[0], passwordHash: hash, salt, emailVerified: true, createdAt: now(), updatedAt: now(),
      roles: ['member'], providers: {}, totp: { enabled: false, secret: null, lastStep: 0 }, sms: { enabled: false, phone: null }, recoveryCodes: []
    }
    lines += `${email}\t${password}\n`
    created.push(email)
  }
  if (created.length) {
    fs.writeFileSync(outFile, lines, { mode: 0o600, flag: 'a' })
    fs.chmodSync(outFile, 0o600)
    const tmp = `${usersFile}.tmp.${crypto.randomBytes(4).toString('hex')}`
    fs.writeFileSync(tmp, JSON.stringify(users, null, 2), { mode: 0o600 })
    fs.renameSync(tmp, usersFile)
  }
  return { created, skipped }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const take = flag => { const i = args.indexOf(flag); if (i === -1) return null; return args.splice(i, 2)[1] }
  const dataDir = take('--data'); const outFile = take('--out')
  if (!dataDir || !outFile || !args.length) { console.error('usage: seed-users.js --data <DATA dir> --out <password file> email [email ...]'); process.exit(2) }
  if (path.resolve(outFile).startsWith(path.resolve(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')) + path.sep)) { console.error('--out must be outside the repository'); process.exit(2) }
  const r = seedUsers({ dataDir, outFile, emails: args })
  for (const e of r.created) console.log('created (verified):', e)
  for (const e of r.skipped) console.log('already exists, left alone:', e)
  if (r.created.length) console.log('passwords written to', outFile, '(mode 0600). Turn on an authenticator app after the first sign-in.')
}
