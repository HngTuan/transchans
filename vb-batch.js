/* =============================================================================
 * vb-batch.js — trang Dịch hàng loạt (batch.html) v3
 * Cần: jszip.min.js, vb-models.js, vb-shared.js, vb-batch-adv.js nạp trước.
 *  - Nạp THƯ MỤC / .zip / ảnh rời (kéo-thả được cả thư mục nhiều cấp)
 *  - Xuất đúng định dạng chuẩn của trang chính: bản dịch + dòng gốc (*)
 *  - Trang trắng bỏ qua ngay tại máy; model báo trang không chữ → không tốn dịch
 *  - Hàng đợi chung nhiều luồng, cache trang trùng, chạy lại chỉ dịch trang lỗi
 * ========================================================================== */
(function () {
  'use strict';
  const VB = window.VBS;
  if (!VB || !document.getElementById('b-list')) return;
  const $ = VB.$, sleep = VB.sleep;
  const CFG = 'vbs_batch_cfg_v2';
  const IMG_RE = /\.(jpe?g|png|webp|bmp|gif|avif)$/i;
  const NAMES = { ja: 'Japanese', ko: 'Korean', zh: 'Chinese', en: 'English', vi: 'Vietnamese' };
  const EMPTY = '(không có chữ)';
  const S = { chapters: [], running: false, abort: null, done: 0, total: 0, fails: 0, used: '', cache: new Map() };
  const adv = () => (VB.adv ? VB.adv.cfg : { marker: '*', sfxTag: '(sfx)', enabled: false });

  const setStatus = t => { const e = $('b-status'); if (e) e.textContent = t; };
  const setProg = p => { const e = $('b-progress'); if (e) e.style.width = Math.max(0, Math.min(100, p)) + '%'; };
  function log(m, c) {
    const b = $('b-log'); if (!b) return;
    const d = document.createElement('div'); if (c) d.className = c;
    d.textContent = `[${new Date().toLocaleTimeString('vi-VN')}] ${m}`;
    b.appendChild(d); b.scrollTop = b.scrollHeight;
  }
  function refreshCtx() {
    const e = $('b-ctxinfo'); if (!e) return;
    if (!VB.adv) { e.textContent = ''; return; }
    const n = VB.adv.build().length;
    e.textContent = !adv().enabled ? '· ngữ cảnh: đang TẮT' : n ? `· ngữ cảnh: ${n.toLocaleString('vi-VN')} ký tự` : '· chưa có ngữ cảnh — bấm ⚙ Nâng cao';
  }
  function fnv(str) { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }

  /* -------------------------------------------------------------- prompt */
  const SCHEMA = {
    type: 'OBJECT',
    properties: {
      no_text: { type: 'BOOLEAN' },
      lines: { type: 'ARRAY', items: { type: 'OBJECT', properties: { src: { type: 'STRING' }, tr: { type: 'STRING' }, sfx: { type: 'BOOLEAN' } }, required: ['src', 'tr'] } }
    },
    required: ['lines']
  };
  function styleBlock(dst) { const s = window.STYLE_SKILL; return s && typeof s.buildBlock === 'function' ? s.buildBlock(NAMES[dst] || 'Vietnamese', 'translate') : ''; }

  function prompt(o) {
    const src = NAMES[o.src] || o.src, dst = NAMES[o.dst] || o.dst;
    const order = o.type === 'webtoon'
      ? 'webtoon: strictly top-to-bottom; bubbles on the same row: left-to-right'
      : 'manga: panel tiers top-to-bottom, inside a tier RIGHT-to-LEFT; inside a panel the right/higher bubble first';
    const p = [];
    // Phần tĩnh (ngữ cảnh + luật) đặt ĐẦU để các trang dùng chung tiền tố → Gemini cache ngầm, nhanh hơn
    if (o.context) p.push('--- STORY CONTEXT (reference only, never output it; names, terms and forms of address MUST follow it) ---', o.context, '--- END CONTEXT ---', '');
    p.push(`You are a professional comic translator, ${src} → ${dst}. You can SEE the attached page image.`,
      '', 'RULES',
      `1. Reading order — ${order}.`,
      '2. One item = one bubble / caption box / standalone text block. All text inside ONE outline is ONE item even if it wraps over several rows (join with spaces). Two outlines = two items.',
      `3. "src" = the original ${src} text exactly as written (main text only, no furigana/ruby). "tr" = the ${dst} translation.`,
      '4. Skip watermarks, page numbers, scanlation credits and unreadable scribbles.',
      o.skipSfx ? '5. IGNORE sound effects / onomatopoeia drawn on the artwork.' : '5. Sound effects drawn on the artwork are their own items with "sfx": true and a short SFX-style translation.',
      `6. Use the art (age, gender, rank, clothing, who faces whom, emotion) to choose forms of address and keep them consistent across the page${o.dst === 'vi' ? ' (Vietnamese pronoun pairs: tôi–cậu, anh–em, tao–mày, ta–ngươi…)' : ''}.`,
      `7. Natural spoken ${dst}: meaning and nuance over word order; keep each voice, slang, stammering, cut-off lines; normal sentence case even if the source is ALL CAPS. No notes, no explanations.`,
      '8. If the page has NO readable text at all, answer {"no_text": true, "lines": []} immediately.');
    if (o.style) { const sg = styleBlock(o.dst); if (sg) p.push('', sg.slice(0, 4000)); }
    if (o.sliced) p.push('', `NOTE: the page is sent as ${o.sliceCount} vertical slices of ONE page, in order and slightly overlapping. Read them as one continuous page and never repeat the overlap.`);
    p.push('', 'OUTPUT: JSON only, no markdown: {"no_text": false, "lines": [{"src": "…", "tr": "…", "sfx": false}]}');
    return p.join('\n');
  }

  function parseResult(raw, skipSfx) {
    const t = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    let j = null;
    try { j = JSON.parse(t); } catch (_) { const a = t.indexOf('{'), b = t.lastIndexOf('}'); if (a >= 0 && b > a) { try { j = JSON.parse(t.slice(a, b + 1)); } catch (_) {} } }
    if (j && typeof j === 'object') {
      let lines = (Array.isArray(j.lines) ? j.lines : []).map(l => ({ src: String((l && l.src) || '').trim(), tr: String((l && l.tr) || '').trim(), sfx: !!(l && l.sfx) })).filter(l => l.src || l.tr);
      if (skipSfx) lines = lines.filter(l => !l.sfx);
      return { lines, empty: !lines.length };
    }
    const lines = t.split('\n').map(s => s.trim()).filter(s => s && !/^\[?\s*no[ _-]?text\s*\]?$/i.test(s)).map(s => ({ src: '', tr: s, sfx: false }));
    return { lines, empty: !lines.length };
  }

  /* --------------------------------------------- phân tích ảnh tại máy */
  async function analyze(blob) {
    let bm = null;
    try { bm = await createImageBitmap(blob, { resizeWidth: 128, resizeQuality: 'low' }); }
    catch (_) { try { bm = await createImageBitmap(blob); } catch (_) {} }
    if (!bm) return { blank: false, hash: 'x' + blob.size + ':' + Math.random() };
    const w = 128, h = Math.max(8, Math.min(1024, Math.round(128 * bm.height / bm.width)));
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(bm, 0, 0, w, h); if (bm.close) bm.close();
    const d = cx.getImageData(0, 0, w, h).data;
    let sum = 0, sq = 0, mn = 255, mx = 0, q = '';
    for (let i = 0; i < d.length; i += 4) {
      const y = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
      sum += y; sq += y * y; if (y < mn) mn = y; if (y > mx) mx = y;
      q += String.fromCharCode(65 + (y >> 4));
    }
    const n = w * h, mean = sum / n, std = Math.sqrt(Math.max(0, sq / n - mean * mean));
    return { blank: std < 3 && mx - mn < 20, hash: fnv(q) + '-' + blob.size };   // trang trắng/đen/1 màu
  }

  /* ----------------------------------------------------------- dịch 1 trang */
  async function runPage(p, cfg, ctx, sig, signal) {
    const a = await analyze(p.blob);
    if (a.blank) return { lines: [], empty: true, local: true };
    const ck = a.hash + '|' + sig;
    if (S.cache.has(ck)) return Object.assign({ cached: true }, S.cache.get(ck));
    const imgs = await VB.img.parts(p.blob, cfg.width, cfg.slice);
    const parts = [{ text: prompt(Object.assign({}, cfg, { context: ctx, sliced: imgs.length > 1, sliceCount: imgs.length })) }];
    imgs.forEach(b => parts.push({ inline_data: { mime_type: 'image/jpeg', data: b } }));
    const r = await VB.gemini.call(cfg.model, parts, { signal, json: true, schema: SCHEMA, fast: cfg.fast, maxTokens: 8192, temperature: 0.4, onNote: m => log(m, 'warn') });
    if (r.model !== S.used) { S.used = r.model; const e = $('b-modelinfo'); if (e) e.textContent = '· đang gọi: ' + r.model; }
    const res = parseResult(r.text, cfg.skipSfx);
    S.cache.set(ck, res);
    return res;
  }

  /* --------------------------------------------- định dạng chuẩn (như trang chính) */
  const pad2 = n => String(n).padStart(2, '0');
  function format(ch) {
    const a = adv(), bi = $('b-bi').checked, mk = a.marker || '*', tag = a.sfxTag || '(sfx)';
    const out = [`=== ${ch.name} ===`, ''];
    ch.pages.forEach((p, i) => {
      out.push(`[Trang ${pad2(i + 1)} — ${p.name}]`);
      const r = p.res;
      if (!r) out.push('(chưa dịch)');
      else if (r.error) out.push('⚠ LỖI: ' + r.error);
      else if (r.empty || !r.lines.length) out.push(EMPTY);
      else r.lines.forEach(l => {
        const pre = l.sfx ? tag + ' ' : '';
        out.push(pre + (l.tr || '⟨thiếu bản dịch⟩'));
        if (bi && l.src) out.push(mk + pre + l.src);
        if (bi) out.push('');
      });
      out.push('');
    });
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }
  function reformat() { S.chapters.forEach(c => { if (c.result && !c.edited) c.result = format(c); }); renderResults(); }

  /* ----------------------------------------------------------------- UI */
  function counts() {
    if (S.running) return;
    const sel = S.chapters.filter(c => c.sel), pg = sel.reduce((s, c) => s + c.pages.length, 0);
    setStatus(sel.length ? `Đã chọn ${sel.length} chương · ${pg} trang.` : 'Chưa chọn chương nào.');
  }
  function renderList() {
    const box = $('b-list'), kw = ($('b-filter').value || '').trim().toLowerCase();
    box.innerHTML = '';
    if (!S.chapters.length) { box.innerHTML = '<p class="vbs-hint">Chưa nạp chương nào.</p>'; counts(); return; }
    S.chapters.forEach(c => {
      if (kw && !c.name.toLowerCase().includes(kw)) return;
      const row = document.createElement('label');
      row.className = 'vbs-chapter' + (c.status === 'run' ? ' run' : c.status === 'done' ? ' done' : c.status === 'err' ? ' err' : '');
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = c.sel;
      cb.onchange = () => { c.sel = cb.checked; counts(); };
      const nm = document.createElement('span'); nm.className = 'vbs-chapter-name'; nm.textContent = c.name;
      const me = document.createElement('span'); me.className = 'vbs-hint';
      const ok = c.pages.filter(p => p.res && !p.res.error).length;
      me.textContent = `${c.pages.length} trang` + (ok ? ` · xong ${ok}` : '') +
        (c.status === 'done' ? ' · ✔' : c.status === 'err' ? ' · ✘ ' + c.err : c.status === 'run' ? ' · đang dịch…' : '');
      row.append(cb, nm, me); box.appendChild(row);
    });
    counts();
  }
  function renderResults() {
    const box = $('b-results'); box.innerHTML = '';
    const done = S.chapters.filter(c => c.result);
    if (!done.length) { box.innerHTML = '<p class="vbs-hint">Chưa có kết quả.</p>'; return; }
    done.forEach(c => {
      const card = document.createElement('div'); card.className = 'vbs-result';
      const ta = document.createElement('textarea'); ta.rows = 12; ta.value = c.result;
      ta.oninput = () => { c.result = ta.value; c.edited = true; };
      const head = document.createElement('div'); head.className = 'vbs-row';
      const mk = (t, f) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'vbs-btn'; b.textContent = t; b.onclick = f; return b; };
      const h = document.createElement('b'); h.textContent = c.name;
      const sp = document.createElement('span'); sp.className = 'vbs-sp';
      head.append(h, sp, mk('Copy', () => VB.file.copy(ta.value)),
        mk('⬇ .txt', () => VB.file.saveAs(ta.value, 'txt', c.name)),
        mk('⬇ .docx', () => VB.file.saveAs(ta.value, 'docx', c.name)));
      card.append(head, ta); box.appendChild(card);
    });
  }

  /* ------------------------------------------------------- nạp nguồn ảnh */
  function addChapters(list, label) {
    let pages = 0;
    list.forEach(c => {
      if (!c.pages.length) return;
      c.pages.sort((a, b) => VB.coll.compare(a.name, b.name));
      let name = label && list.length > 1 ? `${label} / ${c.name}` : (label && c.name === '(gốc)' ? label : c.name);
      while (S.chapters.some(x => x.name === name)) name += ' *';
      S.chapters.push({ name, pages: c.pages.map(p => ({ name: p.name, blob: p.blob, res: null })), sel: true, status: 'idle', result: '', err: '' });
      pages += c.pages.length;
    });
    S.chapters.sort((a, b) => VB.coll.compare(a.name, b.name));
    renderList();
    const total = S.chapters.reduce((s, c) => s + c.pages.length, 0);
    $('b-zipinfo').textContent = `Đã nạp ${S.chapters.length} chương · ${total} trang.`;
    return pages;
  }
  async function addZip(file) {
    setStatus(`Đang đọc ${file.name}…`);
    const chs = await VB.zipToChapters(file);
    if (!chs.length) { setStatus(`${file.name}: không có ảnh.`); return; }
    addChapters(chs, file.name.replace(/\.zip$/i, ''));
  }
  /** files: [{file, path}] — path dạng "Truyện/Chap 1/001.png" */
  function addFileList(items) {
    const map = new Map();
    items.forEach(({ file, path }) => {
      if (!IMG_RE.test(file.name) || file.name.startsWith('.')) return;
      const segs = String(path || file.name).split('/').filter(Boolean);
      const dirs = segs.slice(0, -1);
      const ch = dirs.length > 1 ? dirs.slice(1).join(' / ') : (dirs[0] || 'Ảnh rời');
      const root = dirs.length > 1 ? dirs[0] : '';
      const key = root ? root + ' / ' + ch : ch;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push({ name: file.name, blob: file });
    });
    const list = Array.from(map, ([name, pages]) => ({ name, pages }));
    if (!list.length) { setStatus('Không tìm thấy ảnh nào (chỉ nhận jpg, png, webp, bmp, gif, avif).'); return; }
    const n = addChapters(list, '');
    log(`Nạp ${n} ảnh từ ${list.length} thư mục (đã lọc bỏ file không phải ảnh).`, 'ok');
  }
  function readEntry(entry, prefix, out) {
    return new Promise(res => {
      if (entry.isFile) entry.file(f => { out.push({ file: f, path: prefix + f.name }); res(); }, () => res());
      else if (entry.isDirectory) {
        const rd = entry.createReader(), all = [];
        const next = () => rd.readEntries(async ents => {
          if (!ents.length) { for (const e of all) await readEntry(e, prefix + entry.name + '/', out); res(); }
          else { all.push(...ents); next(); }
        }, () => res());
        next();
      } else res();
    });
  }

  /* --------------------------------------------------------------- cfg */
  const IDS = ['type', 'src', 'dst', 'conc', 'delay', 'width'];
  const readCfg = () => {
    const keys = Math.max(1, VB.keys.stat().usable);
    const cv = $('b-conc').value;
    return {
      model: $('b-model').value, type: $('b-type').value, src: $('b-src').value, dst: $('b-dst').value,
      conc: cv === 'auto' ? Math.min(6, Math.max(2, keys)) : Math.max(1, parseInt(cv, 10) || 1),
      delay: Math.max(0, parseInt($('b-delay').value, 10) || 0),
      width: Math.max(600, parseInt($('b-width').value, 10) || 1400),
      skipSfx: $('b-skipsfx').checked, style: $('b-style').checked, slice: $('b-slice').checked,
      fast: $('b-fast').checked
    };
  };
  const saveCfg = () => {
    try {
      const c = readCfg(); c.conc = $('b-conc').value; c.bilingual = $('b-bi').checked;
      localStorage.setItem(CFG, JSON.stringify(c));
    } catch (_) {}
  };
  function loadCfg() {
    try {
      const c = JSON.parse(localStorage.getItem(CFG) || '{}');
      const set = (id, v) => { const e = $(id); if (e && v != null) { if (e.type === 'checkbox') e.checked = !!v; else e.value = v; } };
      IDS.forEach(k => set('b-' + k, c[k]));
      set('b-skipsfx', c.skipSfx); set('b-style', c.style); set('b-slice', c.slice); set('b-bi', c.bilingual); set('b-fast', c.fast);
    } catch (_) {}
  }

  /* ------------------------------------------------------- chạy hàng đợi */
  async function start() {
    if (S.running) return;
    const sel = S.chapters.filter(c => c.sel);
    if (!sel.length) { alert('Chưa chọn chương nào.'); return; }
    if (!VB.keys.load().length) { alert('Chưa có API key. Bấm 🔑 trên thanh điều hướng.'); return; }
    const cfg = readCfg(); saveCfg();
    const ctx = VB.adv ? VB.adv.build() : '';
    const sig = fnv([cfg.model, cfg.src, cfg.dst, cfg.type, cfg.skipSfx, cfg.style, ctx.length].join('|'));

    // Chỉ dịch trang chưa có kết quả hoặc bị lỗi → bấm lại ▶ = chạy tiếp/dịch lại trang lỗi
    const jobs = [];
    sel.forEach(ch => ch.pages.forEach(p => { if (!p.res || p.res.error) jobs.push({ ch, p }); }));
    if (!jobs.length) { if (!confirm('Mọi trang đã dịch xong. Dịch lại toàn bộ?')) return; sel.forEach(ch => ch.pages.forEach(p => { p.res = null; jobs.push({ ch, p }); })); S.cache.clear(); }

    S.running = true; S.abort = new AbortController(); S.done = 0; S.fails = 0; S.used = '';
    S.total = jobs.length;
    $('b-start').disabled = true; $('b-stop').disabled = false; setProg(0);
    sel.forEach(c => { c.status = 'run'; c.err = ''; });
    renderList();
    log(`Bắt đầu ${sel.length} chương · ${jobs.length} trang · ${cfg.conc} luồng · model ${cfg.model}`);

    const t0 = Date.now(); let cur = 0, fatal = null, skipped = 0, dup = 0;
    const left = new Map(sel.map(c => [c, c.pages.filter(p => !p.res || p.res.error).length]));
    const finishCh = ch => { ch.status = ch.pages.some(p => p.res && p.res.error) ? 'err' : 'done'; if (ch.status === 'err') ch.err = 'có trang lỗi'; ch.edited = false; ch.result = format(ch); renderList(); renderResults(); };

    async function worker(w) {
      if (w) await sleep(w * 350);                     // giãn khởi động tránh dồn 429
      while (!fatal && !S.abort.signal.aborted) {
        const j = jobs[cur++]; if (!j) return;
        try {
          j.p.res = await runPage(j.p, cfg, ctx, sig, S.abort.signal);
          if (j.p.res.local) skipped++; if (j.p.res.cached) dup++;
          S.fails = 0;
        } catch (e) {
          const m = String(e.message || e);
          if (/dừng/i.test(m)) return;
          j.p.res = { error: m }; log(`${j.ch.name} · ${j.p.name}: ${m}`, 'bad');
          if (++S.fails >= 4 || /Không còn API key|Key không hợp lệ/.test(m)) { fatal = new Error(m); return; }
        }
        S.done++;
        const sec = (Date.now() - t0) / 1000, eta = S.done ? Math.round(sec / S.done * (S.total - S.done)) : 0;
        setProg(S.total ? S.done / S.total * 100 : 0);
        setStatus(`${S.done}/${S.total} trang · ${(S.done / Math.max(1, sec) * 60).toFixed(1)} trang/phút · còn ~${eta}s`);
        left.set(j.ch, left.get(j.ch) - 1);
        if (left.get(j.ch) <= 0) finishCh(j.ch);
        if (cfg.delay && !j.p.res.local && !j.p.res.cached) await sleep(cfg.delay);
      }
    }
    await Promise.all(Array.from({ length: Math.min(cfg.conc, jobs.length) }, (_, i) => worker(i)));

    sel.forEach(ch => { if (ch.status === 'run') { ch.status = ch.pages.some(p => p.res) ? 'err' : 'idle'; ch.err = S.abort.signal.aborted ? 'đã dừng' : 'chưa xong'; if (ch.pages.some(p => p.res)) ch.result = format(ch); } });
    renderList(); renderResults();
    S.running = false; $('b-start').disabled = false; $('b-stop').disabled = true;
    if (skipped || dup) log(`Tối ưu: bỏ qua ${skipped} trang trắng tại máy, dùng lại ${dup} trang trùng.`, 'ok');
    if (fatal) {
      setStatus('Dừng vì lỗi: ' + fatal.message); log('DỪNG SỚM — ' + fatal.message, 'bad');
      alert('Đã dừng vì lỗi lặp lại:\n\n' + fatal.message + '\n\nBấm ▶ lần nữa để chạy tiếp các trang lỗi/chưa dịch.');
    } else {
      setProg(100);
      setStatus(S.abort.signal.aborted ? 'Đã dừng — bấm ▶ để chạy tiếp.' : `Hoàn tất ${S.total} trang trong ${Math.round((Date.now() - t0) / 1000)}s.`);
    }
  }

  async function zipAll() {
    const done = S.chapters.filter(c => c.result);
    if (!done.length) { alert('Chưa có kết quả.'); return; }
    const z = new JSZip(), used = new Set();
    done.forEach(c => { let n = VB.file.safeName(c.name), i = 2; while (used.has(n)) n = VB.file.safeName(c.name) + ' (' + i++ + ')'; used.add(n); z.file(n + '.txt', c.result); });
    z.file('_TAT-CA.txt', done.map(c => c.result).join('\n'));
    setStatus('Đang nén…');
    VB.file.download(await z.generateAsync({ type: 'blob' }), 'visionbox-ban-dich.zip');
    setStatus(`Đã tải ${done.length} chương.`);
  }

  /* ------------------------------------------------------------- sự kiện */
  function bind() {
    $('b-zip').onchange = async e => { for (const f of Array.from(e.target.files || [])) { try { await addZip(f); } catch (x) { setStatus('Lỗi zip: ' + x.message); } } e.target.value = ''; };
    $('b-folder').onchange = e => { addFileList(Array.from(e.target.files || []).map(f => ({ file: f, path: f.webkitRelativePath || f.name }))); e.target.value = ''; };
    $('b-imgs').onchange = e => { addFileList(Array.from(e.target.files || []).map(f => ({ file: f, path: f.name }))); e.target.value = ''; };
    const d = $('b-drop');
    ['dragenter', 'dragover'].forEach(t => d.addEventListener(t, e => { e.preventDefault(); d.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(t => d.addEventListener(t, e => { e.preventDefault(); d.classList.remove('over'); }));
    d.addEventListener('drop', async e => {
      const items = Array.from(e.dataTransfer.items || []).map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
      const loose = [];
      if (items.length) { for (const en of items) await readEntry(en, '', loose); }
      else Array.from(e.dataTransfer.files || []).forEach(f => loose.push({ file: f, path: f.name }));
      for (const it of loose.filter(x => /\.zip$/i.test(x.file.name))) { try { await addZip(it.file); } catch (x) { setStatus('Lỗi zip: ' + x.message); } }
      const imgs = loose.filter(x => IMG_RE.test(x.file.name));
      if (imgs.length) addFileList(imgs);
    });

    $('b-all').onclick = () => { S.chapters.forEach(c => c.sel = true); renderList(); };
    $('b-none').onclick = () => { S.chapters.forEach(c => c.sel = false); renderList(); };
    $('b-invert').onclick = () => { S.chapters.forEach(c => c.sel = !c.sel); renderList(); };
    $('b-clear').onclick = () => { if (S.running) return; if (confirm('Xoá toàn bộ chương đã nạp?')) { S.chapters = []; S.cache.clear(); renderList(); renderResults(); $('b-zipinfo').textContent = ''; } };
    $('b-filter').oninput = renderList;
    $('b-start').onclick = start;
    $('b-stop').onclick = () => { if (S.abort) S.abort.abort(); setStatus('Đang dừng…'); };
    $('b-zipall').onclick = zipAll;
    $('b-copyall').onclick = () => { const t = S.chapters.filter(c => c.result).map(c => c.result).join('\n'); if (!t) { alert('Chưa có kết quả.'); return; } VB.file.copy(t); };
    $('b-adv').onclick = () => VB.adv && VB.adv.open('ctx');
    $('b-bi').addEventListener('change', reformat);
    ['b-model', 'b-type', 'b-src', 'b-dst', 'b-conc', 'b-delay', 'b-width', 'b-skipsfx', 'b-style', 'b-slice', 'b-bi', 'b-fast']
      .forEach(id => { const e = $(id); if (e) e.addEventListener('change', saveCfg); });
    window.addEventListener('vbs:adv', () => { refreshCtx(); reformat(); });
    window.addEventListener('vbs:ctx', refreshCtx);
    window.addEventListener('beforeunload', e => { if (S.running) { e.preventDefault(); e.returnValue = ''; } });
  }

  loadCfg(); bind(); renderList(); renderResults(); setTimeout(refreshCtx, 50);
})();
