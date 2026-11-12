import assert from 'node:assert'
import {
  normalizePhotoName,
  generatePairedMeta,
  searchPhotoAssets,
  formatSidecarPath,
  isDescriptiveImageName,
  shouldNormalizeImageName,
  processIncomingPhoto
} from '../photo-asset-pipeline.js'

// normalization
const fixedTime = Date.UTC(2026, 10, 5, 12, 30) // 20261105-1230
const n1 = normalizePhotoName('Screenshot 2026-11-05 at 10.15.22.png', { timestamp: fixedTime })
assert.strictEqual(n1, 'asset-photo-20261105-1230-screenshot.png')

const n2 = normalizePhotoName('IMG_0492.JPG', { timestamp: fixedTime, sequence: 2 })
assert.strictEqual(n2, 'asset-photo-20261105-1230-capture-2.jpg')

const n3 = normalizePhotoName('Dashboard Analytics Graph.webp', { timestamp: fixedTime })
assert.strictEqual(n3, 'asset-photo-20261105-1230-dashboard-analytics-graph.webp')

// sidecar path
assert.strictEqual(formatSidecarPath('assets/img1.png'), 'assets/img1.png.meta.json')
assert.strictEqual(formatSidecarPath('assets/img1.png', 'text'), 'assets/img1.png.desc.txt')

// paired metadata generation
const meta = generatePairedMeta('assets/' + n1, {
  originalName: 'Screenshot 2026-11-05 at 10.15.22.png',
  width: 1920,
  height: 1080,
  sizeBytes: 250000,
  description: 'Production metrics dashboard in dark mode showing 99.9% uptime and active subscribers',
  tags: ['Dashboard', 'Metrics', 'Dark Mode'],
  ocrTokens: ['revenue', 'subscribers', '99.9%', 'uptime', 'october']
})

assert.strictEqual(meta.format, 'png')
assert.strictEqual(meta.aspectRatio, '16:9')
assert.deepStrictEqual(meta.tags, ['dashboard', 'metrics', 'dark-mode'])
assert.ok(meta.searchIndex.includes('revenue'))
assert.ok(meta.searchIndex.includes('uptime'))

// descriptive naming scheme detection
assert.strictEqual(isDescriptiveImageName('architecture-diagram.png'), true)
assert.strictEqual(isDescriptiveImageName('user-profile.webp'), true)
assert.strictEqual(isDescriptiveImageName('logo-dark.svg'), true)
assert.strictEqual(isDescriptiveImageName('auth-flow-v2.png'), true)
assert.strictEqual(isDescriptiveImageName('button-hover.png'), true)
assert.strictEqual(isDescriptiveImageName('database_schema.png'), true)
assert.strictEqual(isDescriptiveImageName('userProfileAvatar.png'), true)
assert.strictEqual(isDescriptiveImageName('favicon.ico'), true)
assert.strictEqual(isDescriptiveImageName('hero.jpg'), true)

// generic screenshots, camera dumps, and hashes should NOT be descriptive
assert.strictEqual(isDescriptiveImageName('Screenshot 2026-11-05 at 10.15.22.png'), false)
assert.strictEqual(isDescriptiveImageName('Screen Shot 2026-11-05.png'), false)
assert.strictEqual(isDescriptiveImageName('IMG_0492.JPG'), false)
assert.strictEqual(isDescriptiveImageName('DSC_0012.JPG'), false)
assert.strictEqual(isDescriptiveImageName('DCIM_1001.JPG'), false)
assert.strictEqual(isDescriptiveImageName('Pasted image.png'), false)
assert.strictEqual(isDescriptiveImageName('image(1).png'), false)
assert.strictEqual(isDescriptiveImageName('untitled.png'), false)
assert.strictEqual(isDescriptiveImageName('8f4b2c1a-5b1e-4c3d-9a8b-1e2f3a4b5c6d.png'), false)
assert.strictEqual(isDescriptiveImageName('1730793600123.png'), false)

// shouldNormalizeImageName decisions with settings
// 1. Descriptive name with avoidDescriptiveNames: true (default) -> should NOT normalize
assert.strictEqual(shouldNormalizeImageName('architecture-diagram.png', { autoNormalizeNames: true, avoidDescriptiveNames: true }), false)
assert.strictEqual(shouldNormalizeImageName('user-profile.webp', {}), false) // defaults to true
assert.strictEqual(shouldNormalizeImageName('logo-dark.svg'), false)

// 2. Generic screenshot / camera dump -> SHOULD normalize
assert.strictEqual(shouldNormalizeImageName('Screenshot 2026-11-05 at 10.15.22.png', { autoNormalizeNames: true, avoidDescriptiveNames: true }), true)
assert.strictEqual(shouldNormalizeImageName('IMG_0492.JPG'), true)

// 3. If user explicitly sets avoidDescriptiveNames: false -> even descriptive is normalized
assert.strictEqual(shouldNormalizeImageName('architecture-diagram.png', { autoNormalizeNames: true, avoidDescriptiveNames: false }), true)

// 4. If autoNormalizeNames: false -> never normalize
assert.strictEqual(shouldNormalizeImageName('Screenshot 2026-11-05.png', { autoNormalizeNames: false }), false)

// 5. Already normalized name -> do not re-normalize
assert.strictEqual(shouldNormalizeImageName('asset-photo-20261105-1230-capture.png'), false)

// processIncomingPhoto end-to-end
const p1 = processIncomingPhoto('Screenshot 2026-11-05 at 10.15.22.png', { timestamp: fixedTime })
assert.strictEqual(p1.renamed, true)
assert.strictEqual(p1.finalName, 'asset-photo-20261105-1230-screenshot.png')
assert.strictEqual(p1.sidecarPath, 'asset-photo-20261105-1230-screenshot.png.meta.json')
assert.ok(p1.meta)
assert.strictEqual(p1.meta.originalName, 'Screenshot 2026-11-05 at 10.15.22.png')

const p2 = processIncomingPhoto('architecture-diagram.png', {
  description: 'System microservices and event bus architecture',
  tags: ['Architecture', 'Diagram', 'Services']
})
assert.strictEqual(p2.renamed, false) // preserved original name!
assert.strictEqual(p2.finalName, 'architecture-diagram.png')
assert.strictEqual(p2.sidecarPath, 'architecture-diagram.png.meta.json')
assert.ok(p2.meta)
assert.deepStrictEqual(p2.meta.tags, ['architecture', 'diagram', 'services'])

// search engine matching through photos
const assets = [
  { path: 'assets/' + n1, meta },
  {
    path: 'assets/hero.jpg',
    meta: generatePairedMeta('assets/hero.jpg', {
      description: 'Landing page hero image featuring code editor',
      tags: ['editor', 'homepage']
    })
  },
  {
    path: p2.finalName,
    meta: p2.meta
  }
]

const searchRevenue = searchPhotoAssets('revenue', assets)
assert.strictEqual(searchRevenue.length, 1)
assert.strictEqual(searchRevenue[0].assetPath, 'assets/' + n1)
assert.ok(searchRevenue[0].matchedTerms.includes('revenue'))

const searchEditor = searchPhotoAssets('editor', assets)
assert.strictEqual(searchEditor.length, 1)
assert.strictEqual(searchEditor[0].assetPath, 'assets/hero.jpg')

const searchArch = searchPhotoAssets('architecture', assets)
assert.strictEqual(searchArch.length, 1)
assert.strictEqual(searchArch[0].assetPath, 'architecture-diagram.png')

console.log('photo-asset-pipeline tests passed successfully')
