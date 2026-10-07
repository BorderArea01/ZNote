// Shared navigation for independently installed ZNote extensions. No credentials.
export function panelTabs(root = document) {
  const bar = root.querySelector('[data-panel-tabs]');
  if (!bar) return () => {};
  const tabs = [...bar.querySelectorAll('[data-panel]')];
  bar.setAttribute('role', 'tablist');
  function select(id, focus = false) {
    const chosen = tabs.find(tab => tab.dataset.panel === id) || tabs[0];
    for (const tab of tabs) {
      const panel = root.querySelector('#' + tab.dataset.panel), active = tab === chosen;
      tab.id ||= 'tab-' + tab.dataset.panel; tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-controls', tab.dataset.panel); tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
      if (panel) { panel.hidden = !active; panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', tab.id); }
    }
    if (focus) chosen.focus();
    bar.dispatchEvent(new CustomEvent('panel-change', { detail: chosen.dataset.panel }));
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => select(tab.dataset.panel));
    tab.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      select(tabs[next].dataset.panel, true);
    });
  });
  select(bar.dataset.initial || tabs[0].dataset.panel);
  return select;
}
export function pluginShell(root = document) {
  const manifest = chrome.runtime.getManifest();
  root.querySelectorAll('[data-addon-version]').forEach(node => node.textContent = manifest.version_name || manifest.version);
  root.querySelectorAll('[data-manage-addons]').forEach(button => button.addEventListener('click', () =>
    chrome.tabs.create({ url: /Edg\//.test(navigator.userAgent) ? 'edge://extensions/' : 'chrome://extensions/' })));
  return panelTabs(root);
}
