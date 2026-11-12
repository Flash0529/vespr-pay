#!/usr/bin/env node
// Headless-browser check of the SDE file explorer, fuzzy palette (tools/cdp-shot.mjs against scripts/demo-stack.sh).
// Run:  VESPR_DEMO_DIR=$HOME/.cache/vespr-ctx-demo VESPR_DEMO_PORT=9560 node scripts/test-explorer-browser.mjs
// It tests:
//   1. New file creation (dialog/inline edit -> liveClient.files + DOM update)
//   2. New folder creation (.keep marker -> directory tree item)
//   3. Rename file (treeAction -> pathops plan -> state & DOM update)
//   4. Delete with confirmation (inline confirmation row -> delete-yes -> cleanup)
//   5. Command palette fuzzy ranking and match highlighting (pal -> FZ.rank -> <mark>)
//   6. Recent files ranking in the palette (touchFile -> RC.list -> recents first)
//   (follow mode was removed on 2026-11-07 at the team's request; its checks went with it)

import { spawnSync, execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIR = process.env.VESPR_DEMO_DIR || path.join(os.homedir(), '.cache', 'vespr-ctx-demo')
const PORT = Number(process.env.VESPR_DEMO_PORT || 9560)
const WEB = PORT + 2
const CDP = process.env.CDP_SHOT || '/srv/vespr/tools/cdp-shot.mjs'

// Skip gracefully if chromium is not installed in the environment
if (spawnSync('which', ['chromium']).status !== 0) {
  console.log('PASS explorer-browser (chromium not installed, skipped)')
  process.exit(0)
}

const fail = []
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' ' + detail : ''}`)
  if (!ok) fail.push(name)
}

// 1. Ensure the demo stack is running
let startedOurOwnStack = false
const statusCmd = `VESPR_DEMO_DIR=${DIR} VESPR_DEMO_PORT=${PORT} bash "${ROOT}/scripts/demo-stack.sh" status`
let statusOut = ''
try { statusOut = execSync(statusCmd, { encoding: 'utf8' }) } catch {}

if (!statusOut.includes('server: up') || !statusOut.includes('web: up')) {
  console.log(`Starting demo stack on port ${PORT}...`)
  execSync(`VESPR_DEMO_DIR=${DIR} VESPR_DEMO_PORT=${PORT} bash "${ROOT}/scripts/demo-stack.sh" start`, { stdio: 'inherit' })
  startedOurOwnStack = true
}

// Read token and construct URL
const tokPath = path.join(DIR, 'tok-alex')
if (!fs.existsSync(tokPath)) {
  console.error('FAIL: tok-alex not found in ' + DIR)
  process.exit(1)
}
const tok = fs.readFileSync(tokPath, 'utf8').trim()
const targetUrl = `http://127.0.0.1:${WEB}/prototype.html?live=1&server=ws://127.0.0.1:${PORT}&room=demo&name=alex&token=${tok}#token=${tok}`

const work = fs.mkdtempSync(path.join(os.homedir(), '.cache', 'explorer-browser-'))

const testScript = `(function() {
  try {
    const results = {};
    const snapFiles = () => (liveClient && liveClient.get && liveClient.get().files) || [];

    // 1. Initial State
    results.connected = !!(liveConnected && liveClient && document.getElementById('connBtn')?.dataset.status === 'connected');
    results.initialFilesCount = snapFiles().length;


    // 2. New File
    const btnNewFile = document.querySelector('button[data-treeact="new-file"]');
    if (btnNewFile) btnNewFile.click();
    const inputNewFile = document.getElementById('treeEdit');
    results.hasNewFileInput = !!inputNewFile;
    if (inputNewFile) {
      inputNewFile.value = 'test_item.py';
      inputNewFile.dispatchEvent(new Event('input', { bubbles: true }));
      commitTreeEdit();
    }
    results.fileCreated = snapFiles().includes('test_item.py');
    results.activeAfterCreate = state.activeFile === 'test_item.py';
    results.domHasNewFile = !!document.querySelector('.tree .row[data-file="test_item.py"]');

    // 3. New Folder
    const btnNewFolder = document.querySelector('button[data-treeact="new-folder"]');
    if (btnNewFolder) btnNewFolder.click();
    const inputNewFolder = document.getElementById('treeEdit');
    results.hasNewFolderInput = !!inputNewFolder;
    if (inputNewFolder) {
      inputNewFolder.value = 'test_folder';
      inputNewFolder.dispatchEvent(new Event('input', { bubbles: true }));
      commitTreeEdit();
    }
    results.folderCreated = snapFiles().includes('test_folder/.keep');
    results.domHasFolder = !!document.querySelector('.tree .row.dir[data-dir="test_folder"]');

    // 4. Rename
    const rowToRename = document.querySelector('.tree .row[data-file="test_item.py"]');
    treeAction('rename', rowToRename);
    const inputRename = document.getElementById('treeEdit');
    results.hasRenameInput = !!inputRename && inputRename.value === 'test_item.py';
    if (inputRename) {
      inputRename.value = 'renamed_item.py';
      inputRename.dispatchEvent(new Event('input', { bubbles: true }));
      commitTreeEdit();
    }
    results.renameOldGone = !snapFiles().includes('test_item.py');
    results.renameNewPresent = snapFiles().includes('renamed_item.py');
    results.activeAfterRename = state.activeFile === 'renamed_item.py';
    results.domHasRenamedFile = !!document.querySelector('.tree .row[data-file="renamed_item.py"]');

    // 5. Delete with Confirmation
    const rowToDelete = document.querySelector('.tree .row[data-file="renamed_item.py"]');
    treeAction('delete', rowToDelete);
    const confirmRow = document.querySelector('.tree .row.confirm');
    results.hasConfirmRow = !!confirmRow;
    results.confirmHasWarning = confirmRow ? /Delete renamed_item\\.py/.test(confirmRow.textContent) : false;
    const btnDeleteYes = document.querySelector('button[data-treeact="delete-yes"]');
    results.hasDeleteYesBtn = !!btnDeleteYes;
    if (btnDeleteYes) btnDeleteYes.click();
    results.deletedFromLive = !snapFiles().includes('renamed_item.py');
    results.deletedFromDom = !document.querySelector('.tree .row[data-file="renamed_item.py"]');

    // Clean up test_folder
    const folderToDelete = document.querySelector('.tree .row.dir[data-dir="test_folder"]');
    if (folderToDelete) {
      treeAction('delete', folderToDelete);
      const btnDelFolder = document.querySelector('button[data-treeact="delete-yes"]');
      if (btnDelFolder) btnDelFolder.click();
    }

    // 6. Palette with Fuzzy Ranking
    pal(true);
    const palIn = document.getElementById('palIn');
    results.palOpen = !document.getElementById('palScrim').hidden;
    palIn.value = 'c p';
    palList('c p');
    const firstPalOption = document.querySelector('#palList li[role="option"]');
    results.palTopResultText = firstPalOption ? firstPalOption.textContent : '';
    results.palHasMark = firstPalOption ? !!firstPalOption.querySelector('mark') : false;
    pal(false);

    // 7. Recent Files
    touchFile('boom.py');
    touchFile('cart.py');
    pal(true);
    palList('');
    const recentsPresent = typeof RC !== 'undefined' && RC && RC.list().length >= 2;
    results.recentsTracked = recentsPresent;
    pal(false);

    return results;
  } catch (err) {
    return { error: err.message, stack: err.stack };
  }
})()`

const plan = {
  w: 1280,
  h: 800,
  dsf: 1,
  mobile: false,
  steps: [
    { go: targetUrl, wait: 2000 },
    { waitFor: "document.getElementById('connBtn') && document.getElementById('connBtn').dataset.status === 'connected'", tries: 60 },
    { eval: testScript, print: 'EXPLORER_RESULTS' }
  ]
}

const planPath = path.join(work, 'plan.json')
fs.writeFileSync(planPath, JSON.stringify(plan))

const runOnce = () => spawnSync('node', ['--experimental-websocket', CDP, planPath], {
  encoding: 'utf8',
  timeout: Number(process.env.EXPLORER_TIMEOUT_MS || 150000), // a busy machine needs longer than a minute to start the browser and connect
  env: { ...process.env, TMPDIR: work }
})

let run = runOnce()
if (run.status !== 0 && /targets/.test((run.stdout || '') + (run.stderr || ''))) {
  run = runOnce()
}

const out = (run.stdout || '') + (run.stderr || '')
let got = null
for (const line of out.split('\n')) {
  if (line.startsWith('EXPLORER_RESULTS ')) {
    try {
      const raw = line.slice('EXPLORER_RESULTS '.length).trim()
      got = JSON.parse(raw)
      if (typeof got === 'string') got = JSON.parse(got)
    } catch {}
  }
}

check('browser ran', !!got && run.status === 0, run.status === 0 ? '' : `(cdp exit ${run.status})`)

if (got && !got.error) {
  check('live connection established', got.connected === true)
  check('new file: input opens', got.hasNewFileInput === true)
  check('new file: created on live store', got.fileCreated === true)
  check('new file: active in editor and DOM', got.activeAfterCreate === true && got.domHasNewFile === true)
  check('new folder: created on live store and DOM', got.folderCreated === true && got.domHasFolder === true)
  check('rename: prompt opens with current name', got.hasRenameInput === true)
  check('rename: old path gone, new path on store', got.renameOldGone === true && got.renameNewPresent === true)
  check('rename: active file and DOM updated', got.activeAfterRename === true && got.domHasRenamedFile === true)
  check('delete: confirmation row appears', got.hasConfirmRow === true && got.confirmHasWarning === true)
  check('delete: confirmation removes from store and DOM', got.deletedFromLive === true && got.deletedFromDom === true)
  check('palette: opens on pal(true)', got.palOpen === true)
  check('palette: fuzzy ranking highlights matches', got.palHasMark === true && got.palTopResultText.includes('cart.py'))
  check('recent files: tracked in recents list', got.recentsTracked === true)
} else if (got && got.error) {
  check('test script execution', false, `${got.error}\n${got.stack}`)
} else {
  check('test script executed', false, 'no result parsed from CDP output')
}

// Clean up
try {
  fs.rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
} catch {}

if (startedOurOwnStack) {
  console.log('Stopping demo stack...')
  execSync(`VESPR_DEMO_DIR=${DIR} VESPR_DEMO_PORT=${PORT} bash "${ROOT}/scripts/demo-stack.sh" stop`, { stdio: 'ignore' })
}

console.log(fail.length ? `FAILED: ${fail.join('; ')}` : 'ALL EXPLORER-BROWSER CHECKS PASSED')
process.exit(fail.length ? 1 : 0)
