/* vb-inline.js — Song ngu cho che do dich anh thuong (index.html)
 * Chi doi HIEN THI, khong ghi de translationResult => Refine/Vers/autosave an toan.
 */
(() => {
  'use strict';
  if (!window.VB) return console.error('[VB-INLINE] thieu vb-core.js');
  const VB = window.VB;
  let biOn = false, timer = null;

  const cfg = () => VB.data.bilingual;

  function readLines(el) {
    if (!el) return [];
    const rows = el.querySelectorAll(':scope > .line-row .line-text');
    if (rows.length) return Array.from(rows).map(r => r.textContent);
    const t = (el.innerText || '').trim();
    return t && !el.classList.contains('empty') ? t.split('\n') : [];
  }

  function renderBilingual(transEl, srcLines, dstLines) {
    const marker = cfg().marker || '*';
    const tag = cfg().sfxTag || '(sfx)';
    const n = Math.max(srcLines.length, dstLines.length);
    transEl.innerHTML = '';
    for (let i = 0; i < n; i++) {
      const rawS = (srcLines[i] || '').trim();
      const rawT = (dstLines[i] || '').trim();
      if (!rawS && !rawT) continue;
      const sfx = VB.isSfxLine(rawS) || VB.isSfxLine(rawT);
      const t = (sfx ? `${tag} ${VB.stripSfx(rawT)}` : rawT).trim() || '⟨thiếu bản dịch⟩';
      const s = (sfx ? `${tag} ${VB.stripSfx(rawS)}` : rawS).trim();

      const row = document.createElement('div');
      row.className = 'line-row';
      const num = document.createElement('span');
      num.className = 'line-num';
      num.setAttribute('contenteditable', 'false');
      num.textContent = String(i + 1);
      const txt = document.createElement('span');
      txt.className = 'line-text';
      txt.appendChild(document.createTextNode(t));
      if (s) {
        const br = document.createElement('span');
        br.className = 'vb-bi-src';
        br.textContent = marker + s;
        txt.appendChild(document.createElement('br'));
        txt.appendChild(br);
      }
      row.appendChild(num); row.appendChild(txt);
      transEl.appendChild(row);
    }
    transEl.classList.remove('empty');
  }

  function applyItem(item) {
    const i = item.dataset.index;
    const ocrEl = document.getElementById('ocr-' + i);
    const transEl = document.getElementById('translation-' + i);
    if (!ocrEl || !transEl) return;
    // Dang sua tay thi de yen, khong dung vao DOM
    if (ocrEl.getAttribute('contenteditable') === 'true' || transEl.getAttribute('contenteditable') === 'true') return;

    const ours = !!transEl.querySelector('.vb-bi-src');
    const plain = ours ? (transEl.dataset.vbPlain || '') : readLines(transEl).join('\n');
    const src = readLines(ocrEl).join('\n');
    if (!plain || !src || transEl.classList.contains('error')) return;

    const sig = src.length + ':' + plain.length + ':' + plain.slice(0, 40);
    if (ours && transEl.dataset.vbSig === sig) return;

    transEl.dataset.vbPlain = plain;
    transEl.dataset.vbSig = sig;
    renderBilingual(transEl, src.split('\n'), plain.split('\n'));
  }

  function restoreItem(item) {
    const transEl = document.getElementById('translation-' + item.dataset.index);
    if (!transEl || !transEl.querySelector('.vb-bi-src')) return;
    const plain = transEl.dataset.vbPlain || '';
    transEl.innerHTML = '';
    plain.split('\n').forEach((line, i) => {
      const row = document.createElement('div');
      row.className = 'line-row';
      const num = document.createElement('span');
      num.className = 'line-num';
      num.setAttribute('contenteditable', 'false');
      num.textContent = String(i + 1);
      const txt = document.createElement('span');
      txt.className = 'line-text';
      txt.textContent = line;
      row.appendChild(num); row.appendChild(txt);
      transEl.appendChild(row);
    });
    delete transEl.dataset.vbSig;
  }

  // ---- bang tong hop "All translations" ----
  const HEAD_RE = /^===\s.+\s===$/;
  function splitBlocks(text) {
    const out = []; let cur = { head: '', lines: [] };
    String(text || '').split('\n').forEach(raw => {
      const l = raw.trim();
      if (!l) return;
      if (HEAD_RE.test(l)) { if (cur.head || cur.lines.length) out.push(cur); cur = { head: l, lines: [] }; }
      else cur.lines.push(l);
    });
    if (cur.head || cur.lines.length) out.push(cur);
    return out;
  }

  function applySummary() {
    const o = document.getElementById('summary-ocr-all');
    const t = document.getElementById('summary-translation-all');
    if (!o || !t || t.getAttribute('contenteditable') === 'true') return;
    if (o.classList.contains('empty') || t.classList.contains('empty')) return;

    const plain = t.dataset.vbApplied === '1' ? (t.dataset.vbPlain || '') : t.innerText.trim();
    const src = o.innerText.trim();
    if (!plain || !src) return;
    const sig = src.length + ':' + plain.length;
    if (t.dataset.vbApplied === '1' && t.dataset.vbSig === sig) return;

    const a = splitBlocks(src), b = splitBlocks(plain);
    let out;
    if (a.length === b.length && a.length > 1) {
      out = a.map((blk, i) => (b[i].head ? b[i].head + '\n' : '') +
        VB.mergeBilingual(blk.lines.join('\n'), b[i].lines.join('\n'))).join('\n\n');
    } else {
      out = VB.mergeBilingual(a.flatMap(x => x.lines).join('\n'), b.flatMap(x => x.lines).join('\n'));
    }
    t.dataset.vbPlain = plain;
    t.dataset.vbSig = sig;
    t.dataset.vbApplied = '1';
    t.textContent = out;
  }

  function restoreSummary() {
    const t = document.getElementById('summary-translation-all');
    if (!t || t.dataset.vbApplied !== '1') return;
    t.textContent = t.dataset.vbPlain || '';
    delete t.dataset.vbApplied; delete t.dataset.vbSig;
  }

  function refresh() {
    if (!biOn) return;
    document.querySelectorAll('#manga-results .manga-item').forEach(applyItem);
    applySummary();
  }
  const refreshSoon = () => { clearTimeout(timer); timer = setTimeout(refresh, 120); };

  function setBilingual(on) {
    biOn = on;
    cfg().enabled = on;
    VB.save();
    if (on) refresh();
    else {
      document.querySelectorAll('#manga-results .manga-item').forEach(restoreItem);
      restoreSummary();
    }
  }

  function mount() {
    const row = document.querySelector('.lang-bar-row');
    if (row) {
      const label = document.createElement('label');
      label.className = 'toggle-field';
      label.htmlFor = 'vb-bi-inline';
      label.title = 'Hiện dòng gốc ngay dưới mỗi câu dịch';
      label.innerHTML = '<input type="checkbox" id="vb-bi-inline"><span class="toggle-switch"></span>' +
        '<span class="toggle-label">Song ngữ <small>(dòng gốc dưới bản dịch)</small></span>';
      const upload = row.querySelector('.upload-btn');
      upload ? row.insertBefore(label, upload) : row.appendChild(label);
      const cb = label.querySelector('input');
      cb.checked = !!cfg().enabled;
      cb.addEventListener('change', () => setBilingual(cb.checked));
      biOn = cb.checked;
    }

    // Vao Edit mode / Refine => tra ve ban dich thuan truoc khi renderer doc DOM
    document.addEventListener('click', e => {
      if (!biOn) return;
      const btn = e.target.closest('.edit-item-btn, .refine-translate-option, #selection-refine-translate-btn');
      if (!btn) return;
      const item = btn.closest('.manga-item');
      if (item) restoreItem(item);
      else document.querySelectorAll('#manga-results .manga-item').forEach(restoreItem);
    }, true);

    const mo = new MutationObserver(refreshSoon);
    ['manga-results', 'summary-section'].forEach(id => {
      const el = document.getElementById(id);
      if (el) mo.observe(el, { childList: true, subtree: true, characterData: true });
    });
    refresh();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
