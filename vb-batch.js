/* vb-batch.js — VisionBox · Dich hang loat nhieu chuong tu file .zip
 *
 * Viet lai hoan chinh (thay the ban cu):
 *  - Bo hoan toan phan khai bao trung lap `const on` + `function init()` o cuoi
 *    file (chinh la SyntaxError "Identifier 'on' has already been declared"
 *    lam ca file khong chay -> tinh nang dich hang loat "im lang").
 *  - Bo sung handler `change` cho #b-zip (truoc day chi keo-tha moi nap duoc zip).
 *  - Bo sung cac ham bi goi nhung chua he ton tai: zipAll(), downloadText(),
 *    safeName(), dedupJoin().
 *  - fillOptions() gio KHONG lam select rong khi gia tri da luu khong co trong
 *    danh sach option (vd model gemini-3.1-flash-lite tren studio.html) - se tu
 *    them option do vao thay vi de model trong roi goi API loi.
 *  - Tu chay duoc ca khi vb-core.js / vb-format.js thieu ham: moi thu VB.* deu
 *    co ban du phong ngay trong file nay.
 *
 * Yeu cau DOM: #b-drop #b-zip #b-zipinfo #b-model #b-type #b-src #b-dst #b-conc
 * #b-delay #b-width #b-skipsfx #b-style #b-slice #b-bi #b-ctx #b-ctxinfo
 * #b-keyinfo #b-all #b-none #b-invert #b-filter #b-start #b-stop #b-progress
 * #b-status #b-list #b-zipall #b-copyall #b-results  (co trong batch.html va
 * trong panel [data-panel="batch"] cua studio.html).
 */
(() => {
  'use strict';

  // ================== tien ich DOM ==================
  const $ = (id) => document.getElementById(id);
  const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); return el; };
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, m =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

  // ================== lop bao VB (co ban du phong) ==================
  // vb-core.js co the chua nap / thieu ham -> moi thu duoi day deu uu tien dung
  // ban that cua VB, khong co thi dung ban du phong ngay trong file nay.
  const LS_OPTS = 'vb_batch_options_v1';

  const DEF_BATCH = {
    model: 'gemini-2.5-flash', contentType: 'manga',
    sourceLang: 'ja', targetLang: 'vi',
    concurrency: 1, delayMs: 700, maxWidth: 1400,
    skipSfx: false, styleGuide: true, sliceTall: true,
    bilingual: true, useContext: true
  };
  const DEF_BI = { enabled: true, sfxTag: '(sfx)', tagSfxInPrompt: true };

  let localData = { batch: Object.assign({}, DEF_BATCH), bilingual: Object.assign({}, DEF_BI) };
  try {
    const raw = localStorage.getItem(LS_OPTS);
    if (raw) Object.assign(localData.batch, JSON.parse(raw) || {});
  } catch (_) {}

  function store() {
    const d = (window.VB && window.VB.data) ? window.VB.data : localData;
    d.batch = Object.assign({}, DEF_BATCH, d.batch || {});
    d.bilingual = Object.assign({}, DEF_BI, d.bilingual || {});
    return d;
  }
  function persist() {
    if (window.VB && typeof window.VB.save === 'function') { try { window.VB.save(); return; } catch (_) {} }
    try { localStorage.setItem(LS_OPTS, JSON.stringify(store().batch)); } catch (_) {}
  }

  const LANG_NAMES = { ko: 'Korean', ja: 'Japanese', zh: 'Chinese', en: 'English', vi: 'Vietnamese' };

  function langName(code) {
    if (window.VB && typeof window.VB.langName === 'function') return window.VB.langName(code);
    return LANG_NAMES[code] || code;
  }
  function sleep(ms) {
    if (window.VB && typeof window.VB.sleep === 'function') return window.VB.sleep(ms);
    return new Promise(r => setTimeout(r, ms));
  }
  function naturalCompare(a, b) {
    if (window.VB && typeof window.VB.naturalCompare === 'function') return window.VB.naturalCompare(a, b);
    return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
  }
  function splitLines(s) {
    if (window.VB && typeof window.VB.splitLines === 'function') return window.VB.splitLines(s);
    return String(s || '').split(/\r\n|\r|\n/).map(l => l.trim()).filter(l => l.length > 0);
  }
  function mimeOf(name) {
    if (window.VB && typeof window.VB.mimeOf === 'function') return window.VB.mimeOf(name);
    const ext = String(name).toLowerCase().split('.').pop();
    return ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
      heic: 'image/heic', heif: 'image/heif', bmp: 'image/bmp', gif: 'image/gif' })[ext] || 'image/jpeg';
  }
  function getKeys() {
    if (window.VB && typeof window.VB.getKeys === 'function') {
      const k = window.VB.getKeys();
      if (Array.isArray(k) && k.length) return k;
    }
    const out = [];
    const d = (window.VB && window.VB.data) || {};
    (Array.isArray(d.keys) ? d.keys : []).forEach(k => {
      const v = typeof k === 'string' ? k : (k && k.key);
      if (v && v.trim()) out.push(v.trim());
    });
    if (!out.length) {
      const el = $('api-key-input');
      if (el && el.value.trim()) out.push(el.value.trim());
    }
    if (!out.length) {
      try {
        const cfg = JSON.parse(localStorage.getItem('visionbox_config_cache_v1') || '{}');
        if (cfg.apiKey && String(cfg.apiKey).trim()) out.push(String(cfg.apiKey).trim());
      } catch (_) {}
    }
    return out;
  }
  function hasContext() {
    if (window.VB && typeof window.VB.hasContext === 'function') return !!window.VB.hasContext();
    return false;
  }
  function contextCharCount() {
    if (window.VB && typeof window.VB.contextCharCount === 'function') return window.VB.contextCharCount() || 0;
    return 0;
  }
  function contextBlock(target, mode) {
    if (window.VB && typeof window.VB.buildContextBlock === 'function') {
      try { return window.VB.buildContextBlock(target, mode) || ''; } catch (_) {}
    }
    return '';
  }
  function styleBlock(target, mode) {
    if (window.VB && typeof window.VB.getStyleBlock === 'function') {
      try { return window.VB.getStyleBlock(target, mode) || ''; } catch (_) {}
    }
    if (window.STYLE_SKILL && typeof window.STYLE_SKILL.buildBlock === 'function') {
      try { return '\n' + window.STYLE_SKILL.buildBlock(target, mode) + '\n'; } catch (_) {}
    }
    return '';
  }
  function mergeBilingual(src, dst) {
    if (window.VB && typeof window.VB.mergeBilingual === 'function') {
      try { return window.VB.mergeBilingual(src, dst); } catch (_) {}
    }
    const s = splitLines(src), t = splitLines(dst);
    const n = Math.max(s.length, t.length);
    const out = [];
    for (let i = 0; i < n; i++) {
      if (t[i]) out.push(t[i]);
      if (s[i]) out.push('*' + s[i]);
    }
    return out.join('\n');
  }

  // ================== prompt (du phong khi vb-core thieu) ==================
  function buildOcrPrompt(o) {
    if (window.VB && typeof window.VB.buildOcrPrompt === 'function') return window.VB.buildOcrPrompt(o);
    const lang = langName(o.sourceLang);
    const order = o.contentType === 'manga'
      ? 'standard MANGA reading order: top to bottom, RIGHT to LEFT'
      : 'standard WEBTOON reading order: top to bottom, LEFT to RIGHT';
    const sfx = o.skipSfx
      ? 'Completely IGNORE sound-effect/onomatopoeia lettering drawn onto the artwork with no enclosing bubble outline. Output only text inside bubbles/caption boxes.'
      : `Include sound-effect/onomatopoeia lettering as its own line, in its true reading position${o.sfxTag ? `, prefixed with "${o.sfxTag} "` : ''}.`;
    return `OCR every speech bubble / caption box on this ${lang} comic page.

RULES:
1. Follow ${order}. This is mandatory.
2. ALL text inside ONE bubble outline = ONE single output line, even when it visually wraps onto several rows (join wrapped fragments with a single space). Two different bubbles = two different lines. This is the most common mistake - check it carefully.
3. Do NOT translate. Extract the original ${lang} text exactly as written, character for character.
4. Skip a bubble entirely if it has no legible text; never write a placeholder like "(blank)" / "(no text)".
5. ${sfx}
6. If the page has no text at all, answer exactly: [NO TEXT]

Return ONLY the extracted lines, one bubble per line. No titles, numbering, or commentary.`;
  }

  function buildTranslatePrompt(o) {
    if (window.VB && typeof window.VB.buildTranslatePrompt === 'function') return window.VB.buildTranslatePrompt(o);
    const s = langName(o.sourceLang), t = langName(o.targetLang);
    const prev = o.prevTail ? `\nPREVIOUS PAGE (context only, do NOT translate or output these):\n${o.prevTail}\n` : '';
    const sfx = o.tagSfx && o.sfxTag
      ? `\nLines starting with "${o.sfxTag}" are sound effects: keep that prefix and render the sound briefly in ${t}.`
      : '';
    return `You are an elite comic localizer translating ${s} to ${t}.

Below is the OCR text of one comic page, one speech bubble per line, together with the page image.
${prev}
OCR text (${o.lineCount} lines):
${o.text}

RULES:
1. Output EXACTLY ${o.lineCount} lines, one translation per source line, in the same order. Never merge, split, add or drop a line.
2. Translate the contextual meaning, not word for word. Use natural, punchy spoken ${t}, matching each character's tone shown in the art.
3. Use normal sentence case even if the source is ALL CAPS.
4. Never output notes, explanations, numbering, or placeholders like "(blank)".${sfx}
${contextBlockSafe(o)}${styleBlockSafe(o)}
Return ONLY the ${o.lineCount} translated lines.`;
  }
  const contextBlockSafe = (o) => o.contextBlock ? `\n${o.contextBlock}\n` : '';
  const styleBlockSafe = (o) => o.styleBlock ? `\n${o.styleBlock}\n` : '';

  // ================== anh -> parts (du phong) ==================
  async function imageToParts(blob, opt) {
    if (window.VB && typeof window.VB.imageToParts === 'function') return window.VB.imageToParts(blob, opt);
    return localImageToParts(blob, opt);
  }

  function blobToBase64(blob) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result).split(',')[1] || '');
      fr.onerror = () => rej(fr.error || new Error('Không đọc được ảnh'));
      fr.readAsDataURL(blob);
    });
  }

  async function loadBitmap(blob) {
    if (typeof createImageBitmap === 'function') {
      try { return await createImageBitmap(blob); } catch (_) {}
    }
    return await new Promise((res, rej) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); res(img); };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Ảnh không hợp lệ hoặc định dạng không hỗ trợ')); };
      img.src = url;
    });
  }

  const OVERLAP = 90; // px chong nhau giua 2 manh de khong cat doi bong thoai

  async function localImageToParts(blob, opt) {
    const maxWidth = Math.max(300, opt.maxWidth || 1400);
    const sliceHeight = Math.max(1200, opt.sliceHeight || 3000);
    let bmp;
    try { bmp = await loadBitmap(blob); }
    catch (_) { return [{ inline_data: { mime_type: blob.type || 'image/jpeg', data: await blobToBase64(blob) } }]; }

    const scale = Math.min(1, maxWidth / (bmp.width || maxWidth));
    const w = Math.max(1, Math.round((bmp.width || maxWidth) * scale));
    const h = Math.max(1, Math.round((bmp.height || maxWidth) * scale));

    const cuts = [];
    if (opt.sliceTall && h > sliceHeight) {
      let y = 0;
      while (y < h) {
        const hh = Math.min(sliceHeight, h - y);
        cuts.push({ y, h: hh });
        if (y + hh >= h) break;
        y += Math.max(1, hh - OVERLAP);
      }
    } else {
      cuts.push({ y: 0, h });
    }

    const parts = [];
    for (const c of cuts) {
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = c.h;
      const ctx = cv.getContext('2d');
      ctx.drawImage(bmp, 0, Math.round(c.y / scale), bmp.width, Math.round(c.h / scale), 0, 0, w, c.h);
      const data = cv.toDataURL('image/jpeg', 0.9).split(',')[1];
      parts.push({ inline_data: { mime_type: 'image/jpeg', data } });
    }
    if (bmp.close) try { bmp.close(); } catch (_) {}
    return parts;
  }

  // ================== goi Gemini (du phong) ==================
  const RETRY_WAIT = [4000, 8000, 15000, 25000, 40000];

  async function callGemini(cfg) {
    if (window.VB && typeof window.VB.callGemini === 'function') return window.VB.callGemini(cfg);
    return localCallGemini(cfg);
  }

  async function localCallGemini({ model, parts, generationConfig, signal, shouldStop, onStatus }) {
    const keys = getKeys();
    if (!keys.length) throw new Error('Chưa có API key');
    if (!model) throw new Error('Chưa chọn model');

    const body = {
      contents: [{ parts }],
      generationConfig: Object.assign({ temperature: 0.2, topP: 0.9, topK: 40, maxOutputTokens: 8192 }, generationConfig || {})
    };
    let lastErr = null;

    for (let ki = 0; ki < keys.length; ki++) {
      for (let attempt = 0; attempt <= RETRY_WAIT.length; attempt++) {
        if (shouldStop && shouldStop()) throw new Error('Đã dừng theo yêu cầu');
        let res;
        try {
          res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(keys[ki])}`,
            { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal }
          );
        } catch (e) {
          if (e && e.name === 'AbortError') throw e;
          lastErr = e; 
          if (attempt < RETRY_WAIT.length) { await sleep(RETRY_WAIT[attempt]); continue; }
          break;
        }

        if (res.ok) {
          const data = await res.json();
          const cand = data.candidates && data.candidates[0];
          const text = ((cand && cand.content && cand.content.parts) || []).map(p => p.text || '').join('').trim();
          if (!text) {
            const why = (data.promptFeedback && data.promptFeedback.blockReason) || (cand && cand.finishReason) || 'trả về rỗng';
            throw new Error('Gemini ' + why);
          }
          return text;
        }

        let msg = 'HTTP ' + res.status;
        try { const j = await res.json(); msg = (j.error && j.error.message) || msg; } catch (_) {}
        lastErr = new Error(msg);

        if (res.status === 429 || res.status >= 500) {
          if (attempt < RETRY_WAIT.length) {
            const s = Math.round(RETRY_WAIT[attempt] / 1000);
            if (onStatus) onStatus(`Bị giới hạn tốc độ (${res.status}), chờ ${s}s rồi thử lại…`);
            await sleep(RETRY_WAIT[attempt]);
            continue;
          }
          break; // het luot -> doi sang key khac
        }
        if (res.status === 400 || res.status === 401 || res.status === 403) break; // key/model sai -> doi key
        throw lastErr;
      }
    }
    throw lastErr || new Error('Gọi Gemini thất bại');
  }

  // ================== trang thai ==================
  /** chapters: [{id,name,images:[{name,path,entry}],selected,status,done,total,pages:[],error}] */
  let chapters = [];
  let running = false, stopFlag = false;
  let totalUnits = 0, doneUnits = 0;

  const find = (id) => chapters.find(c => c.id === id);
  const setStatus = (t) => { const el = $('b-status'); if (el) el.textContent = t; };

  function bumpProgress() {
    doneUnits++;
    const el = $('b-progress');
    if (el) el.style.width = totalUnits ? Math.round(doneUnits / totalUnits * 100) + '%' : '0%';
  }

  // ================== nap zip ==================
  const IMG_RE = /\.(png|jpe?g|webp|heic|heif|bmp|gif)$/i;

  async function loadZips(files) {
    if (typeof JSZip === 'undefined') { alert('Thiếu jszip.min.js — không đọc được file zip.'); return; }
    setStatus('Đang đọc file zip…');
    const map = new Map();
    const many = files.length > 1;

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
        const key = (many ? file.name.replace(/\.zip$/i, '') + ' :: ' : '') + chapName;
        if (!map.has(key)) map.set(key, []);
        map.get(key).push({ name: fname, path, entry });
      });
    }

    chapters = Array.from(map.entries())
      .sort((a, b) => naturalCompare(a[0], b[0]))
      .map(([name, imgs], i) => ({
        id: 'ch' + i,
        name,
        images: imgs.sort((x, y) => naturalCompare(x.name, y.name)),
        selected: true, status: 'idle', done: 0, total: imgs.length, pages: [], error: ''
      }));

    const info = $('b-zipinfo');
    if (info) info.textContent = `Đã quét: ${chapters.length} chương · ${chapters.reduce((s, c) => s + c.total, 0)} ảnh.`;
    renderChapters();
    renderResults();
    setStatus(chapters.length ? 'Chọn chương rồi bấm “Bắt đầu dịch”.' : 'Không tìm thấy ảnh nào trong zip.');
  }

  // ================== render danh sach chuong ==================
  function statusText(c) {
    return ({
      idle: 'chờ',
      running: `đang chạy ${c.done}/${c.total}`,
      done: `xong ${c.done}/${c.total}`,
      error: `lỗi: ${c.error || 'không rõ'}`,
      stopped: `dừng ${c.done}/${c.total}`
    })[c.status] || '';
  }

  function refreshBadge(c) {
    const el = document.querySelector(`[data-badge="${c.id}"]`);
    if (el) {
      el.textContent = statusText(c);
      if (el.parentElement) el.parentElement.className = 'vb-chapter ' + c.status;
    }
  }

  function renderChapters() {
    const box = $('b-list');
    if (!box) return;
    const filterEl = $('b-filter');
    const filter = ((filterEl && filterEl.value) || '').toLowerCase();
    box.innerHTML = '';

    const list = chapters.filter(c => !filter || c.name.toLowerCase().includes(filter));
    if (!list.length) {
      box.innerHTML = '<span class="vb-hint">Chưa có chương nào (hoặc bộ lọc không khớp).</span>';
      return;
    }

    list.forEach(c => {
      const row = document.createElement('div');
      row.className = 'vb-chapter ' + c.status;
      row.innerHTML = `
        <label class="vb-inline"><input type="checkbox" data-sel="${c.id}" ${c.selected ? 'checked' : ''}> <b>${escapeHtml(c.name)}</b></label>
        <span class="vb-hint">${c.total} ảnh</span>
        <span class="vb-badge" data-badge="${c.id}">${escapeHtml(statusText(c))}</span>
        <span class="vb-spacer"></span>
        <button class="vb-btn vb-btn-icon" data-one="${c.id}" title="Chỉ dịch chương này">▶</button>`;
      box.appendChild(row);
    });

    box.onchange = (e) => {
      const cb = e.target.closest('[data-sel]');
      if (cb) { const c = find(cb.dataset.sel); if (c) c.selected = cb.checked; }
    };
    box.onclick = async (e) => {
      const b = e.target.closest('[data-one]');
      if (!b) return;
      if (running) { setStatus('Đang chạy, vui lòng chờ hoặc bấm Dừng.'); return; }
      const c = find(b.dataset.one);
      if (c) await runAll([c]);
    };
  }

  // ================== ket qua ==================
  const EMPTY_MARK = '(không có chữ)';

  function buildChapterFallback(name, pages, opt) {
    const pad = n => String(n).padStart(2, '0');
    const out = [`=== ${name} ===`, ''];
    pages.forEach((p, i) => {
      out.push(`[Trang ${pad(p.no || i + 1)} — ${p.name || 'image'}]`);
      if (p.error) out.push('⚠ LỖI: ' + p.error);
      else if (!p.lines || !p.lines.length) out.push(EMPTY_MARK);
      else if (opt && opt.bilingual && p.source && p.source.length)
        out.push(mergeBilingual(p.source.join('\n'), p.lines.join('\n')));
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
      lines: p && p.translated ? splitLines(p.translated) : [],
      source: p && p.source ? splitLines(p.source) : [],
      error: p && p.error ? p.error : ''
    }));
    const opt = { bilingual: o.bilingual };
    try {
      const build = (window.VB && window.VB.FMT && window.VB.FMT.buildChapterText) || buildChapterFallback;
      return build(c.name, pages, opt);
    } catch (e) {
      console.error('[VB-BATCH] chapterText lỗi:', e);
      return buildChapterFallback(c.name, pages, opt);
    }
  }

  // Bao render: loi hien thi chi duoc ghi log, KHONG lan ra hang doi dich.
  function renderResults() {
    try { renderResultsInner(); }
    catch (e) {
      console.error('[VB-BATCH] renderResults lỗi:', e);
      setStatus('Lỗi hiển thị kết quả (hàng đợi vẫn chạy tiếp): ' + e.message);
    }
  }

  function renderResultsInner() {
    const box = $('b-results');
    if (!box) return;
    const done = chapters.filter(c => c.pages && c.pages.length);
    box.innerHTML = done.length ? '' : '<span class="vb-hint">Chưa có kết quả.</span>';

    done.forEach(c => {
      const div = document.createElement('details');
      div.className = 'vb-result';
      div.innerHTML = `
        <summary>${escapeHtml(c.name)} — ${c.done}/${c.total} trang${c.status === 'error' ? ' ⚠' : ''}</summary>
        <div class="vb-row">
          <button class="vb-btn" data-dl="${c.id}">⬇ .txt</button>
          <button class="vb-btn" data-dx="${c.id}">⬇ .docx</button>
          <button class="vb-btn" data-cp="${c.id}">Copy</button>
        </div>
        <textarea rows="16" data-ta="${c.id}">${escapeHtml(chapterText(c))}</textarea>`;
      box.appendChild(div);
    });

    box.onclick = async (e) => {
      const dl = e.target.closest('[data-dl]');
      const dx = e.target.closest('[data-dx]');
      const cp = e.target.closest('[data-cp]');
      const hit = dl || dx || cp;
      if (!hit) return;
      const id = hit.dataset.dl || hit.dataset.dx || hit.dataset.cp;
      const c = find(id);
      if (!c) return;
      const ta = document.querySelector(`[data-ta="${id}"]`);
      const content = ta ? ta.value : chapterText(c);
      const fname = safeName(c.name);

      if (dl) downloadText(content, fname + '.txt');
      if (dx) {
        if (window.VB && window.VB.FMT && typeof window.VB.FMT.download === 'function') {
          try { await window.VB.FMT.download(content, fname, 'docx'); }
          catch (err) { console.error(err); downloadText(content, fname + '.txt'); }
        } else if (window.fileExport && typeof window.fileExport.save === 'function') {
          try { await window.fileExport.save(content, 'docx', fname); }
          catch (err) { console.error(err); downloadText(content, fname + '.txt'); }
        } else {
          downloadText(content, fname + '.txt');
        }
      }
      if (cp) {
        try { await navigator.clipboard.writeText(content); setStatus('Đã copy ' + c.name); }
        catch (_) { setStatus('Copy thất bại (trình duyệt chặn clipboard).'); }
      }
    };
  }

  // ================== tai file ==================
  function safeName(name) {
    return String(name || 'chuong')
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'chuong';
  }
  function stamp() {
    const d = new Date(), p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  }
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
  function downloadText(content, filename) {
    downloadBlob(new Blob([content], { type: 'text/plain;charset=utf-8' }), filename);
  }

  async function zipAll() {
    const done = chapters.filter(c => c.pages && c.pages.length);
    if (!done.length) { alert('Chưa có kết quả nào để tải.'); return; }
    if (typeof JSZip === 'undefined') { alert('Thiếu jszip.min.js'); return; }
    setStatus('Đang đóng gói .zip…');
    const zip = new JSZip();
    const used = new Set();
    done.forEach(c => {
      const base = safeName(c.name);
      let name = base + '.txt', i = 2;
      while (used.has(name)) name = `${base} (${i++}).txt`;
      used.add(name);
      const ta = document.querySelector(`[data-ta="${c.id}"]`);
      zip.file(name, ta ? ta.value : chapterText(c));
    });
    try {
      const blob = await zip.generateAsync({ type: 'blob' });
      downloadBlob(blob, `visionbox-batch-${stamp()}.zip`);
      setStatus(`Đã tải ${done.length} chương (.zip).`);
    } catch (e) {
      console.error(e);
      setStatus('Đóng gói zip thất bại: ' + e.message);
    }
  }

  async function copyAll() {
    const all = chapters.filter(c => c.pages && c.pages.length).map(chapterText).join('\n\n');
    if (!all.trim()) { setStatus('Chưa có kết quả để copy.'); return; }
    try { await navigator.clipboard.writeText(all); setStatus('Đã copy toàn bộ kết quả.'); }
    catch (_) { setStatus('Copy thất bại (trình duyệt chặn clipboard).'); }
  }

  // ================== gop OCR nhieu manh anh ==================
  // Cac manh anh duoc cat CHONG NHAU (OVERLAP) nen dong dau cua manh sau
  // thuong lap lai dong cuoi cua manh truoc -> bo trung o ranh gioi, khong bo
  // trung o giua (thoai lap lai co chu y van duoc giu).
  function dedupJoin(chunks) {
    const out = [];
    chunks.forEach((chunk, ci) => {
      const lines = splitLines(chunk).filter(l => l !== '[NO TEXT]');
      let start = 0;
      if (ci > 0) {
        const tail = out.slice(-4).map(x => x.toLowerCase());
        while (start < lines.length && tail.includes(lines[start].toLowerCase())) start++;
      }
      for (let i = start; i < lines.length; i++) out.push(lines[i]);
    });
    return out.join('\n').trim();
  }

  // ================== chay hang loat ==================
  const IMAGE_TIMEOUT_MS = 180000; // 1 anh treo qua 3 phut -> bo qua, khong khoa ca loat

  async function runAll(list) {
    if (running) return;
    const targets = list || chapters.filter(c => c.selected);
    if (!targets.length) { alert('Chưa chọn chương nào.'); return; }
    if (!getKeys().length) {
      alert('Chưa có API key. Về trang chính → ⚙ Nâng cao → tab API Keys (hoặc nhập key ở trang chính).');
      return;
    }
    saveOptions();

    running = true; stopFlag = false;
    const startBtn = $('b-start'), stopBtn = $('b-stop');
    if (startBtn) startBtn.disabled = true;
    if (stopBtn) stopBtn.disabled = false;

    totalUnits = targets.reduce((s, c) => s + c.total, 0);
    doneUnits = 0;
    const bar = $('b-progress');
    if (bar) bar.style.width = '0%';

    try {
      for (const c of targets) {
        if (stopFlag) break;
        try {
          await runChapter(c);
        } catch (e) {
          // Mot chuong hong KHONG duoc lam chet hang doi.
          console.error('[VB-BATCH] chương lỗi:', c.name, e);
          c.status = 'error';
          c.error = e.message || String(e);
          refreshBadge(c);
        }
      }
    } finally {
      running = false;
      if (startBtn) startBtn.disabled = false;
      if (stopBtn) stopBtn.disabled = true;
      const bad = chapters.filter(c => c.status === 'error').length;
      setStatus(stopFlag
        ? 'Đã dừng.'
        : (bad ? `Hoàn tất, còn ${bad} chương có trang lỗi.` : 'Hoàn tất tất cả chương đã chọn ✔'));
      renderResults();
    }
  }

  async function runChapter(c) {
    c.status = 'running'; c.done = 0; c.pages = []; c.error = '';
    refreshBadge(c);

    const o = readOptions();
    const conc = Math.max(1, Math.min(3, o.concurrency || 1));
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
            prevTail = splitLines(page.translated).slice(-4).join('\n');
          }
        } catch (e) {
          const aborted = (e && e.name === 'AbortError') || /Đã dừng/.test(e.message || '');
          // CHI thoat worker khi nguoi dung THAT SU bam Dung. Truoc day mot
          // request bi abort/timeout cung lam worker return -> cac anh con lai
          // dung im, chuong khong bao gio xong.
          if (aborted && stopFlag) return;
          c.pages[i] = {
            name: img.name, source: '', translated: '',
            error: aborted ? 'Quá thời gian chờ (timeout)' : (e.message || String(e))
          };
          c.error = c.pages[i].error;
          console.error('[VB-BATCH] trang lỗi:', img.name, e);
        }
        c.done++;
        bumpProgress();
        refreshBadge(c);
        if (o.delayMs) await sleep(o.delayMs);
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
      const blob0 = await img.entry.async('blob');
      const blob = blob0.type ? blob0 : new Blob([blob0], { type: mimeOf(img.name) });
      const parts = await imageToParts(blob, {
        maxWidth: o.maxWidth, sliceTall: o.sliceTall, sliceHeight: 3000
      });

      const bi = store().bilingual;
      const ocrPrompt = buildOcrPrompt({
        sourceLang: o.sourceLang, contentType: o.contentType,
        skipSfx: o.skipSfx, sfxTag: bi.sfxTag
      });

      // ---- 1) OCR tung manh anh ----
      const chunks = [];
      for (const part of parts) {
        chunks.push(await callGemini({
          model: o.model,
          parts: [{ text: ocrPrompt }, part],
          generationConfig: { temperature: 0.1 },
          signal: ac.signal,
          shouldStop: () => stopFlag,
          onStatus: setStatus
        }));
      }
      const source = dedupJoin(chunks);
      if (!source || source === '[NO TEXT]') {
        return { name: img.name, source: '', translated: '', empty: true };
      }

      // ---- 2) Dich ----
      const lines = splitLines(source);
      const target = langName(o.targetLang);
      const translated = await callGemini({
        model: o.model,
        parts: [{
          text: buildTranslatePrompt({
            sourceLang: o.sourceLang, targetLang: o.targetLang,
            text: lines.join('\n'), lineCount: lines.length,
            contextBlock: o.useContext ? contextBlock(target, 'translate') : '',
            styleBlock: o.styleGuide ? styleBlock(target, 'translate') : '',
            prevTail,
            tagSfx: !o.skipSfx && !!bi.tagSfxInPrompt,
            sfxTag: bi.sfxTag
          })
        }, parts[0]],
        generationConfig: { temperature: 0.35, maxOutputTokens: 8192 },
        signal: ac.signal,
        shouldStop: () => stopFlag,
        onStatus: setStatus
      });

      return {
        name: img.name,
        source: lines.join('\n'),
        translated: splitLines(translated).join('\n')
      };
    } finally {
      clearTimeout(timer);
    }
  }

  // ================== options ==================
  const num = (id, def) => { const el = $(id); const v = el ? parseInt(el.value, 10) : NaN; return Number.isFinite(v) ? v : def; };
  const val = (id, def) => { const el = $(id); return el && el.value ? el.value : def; };
  const chk = (id, def) => { const el = $(id); return el ? !!el.checked : def; };

  function readOptions() {
    const d = store().batch;
    return {
      model: val('b-model', d.model),
      contentType: val('b-type', d.contentType),
      sourceLang: val('b-src', d.sourceLang),
      targetLang: val('b-dst', d.targetLang),
      concurrency: num('b-conc', d.concurrency),
      delayMs: num('b-delay', d.delayMs),
      maxWidth: num('b-width', d.maxWidth),
      skipSfx: chk('b-skipsfx', d.skipSfx),
      styleGuide: chk('b-style', d.styleGuide),
      sliceTall: chk('b-slice', d.sliceTall),
      bilingual: chk('b-bi', d.bilingual),
      useContext: chk('b-ctx', d.useContext)
    };
  }

  function saveOptions() {
    Object.assign(store().batch, readOptions());
    persist();
  }

  // Gan gia tri cho <select> AN TOAN: neu gia tri da luu khong co trong danh
  // sach option (vd model gemini-3.1-flash-lite khong co trong studio.html),
  // them option do vao thay vi de select rong -> goi API voi model rong.
  function setSelect(id, value) {
    const el = $(id);
    if (!el || value == null || value === '') return;
    const has = Array.from(el.options).some(o => o.value === String(value));
    if (!has) {
      const opt = document.createElement('option');
      opt.value = String(value);
      opt.textContent = String(value);
      el.appendChild(opt);
    }
    el.value = String(value);
  }
  function setNum(id, value) { const el = $(id); if (el && Number.isFinite(+value)) el.value = value; }
  function setChk(id, value) { const el = $(id); if (el && typeof value === 'boolean') el.checked = value; }

  function fillOptions() {
    const d = store();
    const b = d.batch;
    setSelect('b-model', b.model);
    setSelect('b-type', b.contentType);
    setSelect('b-src', b.sourceLang);
    setSelect('b-dst', b.targetLang);
    setSelect('b-conc', String(b.concurrency));
    setNum('b-delay', b.delayMs);
    setNum('b-width', b.maxWidth);
    setChk('b-skipsfx', b.skipSfx);
    setChk('b-style', b.styleGuide);
    setChk('b-slice', b.sliceTall);
    setChk('b-bi', typeof d.bilingual.enabled === 'boolean' ? d.bilingual.enabled : b.bilingual);
    setChk('b-ctx', b.useContext);

    const ctxInfo = $('b-ctxinfo');
    if (ctxInfo) {
      ctxInfo.textContent = hasContext()
        ? `Ngữ cảnh: ${contextCharCount().toLocaleString()} ký tự`
        : 'Chưa có ngữ cảnh (thiết lập ở trang chính → ⚙ Nâng cao).';
    }
    const keyInfo = $('b-keyinfo');
    if (keyInfo) {
      const keys = getKeys();
      keyInfo.textContent = keys.length ? `${keys.length} API key sẵn sàng` : '⚠ Chưa có API key';
    }
  }

  // ================== khoi tao + gan su kien (CHI MOT LAN) ==================
  function init() {
    if (!$('b-list')) return; // trang nay khong co panel batch -> bo qua

    window.addEventListener('unhandledrejection', (ev) => {
      console.error('[VB-BATCH] unhandled:', ev.reason);
      if (running) setStatus('Lỗi ngầm: ' + ((ev.reason && ev.reason.message) || ev.reason));
    });

    fillOptions();
    renderChapters();
    renderResults();

    on('b-back', 'click', () => { location.href = 'index.html'; });

    // ---- nap zip: file picker (truoc day BI THIEU) ----
    on('b-zip', 'change', (e) => {
      const files = Array.from(e.target.files || []).filter(f => /\.zip$/i.test(f.name));
      if (files.length) loadZips(files);
      else if ((e.target.files || []).length) alert('Chỉ nhận file .zip');
      e.target.value = ''; // cho phep chon lai dung file do
    });

    // ---- nap zip: keo & tha ----
    const drop = $('b-drop');
    if (drop) {
      ['dragenter', 'dragover'].forEach(ev =>
        drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
      ['dragleave', 'drop'].forEach(ev =>
        drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
      drop.addEventListener('drop', e => {
        const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []).filter(f => /\.zip$/i.test(f.name));
        if (files.length) loadZips(files); else alert('Chỉ nhận file .zip');
      });
    }

    // ---- chon chuong ----
    on('b-all', 'click', () => { chapters.forEach(c => c.selected = true); renderChapters(); });
    on('b-none', 'click', () => { chapters.forEach(c => c.selected = false); renderChapters(); });
    on('b-invert', 'click', () => { chapters.forEach(c => c.selected = !c.selected); renderChapters(); });
    on('b-filter', 'input', renderChapters);

    // ---- chay / dung ----
    on('b-start', 'click', () => { runAll(); });
    on('b-stop', 'click', () => {
      if (!running) return;
      stopFlag = true;
      setStatus('Đang dừng sau ảnh hiện tại…');
    });

    // ---- luu cau hinh khi doi ----
    ['b-model', 'b-type', 'b-src', 'b-dst', 'b-conc', 'b-delay', 'b-width',
      'b-skipsfx', 'b-style', 'b-slice', 'b-bi', 'b-ctx'].forEach(id => {
      on(id, 'change', saveOptions);
    });

    // ---- ket qua ----
    on('b-zipall', 'click', zipAll);
    on('b-copyall', 'click', copyAll);

    window.addEventListener('beforeunload', (e) => {
      if (running) { e.preventDefault(); e.returnValue = ''; }
    });

    if (!getKeys().length) setStatus('⚠ Chưa có API key — hãy nhập key ở trang chính trước khi dịch.');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
