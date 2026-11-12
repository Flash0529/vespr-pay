const test=require('node:test'),assert=require('node:assert/strict')
const {windowAppearance,resolveWallpaperPath}=require('../appearance.js')
const {readFileSync}=require('node:fs'),{runInNewContext}=require('node:vm'),path=require('node:path')
test('supported Windows11 gets an OS backdrop without a wallpaper file',()=>{
 const actual=windowAppearance({platform:'win32',release:'10.0.22621'})
 assert.deepEqual(actual,{backdrop:'mica',options:{backgroundMaterial:'mica',backgroundColor:'#00000000'}})
})
test('older Windows, other OS and malformed versions keep solid backgrounds',()=>{
 for(const [platform,release] of [['win32','10.0.22000'],['darwin','24.0.0'],['linux','6.1.0'],['win32','unknown']]){
  assert.deepEqual(windowAppearance({platform,release}),{backdrop:'solid',options:{backgroundColor:'#202022'}})
 }
})
test('accessibility settings take priority over the material effect',()=>{
 for(const settings of [{reducedTransparency:true},{highContrast:true}]){
  assert.equal(windowAppearance({platform:'win32',release:'10.0.26100',...settings}).backdrop,'solid')
 }
})
test('wallpaper mode returns wallpaper backdrop with solid backing when wallpaper exists',()=>{
 const actual=windowAppearance({platform:'win32',release:'10.0.26100',wallpaperPath:path.join(__dirname,'../package.json')})
 assert.equal(actual.backdrop,'wallpaper')
 assert.equal(actual.options.backgroundColor,'#202022')
})
test('accessibility settings override wallpaper mode to solid',()=>{
 const actual=windowAppearance({platform:'win32',release:'10.0.26100',reducedTransparency:true,wallpaperPath:path.join(__dirname,'../package.json')})
 assert.equal(actual.backdrop,'solid')
})
test('missing wallpaper path falls back to mica on Win11 or solid',()=>{
 const actual=windowAppearance({platform:'win32',release:'10.0.26100',wallpaperPath:'C:\\nonexistent\\wallpaper.jpg'})
 assert.equal(actual.backdrop,'mica')
 const actualOlder=windowAppearance({platform:'win32',release:'10.0.19045',wallpaperPath:'C:\\nonexistent\\wallpaper.jpg'})
 assert.equal(actualOlder.backdrop,'solid')
})
test('preload exposes the exact read-only native capability, with no extra IPC call',()=>{
 const script=readFileSync(path.join(__dirname,'../preload.js'),'utf8')
 for(const [argument,expected] of [['mica','mica'],['wallpaper','wallpaper'],['unexpected','solid']]){
  const exposed={};let calls=0
  runInNewContext(script,{process:{argv:['--vespr-site=https://fixture.invalid','--vespr-backdrop='+argument]},require:name=>{assert.equal(name,'electron');return {contextBridge:{exposeInMainWorld:(key,value)=>{exposed[key]=value}},ipcRenderer:{invoke:()=>{calls++}}}}})
  assert.equal(exposed.VESPR_DESKTOP.backdrop,expected)
  assert.equal(calls,0)
 }
})
