/* =============================================================================
 * vb-studio.js — thanh điều hướng dùng chung cho studio.html / batch.html / merge.html
 * Không còn cơ chế tab-trong-một-trang. Mỗi công cụ là một trang riêng.
 * ========================================================================== */
(function () {
  'use strict';
  const VB = (window.VB = window.VB || {});

  const PAGES = [
    { file: 'studio.html', key: 'context', label: '📚 Tạo ngữ cảnh' },
    { file: 'batch.html',  key: 'batch',   label: '📦 Dịch hàng loạt' },
    { file: 'merge.html',  key: 'merge',   label: '🔀 Gộp bản dịch' }
  ];

  function currentFile() {
    const p = location.pathname.split('/').pop() || 'index.html';
    return p.toLowerCase();
  }

  function buildNav() {
    const nav = document.querySelector('.vb-studio-nav');
    if (!nav) return;
    const here = currentFile();
    nav.innerHTML = '';
    PAGES.forEach(p => {
      const a = document.createElement('a');
      a.className = 'vb-studio-tab' + (here === p.file ? ' is-active' : '');
      a.href = p.file;
      a.textContent = p.label;
      a.dataset.page = p.key;
      if (here === p.file) a.setAttribute('aria-current', 'page');
      nav.appendChild(a);
    });
    const sp = document.createElement('span');
    sp.className = 'vb-spacer';
    nav.appendChild(sp);
    const home = document.createElement('a');
    home.className = 'vb-studio-tab vb-studio-tab-ghost';
    home.href = 'index.html';
    home.textContent = '← Trang chính';
    nav.appendChild(home);
  }

  // Dọn rác của bản gộp-tab cũ: nếu localStorage còn khoá tab thì xoá đi
  try { localStorage.removeItem('visionbox_studio_tab'); } catch (_) {}

  // Toast dùng chung cho cả 3 trang
  function toast(msg, ms) {
    let el = document.getElementById('vb-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'vb-toast';
      el.className = 'vb-toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('is-on');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('is-on'), ms || 2000);
  }

  // Cảnh báo khi rời trang lúc đang chạy tác vụ
  window.addEventListener('beforeunload', (e) => {
    const busy = (VB.batch && VB.batch.state && VB.batch.state.running) ||
                 (VB.context && VB.context.running) ||
                 (VB.merge && VB.merge.running);
    if (busy) { e.preventDefault(); e.returnValue = ''; }
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildNav);
  else buildNav();

  VB.toast = toast;
  VB.studio = { pages: PAGES, currentFile, buildNav };
})();
