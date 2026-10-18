/* =============================================================================
 * vb-dom-guard.js — chống "đứng" renderer.js khi index.html thiếu phần tử
 * renderer.js gắn sự kiện thẳng vào ~80 phần tử theo id mà không kiểm tra null.
 * Thiếu 1 cái (vd. #toggle-key-btn) là toàn bộ phần sau bị dừng:
 * Settings, Webtoon/Manga, theme, cỡ chữ, loadConfig... đều chết.
 * File này tạo phần tử ẩn thay thế cho cái nào bị thiếu + hiện lỗi JS lên màn hình.
 * PHẢI nạp NGAY TRƯỚC renderer.js.
 * ========================================================================== */
(function () {
  'use strict';

  // ---------- 1. Hiện lỗi JS lên màn hình (để dễ báo lỗi) ----------
  function showError(msg) {
    try {
      let box = document.getElementById('vb-err-box');
      if (!box) {
        box = document.createElement('div');
        box.id = 'vb-err-box';
        box.title = 'Bấm để đóng';
        box.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:99999;max-width:min(560px,90vw);' +
          'max-height:40vh;overflow:auto;padding:10px 14px;background:#3a1214;color:#ffd9d9;' +
          'border:1px solid #e5484d;border-radius:10px;font:12px/1.5 Consolas,monospace;' +
          'white-space:pre-wrap;cursor:pointer;box-shadow:0 10px 30px rgba(0,0,0,.5)';
        box.addEventListener('click', () => box.remove());
        (document.body || document.documentElement).appendChild(box);
      }
      box.textContent = (box.textContent ? box.textContent + '\n\n' : '⚠ Lỗi JavaScript (chụp lại gửi để sửa):\n') + msg;
    } catch (_) {}
  }
  window.addEventListener('error', e => {
    if (!e.message) return;
    const f = (e.filename || '').split('/').pop();
    showError(`${e.message}\n  → ${f}:${e.lineno}:${e.colno}`);
  });
  window.addEventListener('unhandledrejection', e => {
    const r = e.reason;
    const m = String((r && r.message) || r || '');
    // lỗi mạng/API đã có toast riêng của app → bỏ qua
    if (/fetch|network|HTTP|API|quota|429|abort/i.test(m)) return;
    showError('Promise: ' + m);
  });

  // ---------- 2. Danh sách phần tử renderer.js cần ----------
  const NEED = {
    text: ['api-key-input', 'model-custom-input', 'replace-find-input', 'replace-with-input', 'nav-fab-prompt-input'],
    file: ['image-input'],
    check: ['skip-sfx-toggle', 'style-guide-toggle', 'replace-scope-ocr', 'replace-scope-translation',
      'replace-whole-word', 'replace-case-sensitive'],
    select: ['source-lang-select', 'target-lang-select', 'theme-select', 'lang-select', 'model-select'],
    button: ['toggle-key-btn', 'get-key-btn', 'ocr-batch-btn', 'translate-batch-btn', 'clear-all-btn',
      'combined-batch-btn', 'batch-stop-btn', 'content-type-btn', 'nav-fab-confirm-yes', 'nav-fab-confirm-no',
      'nav-fab-prompt-run', 'nav-fab-prompt-cancel', 'selection-ocr-btn', 'selection-refine-btn',
      'selection-refine-ocr-btn', 'selection-refine-translate-btn', 'selection-translate-btn',
      'selection-cancel-btn', 'nav-fab-selection-all', 'nav-fab-selection-clear', 'info-modal-close',
      'usage-btn', 'view-logs-btn', 'about-btn', 'replace-btn', 'replace-close-btn', 'replace-prev-btn',
      'replace-next-btn', 'replace-one-btn', 'replace-all-btn', 'settings-btn', 'font-size-decrease',
      'font-size-increase', 'nav-fab-top', 'nav-fab-bottom', 'nav-fab-error-badge'],
    span: ['batch-current', 'batch-total', 'batch-progress-fill', 'content-type-btn-label', 'nav-fab-toast-dot',
      'nav-fab-toast-text', 'nav-fab-confirm-text', 'selection-count', 'selection-count-suffix',
      'nav-fab-selection-count', 'info-modal-title', 'replace-match-count', 'font-size-value'],
    pre: ['summary-ocr-all', 'summary-translation-all'],
    div: ['placeholder', 'manga-results', 'dropzone', 'nav-fab-toggle', 'nav-fab-toggle-wrap', 'nav-fab-panel',
      'nav-fab-list', 'nav-fab-scrim', 'summary-section', 'selection-bar', 'nav-fab-selection-head',
      'info-modal', 'info-modal-body', 'replace-bar', 'settings-panel', 'content-type-menu']
  };
  const OPTIONS = {
    'theme-select': [['dark', 'Dark mode'], ['light', 'Light mode']],
    'lang-select': [['en', 'English'], ['vi', 'Tiếng Việt']],
    'source-lang-select': [['ko', 'Korean'], ['en', 'English'], ['zh', 'Chinese']],
    'target-lang-select': [['vi', 'Vietnamese'], ['en', 'English'], ['ko', 'Korean'], ['zh', 'Chinese'], ['ja', 'Japanese']],
    'model-select': [['gemini-2.5-flash', 'gemini-2.5-flash'], ['__custom__', 'Other model...']]
  };

  let holder = null;
  function box() {
    if (!holder) {
      holder = document.createElement('div');
      holder.id = 'vb-dom-guard';
      holder.hidden = true;
      holder.setAttribute('aria-hidden', 'true');
      (document.body || document.documentElement).appendChild(holder);
    }
    return holder;
  }
  function make(kind, id) {
    let el;
    if (kind === 'text') { el = document.createElement('input'); el.type = id === 'api-key-input' ? 'password' : 'text'; }
    else if (kind === 'file') { el = document.createElement('input'); el.type = 'file'; el.multiple = true; }
    else if (kind === 'check') { el = document.createElement('input'); el.type = 'checkbox'; }
    else if (kind === 'select') {
      el = document.createElement('select');
      (OPTIONS[id] || []).forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; el.appendChild(o); });
    }
    else el = document.createElement(kind === 'button' ? 'button' : kind);
    if (kind === 'button') el.type = 'button';
    el.id = id;
    if (id === 'content-type-menu') {
      ['webtoon', 'manga'].forEach(v => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'content-type-option'; b.dataset.value = v;
        b.textContent = v === 'manga' ? 'Manga' : 'Webtoon';
        el.appendChild(b);
      });
    }
    return el;
  }

  const missing = [];
  Object.keys(NEED).forEach(kind => NEED[kind].forEach(id => {
    if (document.getElementById(id)) return;
    missing.push(id);
    box().appendChild(make(kind, id));
  }));

  // content-type-menu có thật nhưng thiếu lựa chọn → bổ sung
  const ctm = document.getElementById('content-type-menu');
  if (ctm && !ctm.querySelector('.content-type-option[data-value="manga"]')) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'content-type-option'; b.dataset.value = 'manga'; b.textContent = 'Manga';
    ctm.appendChild(b);
  }
  // selection-refine-btn cần nằm trong .refine-dropdown có .refine-menu
  const srb = document.getElementById('selection-refine-btn');
  if (srb && !srb.closest('.refine-dropdown')) {
    const wrap = document.createElement('div');
    wrap.className = 'refine-dropdown';
    srb.parentNode.insertBefore(wrap, srb);
    wrap.appendChild(srb);
    const m = document.createElement('div'); m.className = 'refine-menu'; wrap.appendChild(m);
  }

  // ---------- 3. Các label / class mà applyLanguage() ghi chữ vào ----------
  function ensureLabel(forId, withToggleLabel) {
    let lb = document.querySelector(`label[for="${forId}"]`);
    if (!lb) { lb = document.createElement('label'); lb.htmlFor = forId; box().appendChild(lb); missing.push('label[for=' + forId + ']'); }
    if (withToggleLabel && !lb.querySelector('.toggle-label')) {
      const s = document.createElement('span'); s.className = 'toggle-label'; lb.appendChild(s);
    }
  }
  ensureLabel('source-lang-select', false);
  ensureLabel('target-lang-select', false);
  ensureLabel('skip-sfx-toggle', true);
  ensureLabel('style-guide-toggle', true);
  if (!document.querySelector('.brand-sub')) {
    const s = document.createElement('span'); s.className = 'brand-sub'; box().appendChild(s); missing.push('.brand-sub');
  }

  if (missing.length) console.warn('[vb-dom-guard] index.html thiếu, đã tạo ẩn thay thế:', missing.join(', '));
  window.VBDomGuard = { missing };
})();
