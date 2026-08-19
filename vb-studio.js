/* vb-studio.js — chuyển tab giữa các công cụ trong trang Studio */
(() => {
  'use strict';
  const KEY = 'visionbox_studio_tab';
  const TABS = ['batch', 'merge'];

  function show(name) {
    document.querySelectorAll('.vb-studio-tab').forEach(t => t.classList.toggle('is-active', t.dataset.tab === name));
    document.querySelectorAll('.vb-studio-panel').forEach(p => p.classList.toggle('is-active', p.dataset.panel === name));
    try { localStorage.setItem(KEY, name); } catch (e) {}
    if (location.hash.slice(1) !== name) history.replaceState(null, '', '#' + name);
  }

  function init() {
    if (!document.querySelector('.vb-studio-tab')) return;
    document.querySelectorAll('.vb-studio-tab').forEach(t => t.addEventListener('click', () => show(t.dataset.tab)));
    let saved = '';
    try { saved = localStorage.getItem(KEY) || ''; } catch (e) {}
    const hash = location.hash.slice(1);
    show(TABS.includes(hash) ? hash : (TABS.includes(saved) ? saved : 'batch'));
  }

  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', init) : init();
})();
