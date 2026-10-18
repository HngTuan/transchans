/* =============================================================================
 * vb-shared.js — nền tảng dùng chung cho studio.html / batch.html / merge.html
 * Tự chứa: nav · API key (nhiều key, dán hoặc upload) · dò model · gọi Gemini
 *          · đọc txt/docx · xuất txt/docx/zip · kho ngữ cảnh · toast
 * KHÔNG phụ thuộc vb-core.js / vb-ui.js.  Chỉ cần jszip.min.js nạp trước.
 * ========================================================================== */
(function () {
  'use strict';
  const VB = (window.VBS = window.VBS || {});
  const API = 'https://generativelanguage.googleapis.com/v1beta';

  const LS_KEYS = 'vbs_api_keys_v1';
  const LS_MODELS = 'vbs_models_cache_v1';
  const LS_CTX = 'vbs_context_current_v1';
  const LS_LIB = 'vbs_context_lib_v1';

  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  VB.$ = $; VB.sleep = sleep; VB.API = API;

  /* ========================== TOAST ========================== */
  function toast(msg, ms) {
    let el = $('vbs-toast');
    if (!el) { el = document.createElement('div'); el.id = 'vbs-toast'; el.className = 'vbs-toast'; document.body.appendChild(el); }
    el.textContent = msg; el.classList.add('on');
    clearTimeout(toast._t); toast._t = setTimeout(() => el.classList.remove('on'), ms || 2200);
  }
  VB.toast = toast;

  /* ========================== API KEYS ========================== */
  const cooldown = new Map(), dead = new Set();

  function loadKeys() {
    try { const v = JSON.parse(localStorage.getItem(LS_KEYS) || '[]'); return Array.isArray(v) ? v.filter(Boolean) : []; }
    catch (_) { return []; }
  }
  function saveKeys(list) {
    const uniq = Array.from(new Set(list.map(s => String(s).trim()).filter(Boolean)));
    try { localStorage.setItem(LS_KEYS, JSON.stringify(uniq)); } catch (_) {}
    window.dispatchEvent(new Event('vbs:keys'));
    return uniq;
  }
  function parseKeys(text) {
    return String(text || '').split(/[\r\n,;\s]+/).map(s => s.trim())
      .filter(s => s.length >= 15 && !/^#/.test(s));
  }
  const mask = (k) => !k ? '' : (k.length <= 14 ? k : k.slice(0, 10) + '…' + k.slice(-4));

  function keyPools() {
    const now = Date.now();
    const all = loadKeys().filter(k => !dead.has(k));
    return { all, free: all.filter(k => !cooldown.get(k) || cooldown.get(k) < now) };
  }
  function pickKey() {
    const { all, free } = keyPools(), pool = free.length ? free : all;
    if (!pool.length) return null;
    pickKey._i = ((pickKey._i || 0) + 1) % pool.length;
    return pool[pickKey._i];
  }
  const penalize = (k, ms) => cooldown.set(k, Date.now() + (ms || 45000));
  const killKey = (k) => dead.add(k);
  const keyStat = () => { const p = keyPools(); return { total: loadKeys().length, usable: p.all.length, free: p.free.length, dead: dead.size }; };

  VB.keys = { load: loadKeys, save: saveKeys, parse: parseKeys, pick: pickKey, penalize, kill: killKey, stat: keyStat, mask, reset: () => { dead.clear(); cooldown.clear(); } };

  /* ========================== HỘP QUẢN LÝ KEY ========================== */
  function keyModal() {
    let m = $('vbs-keymodal');
    if (m) { m.classList.add('on'); fillBox(); return; }
    m = document.createElement('div');
    m.id = 'vbs-keymodal'; m.className = 'vbs-modal on';
    m.innerHTML =
      '<div class="vbs-modal-box">' +
      '<div class="vbs-modal-head"><b>API Keys (Gemini)</b><button class="vbs-x" id="vbs-k-close">✕</button></div>' +
      '<p class="vbs-hint">Dán mỗi dòng một key, hoặc nạp file .txt. Key được lưu trong trình duyệt này, gửi thẳng tới Google qua header <code>x-goog-api-key</code>.</p>' +
      '<textarea id="vbs-k-box" rows="10" spellcheck="false" placeholder="AQ.xxxxxxxx&#10;AIzaSyxxxxxxxx"></textarea>' +
      '<div class="vbs-row">' +
      '<label class="vbs-btn" for="vbs-k-file">📄 Nạp từ file .txt</label>' +
      '<input type="file" id="vbs-k-file" accept=".txt,.csv,.json" hidden multiple>' +
      '<button class="vbs-btn" id="vbs-k-paste">📋 Dán từ clipboard</button>' +
      '<button class="vbs-btn" id="vbs-k-test">🔍 Kiểm tra key</button>' +
      '<span class="vbs-sp"></span>' +
      '<button class="vbs-btn danger" id="vbs-k-clear">Xoá hết</button>' +
      '<button class="vbs-btn primary" id="vbs-k-save">💾 Lưu</button>' +
      '</div>' +
      '<div class="vbs-log" id="vbs-k-log"></div>' +
      '</div>';
    document.body.appendChild(m);

    const box = $('vbs-k-box'), lg = $('vbs-k-log');
    const say = (t, c) => { const d = document.createElement('div'); if (c) d.className = c; d.textContent = t; lg.appendChild(d); lg.scrollTop = lg.scrollHeight; };

    function fillBox() { $('vbs-k-box').value = loadKeys().join('\n'); }
    fillBox();

    $('vbs-k-close').onclick = () => m.classList.remove('on');
    m.addEventListener('click', e => { if (e.target === m) m.classList.remove('on'); });
    $('vbs-k-save').onclick = () => {
      const k = saveKeys(parseKeys(box.value));
      dead.clear(); cooldown.clear();
      box.value = k.join('\n');
      say(`Đã lưu ${k.length} key.`, 'ok'); toast(`Đã lưu ${k.length} key`);
    };
    $('vbs-k-clear').onclick = () => { if (confirm('Xoá toàn bộ key đã lưu?')) { saveKeys([]); box.value = ''; say('Đã xoá hết key.', 'warn'); } };
    $('vbs-k-paste').onclick = async () => {
      try { const t = await navigator.clipboard.readText(); box.value = (box.value.trim() ? box.value.trim() + '\n' : '') + t; say('Đã dán từ clipboard.'); }
      catch (_) { say('Trình duyệt chặn đọc clipboard, hãy dán tay bằng Ctrl+V.', 'bad'); }
    };
    $('vbs-k-file').onchange = async (e) => {
      for (const f of Array.from(e.target.files || [])) {
        const t = await f.text();
        box.value = (box.value.trim() ? box.value.trim() + '\n' : '') + parseKeys(t).join('\n');
        say(`Nạp ${f.name}: thêm ${parseKeys(t).length} key.`);
      }
      e.target.value = '';
    };
    $('vbs-k-test').onclick = async () => {
      saveKeys(parseKeys(box.value)); dead.clear(); cooldown.clear();
      lg.innerHTML = '';
      await selfTest(say);
    };
  }
  VB.keyModal = keyModal;

  /* ========================== MODEL ========================== */
  const PREFERRED = (window.VBModels && window.VBModels.fallback) || ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'];
  const EXCLUDE = /(tts|embedding|image|imagen|live|veo|lyria|transcribe|robotics|computer-use|deep-research|guard|aqa)/i;
  let MODELS = null;
  const modelDead = new Set();

  function rank(id) { const i = PREFERRED.indexOf(id); return i >= 0 ? i : 100 + (/pro/.test(id) ? 5 : 0); }

  async function discover(force) {
    if (!force && MODELS) return MODELS;
    if (!force) {
      try { const c = JSON.parse(localStorage.getItem(LS_MODELS) || 'null'); if (c && Date.now() - c.at < 864e5 && c.list.length) { MODELS = c.list; return MODELS; } } catch (_) {}
    }
    const key = pickKey();
    if (!key) throw new Error('Chưa có API key.');
    const out = []; let token = '';
    for (let p = 0; p < 5; p++) {
      const res = await fetch(`${API}/models?pageSize=1000${token ? '&pageToken=' + encodeURIComponent(token) : ''}`, { headers: { 'x-goog-api-key': key } });
      const body = await res.text();
      if (!res.ok) {
        if (res.status === 429) penalize(key, 60000);
        if ([400, 401, 403].includes(res.status)) killKey(key);
        throw new Error(`models.list HTTP ${res.status} — ${body.slice(0, 200)}`);
      }
      const data = JSON.parse(body);
      (data.models || []).forEach(mm => {
        const id = String(mm.name || '').replace(/^models\//, '');
        if (!id || EXCLUDE.test(id)) return;
        const meth = mm.supportedGenerationMethods || [];
        if (meth.length && !meth.includes('generateContent')) return;
        out.push({ id, label: mm.displayName || '' });
      });
      token = data.nextPageToken || ''; if (!token) break;
    }
    if (!out.length) throw new Error('Key này không có model nào hỗ trợ generateContent.');
    out.sort((a, b) => rank(a.id) - rank(b.id));
    MODELS = out;
    try { localStorage.setItem(LS_MODELS, JSON.stringify({ at: Date.now(), list: out })); } catch (_) {}
    return out;
  }

  async function fillModelSelect(sel, opts) {
    if (!sel) return '';
    if (window.VBModels) {                       // đồng bộ tự động dùng chung toàn hệ thống
      window.VBModels.fillAll();
      await window.VBModels.sync(opts && opts.force);
      MODELS = window.VBModels.list();
      return `đã đồng bộ ${MODELS.length} model`;
    }
    const remember = 'vbs_model_' + (sel.id || 'x');
    const want = localStorage.getItem(remember) || '';
    const put = arr => {
      sel.innerHTML = '';
      arr.forEach(mm => { const o = document.createElement('option'); o.value = mm.id; o.textContent = mm.id; sel.appendChild(o); });
      if (want && arr.some(x => x.id === want)) sel.value = want;
    };
    put(PREFERRED.map(id => ({ id })));
    try { put(await discover(opts && opts.force)); } catch (_) {}
    if (!sel._bound) { sel._bound = 1; sel.addEventListener('change', () => { try { localStorage.setItem(remember, sel.value); } catch (_) {} }); }
    return '';
  }

  const candidates = (prefer) => {
    const base = (window.VBModels ? window.VBModels.list() : (MODELS || PREFERRED.map(id => ({ id })))).map(m => m.id);
    const list = [];
    if (prefer && !modelDead.has(prefer)) list.push(prefer);
    base.forEach(id => { if (id !== prefer && !modelDead.has(id)) list.push(id); });
    return list.length ? list : [prefer || PREFERRED[0]];
  };
  VB.models = { discover, fill: fillModelSelect, candidates, preferred: PREFERRED, dead: modelDead };

  /* ========================== GỌI GEMINI ========================== */
  const FEAT = { schema: true, thinking: true };
  function reqBody(parts, o) {
    const g = { temperature: o.temperature != null ? o.temperature : 0.35, topP: 0.95, maxOutputTokens: o.maxTokens || 8192 };
    if (o.json) { g.responseMimeType = 'application/json'; if (o.schema && FEAT.schema) g.responseSchema = o.schema; }
    if (o.fast && FEAT.thinking) g.thinkingConfig = { thinkingBudget: 0 };
    const b = { contents: [{ role: 'user', parts }], generationConfig: g };
    if (!o.noSafety) {
      b.safetySettings = ['HARM_CATEGORY_HARASSMENT', 'HARM_CATEGORY_HATE_SPEECH', 'HARM_CATEGORY_SEXUALLY_EXPLICIT', 'HARM_CATEGORY_DANGEROUS_CONTENT']
        .map(c => ({ category: c, threshold: 'BLOCK_NONE' }));
    }
    return b;
  }

  async function call(model, parts, opts) {
    opts = opts || {};
    const note = opts.onNote || function () {};
    let lastErr = null, noSafety = false;

    for (const mid of candidates(model)) {
      const tries = Math.min(8, Math.max(3, keyStat().usable + 2));
      for (let t = 0; t < tries; t++) {
        if (opts.signal && opts.signal.aborted) throw new Error('Đã dừng');
        const key = pickKey();
        if (!key) throw new Error('Không còn API key khả dụng (tất cả bị từ chối hoặc đang bị phạt).');
        let res, raw = '';
        try {
          res = await fetch(`${API}/models/${encodeURIComponent(mid)}:generateContent`, {
            method: 'POST', signal: opts.signal,
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
            body: JSON.stringify(reqBody(parts, Object.assign({}, opts, { noSafety })))
          });
          raw = await res.text();
        } catch (e) {
          if (e.name === 'AbortError') throw new Error('Đã dừng');
          lastErr = new Error('Lỗi mạng: ' + e.message); await sleep(600 + t * 400); continue;
        }
        let data = null; try { data = JSON.parse(raw); } catch (_) {}
        const msg = (data && data.error && data.error.message) || raw.slice(0, 300);

        if (res.status === 404) { modelDead.add(mid); note(`Model ${mid} không gọi được (404) → thử model khác. ${msg}`); lastErr = new Error(`Model ${mid} bị từ chối (404): ${msg}`); break; }
        if (res.status === 429) { penalize(key, 60000); note(`Key ${mask(key)} hết quota (429) → đổi key.`); lastErr = new Error('429 quota'); await sleep(700 + t * 500); continue; }
        if (res.status === 500 || res.status === 503) { penalize(key, 15000); lastErr = new Error('HTTP ' + res.status + ' (quá tải)'); await sleep(800 + t * 600); continue; }
        if (res.status === 401 || res.status === 403) { killKey(key); note(`Key ${mask(key)} bị từ chối (${res.status}): ${msg}`); lastErr = new Error(`HTTP ${res.status}: ${msg}`); continue; }
        if (res.status === 400) {
          if (FEAT.thinking && /thinking/i.test(msg)) { FEAT.thinking = false; note('Model không hỗ trợ chế độ nhanh → tắt, gọi lại.'); continue; }
          if (FEAT.schema && /schema|response_?mime/i.test(msg)) { FEAT.schema = false; note('Model không nhận schema → bỏ schema, gọi lại.'); continue; }

          if (!noSafety && /safety|BLOCK_NONE|threshold/i.test(msg)) { noSafety = true; note('Bỏ safetySettings rồi thử lại.'); continue; }
          if (/api[_ ]?key|invalid|credential/i.test(msg)) { killKey(key); note(`Key ${mask(key)} không hợp lệ: ${msg}`); lastErr = new Error('Key không hợp lệ: ' + msg); continue; }
          lastErr = new Error('HTTP 400: ' + msg); break;
        }
        if (!res.ok) { lastErr = new Error(`HTTP ${res.status}: ${msg}`); await sleep(500); continue; }

        const cand = data && data.candidates && data.candidates[0];
        const text = cand && cand.content && Array.isArray(cand.content.parts) ? cand.content.parts.map(p => p.text || '').join('').trim() : '';
        if (!text) {
          const why = (data && data.promptFeedback && data.promptFeedback.blockReason) || (cand && cand.finishReason) || 'rỗng';
          lastErr = new Error('Model không trả nội dung (' + why + ')');
          if (/SAFETY|PROHIBITED|RECITATION/i.test(why)) break;
          await sleep(500); continue;
        }
        return { text, model: mid };
      }
    }
    throw lastErr || new Error('Gọi API thất bại');
  }

  async function selfTest(say) {
    const keys = loadKeys();
    if (!keys.length) { say('Chưa có API key nào.', 'bad'); return false; }
    say(`Đang kiểm tra ${keys.length} key…`);
    let ok = 0;
    for (let i = 0; i < keys.length; i++) {
      try {
        const r = await fetch(`${API}/models?pageSize=1`, { headers: { 'x-goog-api-key': keys[i] } });
        if (r.ok) { ok++; say(`Key #${i + 1} ${mask(keys[i])} ✔`, 'ok'); }
        else { const b = await r.text(); say(`Key #${i + 1} ${mask(keys[i])} ✘ HTTP ${r.status} — ${b.slice(0, 140)}`, 'bad'); if ([400, 401, 403].includes(r.status)) killKey(keys[i]); }
      } catch (e) { say(`Key #${i + 1} ✘ ${e.message}`, 'bad'); }
    }
    if (!ok) { say('Không key nào dùng được. Tạo key mới tại aistudio.google.com/apikey.', 'bad'); return false; }
    try {
      const list = await discover(true);
      say(`Dò được ${list.length} model. Ưu tiên: ${list.slice(0, 4).map(m => m.id).join(', ')}`, 'ok');
      const r = await call(list[0].id, [{ text: 'Trả lời đúng hai ký tự: OK' }], { maxTokens: 16, onNote: m => say(m, 'warn') });
      say(`Gọi thử ${r.model} → "${r.text.slice(0, 30)}" ✔ Mọi thứ sẵn sàng.`, 'ok');
      return true;
    } catch (e) { say('Thất bại: ' + e.message, 'bad'); return false; }
  }
  VB.gemini = { call, selfTest };

  /* ========================== ĐỌC / GHI FILE ========================== */
  async function readTextFile(file) {
    if (/\.docx$/i.test(file.name)) {
      if (typeof JSZip === 'undefined') throw new Error('Thiếu JSZip để đọc .docx');
      const zip = await JSZip.loadAsync(file);
      const f = zip.file('word/document.xml');
      if (!f) throw new Error('File .docx hỏng');
      const xml = await f.async('string');
      return xml.replace(/<w:p[ >][\s\S]*?(?=<w:p[ >]|<\/w:body>)/g, m => m.replace(/<[^>]+>/g, '') + '\n')
        .replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();
    }
    return await file.text();
  }

  function download(blob, name) {
    const u = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 1500);
  }
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const XH = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

  async function docxBlob(text) {
    const paras = String(text).split(/\r\n|\r|\n/).map(l => l.trim() === '' ? '<w:p/>' :
      `<w:p><w:r><w:t xml:space="preserve">${esc(l)}</w:t></w:r></w:p>`).join('');
    const z = new JSZip();
    z.file('[Content_Types].xml', XH + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    z.folder('_rels').file('.rels', XH + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    z.folder('word').file('document.xml', XH + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + paras + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417"/></w:sectPr></w:body></w:document>');
    return z.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  }

  const safeName = (s) => String(s || '').replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120) || 'ket-qua';

  async function saveAs(text, fmt, name) {
    try {
      if (fmt === 'docx') { download(await docxBlob(text), safeName(name) + '.docx'); return; }
      download(new Blob([text], { type: 'text/plain;charset=utf-8' }), safeName(name) + '.' + (fmt || 'txt'));
    } catch (e) { alert('Không lưu được: ' + e.message); }
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast('Đã copy'); }
    catch (_) { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); toast('Đã copy'); }
  }
  VB.file = { read: readTextFile, download, docxBlob, saveAs, copy, safeName };

  /* ========================== ẢNH ========================== */
  async function bitmap(blob) {
    if (window.createImageBitmap) { try { return await createImageBitmap(blob); } catch (_) {} }
    return await new Promise((res, rej) => {
      const u = URL.createObjectURL(blob), im = new Image();
      im.onload = () => { URL.revokeObjectURL(u); res(im); };
      im.onerror = () => { URL.revokeObjectURL(u); rej(new Error('ảnh hỏng')); };
      im.src = u;
    });
  }
  const b64 = (cv) => { const u = cv.toDataURL('image/jpeg', 0.86); return u.slice(u.indexOf(',') + 1); };

  async function imageParts(blob, maxW, allowSlice) {
    const bm = await bitmap(blob);
    const ow = bm.width || bm.naturalWidth, oh = bm.height || bm.naturalHeight;
    const sc = ow > maxW ? maxW / ow : 1;
    const w = Math.max(1, Math.round(ow * sc)), h = Math.max(1, Math.round(oh * sc));
    if (!(allowSlice && h > w * 2.6)) {
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      cv.getContext('2d').drawImage(bm, 0, 0, w, h);
      if (bm.close) bm.close();
      return [b64(cv)];
    }
    const sh = Math.round(w * 1.7), ov = Math.round(sh * 0.08), out = [];
    for (let y = 0; y < h; y += sh - ov) {
      const hh = Math.min(sh, h - y);
      if (hh < 40 && out.length) break;
      const cv = document.createElement('canvas'); cv.width = w; cv.height = hh;
      cv.getContext('2d').drawImage(bm, 0, y / sc, ow, hh / sc, 0, 0, w, hh);
      out.push(b64(cv));
      if (y + hh >= h) break;
    }
    if (bm.close) bm.close();
    return out;
  }
  VB.img = { parts: imageParts };

  /* ========================== ZIP → CHƯƠNG ========================== */
  const IMG_RE = /\.(jpe?g|png|webp|bmp|gif|avif|tiff?)$/i;
  const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  VB.coll = coll;

  async function zipToChapters(file) {
    if (typeof JSZip === 'undefined') throw new Error('Thiếu jszip.min.js');
    const zip = await JSZip.loadAsync(file), map = new Map();
    Object.keys(zip.files).sort(coll.compare).forEach(path => {
      const e = zip.files[path];
      if (e.dir || path.includes('__MACOSX')) return;
      const base = path.split('/').pop();
      if (!base || base.startsWith('.') || !IMG_RE.test(base)) return;
      const parts = path.split('/').filter(Boolean);
      const ch = parts.length <= 1 ? '(gốc)' : parts.slice(0, -1).join(' / ');
      if (!map.has(ch)) map.set(ch, []);
      map.get(ch).push({ name: base, entry: e });
    });
    const out = [];
    for (const [name, list] of map) {
      list.sort((a, b) => coll.compare(a.name, b.name));
      const pages = [];
      for (const it of list) pages.push({ name: it.name, blob: await it.entry.async('blob') });
      out.push({ name, pages });
    }
    out.sort((a, b) => coll.compare(a.name, b.name));
    return out;
  }
  VB.zipToChapters = zipToChapters;

  /* ========================== KHO NGỮ CẢNH ========================== */
  function ctxGet() { try { return localStorage.getItem(LS_CTX) || ''; } catch (_) { return ''; } }
  function ctxSet(t) { try { localStorage.setItem(LS_CTX, t || ''); } catch (e) { alert('Ngữ cảnh quá lớn để lưu: ' + e.message); } window.dispatchEvent(new Event('vbs:ctx')); }
  function libList() { try { return JSON.parse(localStorage.getItem(LS_LIB) || '[]'); } catch (_) { return []; } }
  function libSave(name, text) {
    const lib = libList().filter(x => x.name !== name);
    lib.unshift({ name, text, at: Date.now() });
    while (lib.length > 30) lib.pop();
    try { localStorage.setItem(LS_LIB, JSON.stringify(lib)); }
    catch (e) { alert('Không lưu được vào thư viện (hết dung lượng trình duyệt): ' + e.message); }
    return lib;
  }
  VB.ctx = { get: ctxGet, set: ctxSet, libList, libSave };

  /* ========================== NAV ========================== */
  const PAGES = [
    { f: 'studio.html', t: '📚 Tạo ngữ cảnh' },
    { f: 'batch.html', t: '📦 Dịch hàng loạt' },
    { f: 'merge.html', t: '🔀 Gộp bản dịch' }
  ];
  function buildNav() {
    const nav = document.querySelector('.vbs-nav');
    if (!nav) return;
    const here = (location.pathname.split('/').pop() || 'studio.html').toLowerCase();
    nav.innerHTML = '';
    PAGES.forEach(p => {
      const a = document.createElement('a');
      a.className = 'vbs-tab' + (here === p.f ? ' on' : '');
      a.href = p.f; a.textContent = p.t;
      nav.appendChild(a);
    });
    const sp = document.createElement('span'); sp.className = 'vbs-sp'; nav.appendChild(sp);
    const kb = document.createElement('button');
    kb.className = 'vbs-btn'; kb.id = 'vbs-navkey'; kb.type = 'button';
    kb.onclick = keyModal;
    nav.appendChild(kb);
    const home = document.createElement('a');
    home.className = 'vbs-tab ghost'; home.href = 'index.html'; home.textContent = '← Trang chính';
    nav.appendChild(home);
    syncKeyBtn();
  }
  function syncKeyBtn() {
    const b = $('vbs-navkey'); if (!b) return;
    const s = keyStat();
    b.textContent = s.total ? `🔑 ${s.total} key` + (s.dead ? ` (${s.dead} lỗi)` : '') : '🔑 Thêm API key';
    b.classList.toggle('danger', !s.total);
  }
  window.addEventListener('vbs:keys', syncKeyBtn);
  setInterval(syncKeyBtn, 3000);

  function init() {
    buildNav();
    document.querySelectorAll('select[data-model]').forEach(sel => { fillModelSelect(sel); });
    if (!loadKeys().length) setTimeout(() => toast('Chưa có API key — bấm 🔑 trên thanh điều hướng', 4000), 600);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  VB.ready = true;
})();
