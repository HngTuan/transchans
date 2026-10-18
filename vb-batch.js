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
    const sel = S.chapters.filter(c => c.sel), pg = sel.reduce((s, c) =>
