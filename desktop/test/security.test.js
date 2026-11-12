'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const s = require('../security.js')

const APP = 'vespr-app://vespr'
const SETTINGS = 'file:///C:/Program%20Files/VESPR/resources/app.asar/connect.html'

test('only web and mail links go to the browser', () => {
  for (const ok of ['https://vespr.online/docs', 'http://example.com', 'mailto:help@example.com']) assert.equal(s.safeExternal(ok), true, ok)
  for (const bad of ['file:///C:/Windows/System32/calc.exe', 'ms-msdt:/id', 'search-ms:query=x', 'smb://host/share', 'javascript:alert(1)', 'vbscript:x', 'not a url', '']) assert.equal(s.safeExternal(bad), false, bad)
})

test('the window stays on the app and its settings page', () => {
  const o = { appOrigin: APP, settingsUrl: SETTINGS }
  assert.equal(s.mayNavigate('vespr-app://vespr/app/?room=a', o), true)
  assert.equal(s.mayNavigate(SETTINGS + '#x', o), true)
  assert.equal(s.mayNavigate('file:///C:/Users/me/Downloads/evil.html', o), false, 'not any local file')
  assert.equal(s.mayNavigate('https://evil.example/', o), false)
  assert.equal(s.mayNavigate('vespr-app://other/app/', o), false)
})

test('a vespr:// link is followed only for the server the app already uses', () => {
  assert.equal(s.sameServer('https://vespr.online/', 'https://vespr.online'), true)
  assert.equal(s.sameServer('https://vespr.online.evil.example', 'https://vespr.online'), false)
  assert.equal(s.sameServer('http://vespr.online', 'https://vespr.online'), false)
  assert.equal(s.sameServer(null, 'https://vespr.online'), false)
})

test('settings accept https, and http only locally or on the tester build', () => {
  assert.equal(s.cleanAddress('https://vespr.online/'), 'https://vespr.online')
  assert.equal(s.cleanAddress('http://localhost:8241'), 'http://localhost:8241')
  assert.equal(s.cleanAddress('http://100.64.0.10:9700'), null)
  assert.equal(s.cleanAddress('http://100.64.0.10:9700', { allowHttp: true }), 'http://100.64.0.10:9700')
  assert.equal(s.cleanAddress('https://user:pw@vespr.online'), null, 'no passwords in addresses')
  assert.equal(s.cleanAddress('javascript:alert(1)'), null)
  assert.equal(s.cleanAddress(''), '')
  assert.deepEqual(s.cleanSettings({ site: 'https://vespr.online', token: 'abc', label: 'my\u0007 pc' }), { site: 'https://vespr.online', token: 'abc', label: 'my pc' })
  assert.equal(s.cleanSettings({ ideUrl: 'file:///C:/x.html' }), null)
  assert.equal(s.cleanSettings({ token: 'a b' }), null)
  assert.equal(s.cleanSettings('nope'), null)
})

test('permissions: clipboard, notifications and fullscreen for the app only', () => {
  assert.equal(s.mayHavePermission('notifications', 'vespr-app://vespr/app/', APP), true)
  for (const p of ['media', 'geolocation', 'midiSysex', 'hid', 'serial', 'usb', 'openExternal', 'display-capture']) assert.equal(s.mayHavePermission(p, 'vespr-app://vespr/app/', APP), false, p)
  assert.equal(s.mayHavePermission('notifications', 'https://evil.example', APP), false)
})

test('the runner token is sealed when the key store is available', () => {
  const store = { isEncryptionAvailable: () => true, encryptString: v => Buffer.from('sealed:' + v), decryptString: b => b.toString().replace(/^sealed:/, '') }
  const sealed = s.sealSecret('tok123', store)
  assert.equal(sealed.token, ''); assert.ok(sealed.tokenSealed && !sealed.tokenSealed.includes('tok123'))
  assert.equal(s.openSecret(sealed, store), 'tok123')
  assert.equal(s.openSecret({ token: 'old-plain' }, store), 'old-plain', 'an old settings file still works (and is sealed on the next save)')
  const none = { isEncryptionAvailable: () => false }
  assert.deepEqual(s.sealSecret('tok', none), { token: 'tok' })
  assert.equal(s.openSecret({ tokenSealed: 'xx' }, { isEncryptionAvailable: () => true, decryptString: () => { throw new Error('other user') } }), '')
})
