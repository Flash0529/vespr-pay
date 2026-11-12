// The VESPR look inside the browser SDE. The web workbench keeps user settings in the browser profile and ignores server-side defaults,
// so the extension sets them (only the ones the person has not set themselves) and closes the Welcome / Walkthrough tabs that open on a first visit.
const PALETTE = {
  'editor.background': '#1c1c1e', 'editorGroupHeader.tabsBackground': '#131314', 'editorGroup.border': '#131314',
  'tab.activeBackground': '#1c1c1e', 'tab.inactiveBackground': '#131314', 'tab.border': '#131314', 'tab.activeBorderTop': '#6c9dff', 'tab.unfocusedActiveBorderTop': '#131314',
  'sideBar.background': '#171718', 'sideBar.border': '#171718', 'sideBarSectionHeader.background': '#171718', 'sideBarSectionHeader.border': '#171718',
  'activityBar.background': '#131314', 'activityBar.border': '#131314', 'activityBar.activeBorder': '#6c9dff', 'activityBarBadge.background': '#6c9dff', 'activityBarBadge.foreground': '#06122e',
  'titleBar.activeBackground': '#131314', 'titleBar.inactiveBackground': '#131314', 'titleBar.border': '#131314',
  'statusBar.background': '#171718', 'statusBar.foreground': '#9b9ba3', 'statusBar.border': '#171718', 'statusBar.noFolderBackground': '#171718',
  'panel.background': '#131314', 'panel.border': '#131314', 'terminal.background': '#131314', 'panelTitle.activeBorder': '#6c9dff',
  'focusBorder': '#6c9dff', 'list.activeSelectionBackground': '#232326', 'list.hoverBackground': '#232326', 'list.inactiveSelectionBackground': '#232326',
  'input.background': '#232326', 'input.border': '#232326', 'dropdown.background': '#232326', 'dropdown.border': '#232326',
  'button.background': '#6c9dff', 'button.foreground': '#06122e', 'progressBar.background': '#6c9dff',
  'editorWidget.background': '#1c1c1e', 'editorWidget.border': '#232326', 'editorLineNumber.foreground': '#6c6c74', 'editorLineNumber.activeForeground': '#9b9ba3', 'editorCursor.foreground': '#6c9dff',
  'scrollbarSlider.background': '#ffffff14', 'scrollbarSlider.hoverBackground': '#ffffff24', 'breadcrumb.background': '#1c1c1e', 'widget.border': '#232326'
}
const SETTINGS = {
  'workbench.startupEditor': 'none', 'workbench.welcomePage.walkthroughs.openOnInstall': false, 'workbench.tips.enabled': false, 'workbench.enableExperiments': false,
  'window.commandCenter': false, 'window.menuBarVisibility': 'hidden', 'workbench.layoutControl.enabled': false, 'window.autoDetectColorScheme': false,
  'workbench.colorTheme': 'Default Dark Modern', 'workbench.colorCustomizations': PALETTE, 'update.mode': 'none', 'extensions.autoCheckUpdates': false
}
const isWelcomeTab = label => /^(welcome|get started)$|^walkthrough:/i.test(String(label || '').trim())

// Which settings still need writing: those the person has not set (inspect() says there is no user value). A `workbench.colorCustomizations` the person made is kept whole.
function planUpdates (inspect, settings = SETTINGS) {
  const out = []
  for (const [key, value] of Object.entries(settings)) { const i = inspect(key); if (!i || i.globalValue === undefined) out.push([key, value]) }
  return out
}

function apply (vscode) {
  const cfg = vscode.workspace.getConfiguration()
  const todo = planUpdates(k => cfg.inspect(k))
  Promise.all(todo.map(([k, v]) => Promise.resolve(cfg.update(k, v, vscode.ConfigurationTarget.Global)).catch(() => {}))).catch(() => {})
  // a first visit opens a Welcome or Walkthrough tab: close it (for the first 20 seconds only, so a person who opens it on purpose later is not fought)
  const t0 = Date.now(); const closeWelcome = () => {
    if (Date.now() - t0 > 20000) return
    for (const g of vscode.window.tabGroups.all) for (const tab of g.tabs) if (isWelcomeTab(tab.label)) { try { vscode.window.tabGroups.close(tab) } catch {} }
  }
  Promise.resolve(vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar')).catch(() => {}) // the empty right-hand (chat) panel that appears once the title bar is hidden
  setTimeout(() => Promise.resolve(vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar')).catch(() => {}), 4000)
  closeWelcome(); const d = vscode.window.tabGroups.onDidChangeTabs(closeWelcome); setTimeout(() => d.dispose(), 20500)
  return todo.length
}
module.exports = { apply, planUpdates, isWelcomeTab, SETTINGS, PALETTE }
