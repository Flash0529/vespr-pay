// Puts the sample project (plus one script that fails on purpose) into a room, so a throwaway demo stack has something to show.
//   node scripts/demo-seed.mjs <server ws url> <room> <token> <name>
import fs from 'node:fs'
import path from 'node:path'
import { joinRoom } from '../agents/src/room.js'

const [server, roomName, token, name = 'alex'] = process.argv.slice(2)
if (!server || !roomName || !token) { console.error('usage: demo-seed.mjs <server> <room> <token> [name]'); process.exit(2) }
const here = path.dirname(new URL(import.meta.url).pathname); const sample = path.join(here, '../sample-project')
const room = joinRoom({ server, room: roomName, token, name, color: '#a5b4fc', model: 'seed' })
await room.ready
for (const f of fs.readdirSync(sample)) room.write(f, fs.readFileSync(path.join(sample, f), 'utf8'), 'seed-' + f)
room.write('boom.py', 'def average(xs):\n    return sum(xs) / len(xs)\n\nprint("average of nothing:")\nprint(average([]))\n', 'seed-boom')
room.write('docs/notes.md', '# Notes\n\nWorking notes for the demo workspace.\n', 'seed-notes')
await new Promise(r => setTimeout(r, 800))
console.log('seeded', fs.readdirSync(sample).length + 2, 'files')
process.exit(0)
