/* Presentation preferences only. Never grant access, approve commands or start work. */
(() => {
  const root = document.documentElement;
  const button = document.getElementById('developerToolsBtn');
  const compact = typeof matchMedia === 'function' ? matchMedia('(max-width:1100px)') : { matches:false };
  let enabled = false;
  // starts closed every time: it is a menu now, not a remembered panel
  function showTools(next, save) {
    enabled = next;
    const visible = enabled; // the tools are always one click away in a menu (the team, 2026-11-10: the row of icons in the top bar was pestering), on every window size
    root.dataset.developerTools = 'on'; // other styles (the composer's effort and context chips) key off this; the menu itself opens and closes below
    button?.setAttribute('aria-expanded', String(visible));
    button?.toggleAttribute('hidden', false);
    document.getElementById('developerActions')?.toggleAttribute('hidden', !visible);
  }
  showTools(enabled, false);
  compact.addEventListener?.('change', () => showTools(enabled, false));
  button?.addEventListener('click', e => { e.stopPropagation(); showTools(!enabled, true); });
  document.addEventListener('click', e => { if (enabled && !e.target.closest?.('#developerActions, #developerToolsBtn')) showTools(false, false); });
  document.getElementById('developerActions')?.addEventListener('keydown', e => {
    if (e.key === 'Escape') { showTools(false, true); button?.focus(); }
  });
  const sidebar = document.querySelector('#csetContainer .cset-sidebar');
  if (sidebar) {
    const label = document.createElement('label');
    label.className = 'settings-section-picker';
    label.textContent = 'Settings section';
    const select = document.createElement('select');
    select.id = 'csetSectionSelect';
    select.className = 'cset-select';
    sidebar.querySelectorAll('.cset-nav-group').forEach(group => { // the menu's own groups become option groups
      const heading = group.querySelector('.cset-nav-heading');
      const into = heading ? Object.assign(document.createElement('optgroup'), { label: heading.textContent.trim() }) : select;
      group.querySelectorAll('[data-cset-tab]').forEach(item => {
        const option = document.createElement('option');
        option.value = item.dataset.csetTab;
        option.textContent = item.textContent.trim();
        into.append(option);
      });
      if (into !== select) select.append(into);
    });
    select.addEventListener('change', () => {
      const item = [...sidebar.querySelectorAll('[data-cset-tab]')].find(x => x.dataset.csetTab === select.value);
      item?.click();
    });
    label.append(select);
    sidebar.querySelector('.cset-search-box')?.after(label);
  }
  // A keyboard user must be able to identify dynamic toggle controls too.
  const content = document.getElementById('csetContent');
  const labelControls = () => {
    content?.querySelectorAll('input[type=checkbox]').forEach(input => {
      if (input.labels?.[0]?.textContent.trim() || input.hasAttribute('aria-label')) return;
      const label = input.closest('.cset-sec')?.querySelector('.cset-label')?.textContent;
      if (label) input.setAttribute('aria-label', label);
    });
    const active = document.querySelector('.cset-nav-btn.active');
    const select = document.getElementById('csetSectionSelect');
    if (select && active) select.value = active.dataset.csetTab;
  };
  if (content) new MutationObserver(labelControls).observe(content, { childList:true, subtree:true });
  labelControls();
})();
