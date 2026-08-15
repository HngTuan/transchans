/* vb-format.js — Dinh dang file trans dung chung cho ca 3 che do:
 *   - dich anh le (index.html)
 *   - dich theo chap (batch.html)
 *   - gop 2 ban dich (merge.html)
 * Ngoai ra: gan thanh cong cu "Xuat chuan" vao trang chinh + nut dieu huong.
 */
(() => {
  'use strict';
  const VB = window.VB;
  if (!VB) { console.error('[VB-FMT] thieu vb-core.js'); return; }

  const CHAP_RE = /^===\s*(.+?)\s*===$/;
  const PAGE_RE = /^\[\s*(?:Trang|Page)\s*(\d+)\s*(?:[—–\-:]\s*([^\]]*))?\]\s*$/i;
  const EMPTY_MARK = '(không có chữ)';

  const pad2 = n => String(n).padStart(2, '0');
  const chapHeader = n => `=== ${n} ===`;
  const pageHeader = (no, name) => `[Trang ${pad2(no)} — ${name || 'image'}]`;
  const safeName = n => String(n).replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80);

  /** pages: [{no, name, lines:[], source:[], error}] */
  function buildChapterText(chapterName, pages, opt) {
    const o = Object.assign({
      bilingual: false,
      marker: VB.data.bilingual.marker || '*',
      sfxTag: VB.data.bilingual.sfxTag || '(sfx)'
    }, opt || {});
    const out = [chapHeader(chapterName || 'chapter'), ''];
    (pages || []).forEach((p, i) => {
      out.push(pageHeader(p.no || i + 1, p.name));
      if (p.error) out.push('⚠ LỖI: ' + p.error);
      else if (!p.lines || !p.lines.length) out.push(EMPTY_MARK);
      else if (o.bilingual && p.source && p.source.length)
        out.push(VB.mergeBilingual(p.source.join('\n'), p.lines.join('\n'), o));
      else out.push(p.lines.join('\n'));
      out.push('');
    });
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }

  function buildFileText(chapters, opt) {
    return chapters.map(c => buildChapterText(c.name, c.pages, opt)).join('\n').trim() + '\n';
  }

  /** Tach dong dich / dong goc (bat dau bang marker) trong 1 trang */
  function splitBilingual(rawLines, marker) {
    const mk = marker || VB.data.bilingual.marker || '*';
    const lines = [], source = [];
    (rawLines || []).forEach(l => {
      if (!l) return;
      if (l === EMPTY_MARK || /^\(no text\)$/i.test(l) || /^⚠/.test(l)) return;
      if (mk && l.startsWith(mk) && l.length > mk.length) source.push(l.slice(mk.length).trim());
      else lines.push(l);
    });
    return { lines, source };
  }

  /** Doc nguoc file .txt da xuat -> [{name, pages:[{no,name,lines,source}]}] */
  function parseTransText(text, marker) {
    const chapters = [];
    let chap = null, page = null;
    const pushPage = () => { if (page && chap) chap.pages.push(page); page = null; };
    const pushChap = () => { pushPage(); if (chap) chapters.push(chap); chap = null; };
    const ensureChap = () => { if (!chap) chap = { name: '(không tên)', pages: [] }; };

    String(text || '').replace(/\r\n?/g, '\n').split('\n').forEach(raw => {
      const line = raw.trim();
      let m;
      if ((m = CHAP_RE.exec(line))) { pushChap(); chap = { name: m[1], pages: [] }; return; }
      if ((m = PAGE_RE.exec(line))) {
        pushPage(); ensureChap();
        page = { no: +m[1] || chap.pages.length + 1, name: (m[2] || '').trim(), raw: [] };
        return;
      }
      if (!line) return;
      ensureChap();
      if (!page) page = { no: chap.pages.length + 1, name: '', raw: [] };
      page.raw.push(line);
    });
    pushChap();

    chapters.forEach(c => c.pages.forEach(p => {
      const s = splitBilingual(p.raw, marker);
      p.lines = s.lines; p.source = s.source;
      delete p.raw;
    }));
    return chapters;
  }

  // ---------- doc du lieu tu DOM trang chinh (khong dung toi bien trong renderer.js) ----------
  function readTextBlock(el) {
    if (!el || el.classList.contains('empty') || el.classList.contains('error')) return [];
    if (el.dataset && el.dataset.vbPlain)
      return el.dataset.vbPlain.split('\n').map(s => s.trim()).filter(Boolean);
    const rows = el.querySelectorAll(':scope > .line-row .line-text');
    if (rows.length) {
      return Array.from(rows).map(r => {
        const c = r.cloneNode(true);
        c.querySelectorAll('.vb-bi-src').forEach(x => x.remove());   // bo dong goc cua che do song ngu
        return c.textContent.trim();
      }).filter(Boolean);
    }
    const t = (el.innerText || '').trim();
    return t ? t.split('\n').map(s => s.trim()).filter(Boolean) : [];
  }

  function readPagesFromDOM() {
    const pages = [];
    document.querySelectorAll('#manga-results .manga-item').forEach((item, i) => {
      const idx = item.dataset.index;
      const titleEl = item.querySelector('.manga-item-title span');
      const name = titleEl ? titleEl.textContent.replace(/^[^:]*:\s*/, '').trim() : '';
      pages.push({
        no: i + 1,
        name: name || `image-${pad2(i + 1)}`,
        lines: readTextBlock(document.getElementById('translation-' + idx)),
        source: readTextBlock(document.getElementById('ocr-' + idx))
      });
    });
    return pages;
  }

  // ---------- xuat file ----------
  const XMLH = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

  async function buildDocxBlob(content) {
    if (typeof JSZip === 'undefined') throw new Error('Thiếu jszip.min.js');
    const zip = new JSZip();
    const body = String(content).split(/\r\n|\r|\n/).map(l =>
      l.trim() === '' ? '<w:p/>' : `<w:p><w:r><w:t xml:space="preserve">${esc(l)}</w:t></w:r></w:p>`).join('');
    zip.file('[Content_Types].xml', XMLH +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '</Types>');
    zip.folder('_rels').file('.rels', XMLH +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>');
    zip.folder('word').file('document.xml', XMLH +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
      body + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>');
    return zip.generateAsync({ type: 'blob' });
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  async function download(content, filename, format) {
    if (format === 'docx') downloadBlob(await buildDocxBlob(content), filename + '.docx');
    else downloadBlob(new Blob([content], { type: 'text/plain;charset=utf-8' }), filename + '.txt');
  }

  /** Doc file ngoai vao dang text (.txt/.md/.csv/.json/.docx) */
  async function readAnyFile(file) {
    if (/\.docx$/i.test(file.name)) {
      if (typeof JSZip === 'undefined') throw new Error('Thiếu JSZip để đọc .docx');
      const zip = await JSZip.loadAsync(file);
      const f = zip.file('word/document.xml');
      if (!f) throw new Error('File .docx không hợp lệ');
      const xml = await f.async('string');
      return xml.replace(/<w:p[ >][\s\S]*?<\/w:p>|<w:p\/>/g, m => m.replace(/<[^>]+>/g, '') + '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&apos;/g, "'").trim();
    }
    return (await file.text()).trim();
  }

  // ---------- handoff sang trang Gop ban dich ----------
  const SLOT = { a: 'visionbox_merge_slot_a', b: 'visionbox_merge_slot_b' };
  const setSlot = (k, v) => { try { localStorage.setItem(SLOT[k], v); return true; } catch (e) { return false; } };
  const getSlot = k => { try { return localStorage.getItem(SLOT[k]) || ''; } catch (e) { return ''; } };

  window.VB.FMT = {
    chapHeader, pageHeader, buildChapterText, buildFileText, parseTransText, splitBilingual,
    readPagesFromDOM, readTextBlock, download, downloadBlob, buildDocxBlob, readAnyFile,
    safeName, setSlot, getSlot
  };

  // ================= UI tren trang chinh =================
  function mount() {
    const btns = document.querySelector('.vb-topbar-btns');
    if (btns && !document.getElementById('vb-goto-merge')) {
      const m = document.createElement('button');
      m.type = 'button'; m.id = 'vb-goto-merge'; m.className = 'btn btn-secondary';
      m.textContent = '🔀 Gộp bản dịch';
      m.addEventListener('click', () => { location.href = 'merge.html'; });
      const r = document.createElement('button');
      r.type = 'button'; r.id = 'vb-goto-remover'; r.className = 'btn btn-secondary';
      r.textContent = '🧽 Xoá chữ trên ảnh';
      r.addEventListener('click', () => { location.href = 'remover.html'; });
      btns.appendChild(m); btns.appendChild(r);
    }

    const summary = document.getElementById('summary-section');
    if (!summary || document.getElementById('vb-fmt-bar')) return;

    const bar = document.createElement('section');
    bar.id = 'vb-fmt-bar';
    bar.className = 'vb-fmt-bar';
    bar.innerHTML = `
      <span class="vb-strong">Xuất theo định dạng chuẩn</span>
      <input type="text" id="vb-fmt-name" class="vb-fmt-name" placeholder="Tên chương (VD: Chapter 01)">
      <label class="vb-inline"><input type="checkbox" id="vb-fmt-bi"> Kèm dòng gốc (song ngữ)</label>
      <span class="vb-spacer"></span>
      <button class="vb-btn" id="vb-fmt-copy">Copy</button>
      <button class="vb-btn" id="vb-fmt-txt">⬇ .txt</button>
      <button class="vb-btn" id="vb-fmt-docx">⬇ .docx</button>
      <button class="vb-btn" id="vb-fmt-toa">→ Gộp (A)</button>
      <button class="vb-btn" id="vb-fmt-tob">→ Gộp (B)</button>
      <span class="vb-hint" id="vb-fmt-msg"></span>`;
    summary.parentNode.insertBefore(bar, summary);

    const $ = id => document.getElementById(id);
    $('vb-fmt-name').value = VB.data.context.title || '';
    $('vb-fmt-bi').checked = !!VB.data.bilingual.enabled;
    const msg = t => { $('vb-fmt-msg').textContent = t; setTimeout(() => { if ($('vb-fmt-msg').textContent === t) $('vb-fmt-msg').textContent = ''; }, 2500); };

    const build = () => buildChapterText(
      $('vb-fmt-name').value.trim() || 'chapter',
      readPagesFromDOM(),
      { bilingual: $('vb-fmt-bi').checked }
    );

    $('vb-fmt-copy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(build()); msg('Đã copy ✓'); } catch (e) { msg('Copy thất bại'); }
    });
    $('vb-fmt-txt').addEventListener('click', () => download(build(), safeName($('vb-fmt-name').value || 'visionbox-trans'), 'txt').then(() => msg('Đã xuất .txt')));
    $('vb-fmt-docx').addEventListener('click', () => download(build(), safeName($('vb-fmt-name').value || 'visionbox-trans'), 'docx').then(() => msg('Đã xuất .docx')));
    $('vb-fmt-toa').addEventListener('click', () => msg(setSlot('a', build()) ? 'Đã gửi sang ô A' : 'Không lưu được'));
    $('vb-fmt-tob').addEventListener('click', () => msg(setSlot('b', build()) ? 'Đã gửi sang ô B' : 'Không lưu được'));

    // an/hien theo bang tong hop
    const sync = () => { bar.style.display = summary.style.display === 'none' ? 'none' : 'flex'; };
    sync();
    new MutationObserver(sync).observe(summary, { attributes: true, attributeFilter: ['style'] });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
