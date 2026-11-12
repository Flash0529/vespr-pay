#!/usr/bin/env node
// murmio-runner: lets a VESPR workspace run commands on THIS machine (a teammate's Mac or Windows PC, a server, a cloud VM).
// It dials out to the VESPR server (no open ports), receives jobs, runs them in a throwaway folder with a scrubbed
// environment, streams the output back, and returns files the command created or changed.
//
//   node index.js --server ws://host:9401 --token <token> --label "My Mac" --allow-room demo
//
// Linux requires native isolation by default. --isolation trusted-local explicitly
// permits owner-trusted host execution; it is NOT an OS sandbox. Room approval
// and remote command permission checks remain required in either mode.
import { startRunner } from './lib.js'
import os from 'node:os'
import path from 'node:path'

const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : (process.env[`MURMIO_${name.toUpperCase().replace(/-/g, '_')}`] ?? dflt) }
const server = arg('server'); const token = arg('token')
const allow = new Set(String(arg('allow-room', '')).split(',').map(s => s.trim()).filter(Boolean))
if (!server || !token) { console.error('usage: murmio-runner --server ws://host:port --token T [--label NAME] [--allow-room demo,other|*] [--root DIR] [--isolation native|trusted-local]'); process.exit(2) }
if (!allow.size) console.error('note: no --allow-room given, so every job will be refused until you allow a workspace.')
startRunner({ server, token, label: arg('label', `${os.hostname()} (${process.platform})`), root: arg('root', path.join(os.tmpdir(), 'murmio-runner')), isolation: arg('isolation', process.platform === 'linux' ? 'native' : 'trusted-local'), canRun: async room => allow.has('*') || allow.has(room) })
console.log(`allowing: ${[...allow].join(', ') || 'nothing'}`)
