/* vb-context.js — Studio · Tạo context (port pipeline ② của trans.py)
 * Luồng: nạp ảnh/zip → nhận diện thể loại → phân tích theo lô trang
 *        → tra web (tuỳ chọn) → gộp/cập nhật context 8 phần → lưu thư viện.
 * Cơ chế bảo hiểm: bản mới < 90% bản cũ thì GIỮ bản cũ và nối phần bổ sung.
 */
(() => {
  'use strict';
  const VB = window.VB;
  if (!VB) { console.error('[VB-CTX] thiếu vb-core.js'); return; }

  const $ = id => document.getElementById(id);
  const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); return el; };
  const esc = s => String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const IMG_RE = /\.(png|jpe?g|webp|heic|heif|bmp|gif|avif)$/i;

  let chapters = [];         // [{name, images:[{name, get:()=>Promise<Blob>}]}]
  let running = false, stopFlag = false, resultText = '';

  const setStatus = t => { const e = $('x-status'); if (e) e.textContent = t; };
  const setProgress = (d, t) => { const e = $('x-progress'); if (e) e.style.width = t ? Math.round(d / t * 100) + '%' : '0%'; };

  // ---------- nạp nguồn ----------
  async function loadFiles(files) {
    const zips = files.filter(f => /\.zip$/i.test(f.name));
    const imgs = files.filter(f => IMG_RE.test(f.name));
    const map = new Map();

    for (const f of zips) {
      if (typeof JSZip === 'undefined') { alert('Thiếu jszip.min.js'); return; }
      let zip;
      try { zip = await JSZip.loadAsync(f); } catch (e) { alert('Không đọc được ' + f.name + ': ' + e.message); continue; }
      zip.forEach((path, entry) => {
        if (entry.dir || /(^|\/)__MACOSX\//.test(path) || /(^|\/)\._/.test(path) || !IMG_RE.test(path)) return;
        const segs = path.split('/').filter(Boolean);
        const fname = segs.pop();
        const key = (zips.length > 1 ? f.name.replace(/\.zip$/i, '') + ' :: ' : '') + (segs.length ? segs.join(' / ') : '(gốc)');
        if (!map.has(key)) map.set(key, []);
        map.get(key).push({ name: fname, get: () => entry.async('blob') });
      });
    }
    if (imgs.length) {
      const key = '(ảnh rời)';
      if (!map.has(key)) map.set(key, []);
      imgs.forEach(f => map.get(key).push({ name: f.name, get: () => Promise.resolve(f) }));
    }

    chapters = Array.from(map.entries())
      .sort((a, b) => VB.naturalCompare(a[0], b[0]))
      .map(e => ({ name: e[0], images: e[1].sort((x, y) => VB.naturalCompare(x.name, y.name)) }));

    const total = chapters.reduce((s, c) => s + c.images.length, 0);
    const info = $('x-srcinfo');
    if (info) info.innerHTML = chapters.length
      ? '<b>' + chapters.length + '</b> chương · <b>' + total + '</b> trang: ' + esc(chapters.map(c => c.name).join(' · ')).slice(0, 400)
      : 'Chưa nạp được ảnh nào.';

    if (!$('x-range').value.trim() && chapters.length)
      $('x-range').value = VB.rangeLabel(chapters.map(c => c.name));
    refreshBase();
    setStatus(chapters.length ? 'Sẵn sàng. Bấm “Dựng context”.' : 'Chưa có dữ liệu.');
  }

  // ---------- thư viện ----------
  function refreshBase() {
    const series = ($('x-series').value || '').trim();
    const sel = $('x-base');
    const items = series ? VB.CTXLIB.bySeries(series) : VB.CTXLIB.all();
    const cur = sel.value;
    sel.innerHTML = '<option value="">(không dùng nền — tạo mới)</option>' +
      items.map(i => '<option value="' + i.id + '">' + esc(i.name) + ' · ' + i.text.length.toLocaleString() + ' ký tự</option>').join('');
    if (cur && items.some(i => i.id === cur)) sel.value = cur;
    else if ($('x-autobase').checked && items.length) sel.value = items[0].id;
    renderLib();
  }

  function renderLib() {
    const box = $('x-lib');
    const items = VB.CTXLIB.all();
    box.innerHTML = items.length ? '' : '<span class="vb-hint">Thư viện trống.</span>';
    items.forEach(i => {
      const row = document.createElement('div');
      row.className = 'vb-fileitem';
      row.innerHTML = '<b>' + esc(i.name) + '</b>' +
        '<span class="vb-hint">' + i.text.length.toLocaleString() + ' ký tự · ' + new Date(i.savedAt).toLocaleString() + '</span>' +
        '<span class="vb-spacer"></span>' +
        '<button class="vb-btn vb-btn-icon" data-use="' + i.id + '" title="Dùng cho lần dịch tới">✔ Dùng</button>' +
        '<button class="vb-btn vb-btn-icon" data-open="' + i.id + '" title="Xem">👁</button>' +
        '<button class="vb-btn vb-btn-icon" data-dl="' + i.id + '" title="Tải .txt">⬇</button>' +
        '<button class="vb-btn vb-btn-icon vb-btn-danger" data-del="' + i.id + '" title="Xoá">✕</button>';
      box.appendChild(row);
    });
    box.onclick = e => {
      const b = e.target.closest('button[data-use],button[data-open],button[data-dl],button[data-del]');
      if (!b) return;
      const id = b.dataset.use || b.dataset.open || b.dataset.dl || b.dataset.del;
      const item = VB.CTXLIB.get(id);
      if (!item) return;
      if (b.dataset.use) { VB.applyContextFile(item.name, item.text, { title: item.series }); setStatus('Đã đưa "' + item.name + '" vào ngữ cảnh dịch ✔'); }
      if (b.dataset.open) { $('x-out').value = item.text; resultText = item.text; }
      if (b.dataset.dl) download(item.text, item.name);
      if (b.dataset.del) { if (confirm('Xoá "' + item.name + '" khỏi thư viện?')) { VB.CTXLIB.remove(id); refreshBase(); } }
    };
  }

  function download(text, filename) {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  // ---------- thể loại ----------
  function renderGenres() {
    const box = $('x-genres');
    const chosen = VB.data.ctxb.genres || [];
    box.innerHTML = VB.GENRES.map(g =>
      '<label class="vb-inline vb-gchip"><input type="checkbox" value="' + esc(g) + '"' + (chosen.indexOf(g) !== -1 ? ' checked' : '') + '> ' + esc(g) + '</label>').join('');
  }
  const readGenres = () => Array.from($('x-genres').querySelectorAll('input:checked')).map(i => i.value);
  function setGenres(list) {
    const set = new Set(list || []);
    $('x-genres').querySelectorAll('input').forEach(i => { if (set.has(i.value)) i.checked = true; });
  }

  // ---------- options ----------
  function readOpts() {
    return {
      model: $('x-model').value,
      series: ($('x-series').value || '').trim(),
      range: VB.cleanRange($('x-range').value) || VB.rangeLabel(chapters.map(c => c.name)),
      batchSize: Math.max(1, +$('x-batch').value || 8),
      maxSide: Math.max(640, +$('x-maxside').value || 1280),
      delayMs: Math.max(0, +$('x-delay').value || 800),
      useWeb: $('x-web').checked,
      accumulate: $('x-accum').checked,
      unionRange: $('x-union').checked,
      genreAuto: $('x-gauto').checked,
      genres: readGenres(),
      genreExtra: $('x-gextra').value,
      notes: $('x-notes').value,
      baseId: $('x-base').value
    };
  }
  function saveOpts() {
    const o = readOpts();
    Object.assign(VB.data.ctxb, {
      model: o.model, series: o.series, range: o.range, batchSize: o.batchSize, maxSide: o.maxSide,
      delayMs: o.delayMs, useWeb: o.useWeb, accumulate: o.accumulate, unionRange: o.unionRange,
      genreAuto: o.genreAuto, genres: o.genres, genreExtra: o.genreExtra, notes: o.notes,
      autoBase: $('x-autobase').checked
    });
    VB.save();
  }
  function fillOpts() {
    const d = VB.data.ctxb;
    const setV = (id, v) => { const el = $(id); if (el && v !== undefined && v !== null && v !== '') el.value = v; };
    const setC = (id, v) => { const el = $(id); if (el) el.checked = !!v; };
    const sel = $('x-model');
    if (sel && d.model && !Array.from(sel.options).some(o => o.value === d.model)) {
      const op = document.createElement('option'); op.value = d.model; op.textContent = d.model; sel.appendChild(op);
    }
    setV('x-model', d.model); setV('x-series', d.series || VB.data.context.title || ''); setV('x-range', d.range);
    setV('x-batch', d.batchSize); setV('x-maxside', d.maxSide); setV('x-delay', d.delayMs);
    setV('x-gextra', d.genreExtra); setV('x-notes', d.notes);
    setC('x-web', d.useWeb); setC('x-accum', d.accumulate); setC('x-union', d.unionRange);
    setC('x-gauto', d.genreAuto); setC('x-autobase', d.autoBase);
    renderGenres();
  }

  // ---------- engine ----------
  async function partsFor(img, maxSide) {
    const blob0 = await img.get();
    const blob = blob0.type ? blob0 : new Blob([blob0], { type: VB.mimeOf(img.name) });
    const p = await VB.imageToParts(blob, { maxWidth: maxSide, sliceTall: true, sliceHeight: 2600, quality: 0.88 });
    return p.slice(0, 2);   // trang quá dài: lấy 2 lát đầu cho đỡ tốn token
  }

  async function detectGenres(o) {
    const pages = [];
    chapters.forEach(c => c.images.forEach(i => pages.push(i)));
    if (!pages.length) return { genres: [], note: '' };
    const step = Math.max(1, Math.floor(pages.length / 6));
    const sample = pages.filter((_, i) => i % step === 0).slice(0, 6);

    const parts = [{ text: VB.fmt(VB.CTX.P_GENRE, {
      title_part: o.series ? ' (từ khóa: "' + o.series + '")' : '',
      list: VB.GENRES.join(', ')
    }) }];
    for (const p of sample) {
      const ip = await partsFor(p, 1024);
      parts.push({ text: '[Trang ' + p.name + ']' });
      parts.push(ip[0]);
    }
    const j = await VB.callGeminiJson({
      model: o.model, parts, system: VB.CTX.SYS_ANALYST, schema: VB.CTX.S_GENRE,
      generationConfig: { temperature: 0.2, maxOutputTokens: 2048 },
      shouldStop: () => stopFlag, onStatus: setStatus
    }) || {};
    const n = VB.normalizeGenres(j.genres);
    let note = (j.note || '').trim();
    if (n.unknown.length) note = (note + ' | Nhãn ngoài danh sách: ' + n.unknown.join(', ')).trim();
    return { genres: n.matched, note };
  }

  async function run() {
    if (running) return;
    if (!chapters.length) return alert('Chưa nạp ảnh/zip nào.');
    if (!VB.getKeys().length) return alert('Chưa có API key. Bấm ⚙ Nâng cao → tab API Keys.');
    saveOpts();
    const o = readOpts();
    if (!o.series) return alert('Hãy nhập Tên truyện — thư viện context lưu theo tên này.');

    running = true; stopFlag = false;
    $('x-run').disabled = true; $('x-stop').disabled = false;

    try {
      // nền (context cũ)
      const baseItem = (o.accumulate && o.baseId) ? VB.CTXLIB.get(o.baseId) : null;
      const base = baseItem ? baseItem.text : '';
      const oldRng = baseItem ? (baseItem.range || '?') : '';

      // ① thể loại
      let genres = o.genres.slice(), gnote = '';
      if (o.genreAuto) {
        setStatus('① Đang nhận diện thể loại…');
        try {
          const g = await detectGenres(o);
          g.genres.forEach(x => { if (genres.indexOf(x) === -1) genres.push(x); });
          gnote = g.note;
          setGenres(genres);
          setStatus('① Thể loại: ' + (genres.join(', ') || '(không rõ)'));
        } catch (e) { setStatus('① Nhận diện thể loại lỗi: ' + e.message); }
      }
      let gtext = VB.genrePack(genres, o.genreExtra);
      if (gnote) gtext += '\n- Nhận định từ ảnh: ' + gnote;

      const known = base ? ('\nTÊN RIÊNG / THUẬT NGỮ ĐÃ CHỐT Ở CÁC CHƯƠNG TRƯỚC (phải dùng lại, không đặt tên khác):\n' + VB.knownBlock(base) + '\n') : '';

      // ② phân tích theo lô trang
      const tasks = [];
      chapters.forEach(c => VB.chunkList(c.images, o.batchSize).forEach(grp => tasks.push({ chap: c.name, grp })));
      const total = tasks.length + 2;
      let done = 0;
      setProgress(0, total);

      const notes = [];
      for (let i = 0; i < tasks.length && !stopFlag; i++) {
        const t = tasks[i];
        const files = t.grp.map(x => x.name);
        setStatus('② Phân tích ' + t.chap + ' · ' + files[0] + ' → ' + files[files.length - 1] + ' (' + (i + 1) + '/' + tasks.length + ')');
        const parts = [{ text: VB.fmt(VB.CTX.P_CTX_BATCH, {
          n: t.grp.length, chap: t.chap, files: files.join(', '), genres: gtext, known,
          notes: o.notes ? ('Yêu cầu riêng: ' + o.notes) : ''
        }) }];
        for (const img of t.grp) {
          const ip = await partsFor(img, o.maxSide);
          parts.push({ text: '[Trang ' + img.name + ']' });
          ip.forEach(p => parts.push(p));
        }
        try {
          const j = await VB.callGeminiJson({
            model: o.model, parts, system: VB.CTX.SYS_ANALYST, schema: VB.CTX.S_CTX,
            generationConfig: { temperature: 0.3, maxOutputTokens: 12288 },
            shouldStop: () => stopFlag, onStatus: setStatus
          });
          if (j) { j._chap = t.chap; notes.push(j); }
        } catch (e) {
          if (/Đã dừng/.test(e.message)) break;
          setStatus('② Lỗi lô ' + (i + 1) + ': ' + e.message);
        }
        done++; setProgress(done, total);
        if (o.delayMs && i < tasks.length - 1) await VB.sleep(o.delayMs);
      }
      if (!notes.length) throw new Error('Không phân tích được trang nào.');

      // ③ tra web
      let web = '(không tra web)';
      if (o.useWeb && !stopFlag) {
        setStatus('③ Đang tra cứu thông tin tác phẩm trên mạng…');
        try {
          web = await VB.callGemini({
            model: o.model,
            parts: [{ text: VB.fmt(VB.CTX.P_RESEARCH, {
              title: o.series || '(không rõ tên, hãy suy từ dữ kiện dưới đây)',
              genres: genres.join(', ') || '(chưa rõ)',
              hints: VB.hintsFrom(notes)
            }) }],
            system: VB.CTX.SYS_ANALYST, useSearch: true,
            generationConfig: { temperature: 0.2, maxOutputTokens: 6144 },
            shouldStop: () => stopFlag, onStatus: setStatus
          });
        } catch (e) { web = '(tra web thất bại)'; setStatus('③ Tra web lỗi: ' + e.message); }
      }
      done++; setProgress(done, total);

      // ④ gộp / cập nhật
      let blob = JSON.stringify(notes);
      if (blob.length > 300000) blob = blob.slice(0, 300000) + '\n…(đã cắt bớt dữ liệu thô do quá dài)…';

      const newRng = o.unionRange && oldRng ? VB.unionRange(oldRng, o.range) : o.range;
      const stamp = new Date().toLocaleString();
      setStatus(base ? '④ Đang CẬP NHẬT context (giữ nguyên dữ liệu cũ)…' : '④ Đang tổng hợp context…');

      const prompt = base
        ? VB.fmt(VB.CTX.P_CTX_UPDATE, { series: o.series, old_rng: oldRng || '?', rng: o.range, new_rng: newRng, genres: gtext, old: base, notes: blob, web, user: o.notes || '(không có)', layout: VB.CTX.CTX_LAYOUT, stamp })
        : VB.fmt(VB.CTX.P_CTX_MERGE, { series: o.series, rng: o.range, genres: gtext, notes: blob, web, user: o.notes || '(không có)', layout: VB.CTX.CTX_LAYOUT });

      let ctx = await VB.callGemini({
        model: o.model, parts: [{ text: prompt }],
        system: base ? VB.CTX.SYS_KEEPER : VB.CTX.SYS_ANALYST,
        generationConfig: { temperature: 0.35, maxOutputTokens: 32768 },
        shouldStop: () => stopFlag, onStatus: setStatus
      });
      ctx = (ctx || '').trim();

      // bảo hiểm: không cho phép mất dữ liệu cũ
      if (base) {
        if (!ctx) ctx = base;
        else if (ctx.length < base.length * 0.9) {
          setStatus('⚠ Bản gộp ngắn hơn bản cũ → giữ nguyên bản cũ và nối phần bổ sung.');
          ctx = base.trim() + '\n\n' + '='.repeat(70) + '\nPHẦN BỔ SUNG CHƯƠNG ' + o.range + ' (' + stamp + ')\n' + '='.repeat(70) + '\n\n' + ctx;
        }
      }

      done++; setProgress(done, total);
      resultText = ctx;
      $('x-out').value = ctx;

      const saved = VB.CTXLIB.save(o.series, newRng, ctx);
      refreshBase();
      $('x-base').value = saved.id;
      if ($('x-apply').checked) VB.applyContextFile(saved.name, ctx, { title: o.series });
      $('x-range').value = newRng;

      setStatus('Hoàn tất ✔ Đã lưu "' + saved.name + '" (' + ctx.length.toLocaleString() + ' ký tự)' + ($('x-apply').checked ? ' và đưa vào ngữ cảnh dịch.' : '.'));
    } catch (e) {
      console.error(e);
      setStatus('✘ ' + e.message);
    } finally {
      running = false;
      $('x-run').disabled = false; $('x-stop').disabled = true;
    }
  }

  // ---------- init ----------
  function init() {
    if (!$('x-out')) return;
    fillOpts();
    refreshBase();

    const ki = $('x-keyinfo');
    if (ki) ki.textContent = VB.getKeys().length ? VB.getKeys().length + ' API key sẵn sàng' : '⚠ Chưa có API key';

    on('x-file', 'change', e => { const f = Array.from(e.target.files || []); if (f.length) loadFiles(f); e.target.value = ''; });
    const drop = $('x-drop');
    if (drop) {
      ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
      ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
      drop.addEventListener('drop', e => { const f = Array.from((e.dataTransfer || {}).files || []); if (f.length) loadFiles(f); });
    }

    on('x-series', 'input', () => { refreshBase(); saveOpts(); });
    on('x-autobase', 'change', refreshBase);
    on('x-run', 'click', run);
    on('x-stop', 'click', () => { stopFlag = true; setStatus('Đang dừng…'); });
    on('x-refresh', 'click', refreshBase);
    on('x-gall', 'click', () => $('x-genres').querySelectorAll('input').forEach(i => { i.checked = true; }));
    on('x-gnone', 'click', () => $('x-genres').querySelectorAll('input').forEach(i => { i.checked = false; }));

    on('x-copy', 'click', async () => {
      try { await navigator.clipboard.writeText($('x-out').value); setStatus('Đã copy ✔'); } catch (e) { setStatus('Copy thất bại.'); }
    });
    on('x-txt', 'click', () => {
      const t = $('x-out').value.trim();
      if (!t) return setStatus('Chưa có nội dung.');
      download(t, VB.safeName($('x-series').value || 'context') + ' ' + (VB.cleanRange($('x-range').value) || 'toan-bo') + '.txt');
    });
    on('x-save', 'click', () => {
      const t = $('x-out').value.trim();
      if (!t) return setStatus('Chưa có nội dung.');
      const s = ($('x-series').value || '').trim();
      if (!s) return alert('Nhập Tên truyện trước khi lưu.');
      const it = VB.CTXLIB.save(s, $('x-range').value, t);
      refreshBase(); $('x-base').value = it.id;
      setStatus('Đã lưu (kể cả phần bạn sửa tay): ' + it.name);
    });
    on('x-use', 'click', () => {
      const t = $('x-out').value.trim();
      if (!t) return setStatus('Chưa có nội dung.');
      const s = ($('x-series').value || '').trim() || 'context';
      VB.applyContextFile(VB.safeName(s) + ' ' + (VB.cleanRange($('x-range').value) || 'toan-bo') + '.txt', t, { title: s });
      setStatus('Đã đưa vào ngữ cảnh dịch ✔ (mọi lần dịch sau sẽ dùng file này)');
    });

    ['x-model', 'x-range', 'x-batch', 'x-maxside', 'x-delay', 'x-web', 'x-accum', 'x-union', 'x-gauto', 'x-gextra', 'x-notes']
      .forEach(id => on(id, 'change', saveOpts));

    window.addEventListener('beforeunload', e => { if (running) { e.preventDefault(); e.returnValue = ''; } });
  }

  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', init) : init();
})();
