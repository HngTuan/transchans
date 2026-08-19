/* vb-batch.js — Dich hang loat nhieu chuong tu file .zip */
(() => {
  'use strict';
  const VB = window.VB;
  const $ = id => document.getElementById(id);

  /** chapters: [{id, name, images:[{name, path, entry}], selected, status, done, total, pages:[], error}] */
  let chapters = [];
  let running = false, stopFlag = false;
  let totalUnits = 0, doneUnits = 0;

  const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };

  function init() {
    if (!$('b-list')) return;            // trang này không có panel batch -> bỏ qua
    window.addEventListener('unhandledrejection', ev => {
      console.error('[VB-BATCH] unhandled:', ev.reason);
      if (running) setStatus('Lỗi ngầm: ' + (ev.reason && ev.reason.message || ev.reason));
    });
    fillOptions();
    on('b-back', 'click', () => { location.href = 'index.html'; });
  }
  // ---------- nap zip ----------
  const IMG_RE = /\.(png|jpe?g|webp|heic|heif|bmp|gif)$/i;

  async function loadZips(files) {
    if (typeof JSZip === 'undefined') return alert('Thiếu jszip.min.js');
    setStatus('Đang đọc file zip…');
    const map = new Map();

    for (const file of files) {
      let zip;
      try { zip = await JSZip.loadAsync(file); }
      catch (e) { alert(`Không đọc được ${file.name}: ${e.message}`); continue; }

      zip.forEach((path, entry) => {
        if (entry.dir) return;
        if (/(^|\/)__MACOSX\//.test(path) || /(^|\/)\._/.test(path)) return;
        if (!IMG_RE.test(path)) return;
        const segs = path.split('/').filter(Boolean);
        const fname = segs.pop();
        const chapName = segs.length ? segs.join(' / ') : '(gốc)';
        const key = `${files.length > 1 ? file.name.replace(/\.zip$/i, '') + ' :: ' : ''}${chapName}`;
        if (!map.has(key)) map.set(key, []);
        map.get(key).push({ name: fname, path, entry });
      });
    }

    chapters = Array.from(map.entries())
      .sort((a, b) => VB.naturalCompare(a[0], b[0]))
      .map(([name, imgs], i) => ({
        id: 'ch' + i,
        name,
        images: imgs.sort((x, y) => VB.naturalCompare(x.name, y.name)),
        selected: true, status: 'idle', done: 0, total: imgs.length, pages: [], error: ''
      }));

    $('b-zipinfo').textContent = `Đã quét: ${chapters.length} chương · ${chapters.reduce((s, c) => s + c.total, 0)} ảnh.`;
    renderChapters();
    setStatus(chapters.length ? 'Chọn chương rồi bấm “Bắt đầu dịch”.' : 'Không tìm thấy ảnh nào trong zip.');
  }

  // ---------- render ----------
  function renderChapters() {
    const filter = ($('b-filter').value || '').toLowerCase();
    const box = $('b-list');
    box.innerHTML = '';
    chapters.filter(c => !filter || c.name.toLowerCase().includes(filter)).forEach(c => {
      const row = document.createElement('div');
      row.className = 'vb-chapter ' + c.status;
      row.innerHTML = `
        <label class="vb-inline"><input type="checkbox" data-sel="${c.id}" ${c.selected ? 'checked' : ''}> <b>${escapeHtml(c.name)}</b></label>
        <span class="vb-hint">${c.total} ảnh</span>
        <span class="vb-badge" data-badge="${c.id}">${statusText(c)}</span>
        <span class="vb-spacer"></span>
        <button class="vb-btn vb-btn-icon" data-one="${c.id}" title="Chỉ dịch chương này">▶</button>`;
      box.appendChild(row);
    });
    box.onchange = e => {
      const cb = e.target.closest('[data-sel]');
      if (cb) { const c = find(cb.dataset.sel); if (c) c.selected = cb.checked; }
    };
    box.onclick = async e => {
      const b = e.target.closest('[data-one]');
      if (b && !running) { const c = find(b.dataset.one); if (c) await runAll([c]); }
    };
  }

  const find = id => chapters.find(c => c.id === id);
  const statusText = c => ({ idle: 'chờ', running: `đang chạy ${c.done}/${c.total}`, done: `xong ${c.done}/${c.total}`, error: 'lỗi: ' + c.error, stopped: `dừng ${c.done}/${c.total}` }[c.status] || '');

  function refreshBadge(c) {
    const el = document.querySelector(`[data-badge="${c.id}"]`);
    if (el) { el.textContent = statusText(c); el.parentElement.className = 'vb-chapter ' + c.status; }
  }

  const setStatus = t => { $('b-status').textContent = t; };
  function bumpProgress() {
    doneUnits++;
    $('b-progress').style.width = totalUnits ? Math.round(doneUnits / totalUnits * 100) + '%' : '0%';
  }
  const escapeHtml = s => String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

    // ---------- ket qua ----------
  const EMPTY_MARK = '(không có chữ)';

  // Ban du phong: dung khi vb-format.js chua duoc nap. Truoc day thieu no la
  // chapterText() nem loi ngay trong renderResults() -> giet ca vong lap runAll().
  function buildChapterFallback(name, pages, opt) {
    const pad = n => String(n).padStart(2, '0');
    const out = [`=== ${name} ===`, ''];
    pages.forEach((p, i) => {
      out.push(`[Trang ${pad(p.no || i + 1)} — ${p.name || 'image'}]`);
      if (p.error) out.push('⚠ LỖI: ' + p.error);
      else if (!p.lines || !p.lines.length) out.push(EMPTY_MARK);
      else if (opt && opt.bilingual && p.source && p.source.length)
        out.push(VB.mergeBilingual(p.source.join('\n'), p.lines.join('\n')));
      else out.push(p.lines.join('\n'));
      out.push('');
    });
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }

  function chapterText(c) {
    const o = readOptions();
    const pages = (c.pages || []).map((p, i) => ({
      no: i + 1,
      name: p ? p.name : `image-${i + 1}`,
      lines: p && p.translated ? VB.splitLines(p.translated) : [],
      source: p && p.source ? VB.splitLines(p.source) : [],
      error: p && p.error ? p.error : ''
    }));
    const opt = { bilingual: o.bilingual };
    try {
      const build = (VB.FMT && VB.FMT.buildChapterText) || buildChapterFallback;
      return build(c.name, pages, opt);
    } catch (e) {
      console.error('[VB-BATCH] chapterText lỗi:', e);
      return buildChapterFallback(c.name, pages, opt);
    }
  }

  // Bọc render: mọi lỗi hiển thị chỉ được ghi log, TUYỆT ĐỐI không lan ra hàng đợi.
  function renderResults() {
    try { renderResultsInner(); }
    catch (e) {
      console.error('[VB-BATCH] renderResults lỗi:', e);
      setStatus('Lỗi hiển thị kết quả (hàng đợi vẫn chạy tiếp): ' + e.message);
    }
  }

  function renderResultsInner() {
    const box = $('b-results');
    const done = chapters.filter(c => c.pages && c.pages.length);
    box.innerHTML = done.length ? '' : '<span class="vb-hint">Chưa có kết quả.</span>';
    done.forEach(c => {
      const div = document.createElement('details');
      div.className = 'vb-result';
      div.innerHTML = `
        <summary>${escapeHtml(c.name)} — ${c.done}/${c.total} trang</summary>
        <div class="vb-row">
          <button class="vb-btn" data-dl="${c.id}">⬇ .txt</button>
          <button class="vb-btn" data-dx="${c.id}">⬇ .docx</button>
          <button class="vb-btn" data-cp="${c.id}">Copy</button>
        </div>
        <textarea rows="16" data-ta="${c.id}">${escapeHtml(chapterText(c))}</textarea>`;
      box.appendChild(div);
    });
    box.onclick = async e => {
      const dl = e.target.closest('[data-dl]'), dx = e.target.closest('[data-dx]'), cp = e.target.closest('[data-cp]');
      const hit = dl || dx || cp;
      if (!hit) return;
      const id = hit.dataset.dl || hit.dataset.dx || hit.dataset.cp;
      const c = find(id);
      const ta = document.querySelector(`[data-ta="${id}"]`);
      const content = ta ? ta.value : chapterText(c);
      const fname = safeName(c.name);
      if (dl) downloadText(content, fname + '.txt');
      if (dx) {
        if (VB.FMT && VB.FMT.download) await VB.FMT.download(content, fname, 'docx');
        else downloadText(content, fname + '.txt');
      }
      if (cp) { try { await navigator.clipboard.writeText(content); setStatus('Đã copy ' + c.name); } catch (err) { setStatus('Copy thất bại'); } }
    };
  }

  // ---------- chay ----------
  const IMAGE_TIMEOUT_MS = 180000;   // 1 ảnh treo quá 3 phút -> bỏ qua, không khoá cả loạt

  async function runAll(list) {
    if (running) return;
    const targets = (list || chapters.filter(c => c.selected));
    if (!targets.length) return alert('Chưa chọn chương nào.');
    if (!VB.getKeys().length) return alert('Chưa có API key. Về trang chính → ⚙ Nâng cao → tab API Keys.');

    saveOptions();
    running = true; stopFlag = false;
    $('b-start').disabled = true; $('b-stop').disabled = false;
    totalUnits = targets.reduce((s, c) => s + c.total, 0);
    doneUnits = 0;
    $('b-progress').style.width = '0%';

    try {
      for (const c of targets) {
        if (stopFlag) break;
        try {
          await runChapter(c);
        } catch (e) {
          // Một chương hỏng KHÔNG được phép làm chết hàng đợi nữa.
          console.error('[VB-BATCH] chương lỗi:', c.name, e);
          c.status = 'error';
          c.error = e.message || String(e);
          refreshBadge(c);
        }
      }
    } finally {
      running = false;
      $('b-start').disabled = false;
      $('b-stop').disabled = true;
      const bad = chapters.filter(c => c.status === 'error').length;
      setStatus(stopFlag ? 'Đã dừng.' : (bad ? `Hoàn tất, còn ${bad} chương lỗi.` : 'Hoàn tất tất cả chương đã chọn ✔'));
      renderResults();
    }
  }

  async function runChapter(c) {
    c.status = 'running'; c.done = 0; c.pages = []; c.error = '';
    refreshBadge(c);

    const o = readOptions();
    const conc = Math.max(1, Math.min(3, o.concurrency));
    let cursor = 0;
    let prevTail = '';

    const worker = async () => {
      while (!stopFlag) {
        const i = cursor++;
        if (i >= c.images.length) return;
        const img = c.images[i];
        setStatus(`[${c.name}] ${i + 1}/${c.total} · ${img.name}`);
        try {
          const page = await processImage(img, o, conc === 1 ? prevTail : '');
          c.pages[i] = page;
          if (conc === 1 && page.translated) {
            prevTail = VB.splitLines(page.translated).slice(-4).join('\n');
          }
        } catch (e) {
          const aborted = e.name === 'AbortError' || /Đã dừng/.test(e.message || '');
          // CHỈ thoát worker khi người dùng thật sự bấm Dừng. Trước đây một
          // request bị abort/timeout cũng làm worker return -> ảnh còn lại đứng im.
          if (aborted && stopFlag) return;
          c.pages[i] = {
            name: img.name, source: '', translated: '',
            error: aborted ? 'Quá thời gian chờ (timeout)' : (e.message || String(e))
          };
          c.error = c.pages[i].error;
        }
        c.done++;
        bumpProgress();
        refreshBadge(c);
        if (o.delayMs) await VB.sleep(o.delayMs);
      }
    };

    await Promise.all(Array.from({ length: conc }, () => worker()));
    c.status = stopFlag ? 'stopped' : (c.pages.some(p => p && p.error) ? 'error' : 'done');
    if (c.status === 'done') c.error = '';
    refreshBadge(c);
    renderResults();
  }

  async function processImage(img, o, prevTail) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), IMAGE_TIMEOUT_MS);
    try {
      const blob = await img.entry.async('blob');
      const typed = blob.type ? blob : new Blob([blob], { type: VB.mimeOf(img.name) });
      const parts = await VB.imageToParts(typed, { maxWidth: o.maxWidth, sliceTall: o.sliceTall, sliceHeight: 3000 });

      const ocrPrompt = VB.buildOcrPrompt({
        sourceLang: o.sourceLang, contentType: o.contentType,
        skipSfx: o.skipSfx, sfxTag: VB.data.bilingual.sfxTag
      });

      const chunks = [];
      for (const part of parts) {
        chunks.push(await VB.callGemini({
          model: o.model,
          parts: [{ text: ocrPrompt }, part],
          generationConfig: { temperature: 0.1 },
          signal: ac.signal,
          shouldStop: () => stopFlag,
          onStatus: setStatus
        }));
      }
      const source = dedupJoin(chunks);
      if (!source || source === '[NO TEXT]') return { name: img.name, source: '', translated: '', empty: true };

      const lines = VB.splitLines(source);
      const translated = await VB.callGemini({
        model: o.model,
        parts: [{
          text: VB.buildTranslatePrompt({
            sourceLang: o.sourceLang, targetLang: o.targetLang,
            text: lines.join('\n'), lineCount: lines.length,
            contextBlock: o.useContext ? VB.buildContextBlock(VB.langName(o.targetLang), 'translate') : '',
            styleBlock: o.styleGuide ? VB.getStyleBlock(VB.langName(o.targetLang), 'translate') : '',
            prevTail,
            tagSfx: !o.skipSfx && VB.data.bilingual.tagSfxInPrompt,
            sfxTag: VB.data.bilingual.sfxTag
          })
        }],
        generationConfig: { temperature: 0.35 },
        signal: ac.signal,
        shouldStop: () => stopFlag,
        onStatus: setStatus
      });

      return { name: img.name, source: lines.join('\n'), translated: VB.splitLines(translated).join('\n') };
    } finally {
      clearTimeout(timer);
    }
  }


  // ---------- options ----------
  function readOptions() {
    return {
      model: $('b-model').value,
      contentType: $('b-type').value,
      sourceLang: $('b-src').value,
      targetLang: $('b-dst').value,
      concurrency: +$('b-conc').value,
      delayMs: +$('b-delay').value || 0,
      maxWidth: +$('b-width').value || 1400,
      skipSfx: $('b-skipsfx').checked,
      styleGuide: $('b-style').checked,
      sliceTall: $('b-slice').checked,
      bilingual: $('b-bi').checked,
      useContext: $('b-ctx').checked
    };
  }

  function saveOptions() {
    Object.assign(VB.data.batch, readOptions());
    VB.save();
  }

  function fillOptions() {
    const b = VB.data.batch;
    $('b-model').value = b.model; $('b-type').value = b.contentType;
    $('b-src').value = b.sourceLang; $('b-dst').value = b.targetLang;
    $('b-conc').value = String(b.concurrency); $('b-delay').value = b.delayMs;
    $('b-width').value = b.maxWidth; $('b-skipsfx').checked = b.skipSfx;
    $('b-style').checked = b.styleGuide; $('b-slice').checked = b.sliceTall;
    $('b-bi').checked = VB.data.bilingual.enabled;
    $('b-ctxinfo').textContent = VB.hasContext()
      ? `Ngữ cảnh: ${VB.contextCharCount().toLocaleString()} ký tự`
      : 'Chưa có ngữ cảnh (thiết lập ở trang chính → ⚙ Nâng cao).';
    const keys = VB.getKeys();
    $('b-keyinfo').textContent = keys.length ? `${keys.length} API key sẵn sàng` : '⚠ Chưa có API key';
  }

  // ---------- bind ----------
  function init() {
    fillOptions();
    $('b-back').addEventListener('click', () => { location.href = 'index.html'; });
    $('b-zip').addEventListener('change', e => { loadZips(Array.from(e.target.files || [])); e.target.value = ''; });

    const drop = $('b-drop');
    ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', e => {
      const files = Array.from(e.dataTransfer.files || []).filter(f => /\.zip$/i.test(f.name));
      if (files.length) loadZips(files); else alert('Chỉ nhận file .zip');
    });

    $('b-all').addEventListener('click', () => { chapters.forEach(c => c.selected = true); renderChapters(); });
    $('b-none').addEventListener('click', () => { chapters.forEach(c => c.selected = false); renderChapters(); });
    $('b-invert').addEventListener('click', () => { chapters.forEach(c => c.selected = !c.selected); renderChapters(); });
    $('b-filter').addEventListener('input', renderChapters);
    $('b-start').addEventListener('click', () => runAll());
    $('b-stop').addEventListener('click', () => { stopFlag = true; setStatus('Đang dừng sau ảnh hiện tại…'); });
    $('b-zipall').addEventListener('click', zipAll);
    $('b-copyall').addEventListener('click', async () => {
      const all = chapters.filter(c => c.pages.length).map(chapterText).join('\n\n');
      try { await navigator.clipboard.writeText(all); setStatus('Đã copy toàn bộ'); } catch (e) { setStatus('Copy thất bại'); }
    });
    window.addEventListener('beforeunload', e => { if (running) { e.preventDefault(); e.returnValue = ''; } });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
