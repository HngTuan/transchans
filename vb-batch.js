/* =============================================================================
 * vb-batch.js — trang Dịch hàng loạt (batch.html). Cần vb-shared.js nạp trước.
 * ========================================================================== */
(function () {
  'use strict';
  const VB = window.VBS;
  if (!VB || !document.getElementById('b-list')) return;
  const $ = VB.$, sleep = VB.sleep;
  const CFG = 'vbs_batch_cfg_v1';

  const S = { chapters: [], running: false, abort: null, done: 0, total: 0, zips: [], fails: 0, used: '' };

  const setStatus = t => { const e = $('b-status'); if (e) e.textContent = t; };
  const setProg = p => { const e = $('b-progress'); if (e) e.style.width = Math.max(0, Math.min(100, p)) + '%'; };
  function log(m, c) {
    const b = $('b-log'); if (!b) return;
    const d = document.createElement('div'); if (c) d.className = c;
    d.textContent = `[${new Date().toLocaleTimeString('vi-VN')}] ${m}`;
    b.appendChild(d); b.scrollTop = b.scrollHeight;
  }

  function refreshCtx() {
    const c = VB.ctx.get(), e = $('b-ctxinfo');
    if (e) e.textContent = c ? `· ngữ cảnh: ${c.length.toLocaleString('vi-VN')} ký tự` : '· chưa có ngữ cảnh — sang trang “Tạo ngữ cảnh”';
  }

  /* -------------------------------------------------------------- prompt */
  const LANG = { ja: 'tiếng Nhật', ko: 'tiếng Hàn', zh: 'tiếng Trung', en: 'tiếng Anh', vi: 'tiếng Việt' };
  function styleGuide() {
    const g = window.STYLE_GUIDE || window.VB_STYLE_GUIDE || window.styleGuide;
    return !g ? '' : (typeof g === 'string' ? g : (g.text || g.prompt || g.content || ''));
  }

  function prompt(o) {
    const src = LANG[o.src] || o.src, dst = LANG[o.dst] || o.dst;
    const order = o.type === 'webtoon'
      ? 'Webtoon cuộn dọc: đọc TỪ TRÊN XUỐNG DƯỚI; hai bóng ngang hàng thì trái → phải.'
      : 'Manga khung Nhật: đọc TỪ PHẢI SANG TRÁI, TRÊN XUỐNG DƯỚI. Trong một khung, bóng bên phải đọc trước bóng bên trái, bóng cao hơn trước bóng thấp hơn.';
    const p = [];
    p.push(`Bạn là dịch giả truyện tranh chuyên nghiệp, dịch ${src} → ${dst}. Bạn ĐANG NHÌN THẤY trang truyện đính kèm; dùng hình ảnh để hiểu bối cảnh, không chỉ đọc chữ.`);
    p.push('', 'THỨ TỰ ĐỌC', '1. ' + order,
      '2. Bóng thoại phụ nối tiếp cùng người nói gộp một mục, ngăn bằng " — ".',
      '3. Không bỏ sót chữ nào: thoại, nội tâm, narration, chữ ngoài bóng, biển hiệu, tin nhắn.');
    p.push('', 'XƯNG HÔ (bắt buộc nhìn ảnh)',
      '- Quan sát tuổi, trang phục, đồng phục, chức vụ, biểu cảm, khoảng cách cơ thể, ai cúi đầu trước ai để chọn cặp xưng hô tiếng Việt.',
      '- Giữ nhất quán trong cả trang; chỉ đổi khi quan hệ thay đổi rõ rệt.',
      '- Kính ngữ (-san, -kun, -senpai, 님…) chuyển thành xưng hô Việt tương đương.',
      '- Thiếu dữ kiện thì dùng cặp trung tính và thêm dòng "[GHI CHÚ] …" ở cuối.');
    p.push('', 'VĂN PHONG',
      '- Dịch thoát, câu ngắn, tự nhiên như người Việt nói.',
      '- Giữ tên riêng và thuật ngữ theo bảng trong phần NGỮ CẢNH nếu có.',
      o.skipSfx ? '- BỎ QUA hoàn toàn SFX.' : '- Dịch cả SFX, đánh dấu [SFX].');
    if (o.style) { const sg = styleGuide(); if (sg) p.push('', 'ELEMENTS OF STYLE', sg.slice(0, 4000)); }
    if (o.context) p.push('', '===== NGỮ CẢNH TÁC PHẨM (ưu tiên tuyệt đối) =====', o.context.slice(0, 20000), '===== HẾT NGỮ CẢNH =====');
    if (o.sliced) p.push('', `LƯU Ý: trang này cắt thành ${o.sliceCount} mảnh dọc của CÙNG một trang; đọc liền mạch, không lặp phần chồng lấn.`);
    p.push('', 'ĐỊNH DẠNG — chỉ xuất danh sách, không lời dẫn, không markdown:');
    if (o.bilingual) p.push('1. [LOẠI][Tên nhân vật hoặc "?"]', '   > nguyên văn', '   bản dịch');
    else p.push('1. [LOẠI][Tên nhân vật hoặc "?"] bản dịch');
    p.push('LOẠI ∈ {THOẠI, NỘI TÂM, NARRATION, CHỮ NỀN' + (o.skipSfx ? '' : ', SFX') + '}.',
      'Trang không có chữ thì xuất đúng một dòng: [TRANG TRỐNG]');
    return p.join('\n');
  }

  /* ----------------------------------------------------------------- UI */
  function renderList() {
    const box = $('b-list'), kw = ($('b-filter').value || '').trim().toLowerCase();
    box.innerHTML = '';
    if (!S.chapters.length) { box.innerHTML = '<p class="vbs-hint">Chưa nạp chương nào.</p>'; return; }
    S.chapters.forEach(c => {
      if (kw && !c.name.toLowerCase().includes(kw)) return;
      const row = document.createElement('label');
      row.className = 'vbs-chapter' + (c.status === 'run' ? ' run' : c.status === 'done' ? ' done' : c.status === 'err' ? ' err' : '');
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = c.sel;
      cb.onchange = () => { c.sel = cb.checked; counts(); };
      const nm = document.createElement('span'); nm.className = 'vbs-chapter-name'; nm.textContent = c.name;
      const me = document.createElement('span'); me.className = 'vbs-hint';
      me.textContent = `${c.pages.length} trang` + (c.status === 'done' ? ' · ✔' : c.status === 'err' ? ' · ✘ ' + c.err : c.status === 'run' ? ' · đang dịch…' : '');
      row.append(cb, nm, me); box.appendChild(row);
    });
    counts();
  }
  function counts() {
    if (S.running) return;
    const sel = S.chapters.filter(c => c.sel), pg = sel.reduce((s, c) => s + c.pages.length, 0);
    setStatus(sel.length ? `Đã chọn ${sel.length} chương · ${pg} trang.` : 'Chưa chọn chương nào.');
  }
  function renderResults() {
    const box = $('b-results'); box.innerHTML = '';
    const done = S.chapters.filter(c => c.result);
    if (!done.length) { box.innerHTML = '<p class="vbs-hint">Chưa có kết quả.</p>'; return; }
    done.forEach(c => {
      const card = document.createElement('div'); card.className = 'vbs-result';
      const ta = document.createElement('textarea'); ta.rows = 12; ta.value = c.result;
      ta.oninput = () => { c.result = ta.value; };
      const head = document.createElement('div'); head.className = 'vbs-row';
      const mk = (t, f) => { const b = document.createElement('button'); b.className = 'vbs-btn'; b.textContent = t; b.onclick = f; return b; };
      const h = document.createElement('b'); h.textContent = c.name;
      const sp = document.createElement('span'); sp.className = 'vbs-sp';
      head.append(h, sp, mk('Copy', () => VB.file.copy(ta.value)),
        mk('⬇ .txt', () => VB.file.saveAs(ta.value, 'txt', c.name)),
        mk('⬇ .docx', () => VB.file.saveAs(ta.value, 'docx', c.name)));
      card.append(head, ta); box.appendChild(card);
    });
  }

  /* ---------------------------------------------------------------- zip */
  async function addZip(file) {
    setStatus(`Đang đọc ${file.name}…`);
    const chs = await VB.zipToChapters(file);
    if (!chs.length) { setStatus(`${file.name}: không có ảnh.`); return; }
    S.zips.push(file.name);
    const multi = S.zips.length > 1, label = file.name.replace(/\.zip$/i, '');
    chs.forEach(c => S.chapters.push({ name: multi ? `${label} / ${c.name}` : c.name, pages: c.pages, sel: true, status: 'idle', result: '', err: '' }));
    S.chapters.sort((a, b) => VB.coll.compare(a.name, b.name));
    renderList();
    $('b-zipinfo').textContent = `Đã nạp ${S.zips.length} zip · ${S.chapters.length} chương · ${S.chapters.reduce((s, c) => s + c.pages.length, 0)} trang.`;
  }

  /* --------------------------------------------------------------- cfg */
  const readCfg = () => ({
    model: $('b-model').value, type: $('b-type').value, src: $('b-src').value, dst: $('b-dst').value,
    conc: Math.max(1, parseInt($('b-conc').value, 10) || 1),
    delay: Math.max(0, parseInt($('b-delay').value, 10) || 0),
    width: Math.max(600, parseInt($('b-width').value, 10) || 1400),
    skipSfx: $('b-skipsfx').checked, style: $('b-style').checked, slice: $('b-slice').checked,
    bilingual: $('b-bi').checked, useCtx: $('b-ctx').checked
  });
  const saveCfg = () => { try { localStorage.setItem(CFG, JSON.stringify(readCfg())); } catch (_) {} };
  function loadCfg() {
    try {
      const c = JSON.parse(localStorage.getItem(CFG) || '{}');
      const set = (id, v) => { const e = $(id); if (e && v != null) { if (e.type === 'checkbox') e.checked = !!v; else e.value = v; } };
      ['type', 'src', 'dst', 'conc', 'delay', 'width'].forEach(k => set('b-' + k, c[k]));
      set('b-skipsfx', c.skipSfx); set('b-style', c.style); set('b-slice', c.slice); set('b-bi', c.bilingual); set('b-ctx', c.useCtx);
    } catch (_) {}
  }

  /* --------------------------------------------------------------- dịch */
  async function page(p, i, cfg, ctx, signal) {
    const imgs = await VB.img.parts(p.blob, cfg.width, cfg.slice);
    const parts = [{ text: prompt({ src: cfg.src, dst: cfg.dst, type: cfg.type, skipSfx: cfg.skipSfx, style: cfg.style, bilingual: cfg.bilingual, context: ctx, sliced: imgs.length > 1, sliceCount: imgs.length }) }];
    imgs.forEach(b => parts.push({ inline_data: { mime_type: 'image/jpeg', data: b } }));
    const r = await VB.gemini.call(cfg.model, parts, { signal, onNote: m => log(m, 'warn') });
    if (r.model !== S.used) { S.used = r.model; const e = $('b-modelinfo'); if (e) e.textContent = '· đang gọi: ' + r.model; }
    return r.text;
  }

  async function chapter(ch, cfg, ctx, signal) {
    const out = new Array(ch.pages.length).fill('');
    let cur = 0, stop = null;
    async function worker() {
      while (!stop) {
        if (signal.aborted) return;
        const i = cur++; if (i >= ch.pages.length) return;
        try { out[i] = await page(ch.pages[i], i, cfg, ctx, signal); S.fails = 0; }
        catch (e) {
          const m = String(e.message || e);
          if (m.includes('dừng')) return;
          out[i] = `[LỖI] ${m}`; log(`Trang ${i + 1}: ${m}`, 'bad');
          if (++S.fails >= 3 || /Không còn API key|\(404\)|Key không hợp lệ/.test(m)) { stop = new Error(m); return; }
        }
        S.done++; setProg(S.total ? (S.done / S.total) * 100 : 0);
        setStatus(`${ch.name} · ${Math.min(S.done, S.total)}/${S.total} trang`);
        if (cfg.delay) await sleep(cfg.delay);
      }
    }
    await Promise.all(Array.from({ length: Math.min(cfg.conc, ch.pages.length) }, worker));
    const text = `===== ${ch.name} =====\n` + ch.pages.map((p, i) =>
      `\n--- Trang ${String(i + 1).padStart(3, '0')} · ${p.name} ---\n${out[i] || '[CHƯA DỊCH]'}`).join('\n') + '\n';
    if (stop) throw Object.assign(stop, { partial: text });
    return text;
  }

  async function start() {
    if (S.running) return;
    const sel = S.chapters.filter(c => c.sel);
    if (!sel.length) { alert('Chưa chọn chương nào.'); return; }
    if (!VB.keys.load().length) { alert('Chưa có API key. Bấm 🔑 trên thanh điều hướng.'); return; }
    const cfg = readCfg(); saveCfg();
    const ctx = cfg.useCtx ? VB.ctx.get() : '';

    try { await VB.models.discover(); } catch (e) { log('Không dò được model: ' + e.message, 'warn'); }

    S.running = true; S.abort = new AbortController(); S.done = 0; S.fails = 0; S.used = '';
    S.total = sel.reduce((s, c) => s + c.pages.length, 0);
    $('b-start').disabled = true; $('b-stop').disabled = false; setProg(0);
    log(`Bắt đầu ${sel.length} chương · ${S.total} trang · model ${cfg.model}`);

    let fatal = null;
    for (const ch of sel) {
      if (S.abort.signal.aborted || fatal) break;
      ch.status = 'run'; ch.err = ''; renderList();
      try { ch.result = await chapter(ch, cfg, ctx, S.abort.signal); ch.status = S.abort.signal.aborted ? 'idle' : 'done'; }
      catch (e) { ch.result = e.partial || ch.result; ch.status = 'err'; ch.err = e.message; fatal = e; }
      renderList(); renderResults();
    }

    S.running = false;
    $('b-start').disabled = false; $('b-stop').disabled = true;
    if (fatal) {
      setStatus('Dừng vì lỗi: ' + fatal.message);
      log('DỪNG SỚM — ' + fatal.message, 'bad');
      alert('Đã dừng vì lỗi lặp lại:\n\n' + fatal.message + '\n\nBấm 🔑 → Kiểm tra key để xem key nào sống và model nào gọi được.');
    } else {
      setProg(100);
      setStatus(S.abort.signal.aborted ? 'Đã dừng.' : `Hoàn tất ${sel.length} chương · ${S.total} trang.`);
    }
  }

  async function zipAll() {
    const done = S.chapters.filter(c => c.result);
    if (!done.length) { alert('Chưa có kết quả.'); return; }
    const z = new JSZip(), used = new Set();
    done.forEach(c => { let n = VB.file.safeName(c.name), i = 2; while (used.has(n)) n = VB.file.safeName(c.name) + ' (' + i++ + ')'; used.add(n); z.file(n + '.txt', c.result); });
    setStatus('Đang nén…');
    VB.file.download(await z.generateAsync({ type: 'blob' }), 'visionbox-ban-dich.zip');
    setStatus(`Đã tải ${done.length} chương.`);
  }

  /* ------------------------------------------------------------- sự kiện */
  function bind() {
    $('b-zip').onchange = async e => { for (const f of Array.from(e.target.files || [])) { try { await addZip(f); } catch (x) { setStatus('Lỗi zip: ' + x.message); } } e.target.value = ''; };
    const d = $('b-drop');
    ['dragenter', 'dragover'].forEach(t => d.addEventListener(t, e => { e.preventDefault(); d.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(t => d.addEventListener(t, e => { e.preventDefault(); d.classList.remove('over'); }));
    d.addEventListener('drop', async e => { for (const f of Array.from(e.dataTransfer.files || [])) if (/\.zip$/i.test(f.name)) { try { await addZip(f); } catch (x) { setStatus('Lỗi zip: ' + x.message); } } });

    $('b-all').onclick = () => { S.chapters.forEach(c => c.sel = true); renderList(); };
    $('b-none').onclick = () => { S.chapters.forEach(c => c.sel = false); renderList(); };
    $('b-invert').onclick = () => { S.chapters.forEach(c => c.sel = !c.sel); renderList(); };
    $('b-filter').oninput = renderList;
    $('b-start').onclick = start;
    $('b-stop').onclick = () => { if (S.abort) S.abort.abort(); setStatus('Đang dừng…'); };
    $('b-zipall').onclick = zipAll;
    $('b-copyall').onclick = () => {
      const t = S.chapters.filter(c => c.result).map(c => c.result).join('\n\n');
      if (!t) { alert('Chưa có kết quả.'); return; } VB.file.copy(t);
    };
    $('b-refresh-models').onclick = async () => {
      VB.models.dead.clear(); log('Đang nạp lại danh sách model…');
      log(await VB.models.fill($('b-model'), { force: true }), 'ok');
    };
    $('b-test').onclick = async () => {
      $('b-log-open').open = true; VB.keys.reset(); VB.models.dead.clear();
      $('b-log').innerHTML = '';
      await VB.gemini.selfTest((m, c) => log(m, c));
      await VB.models.fill($('b-model'), { force: true });
    };
    ['b-model', 'b-type', 'b-src', 'b-dst', 'b-conc', 'b-delay', 'b-width', 'b-skipsfx', 'b-style', 'b-slice', 'b-bi', 'b-ctx']
      .forEach(id => { const e = $(id); if (e) e.addEventListener('change', saveCfg); });
    window.addEventListener('vbs:ctx', refreshCtx);
    window.addEventListener('beforeunload', e => { if (S.running) { e.preventDefault(); e.returnValue = ''; } });
  }

  loadCfg(); bind(); renderList(); renderResults(); refreshCtx();
})();
