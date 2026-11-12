import assert from 'node:assert'
import { createImageIndexer, extractVisualEntities } from '../image-indexer.js'

console.log('Running image-indexer tests...')

// 1. Entity Extraction
const ext1 = extractVisualEntities('assets/architecture-diagram.png', {
  width: 1920,
  height: 1080,
  sizeBytes: 154200,
  description: 'System microservices and Redis pubsub event bus architecture',
  tags: ['Architecture', 'Diagram', 'Services'],
  ocrTokens: ['microservices', 'redis', 'gateway', 'auth', 'postgres']
})

assert.ok(ext1.contentHash, 'must have contentHash')
assert.strictEqual(ext1.meta.format, 'png')
assert.ok(ext1.entities.length >= 7, 'must extract asset, tags, OCR, and component entities')
const ocrEnt = ext1.entities.find(e => e.kind === 'ocr-text' && e.text === 'redis')
assert.ok(ocrEnt, 'must have OCR entity for redis')
assert.strictEqual(ocrEnt.tokens[0], 'redis')

const compEnt = ext1.entities.find(e => e.kind === 'ui-component')
assert.ok(compEnt, 'must detect architecture/diagram as ui-component')

// 2. Indexer Lifecycle & Retention Store
const indexer = createImageIndexer()

// Index first image
const idx1 = indexer.indexImage('assets/architecture-diagram.png', {
  contentHash: 'hash-arch-001',
  description: 'System microservices',
  tags: ['Architecture', 'Diagram'],
  ocrTokens: ['redis', 'gateway']
})

assert.strictEqual(idx1.restoredFromCache, false, 'first index is fresh extraction')
assert.strictEqual(indexer.isImageActive('assets/architecture-diagram.png'), true)
assert.strictEqual(indexer.getActiveEntities('assets/architecture-diagram.png').length > 0, true)

// 3. Drop from Workspace (leaves workspace)
const dropResult = indexer.dropImageFromWorkspace('assets/architecture-diagram.png')
assert.strictEqual(dropResult.dropped, true)
assert.strictEqual(dropResult.retainedInCache, true)
assert.strictEqual(indexer.isImageActive('assets/architecture-diagram.png'), false, 'image is no longer active')
assert.strictEqual(indexer.getActiveEntities('assets/architecture-diagram.png').length, 0, 'active entities are dropped')
assert.strictEqual(indexer.hasRetainedHash('hash-arch-001'), true, 'index is retained in cache')

// 4. Restore to Workspace (re-added to workspace)
const restore1 = indexer.indexImage('assets/architecture-diagram.png', {
  contentHash: 'hash-arch-001'
})
assert.strictEqual(restore1.restoredFromCache, true, 'must be restored from cache fast-path')
assert.strictEqual(indexer.isImageActive('assets/architecture-diagram.png'), true, 'image is active again')
assert.strictEqual(indexer.getActiveEntities('assets/architecture-diagram.png').length > 0, true, 'entities are restored')

// 5. Explicit restoreImageToWorkspace
indexer.dropImageFromWorkspace('assets/architecture-diagram.png')
const explicitRestore = indexer.restoreImageToWorkspace('assets/architecture-diagram.png', 'hash-arch-001')
assert.strictEqual(explicitRestore.restored, true)
assert.strictEqual(indexer.isImageActive('assets/architecture-diagram.png'), true)

// 6. Unified Search (Agentic + History + Image)
const agenticContext = [
  { id: 'ag-1', title: 'Refactor Redis caching layer', prompt: 'Use redis cluster for caching session state', role: 'coder', model: 'flint:40b' },
  { id: 'ag-2', title: 'Audit security rules', prompt: 'Check auth gateway endpoints', role: 'security-agent', model: 'flint:40b' }
]

const historyContext = [
  { sha: 'commit-101', subject: 'Fix redis reconnection bug in runner', author: 'the VESPR team', timeAgo: '2h ago' },
  { id: 'chat-202', title: 'Discussion on architecture microservices', author: 'Alex', timeAgo: '1d ago' }
]

// Search 'redis' across all domains
const searchAll = indexer.search({ query: 'redis', kind: 'all', agenticContext, historyContext })
assert.ok(searchAll.length >= 3, 'redis should match across image, agentic, and history')
const domains = new Set(searchAll.map(r => r.domain))
assert.ok(domains.has('image'), 'must contain image match')
assert.ok(domains.has('agentic'), 'must contain agentic match')
assert.ok(domains.has('history'), 'must contain history match')

// Filtered search: kind: 'image'
const searchImageOnly = indexer.search({ query: 'redis', kind: 'image', agenticContext, historyContext })
assert.ok(searchImageOnly.length >= 1)
assert.ok(searchImageOnly.every(r => r.domain === 'image'))

// Filtered search: kind: 'agentic'
const searchAgenticOnly = indexer.search({ query: 'redis', kind: 'agentic', agenticContext, historyContext })
assert.strictEqual(searchAgenticOnly.length, 1)
assert.strictEqual(searchAgenticOnly[0].domain, 'agentic')

// Filtered search: kind: 'history'
const searchHistOnly = indexer.search({ query: 'redis', kind: 'history', agenticContext, historyContext })
assert.strictEqual(searchHistOnly.length, 1)
assert.strictEqual(searchHistOnly[0].domain, 'history')

// 7. Non-image, failed, and stale upload indexing rejection
assert.strictEqual(indexer.indexImage('assets/readme.txt'), null, 'text files must not be indexed as images');
assert.strictEqual(indexer.indexImage('assets/data.csv'), null, 'csv files must not be indexed as images');
assert.strictEqual(indexer.indexImage('assets/corrupt.png', { failed: true }), null, 'failed uploads must not be indexed');
assert.strictEqual(indexer.indexImage('assets/error.png', { status: 'failed' }), null, 'failed status must not be indexed');
assert.strictEqual(indexer.indexImage('assets/stale.png', { isStale: true }), null, 'stale uploads must not be indexed');
assert.strictEqual(indexer.isImageActive('assets/readme.txt'), false);
assert.strictEqual(indexer.isImageActive('assets/corrupt.png'), false);

console.log('✓ All image-indexer tests passed successfully!')
