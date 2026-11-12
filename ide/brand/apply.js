// Build-time rebrand of the bundled VS Code web UI (run as root in the image): product name and default settings in product.json, a few CSS rules, the PWA manifest.
// The logo and icons are copied by the Dockerfile. Only visible branding changes; folder and CLI names stay so nothing else breaks.
// What did NOT work (tried 2026-10-28): patching the product object compiled into workbench.js (it reset the theme to light) and CSS-variable colors on a light theme.
const fs = require('fs')
const root = '/opt/openvscode-server'
const defaults = JSON.parse(fs.readFileSync(__dirname + '/defaults.json', 'utf8'))
const pj = root + '/product.json'; const j = JSON.parse(fs.readFileSync(pj, 'utf8'))
j.nameShort = 'VESPR'; j.nameLong = 'VESPR'; j.configurationDefaults = Object.assign({}, j.configurationDefaults || {}, defaults)
fs.writeFileSync(pj, JSON.stringify(j, null, '\t'))
const css = root + '/out/vs/code/browser/workbench/workbench.css'
fs.appendFileSync(css, '\n/* VESPR */\n.monaco-workbench .editor-group-watermark{display:none!important}\n.monaco-workbench .part.activitybar .menubar{display:none!important}\n.monaco-workbench .part.titlebar .titlebar-center{display:none!important}\n')
// the tab title still says the old product name (it is compiled into the bundle; changing it there resets the theme to light), so rename it at runtime
fs.appendFileSync(root + '/out/vs/code/browser/workbench/workbench.js', '\n;(function(){var f=function(){if(document.title.indexOf("OpenVSCode Server")>-1)document.title=document.title.split("OpenVSCode Server").join("VESPR")};new MutationObserver(f).observe(document.documentElement,{subtree:true,childList:true,characterData:true});f()})();\n')
const m = root + '/resources/server/manifest.json'
if (fs.existsSync(m)) { const x = JSON.parse(fs.readFileSync(m, 'utf8')); x.name = 'VESPR'; x.short_name = 'VESPR'; x.background_color = '#131314'; x.theme_color = '#131314'; fs.writeFileSync(m, JSON.stringify(x, null, '\t')) }
console.log('rebranded: VESPR, ' + Object.keys(defaults).length + ' default settings')
