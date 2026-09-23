/* =============================================================================
 * vb-batch.js — VisionBox Studio · Tab "Dịch hàng loạt"
 * Phụ thuộc: jszip.min.js (bắt buộc), vb-core.js (tuỳ chọn), style-guide.js (tuỳ chọn)
 * Mọi thứ lấy từ VB đều có fallback nội bộ => chạy độc lập được.
 * ========================================================================== */
(function () {
  'use strict';

  if (!document.getElementById('b-list')) return; // không ở trang studio thì thôi

  const VB = (window.VB = window.VB || {});
  const $ = (id) => document.getElementById(id);
  const CFG_KEY = 'visionbox_batch_cfg_v1';
  const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
  const IMG_RE = /\.(jpe?g|png|webp|bmp|gif|avif|tiff?)$/i;
  const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

  /* ---------------------------------------------------------------- state */
  const S = {
    chapters: [],      // {id,name,pages:[{name,blob}],sel,status,result,err}
    running: false,
    abort: null,
    done: 0,
    total: 0,
    zipNames: []
  };

  /* ============================== 1. API KEYS ============================== */
  const cooldown = new Map();          // key -> timestamp hết phạt

  function readKeys() {
    // ưu tiên kho key của vb-core / vb-ui (tab ⚙ Nâng cao → API Keys)
    const src = [
      () => VB.keys && typeof VB.keys.list === 'function' && VB.keys.list(),
      () => VB.keys && Array.isArray(VB.keys.all) && VB.keys.all,
      () => typeof VB.getKeys === 'function' && VB.getKeys()
    ];
    for (const f of src) {
      try { const k = f(); if (Array.isArray(k) && k.length) return k.filter(Boolean); } catch (_) {}
    }
    const LS = ['visionbox_api_keys', 'vb_api_keys', 'visionbox_keys'];
    for (const name of LS) {
      try {
        const raw = localStorage.getItem(name);
        if (!raw) continue;
        const v = JSON.parse(raw);
        if (Array.isArray(v)) { const k = v.map(x => (typeof x === 'string' ? x : x && x.key)).filter(Boolean); if (k.length) return k; }
      } catch (_) {}
    }
    for (const name of ['visionbox_api_key', 'gemini_api_key', 'apiKey']) {
      try { const s = localStorage.getItem(name); if (s && s.trim()) return [s.trim()]; } catch (_) {}
    }
    return [];
  }

  function pickKey() {
    const keys = readKeys();
    if (!keys.length) return null;
    const now = Date.now();
    const free = keys.filter(k => !cooldown.get(k) || cooldown.get(k) < now);
    const pool = free.length ? free : keys;
    const i = (pickKey._i = ((pickKey._i || 0) + 1)) % pool.length;
    return pool[i];
  }

  function penalize(key, ms) {
    cooldown.set(key, Date.now() + (ms || 45000));
    try { VB.keys && typeof VB.keys.penalize === 'function' && VB.keys.penalize(key, ms); } catch (_) {}
  }

  function refreshKeyInfo() {
    const n = readKeys().length;
    const el = $('b-keyinfo');
    if (el) el.textContent = n ? `· ${n} API key sẵn sàng` : '· chưa có API key — mở ⚙ Nâng cao → API Keys';
  }

  /* ============================== 2. NGỮ CẢNH ============================== */
  function getContext() {
    const src = [
      () => VB.context && typeof VB.context.get === 'function' && VB.context.get(),
      () => VB.context && typeof VB.context.current === 'string' && VB.context.current,
      () => typeof VB.getContext === 'function' && VB.getContext()
    ];
    for (const f of src) {
      try { const c = f(); if (c) return typeof c === 'string' ? c : (c.text || c.content || ''); } catch (_) {}
    }
    for (const name of ['visionbox_context_current', 'vb_context_current', 'visionbox_context']) {
      try {
        const raw = localStorage.getItem(name);
        if (!raw) continue;
        if (raw.trim().startsWith('{')) { const o = JSON.parse(raw); if (o && (o.text || o.content)) return o.text || o.content; }
        else if (raw.trim()) return raw;
      } catch (_) {}
    }
    return '';
  }

  function refreshCtxInfo() {
    const c = getContext();
    const el = $('b-ctxinfo');
    if (!el) return;
    el.textContent = c
      ? `· ngữ cảnh hiện hành: ${c.length.toLocaleString('vi-VN')} ký tự`
      : '· chưa có ngữ cảnh — sang tab “Tạo ngữ cảnh” hoặc bỏ tick ô này';
  }

  function styleGuideText() {
    const g = window.STYLE_GUIDE || window.VB_STYLE_GUIDE || VB.styleGuide || window.styleGuide;
    if (!g) return '';
    if (typeof g === 'string') return g;
    return g.text || g.prompt || g.content || '';
  }

  /* ============================== 3. PROMPT ================================ */
  const LANG = { ja: 'tiếng Nhật', ko: 'tiếng Hàn', zh: 'tiếng Trung', en: 'tiếng Anh', vi: 'tiếng Việt' };

  function localPrompt(o) {
    const src = LANG[o.src] || o.src, dst = LANG[o.dst] || o.dst;
    const order = o.type === 'webtoon'
      ? 'Webtoon cuộn dọc: đọc TỪ TRÊN XUỐNG DƯỚI. Khi hai bóng thoại nằm ngang hàng nhau thì đọc trái → phải.'
      : 'Manga khung Nhật: đọc TỪ PHẢI SANG TRÁI, TỪ TRÊN XUỐNG DƯỚI. Trong một khung, bóng thoại bên phải luôn đọc trước bóng bên trái; bóng cao hơn đọc trước bóng thấp hơn.';

    const p = [];
    p.push(`Bạn là dịch giả truyện tranh chuyên nghiệp, dịch ${src} → ${dst}. Bạn ĐANG NHÌN THẤY trang truyện đính kèm, hãy dùng hình ảnh để hiểu bối cảnh chứ không chỉ đọc chữ.`);
    p.push('');
    p.push('QUY TẮC THỨ TỰ');
    p.push('1. ' + order);
    p.push('2. Bóng thoại phụ (đuôi nối tiếp cùng một người nói) gộp chung vào một mục, ngăn bằng dấu " — ".');
    p.push('3. Không bỏ sót bất kỳ chữ nào có trong trang: thoại, nội tâm, narration, chữ ngoài bóng, biển hiệu, tin nhắn điện thoại.');
    p.push('');
    p.push('QUY TẮC XƯNG HÔ (bắt buộc nhìn ảnh mới quyết định)');
    p.push('- Quan sát tuổi tác, trang phục, đồng phục, chức vụ, biểu cảm, khoảng cách cơ thể và vị thế của nhân vật trong khung để chọn cặp xưng hô tiếng Việt cho đúng.');
    p.push('- Giữ nhất quán cặp xưng hô giữa cùng hai nhân vật trong suốt trang; nếu quan hệ thay đổi (cãi nhau, thân mật hơn) mới được đổi và phải hợp lý.');
    p.push('- Hậu tố kính ngữ (-san, -kun, -senpai, 님…) không dịch máy móc mà chuyển thành xưng hô Việt tương đương.');
    p.push('- Nếu ảnh không đủ dữ kiện, chọn cặp trung tính và ghi chú ở cuối bằng dòng "[GHI CHÚ] ...".');
    p.push('');
    p.push('QUY TẮC VĂN PHONG');
    p.push('- Dịch thoát, giữ đúng sắc thái và nhịp truyện tranh; câu ngắn, tự nhiên như người Việt nói.');
    p.push('- Giữ nguyên tên riêng, tên chiêu thức theo bảng thuật ngữ nếu có trong phần NGỮ CẢNH.');
    p.push(o.skipSfx ? '- BỎ QUA hoàn toàn hiệu ứng âm thanh (SFX).' : '- Dịch cả SFX, đánh dấu [SFX].');
    if (o.style) { const sg = styleGuideText(); if (sg) { p.push(''); p.push('ELEMENTS OF STYLE'); p.push(sg.slice(0, 4000)); } }
    if (o.context) { p.push(''); p.push('===== NGỮ CẢNH TÁC PHẨM (ưu tiên tuyệt đối) ====='); p.push(o.context.slice(0, 20000)); p.push('===== HẾT NGỮ CẢNH ====='); }
    if (o.sliced) { p.push(''); p.push(`LƯU Ý: trang này được cắt thành ${o.sliceCount} mảnh theo chiều dọc, bạn đang xem lần lượt các mảnh của CÙNG một trang. Hãy đọc liền mạch, không lặp lại phần chồng lấn giữa hai mảnh.`); }
    p.push('');
    p.push('ĐỊNH DẠNG ĐẦU RA — chỉ xuất danh sách, không thêm lời dẫn, không markdown:');
    if (o.bilingual) {
      p.push('1. [LOẠI][Tên nhân vật hoặc "?"]');
      p.push('   > nguyên văn');
      p.push('   bản dịch');
    } else {
      p.push('1. [LOẠI][Tên nhân vật hoặc "?"] bản dịch');
    }
    p.push('LOẠI ∈ {THOẠI, NỘI TÂM, NARRATION, CHỮ NỀN' + (o.skipSfx ? '' : ', SFX') + '}.');
    p.push('Nếu trang không có chữ nào, xuất đúng một dòng: [TRANG TRỐNG]');
    return p.join('\n');
  }

  function buildPrompt(o) {
    const cands = [
      VB.buildTranslatePrompt, VB.buildTranslationPrompt,
      VB.prompts && VB.prompts.translate, VB.prompt && VB.prompt.translate
    ];
    for (const f of cands) {
      if (typeof f === 'function') {
        try { const s = f(o); if (s && typeof s === 'string' && s.length > 80) return s; } catch (_) {}
      }
    }
    return localPrompt(o);
  }

  /* ============================== 4. ẢNH =================================== */
  async function loadBitmap(blob) {
    if (window.createImageBitmap) { try { return await createImageBitmap(blob); } catch (_) {} }
    return await new Promise((res, rej) => {
      const url = URL.createObjectURL(blob), im = new Image();
      im.onload = () => { URL.revokeObjectURL(url); res(im); };
      im.onerror = () => { URL.revokeObjectURL(url); rej(new Error('không giải mã được ảnh')); };
      im.src = url;
    });
  }

  function canvasToB64(cv) {
    const url = cv.toDataURL('image/jpeg', 0.86);
    return url.slice(url.indexOf(',') + 1);
  }

  // trả về mảng base64 (1 phần tử nếu không cắt)
  async function imageToParts(blob, maxW, allowSlice) {
    const bmp = await loadBitmap(blob);
    const ow = bmp.width || bmp.naturalWidth, oh = bmp.height || bmp.naturalHeight;
    const scale = ow > maxW ? maxW / ow : 1;
    const w = Math.max(1, Math.round(ow * scale)), h = Math.max(1, Math.round(oh * scale));

    const needSlice = allowSlice && h > w * 2.6;
    if (!needSlice) {
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      cv.getContext('2d').drawImage(bmp, 0, 0, w, h);
      if (bmp.close) bmp.close();
      return [canvasToB64(cv)];
    }
    const sliceH = Math.round(w * 1.7), ov = Math.round(sliceH * 0.08);
    const out = [];
    for (let y = 0; y < h; y += sliceH - ov) {
      const hh = Math.min(sliceH, h - y);
      if (hh < 40 && out.length) break;
      const cv = document.createElement('canvas'); cv.width = w; cv.height = hh;
      cv.getContext('2d').drawImage(bmp, 0, y / scale, ow, hh / scale, 0, 0, w, hh);
      out.push(canvasToB64(cv));
      if (y + hh >= h) break;
    }
    if (bmp.close) bmp.close();
    return out;
  }

  /* ============================== 5. GỌI API =============================== */
  async function callModel(model, parts, signal) {
    const keys = readKeys();
    if (!keys.length) throw new Error('Chưa cấu hình API key.');
    let lastErr = null;
    const tries = Math.min(6, Math.max(3, keys.length + 1));

    for (let t = 0; t < tries; t++) {
      if (signal && signal.aborted) throw new Error('Đã dừng');
      const key = pickKey();
      if (!key) throw new Error('Không còn API key khả dụng.');
      try {
        const res = await fetch(`${API_BASE}/${encodeURIComponent(model)}:generateContent`, {
          method: 'POST',
          signal,
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify({
            contents: [{ role: 'user', parts }],
            generationConfig: { temperature: 0.35, topP: 0.95, maxOutputTokens: 8192 },
            safetySettings: ['HARM_CATEGORY_HARASSMENT', 'HARM_CATEGORY_HATE_SPEECH',
              'HARM_CATEGORY_SEXUALLY_EXPLICIT', 'HARM_CATEGORY_DANGEROUS_CONTENT']
              .map(c => ({ category: c, threshold: 'BLOCK_NONE' }))
          })
        });

        if (res.status === 429 || res.status === 503) {
          penalize(key, res.status === 429 ? 60000 : 20000);
          lastErr = new Error(`HTTP ${res.status} (quota/quá tải) — đổi key`);
          await sleep(800 + t * 600);
          continue;
        }
        if (res.status === 400 || res.status === 403) {
          penalize(key, 10 * 60000);
          lastErr = new Error(`HTTP ${res.status} — key không hợp lệ hoặc bị từ chối`);
          continue;
        }
        if (!res.ok) { lastErr = new Error('HTTP ' + res.status); await sleep(600); continue; }

        const data = await res.json();
        const cand = data && data.candidates && data.candidates[0];
        const txt = cand && cand.content && Array.isArray(cand.content.parts)
          ? cand.content.parts.map(p => p.text || '').join('').trim() : '';
        if (!txt) {
          const why = (data && data.promptFeedback && data.promptFeedback.blockReason) || (cand && cand.finishReason) || 'rỗng';
          throw new Error('Model không trả nội dung (' + why + ')');
        }
        return txt;
      } catch (e) {
        if (e.name === 'AbortError') throw new Error('Đã dừng');
        lastErr = e;
        await sleep(500 + t * 400);
      }
    }
    throw lastErr || new Error('Gọi API thất bại');
  }

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  /* ============================== 6. NẠP ZIP =============================== */
  function chapterOf(path) {
    const parts = path.split('/').filter(Boolean);
    return parts.length <= 1 ? '(gốc)' : parts.slice(0, -1).join(' / ');
  }

  async function addZip(file) {
    if (typeof JSZip === 'undefined') { alert('Thiếu jszip.min.js'); return; }
    setStatus(`Đang đọc ${file.name}…`);
    const zip = await JSZip.loadAsync(file);
    const map = new Map();
    const entries = Object.keys(zip.files).sort(coll.compare);

    for (const path of entries) {
      const ent = zip.files[path];
      if (ent.dir) continue;
      const base = path.split('/').pop();
      if (!base || base.startsWith('.') || path.includes('__MACOSX')) continue;
      if (!IMG_RE.test(base)) continue;
      const ch = chapterOf(path);
      if (!map.has(ch)) map.set(ch, []);
      map.get(ch).push({ name: base, entry: ent });
    }
    if (!map.size) { setStatus(`${file.name}: không tìm thấy ảnh nào.`); return; }

    S.zipNames.push(file.name);
    const multi = S.zipNames.length > 1;
    const zipLabel = file.name.replace(/\.zip$/i, '');

    for (const [ch, list] of map) {
      list.sort((a, b) => coll.compare(a.name, b.name));
      const pages = [];
      for (const it of list) pages.push({ name: it.name, blob: await it.entry.async('blob') });
      S.chapters.push({
        id: 'c' + Math.random().toString(36).slice(2, 9),
        name: multi ? `${zipLabel} / ${ch}` : ch,
        pages, sel: true, status: 'idle', result: '', err: ''
      });
    }
    S.chapters.sort((a, b) => coll.compare(a.name, b.name));
    renderList();
    const totalPages = S.chapters.reduce((s, c) => s + c.pages.length, 0);
    $('b-zipinfo').textContent = `Đã nạp ${S.zipNames.length} file zip · ${S.chapters.length} chương · ${totalPages} trang.`;
    setStatus('Sẵn sàng dịch.');
  }

  /* ============================== 7. UI LIST =============================== */
  function renderList() {
    const box = $('b-list');
    const kw = ($('b-filter').value || '').trim().toLowerCase();
    box.innerHTML = '';
    if (!S.chapters.length) { box.innerHTML = '<p class="vb-hint">Chưa nạp chương nào.</p>'; return; }

    S.chapters.forEach(c => {
      if (kw && !c.name.toLowerCase().includes(kw)) return;
      const row = document.createElement('label');
      row.className = 'vb-chapter' + (c.status === 'run' ? ' is-run' : c.status === 'done' ? ' is-done' : c.status === 'err' ? ' is-err' : '');
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.checked = c.sel;
      cb.addEventListener('change', () => { c.sel = cb.checked; updateCounts(); });
      const nm = document.createElement('span'); nm.className = 'vb-chapter-name'; nm.textContent = c.name;
      const meta = document.createElement('span'); meta.className = 'vb-hint';
      meta.textContent = `${c.pages.length} trang` +
        (c.status === 'done' ? ' · ✔ xong' : c.status === 'err' ? ' · ✘ ' + c.err : c.status === 'run' ? ' · đang dịch…' : '');
      row.append(cb, nm, meta);
      box.appendChild(row);
    });
    updateCounts();
  }

  function updateCounts() {
    const sel = S.chapters.filter(c => c.sel);
    const pages = sel.reduce((s, c) => s + c.pages.length, 0);
    if (!S.running) setStatus(sel.length ? `Đã chọn ${sel.length} chương · ${pages} trang.` : 'Chưa chọn chương nào.');
  }

  function setStatus(t) { const el = $('b-status'); if (el) el.textContent = t; }
  function setProgress(p) { const el = $('b-progress'); if (el) el.style.width = Math.max(0, Math.min(100, p)) + '%'; }

  function renderResults() {
    const box = $('b-results');
    box.innerHTML = '';
    const done = S.chapters.filter(c => c.result);
    if (!done.length) { box.innerHTML = '<p class="vb-hint">Chưa có kết quả.</p>'; return; }
    done.forEach(c => {
      const card = document.createElement('div');
      card.className = 'vb-result';
      const head = document.createElement('div');
      head.className = 'vb-row';
      const h = document.createElement('b'); h.textContent = c.name;
      const sp = document.createElement('span'); sp.className = 'vb-spacer';
      const mk = (label, fn) => { const b = document.createElement('button'); b.className = 'vb-btn'; b.textContent = label; b.onclick = fn; return b; };
      head.append(h, sp,
        mk('Copy', () => copy(ta.value)),
        mk('⬇ .txt', () => saveFile(ta.value, 'txt', safeName(c.name))),
        mk('⬇ .docx', () => saveFile(ta.value, 'docx', safeName(c.name))));
      const ta = document.createElement('textarea');
      ta.rows = 12; ta.value = c.result;
      ta.addEventListener('input', () => { c.result = ta.value; });
      card.append(head, ta);
      box.appendChild(card);
    });
  }

  /* ============================== 8. DỊCH ================================== */
  function readCfg() {
    return {
      model: $('b-model').value,
      type: $('b-type').value,
      src: $('b-src').value,
      dst: $('b-dst').value,
      conc: Math.max(1, parseInt($('b-conc').value, 10) || 1),
      delay: Math.max(0, parseInt($('b-delay').value, 10) || 0),
      width: Math.max(600, parseInt($('b-width').value, 10) || 1400),
      skipSfx: $('b-skipsfx').checked,
      style: $('b-style').checked,
      slice: $('b-slice').checked,
      bilingual: $('b-bi').checked,
      useCtx: $('b-ctx').checked
    };
  }

  function saveCfg() { try { localStorage.setItem(CFG_KEY, JSON.stringify(readCfg())); } catch (_) {} }

  function loadCfg() {
    try {
      const c = JSON.parse(localStorage.getItem(CFG_KEY) || '{}');
      const set = (id, v) => { const el = $(id); if (el && v !== undefined && v !== null) { if (el.type === 'checkbox') el.checked = !!v; else el.value = v; } };
      set('b-model', c.model); set('b-type', c.type); set('b-src', c.src); set('b-dst', c.dst);
      set('b-conc', c.conc); set('b-delay', c.delay); set('b-width', c.width);
      set('b-skipsfx', c.skipSfx); set('b-style', c.style); set('b-slice', c.slice);
      set('b-bi', c.bilingual); set('b-ctx', c.useCtx);
    } catch (_) {}
  }

  async function translatePage(page, idx, cfg, ctx, signal) {
    const imgs = await imageToParts(page.blob, cfg.width, cfg.slice);
    const prompt = buildPrompt({
      src: cfg.src, dst: cfg.dst, type: cfg.type, skipSfx: cfg.skipSfx,
      style: cfg.style, bilingual: cfg.bilingual, context: ctx,
      sliced: imgs.length > 1, sliceCount: imgs.length,
      pageName: page.name, pageIndex: idx + 1
    });
    const parts = [{ text: prompt }];
    imgs.forEach(b64 => parts.push({ inline_data: { mime_type: 'image/jpeg', data: b64 } }));
    return await callModel(cfg.model, parts, signal);
  }

  async function runChapter(ch, cfg, ctx, signal) {
    const out = new Array(ch.pages.length).fill('');
    let cursor = 0;

    async function worker() {
      while (true) {
        if (signal.aborted) return;
        const i = cursor++;
        if (i >= ch.pages.length) return;
        const page = ch.pages[i];
        try {
          out[i] = await translatePage(page, i, cfg, ctx, signal);
        } catch (e) {
          if (String(e.message).includes('dừng')) return;
          out[i] = `[LỖI] ${e.message}`;
        }
        S.done++;
        setProgress(S.total ? (S.done / S.total) * 100 : 0);
        setStatus(`${ch.name} · trang ${Math.min(S.done, S.total)}/${S.total}`);
        if (cfg.delay) await sleep(cfg.delay);
      }
    }

    const n = Math.min(cfg.conc, ch.pages.length);
    await Promise.all(Array.from({ length: n }, worker));

    const head = `===== ${ch.name} =====\n`;
    const body = ch.pages.map((p, i) =>
      `\n--- Trang ${String(i + 1).padStart(3, '0')} · ${p.name} ---\n${out[i] || '[TRỐNG]'}`).join('\n');
    return head + body + '\n';
  }

  async function start() {
    if (S.running) return;
    const sel = S.chapters.filter(c => c.sel);
    if (!sel.length) { alert('Chưa chọn chương nào.'); return; }
    if (!readKeys().length) { alert('Chưa có API key. Mở ⚙ Nâng cao → API Keys để thêm (mỗi dòng một key hoặc import file .txt).'); return; }

    const cfg = readCfg();
    saveCfg();
    const ctx = cfg.useCtx ? getContext() : '';

    S.running = true; S.abort = new AbortController();
    S.done = 0; S.total = sel.reduce((s, c) => s + c.pages.length, 0);
    $('b-start').disabled = true; $('b-stop').disabled = false;
    setProgress(0);

    for (const ch of sel) {
      if (S.abort.signal.aborted) break;
      ch.status = 'run'; ch.err = ''; renderList();
      try {
        ch.result = await runChapter(ch, cfg, ctx, S.abort.signal);
        ch.status = S.abort.signal.aborted ? 'idle' : 'done';
      } catch (e) {
        ch.status = 'err'; ch.err = e.message;
      }
      renderList(); renderResults();
    }

    S.running = false;
    $('b-start').disabled = false; $('b-stop').disabled = true;
    setStatus(S.abort.signal.aborted ? 'Đã dừng theo yêu cầu.' : `Hoàn tất ${sel.length} chương · ${S.total} trang.`);
    setProgress(100);
  }

  /* ============================== 9. XUẤT FILE ============================= */
  const safeName = (s) => String(s).replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120) || 'chuong';

  function download(blob, filename) {
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const XMLH = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

  async function docxBlob(text) {
    if (typeof JSZip === 'undefined') throw new Error('Thiếu JSZip');
    const paras = String(text).split(/\r\n|\r|\n/).map(l =>
      l.trim() === '' ? '<w:p/>' : `<w:p><w:r><w:t xml:space="preserve">${esc(l)}</w:t></w:r></w:p>`).join('');
    const zip = new JSZip();
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
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + paras +
      '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417"/></w:sectPr>' +
      '</w:body></w:document>');
    return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  }

  async function saveFile(text, format, name) {
    try {
      if (window.fileExport && typeof window.fileExport.save === 'function') {
        const ok = await window.fileExport.save(text, format, name);
        if (ok) return;
      }
      if (format === 'docx') { download(await docxBlob(text), name + '.docx'); return; }
      download(new Blob([text], { type: 'text/plain;charset=utf-8' }), name + '.' + (format || 'txt'));
    } catch (e) { alert('Không lưu được file: ' + e.message); }
  }

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); flash('Đã copy.'); }
    catch (_) {
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta);
      ta.select(); document.execCommand('copy'); ta.remove(); flash('Đã copy.');
    }
  }

  function flash(msg) { const old = $('b-status').textContent; setStatus(msg); setTimeout(() => setStatus(old), 1500); }

  async function zipAll() {
    const done = S.chapters.filter(c => c.result);
    if (!done.length) { alert('Chưa có kết quả nào để tải.'); return; }
    const zip = new JSZip();
    const used = new Set();
    done.forEach(c => {
      let n = safeName(c.name), i = 2;
      while (used.has(n)) n = safeName(c.name) + ' (' + i++ + ')';
      used.add(n);
      zip.file(n + '.txt', c.result);
    });
    setStatus('Đang nén…');
    download(await zip.generateAsync({ type: 'blob' }), 'visionbox-ban-dich.zip');
    setStatus(`Đã tải ${done.length} chương.`);
  }

  /* ============================== 10. SỰ KIỆN ============================== */
  function bind() {
    $('b-zip').addEventListener('change', async (e) => {
      for (const f of Array.from(e.target.files || [])) { try { await addZip(f); } catch (err) { setStatus('Lỗi đọc zip: ' + err.message); } }
      e.target.value = '';
    });

    const drop = $('b-drop');
    ['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('is-over'); }));
    ['dragleave', 'drop'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove('is-over'); }));
    drop.addEventListener('drop', async (e) => {
      for (const f of Array.from(e.dataTransfer.files || [])) {
        if (/\.zip$/i.test(f.name)) { try { await addZip(f); } catch (err) { setStatus('Lỗi đọc zip: ' + err.message); } }
      }
    });

    $('b-all').onclick = () => { S.chapters.forEach(c => c.sel = true); renderList(); };
    $('b-none').onclick = () => { S.chapters.forEach(c => c.sel = false); renderList(); };
    $('b-invert').onclick = () => { S.chapters.forEach(c => c.sel = !c.sel); renderList(); };
    $('b-filter').addEventListener('input', renderList);
    $('b-start').onclick = start;
    $('b-stop').onclick = () => { if (S.abort) S.abort.abort(); setStatus('Đang dừng…'); };
    $('b-zipall').onclick = zipAll;
    $('b-copyall').onclick = () => {
      const t = S.chapters.filter(c => c.result).map(c => c.result).join('\n\n');
      if (!t) { alert('Chưa có kết quả.'); return; }
      copy(t);
    };
    ['b-model', 'b-type', 'b-src', 'b-dst', 'b-conc', 'b-delay', 'b-width',
      'b-skipsfx', 'b-style', 'b-slice', 'b-bi', 'b-ctx'].forEach(id => {
        const el = $(id); if (el) el.addEventListener('change', saveCfg);
      });
    $('b-ctx').addEventListener('change', refreshCtxInfo);

    window.addEventListener('vb:keys-changed', refreshKeyInfo);
    window.addEventListener('vb:context-changed', refreshCtxInfo);
    window.addEventListener('beforeunload', (e) => { if (S.running) { e.preventDefault(); e.returnValue = ''; } });
    setInterval(() => { refreshKeyInfo(); refreshCtxInfo(); }, 2500);
  }

  loadCfg();
  bind();
  renderList();
  renderResults();
  refreshKeyInfo();
  refreshCtxInfo();

  VB.batch = { state: S, start, stop: () => S.abort && S.abort.abort(), addZip, getContext, readKeys };
})();
/* =============================================================================
 * vb-batch.js — VisionBox Studio · Tab "Dịch hàng loạt"
 * Phụ thuộc: jszip.min.js (bắt buộc), vb-core.js (tuỳ chọn), style-guide.js (tuỳ chọn)
 * Mọi thứ lấy từ VB đều có fallback nội bộ => chạy độc lập được.
 * ========================================================================== */
(function () {
  'use strict';

  if (!document.getElementById('b-list')) return; // không ở trang studio thì thôi

  const VB = (window.VB = window.VB || {});
  const $ = (id) => document.getElementById(id);
  const CFG_KEY = 'visionbox_batch_cfg_v1';
  const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
  const IMG_RE = /\.(jpe?g|png|webp|bmp|gif|avif|tiff?)$/i;
  const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

  /* ---------------------------------------------------------------- state */
  const S = {
    chapters: [],      // {id,name,pages:[{name,blob}],sel,status,result,err}
    running: false,
    abort: null,
    done: 0,
    total: 0,
    zipNames: []
  };

  /* ============================== 1. API KEYS ============================== */
  const cooldown = new Map();          // key -> timestamp hết phạt

  function readKeys() {
    // ưu tiên kho key của vb-core / vb-ui (tab ⚙ Nâng cao → API Keys)
    const src = [
      () => VB.keys && typeof VB.keys.list === 'function' && VB.keys.list(),
      () => VB.keys && Array.isArray(VB.keys.all) && VB.keys.all,
      () => typeof VB.getKeys === 'function' && VB.getKeys()
    ];
    for (const f of src) {
      try { const k = f(); if (Array.isArray(k) && k.length) return k.filter(Boolean); } catch (_) {}
    }
    const LS = ['visionbox_api_keys', 'vb_api_keys', 'visionbox_keys'];
    for (const name of LS) {
      try {
        const raw = localStorage.getItem(name);
        if (!raw) continue;
        const v = JSON.parse(raw);
        if (Array.isArray(v)) { const k = v.map(x => (typeof x === 'string' ? x : x && x.key)).filter(Boolean); if (k.length) return k; }
      } catch (_) {}
    }
    for (const name of ['visionbox_api_key', 'gemini_api_key', 'apiKey']) {
      try { const s = localStorage.getItem(name); if (s && s.trim()) return [s.trim()]; } catch (_) {}
    }
    return [];
  }

  function pickKey() {
    const keys = readKeys();
    if (!keys.length) return null;
    const now = Date.now();
    const free = keys.filter(k => !cooldown.get(k) || cooldown.get(k) < now);
    const pool = free.length ? free : keys;
    const i = (pickKey._i = ((pickKey._i || 0) + 1)) % pool.length;
    return pool[i];
  }

  function penalize(key, ms) {
    cooldown.set(key, Date.now() + (ms || 45000));
    try { VB.keys && typeof VB.keys.penalize === 'function' && VB.keys.penalize(key, ms); } catch (_) {}
  }

  function refreshKeyInfo() {
    const n = readKeys().length;
    const el = $('b-keyinfo');
    if (el) el.textContent = n ? `· ${n} API key sẵn sàng` : '· chưa có API key — mở ⚙ Nâng cao → API Keys';
  }

  /* ============================== 2. NGỮ CẢNH ============================== */
  function getContext() {
    const src = [
      () => VB.context && typeof VB.context.get === 'function' && VB.context.get(),
      () => VB.context && typeof VB.context.current === 'string' && VB.context.current,
      () => typeof VB.getContext === 'function' && VB.getContext()
    ];
    for (const f of src) {
      try { const c = f(); if (c) return typeof c === 'string' ? c : (c.text || c.content || ''); } catch (_) {}
    }
    for (const name of ['visionbox_context_current', 'vb_context_current', 'visionbox_context']) {
      try {
        const raw = localStorage.getItem(name);
        if (!raw) continue;
        if (raw.trim().startsWith('{')) { const o = JSON.parse(raw); if (o && (o.text || o.content)) return o.text || o.content; }
        else if (raw.trim()) return raw;
      } catch (_) {}
    }
    return '';
  }

  function refreshCtxInfo() {
    const c = getContext();
    const el = $('b-ctxinfo');
    if (!el) return;
    el.textContent = c
      ? `· ngữ cảnh hiện hành: ${c.length.toLocaleString('vi-VN')} ký tự`
      : '· chưa có ngữ cảnh — sang tab “Tạo ngữ cảnh” hoặc bỏ tick ô này';
  }

  function styleGuideText() {
    const g = window.STYLE_GUIDE || window.VB_STYLE_GUIDE || VB.styleGuide || window.styleGuide;
    if (!g) return '';
    if (typeof g === 'string') return g;
    return g.text || g.prompt || g.content || '';
  }

  /* ============================== 3. PROMPT ================================ */
  const LANG = { ja: 'tiếng Nhật', ko: 'tiếng Hàn', zh: 'tiếng Trung', en: 'tiếng Anh', vi: 'tiếng Việt' };

  function localPrompt(o) {
    const src = LANG[o.src] || o.src, dst = LANG[o.dst] || o.dst;
    const order = o.type === 'webtoon'
      ? 'Webtoon cuộn dọc: đọc TỪ TRÊN XUỐNG DƯỚI. Khi hai bóng thoại nằm ngang hàng nhau thì đọc trái → phải.'
      : 'Manga khung Nhật: đọc TỪ PHẢI SANG TRÁI, TỪ TRÊN XUỐNG DƯỚI. Trong một khung, bóng thoại bên phải luôn đọc trước bóng bên trái; bóng cao hơn đọc trước bóng thấp hơn.';

    const p = [];
    p.push(`Bạn là dịch giả truyện tranh chuyên nghiệp, dịch ${src} → ${dst}. Bạn ĐANG NHÌN THẤY trang truyện đính kèm, hãy dùng hình ảnh để hiểu bối cảnh chứ không chỉ đọc chữ.`);
    p.push('');
    p.push('QUY TẮC THỨ TỰ');
    p.push('1. ' + order);
    p.push('2. Bóng thoại phụ (đuôi nối tiếp cùng một người nói) gộp chung vào một mục, ngăn bằng dấu " — ".');
    p.push('3. Không bỏ sót bất kỳ chữ nào có trong trang: thoại, nội tâm, narration, chữ ngoài bóng, biển hiệu, tin nhắn điện thoại.');
    p.push('');
    p.push('QUY TẮC XƯNG HÔ (bắt buộc nhìn ảnh mới quyết định)');
    p.push('- Quan sát tuổi tác, trang phục, đồng phục, chức vụ, biểu cảm, khoảng cách cơ thể và vị thế của nhân vật trong khung để chọn cặp xưng hô tiếng Việt cho đúng.');
    p.push('- Giữ nhất quán cặp xưng hô giữa cùng hai nhân vật trong suốt trang; nếu quan hệ thay đổi (cãi nhau, thân mật hơn) mới được đổi và phải hợp lý.');
    p.push('- Hậu tố kính ngữ (-san, -kun, -senpai, 님…) không dịch máy móc mà chuyển thành xưng hô Việt tương đương.');
    p.push('- Nếu ảnh không đủ dữ kiện, chọn cặp trung tính và ghi chú ở cuối bằng dòng "[GHI CHÚ] ...".');
    p.push('');
    p.push('QUY TẮC VĂN PHONG');
    p.push('- Dịch thoát, giữ đúng sắc thái và nhịp truyện tranh; câu ngắn, tự nhiên như người Việt nói.');
    p.push('- Giữ nguyên tên riêng, tên chiêu thức theo bảng thuật ngữ nếu có trong phần NGỮ CẢNH.');
    p.push(o.skipSfx ? '- BỎ QUA hoàn toàn hiệu ứng âm thanh (SFX).' : '- Dịch cả SFX, đánh dấu [SFX].');
    if (o.style) { const sg = styleGuideText(); if (sg) { p.push(''); p.push('ELEMENTS OF STYLE'); p.push(sg.slice(0, 4000)); } }
    if (o.context) { p.push(''); p.push('===== NGỮ CẢNH TÁC PHẨM (ưu tiên tuyệt đối) ====='); p.push(o.context.slice(0, 20000)); p.push('===== HẾT NGỮ CẢNH ====='); }
    if (o.sliced) { p.push(''); p.push(`LƯU Ý: trang này được cắt thành ${o.sliceCount} mảnh theo chiều dọc, bạn đang xem lần lượt các mảnh của CÙNG một trang. Hãy đọc liền mạch, không lặp lại phần chồng lấn giữa hai mảnh.`); }
    p.push('');
    p.push('ĐỊNH DẠNG ĐẦU RA — chỉ xuất danh sách, không thêm lời dẫn, không markdown:');
    if (o.bilingual) {
      p.push('1. [LOẠI][Tên nhân vật hoặc "?"]');
      p.push('   > nguyên văn');
      p.push('   bản dịch');
    } else {
      p.push('1. [LOẠI][Tên nhân vật hoặc "?"] bản dịch');
    }
    p.push('LOẠI ∈ {THOẠI, NỘI TÂM, NARRATION, CHỮ NỀN' + (o.skipSfx ? '' : ', SFX') + '}.');
    p.push('Nếu trang không có chữ nào, xuất đúng một dòng: [TRANG TRỐNG]');
    return p.join('\n');
  }

  function buildPrompt(o) {
    const cands = [
      VB.buildTranslatePrompt, VB.buildTranslationPrompt,
      VB.prompts && VB.prompts.translate, VB.prompt && VB.prompt.translate
    ];
    for (const f of cands) {
      if (typeof f === 'function') {
        try { const s = f(o); if (s && typeof s === 'string' && s.length > 80) return s; } catch (_) {}
      }
    }
    return localPrompt(o);
  }

  /* ============================== 4. ẢNH =================================== */
  async function loadBitmap(blob) {
    if (window.createImageBitmap) { try { return await createImageBitmap(blob); } catch (_) {} }
    return await new Promise((res, rej) => {
      const url = URL.createObjectURL(blob), im = new Image();
      im.onload = () => { URL.revokeObjectURL(url); res(im); };
      im.onerror = () => { URL.revokeObjectURL(url); rej(new Error('không giải mã được ảnh')); };
      im.src = url;
    });
  }

  function canvasToB64(cv) {
    const url = cv.toDataURL('image/jpeg', 0.86);
    return url.slice(url.indexOf(',') + 1);
  }

  // trả về mảng base64 (1 phần tử nếu không cắt)
  async function imageToParts(blob, maxW, allowSlice) {
    const bmp = await loadBitmap(blob);
    const ow = bmp.width || bmp.naturalWidth, oh = bmp.height || bmp.naturalHeight;
    const scale = ow > maxW ? maxW / ow : 1;
    const w = Math.max(1, Math.round(ow * scale)), h = Math.max(1, Math.round(oh * scale));

    const needSlice = allowSlice && h > w * 2.6;
    if (!needSlice) {
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      cv.getContext('2d').drawImage(bmp, 0, 0, w, h);
      if (bmp.close) bmp.close();
      return [canvasToB64(cv)];
    }
    const sliceH = Math.round(w * 1.7), ov = Math.round(sliceH * 0.08);
    const out = [];
    for (let y = 0; y < h; y += sliceH - ov) {
      const hh = Math.min(sliceH, h - y);
      if (hh < 40 && out.length) break;
      const cv = document.createElement('canvas'); cv.width = w; cv.height = hh;
      cv.getContext('2d').drawImage(bmp, 0, y / scale, ow, hh / scale, 0, 0, w, hh);
      out.push(canvasToB64(cv));
      if (y + hh >= h) break;
    }
    if (bmp.close) bmp.close();
    return out;
  }

  /* ============================== 5. GỌI API =============================== */
  async function callModel(model, parts, signal) {
    const keys = readKeys();
    if (!keys.length) throw new Error('Chưa cấu hình API key.');
    let lastErr = null;
    const tries = Math.min(6, Math.max(3, keys.length + 1));

    for (let t = 0; t < tries; t++) {
      if (signal && signal.aborted) throw new Error('Đã dừng');
      const key = pickKey();
      if (!key) throw new Error('Không còn API key khả dụng.');
      try {
        const res = await fetch(`${API_BASE}/${encodeURIComponent(model)}:generateContent`, {
          method: 'POST',
          signal,
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify({
            contents: [{ role: 'user', parts }],
            generationConfig: { temperature: 0.35, topP: 0.95, maxOutputTokens: 8192 },
            safetySettings: ['HARM_CATEGORY_HARASSMENT', 'HARM_CATEGORY_HATE_SPEECH',
              'HARM_CATEGORY_SEXUALLY_EXPLICIT', 'HARM_CATEGORY_DANGEROUS_CONTENT']
              .map(c => ({ category: c, threshold: 'BLOCK_NONE' }))
          })
        });

        if (res.status === 429 || res.status === 503) {
          penalize(key, res.status === 429 ? 60000 : 20000);
          lastErr = new Error(`HTTP ${res.status} (quota/quá tải) — đổi key`);
          await sleep(800 + t * 600);
          continue;
        }
        if (res.status === 400 || res.status === 403) {
          penalize(key, 10 * 60000);
          lastErr = new Error(`HTTP ${res.status} — key không hợp lệ hoặc bị từ chối`);
          continue;
        }
        if (!res.ok) { lastErr = new Error('HTTP ' + res.status); await sleep(600); continue; }

        const data = await res.json();
        const cand = data && data.candidates && data.candidates[0];
        const txt = cand && cand.content && Array.isArray(cand.content.parts)
          ? cand.content.parts.map(p => p.text || '').join('').trim() : '';
        if (!txt) {
          const why = (data && data.promptFeedback && data.promptFeedback.blockReason) || (cand && cand.finishReason) || 'rỗng';
          throw new Error('Model không trả nội dung (' + why + ')');
        }
        return txt;
      } catch (e) {
        if (e.name === 'AbortError') throw new Error('Đã dừng');
        lastErr = e;
        await sleep(500 + t * 400);
      }
    }
    throw lastErr || new Error('Gọi API thất bại');
  }

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  /* ============================== 6. NẠP ZIP =============================== */
  function chapterOf(path) {
    const parts = path.split('/').filter(Boolean);
    return parts.length <= 1 ? '(gốc)' : parts.slice(0, -1).join(' / ');
  }

  async function addZip(file) {
    if (typeof JSZip === 'undefined') { alert('Thiếu jszip.min.js'); return; }
    setStatus(`Đang đọc ${file.name}…`);
    const zip = await JSZip.loadAsync(file);
    const map = new Map();
    const entries = Object.keys(zip.files).sort(coll.compare);

    for (const path of entries) {
      const ent = zip.files[path];
      if (ent.dir) continue;
      const base = path.split('/').pop();
      if (!base || base.startsWith('.') || path.includes('__MACOSX')) continue;
      if (!IMG_RE.test(base)) continue;
      const ch = chapterOf(path);
      if (!map.has(ch)) map.set(ch, []);
      map.get(ch).push({ name: base, entry: ent });
    }
    if (!map.size) { setStatus(`${file.name}: không tìm thấy ảnh nào.`); return; }

    S.zipNames.push(file.name);
    const multi = S.zipNames.length > 1;
    const zipLabel = file.name.replace(/\.zip$/i, '');

    for (const [ch, list] of map) {
      list.sort((a, b) => coll.compare(a.name, b.name));
      const pages = [];
      for (const it of list) pages.push({ name: it.name, blob: await it.entry.async('blob') });
      S.chapters.push({
        id: 'c' + Math.random().toString(36).slice(2, 9),
        name: multi ? `${zipLabel} / ${ch}` : ch,
        pages, sel: true, status: 'idle', result: '', err: ''
      });
    }
    S.chapters.sort((a, b) => coll.compare(a.name, b.name));
    renderList();
    const totalPages = S.chapters.reduce((s, c) => s + c.pages.length, 0);
    $('b-zipinfo').textContent = `Đã nạp ${S.zipNames.length} file zip · ${S.chapters.length} chương · ${totalPages} trang.`;
    setStatus('Sẵn sàng dịch.');
  }

  /* ============================== 7. UI LIST =============================== */
  function renderList() {
    const box = $('b-list');
    const kw = ($('b-filter').value || '').trim().toLowerCase();
    box.innerHTML = '';
    if (!S.chapters.length) { box.innerHTML = '<p class="vb-hint">Chưa nạp chương nào.</p>'; return; }

    S.chapters.forEach(c => {
      if (kw && !c.name.toLowerCase().includes(kw)) return;
      const row = document.createElement('label');
      row.className = 'vb-chapter' + (c.status === 'run' ? ' is-run' : c.status === 'done' ? ' is-done' : c.status === 'err' ? ' is-err' : '');
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.checked = c.sel;
      cb.addEventListener('change', () => { c.sel = cb.checked; updateCounts(); });
      const nm = document.createElement('span'); nm.className = 'vb-chapter-name'; nm.textContent = c.name;
      const meta = document.createElement('span'); meta.className = 'vb-hint';
      meta.textContent = `${c.pages.length} trang` +
        (c.status === 'done' ? ' · ✔ xong' : c.status === 'err' ? ' · ✘ ' + c.err : c.status === 'run' ? ' · đang dịch…' : '');
      row.append(cb, nm, meta);
      box.appendChild(row);
    });
    updateCounts();
  }

  function updateCounts() {
    const sel = S.chapters.filter(c => c.sel);
    const pages = sel.reduce((s, c) => s + c.pages.length, 0);
    if (!S.running) setStatus(sel.length ? `Đã chọn ${sel.length} chương · ${pages} trang.` : 'Chưa chọn chương nào.');
  }

  function setStatus(t) { const el = $('b-status'); if (el) el.textContent = t; }
  function setProgress(p) { const el = $('b-progress'); if (el) el.style.width = Math.max(0, Math.min(100, p)) + '%'; }

  function renderResults() {
    const box = $('b-results');
    box.innerHTML = '';
    const done = S.chapters.filter(c => c.result);
    if (!done.length) { box.innerHTML = '<p class="vb-hint">Chưa có kết quả.</p>'; return; }
    done.forEach(c => {
      const card = document.createElement('div');
      card.className = 'vb-result';
      const head = document.createElement('div');
      head.className = 'vb-row';
      const h = document.createElement('b'); h.textContent = c.name;
      const sp = document.createElement('span'); sp.className = 'vb-spacer';
      const mk = (label, fn) => { const b = document.createElement('button'); b.className = 'vb-btn'; b.textContent = label; b.onclick = fn; return b; };
      head.append(h, sp,
        mk('Copy', () => copy(ta.value)),
        mk('⬇ .txt', () => saveFile(ta.value, 'txt', safeName(c.name))),
        mk('⬇ .docx', () => saveFile(ta.value, 'docx', safeName(c.name))));
      const ta = document.createElement('textarea');
      ta.rows = 12; ta.value = c.result;
      ta.addEventListener('input', () => { c.result = ta.value; });
      card.append(head, ta);
      box.appendChild(card);
    });
  }

  /* ============================== 8. DỊCH ================================== */
  function readCfg() {
    return {
      model: $('b-model').value,
      type: $('b-type').value,
      src: $('b-src').value,
      dst: $('b-dst').value,
      conc: Math.max(1, parseInt($('b-conc').value, 10) || 1),
      delay: Math.max(0, parseInt($('b-delay').value, 10) || 0),
      width: Math.max(600, parseInt($('b-width').value, 10) || 1400),
      skipSfx: $('b-skipsfx').checked,
      style: $('b-style').checked,
      slice: $('b-slice').checked,
      bilingual: $('b-bi').checked,
      useCtx: $('b-ctx').checked
    };
  }

  function saveCfg() { try { localStorage.setItem(CFG_KEY, JSON.stringify(readCfg())); } catch (_) {} }

  function loadCfg() {
    try {
      const c = JSON.parse(localStorage.getItem(CFG_KEY) || '{}');
      const set = (id, v) => { const el = $(id); if (el && v !== undefined && v !== null) { if (el.type === 'checkbox') el.checked = !!v; else el.value = v; } };
      set('b-model', c.model); set('b-type', c.type); set('b-src', c.src); set('b-dst', c.dst);
      set('b-conc', c.conc); set('b-delay', c.delay); set('b-width', c.width);
      set('b-skipsfx', c.skipSfx); set('b-style', c.style); set('b-slice', c.slice);
      set('b-bi', c.bilingual); set('b-ctx', c.useCtx);
    } catch (_) {}
  }

  async function translatePage(page, idx, cfg, ctx, signal) {
    const imgs = await imageToParts(page.blob, cfg.width, cfg.slice);
    const prompt = buildPrompt({
      src: cfg.src, dst: cfg.dst, type: cfg.type, skipSfx: cfg.skipSfx,
      style: cfg.style, bilingual: cfg.bilingual, context: ctx,
      sliced: imgs.length > 1, sliceCount: imgs.length,
      pageName: page.name, pageIndex: idx + 1
    });
    const parts = [{ text: prompt }];
    imgs.forEach(b64 => parts.push({ inline_data: { mime_type: 'image/jpeg', data: b64 } }));
    return await callModel(cfg.model, parts, signal);
  }

  async function runChapter(ch, cfg, ctx, signal) {
    const out = new Array(ch.pages.length).fill('');
    let cursor = 0;

    async function worker() {
      while (true) {
        if (signal.aborted) return;
        const i = cursor++;
        if (i >= ch.pages.length) return;
        const page = ch.pages[i];
        try {
          out[i] = await translatePage(page, i, cfg, ctx, signal);
        } catch (e) {
          if (String(e.message).includes('dừng')) return;
          out[i] = `[LỖI] ${e.message}`;
        }
        S.done++;
        setProgress(S.total ? (S.done / S.total) * 100 : 0);
        setStatus(`${ch.name} · trang ${Math.min(S.done, S.total)}/${S.total}`);
        if (cfg.delay) await sleep(cfg.delay);
      }
    }

    const n = Math.min(cfg.conc, ch.pages.length);
    await Promise.all(Array.from({ length: n }, worker));

    const head = `===== ${ch.name} =====\n`;
    const body = ch.pages.map((p, i) =>
      `\n--- Trang ${String(i + 1).padStart(3, '0')} · ${p.name} ---\n${out[i] || '[TRỐNG]'}`).join('\n');
    return head + body + '\n';
  }

  async function start() {
    if (S.running) return;
    const sel = S.chapters.filter(c => c.sel);
    if (!sel.length) { alert('Chưa chọn chương nào.'); return; }
    if (!readKeys().length) { alert('Chưa có API key. Mở ⚙ Nâng cao → API Keys để thêm (mỗi dòng một key hoặc import file .txt).'); return; }

    const cfg = readCfg();
    saveCfg();
    const ctx = cfg.useCtx ? getContext() : '';

    S.running = true; S.abort = new AbortController();
    S.done = 0; S.total = sel.reduce((s, c) => s + c.pages.length, 0);
    $('b-start').disabled = true; $('b-stop').disabled = false;
    setProgress(0);

    for (const ch of sel) {
      if (S.abort.signal.aborted) break;
      ch.status = 'run'; ch.err = ''; renderList();
      try {
        ch.result = await runChapter(ch, cfg, ctx, S.abort.signal);
        ch.status = S.abort.signal.aborted ? 'idle' : 'done';
      } catch (e) {
        ch.status = 'err'; ch.err = e.message;
      }
      renderList(); renderResults();
    }

    S.running = false;
    $('b-start').disabled = false; $('b-stop').disabled = true;
    setStatus(S.abort.signal.aborted ? 'Đã dừng theo yêu cầu.' : `Hoàn tất ${sel.length} chương · ${S.total} trang.`);
    setProgress(100);
  }

  /* ============================== 9. XUẤT FILE ============================= */
  const safeName = (s) => String(s).replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120) || 'chuong';

  function download(blob, filename) {
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const XMLH = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

  async function docxBlob(text) {
    if (typeof JSZip === 'undefined') throw new Error('Thiếu JSZip');
    const paras = String(text).split(/\r\n|\r|\n/).map(l =>
      l.trim() === '' ? '<w:p/>' : `<w:p><w:r><w:t xml:space="preserve">${esc(l)}</w:t></w:r></w:p>`).join('');
    const zip = new JSZip();
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
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + paras +
      '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417"/></w:sectPr>' +
      '</w:body></w:document>');
    return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  }

  async function saveFile(text, format, name) {
    try {
      if (window.fileExport && typeof window.fileExport.save === 'function') {
        const ok = await window.fileExport.save(text, format, name);
        if (ok) return;
      }
      if (format === 'docx') { download(await docxBlob(text), name + '.docx'); return; }
      download(new Blob([text], { type: 'text/plain;charset=utf-8' }), name + '.' + (format || 'txt'));
    } catch (e) { alert('Không lưu được file: ' + e.message); }
  }

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); flash('Đã copy.'); }
    catch (_) {
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta);
      ta.select(); document.execCommand('copy'); ta.remove(); flash('Đã copy.');
    }
  }

  function flash(msg) { const old = $('b-status').textContent; setStatus(msg); setTimeout(() => setStatus(old), 1500); }

  async function zipAll() {
    const done = S.chapters.filter(c => c.result);
    if (!done.length) { alert('Chưa có kết quả nào để tải.'); return; }
    const zip = new JSZip();
    const used = new Set();
    done.forEach(c => {
      let n = safeName(c.name), i = 2;
      while (used.has(n)) n = safeName(c.name) + ' (' + i++ + ')';
      used.add(n);
      zip.file(n + '.txt', c.result);
    });
    setStatus('Đang nén…');
    download(await zip.generateAsync({ type: 'blob' }), 'visionbox-ban-dich.zip');
    setStatus(`Đã tải ${done.length} chương.`);
  }

  /* ============================== 10. SỰ KIỆN ============================== */
  function bind() {
    $('b-zip').addEventListener('change', async (e) => {
      for (const f of Array.from(e.target.files || [])) { try { await addZip(f); } catch (err) { setStatus('Lỗi đọc zip: ' + err.message); } }
      e.target.value = '';
    });

    const drop = $('b-drop');
    ['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('is-over'); }));
    ['dragleave', 'drop'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove('is-over'); }));
    drop.addEventListener('drop', async (e) => {
      for (const f of Array.from(e.dataTransfer.files || [])) {
        if (/\.zip$/i.test(f.name)) { try { await addZip(f); } catch (err) { setStatus('Lỗi đọc zip: ' + err.message); } }
      }
    });

    $('b-all').onclick = () => { S.chapters.forEach(c => c.sel = true); renderList(); };
    $('b-none').onclick = () => { S.chapters.forEach(c => c.sel = false); renderList(); };
    $('b-invert').onclick = () => { S.chapters.forEach(c => c.sel = !c.sel); renderList(); };
    $('b-filter').addEventListener('input', renderList);
    $('b-start').onclick = start;
    $('b-stop').onclick = () => { if (S.abort) S.abort.abort(); setStatus('Đang dừng…'); };
    $('b-zipall').onclick = zipAll;
    $('b-copyall').onclick = () => {
      const t = S.chapters.filter(c => c.result).map(c => c.result).join('\n\n');
      if (!t) { alert('Chưa có kết quả.'); return; }
      copy(t);
    };
    ['b-model', 'b-type', 'b-src', 'b-dst', 'b-conc', 'b-delay', 'b-width',
      'b-skipsfx', 'b-style', 'b-slice', 'b-bi', 'b-ctx'].forEach(id => {
        const el = $(id); if (el) el.addEventListener('change', saveCfg);
      });
    $('b-ctx').addEventListener('change', refreshCtxInfo);

    window.addEventListener('vb:keys-changed', refreshKeyInfo);
    window.addEventListener('vb:context-changed', refreshCtxInfo);
    window.addEventListener('beforeunload', (e) => { if (S.running) { e.preventDefault(); e.returnValue = ''; } });
    setInterval(() => { refreshKeyInfo(); refreshCtxInfo(); }, 2500);
  }

  loadCfg();
  bind();
  renderList();
  renderResults();
  refreshKeyInfo();
  refreshCtxInfo();

  VB.batch = { state: S, start, stop: () => S.abort && S.abort.abort(), addZip, getContext, readKeys };
})();
