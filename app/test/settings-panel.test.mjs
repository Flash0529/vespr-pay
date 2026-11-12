import assert from 'node:assert'
import { createDefaultSettings, validateSettings, renderSettingsPanelHtml, SETTINGS_TABS } from '../settings-panel.js'

// default settings
const def = createDefaultSettings()
assert.strictEqual(def.routing.sslMode, 'strict')
assert.strictEqual(def.compute.cpuQuotaPercent, 100)
assert.strictEqual(def.cloudflare.tunnelName, 'vespr-tunnel')
assert.strictEqual(def.payments.merchantEnabled, true)
assert.strictEqual(def.search.engine, 'fuzzy')
assert.strictEqual(def.photos.autoNormalizeNames, true)
assert.strictEqual(def.photos.avoidDescriptiveNames, true)
assert.strictEqual(def.photos.generatePairedSidecar, true)
assert.strictEqual(SETTINGS_TABS.length, 8)

// validation
const res = validateSettings({
  routing: { customDomain: 'MYAPP.COM', sslMode: 'flexible' },
  compute: { cpuQuotaPercent: 999, memoryLimitMb: 32 },
  payments: { supportedCurrencies: ['usd', 'eur', 'invalid'] },
  photos: { avoidDescriptiveNames: false, autoNormalizeNames: true }
})

assert.strictEqual(res.valid, true)
assert.strictEqual(res.cleaned.routing.customDomain, 'myapp.com')
assert.strictEqual(res.cleaned.routing.sslMode, 'flexible')
assert.strictEqual(res.cleaned.compute.cpuQuotaPercent, 400, 'clamped to max 400')
assert.strictEqual(res.cleaned.compute.memoryLimitMb, 64, 'clamped to min 64')
assert.deepStrictEqual(res.cleaned.payments.supportedCurrencies, ['USD', 'EUR'], 'filtered invalid currency')
assert.strictEqual(res.cleaned.photos.avoidDescriptiveNames, false)

// HTML rendering for each tab
for (const tab of SETTINGS_TABS) {
  const html = renderSettingsPanelHtml(def, tab.id)
  assert.ok(html.includes('Developer Settings'))
  assert.ok(html.includes(`data-set-tab="${tab.id}"`))
}

// verify photo tab contains avoid descriptive switch
const photoHtml = renderSettingsPanelHtml(def, 'photos')
assert.ok(photoHtml.includes('id="setAvoidDescriptive"'))

console.log('settings-panel tests passed successfully')
