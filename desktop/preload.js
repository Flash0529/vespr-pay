const { contextBridge, ipcRenderer } = require('electron')

// The app inside this window: where its live connection goes (the main process passes the VESPR server address)
const site = (process.argv.find(a => a.startsWith('--vespr-site=')) || '').slice('--vespr-site='.length).replace(/\/+$/, '')
const scheme = (process.argv.find(a => a.startsWith('--vespr-scheme=')) || '').slice('--vespr-scheme='.length) // this app's link scheme (vespr, or vespr-test for VESPR Test)
const backdrop = ['mica', 'wallpaper'].find(b => process.argv.includes('--vespr-backdrop=' + b)) || 'solid'
if (site) contextBridge.exposeInMainWorld('VESPR_DESKTOP', { site, ws: site.replace(/^http/, 'ws'), scheme: /^vespr(-test)?$/.test(scheme) ? scheme : 'vespr', backdrop })

contextBridge.exposeInMainWorld('murmio', {
  get: () => ipcRenderer.invoke('murmio:get'),
  save: cfg => ipcRenderer.invoke('murmio:save', cfg),
  setScreenshotProtection: enable => ipcRenderer.invoke('vespr:set-content-protection', enable),
  getScreenshotProtection: () => ipcRenderer.invoke('vespr:get-content-protection'),
  onOpenTarget: cb => {
    if (typeof cb === 'function') {
      ipcRenderer.on('vespr:open-target', (_event, target) => cb(target))
    }
  }
})
