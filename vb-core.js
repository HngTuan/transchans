/* vb-core.js — VisionBox Extension Core
 * - Kho cau hinh rieng (localStorage namespace rieng, khong dung chung voi config cua renderer.js)
 * - Pool toi da 5 API key: xoay vong + tu dong doi key khi dinh 429/503
 * - Quan ly Context (file ngu canh, glossary, van phong) -> khoi prompt
 * - Ham goi Gemini dung chung (trang batch dung truc tiep)
 * - Ham ghep song ngu: ban dich + dong goc "*...", SFX -> "(sfx)"
 */
(() => {
  'use strict';

  const LS_KEY = 'visionbox_ext_v1';
  const MAX_KEYS = 5;
  const MAX_CTX_CHARS = 24000;

  const DEFAULTS = {
    apiKeys: ['', '', '', '', ''],
    keyMode: 'rotate',            // 'rotate' = xoay vong moi request | 'sticky' = dung 1 key den khi loi
    context: {
      enabled: true,
      applyToOcr: false,          // co chen context vao buoc OCR khong (ton token hon)
      title: '',
      synopsis: '',
      tone: '',
      glossary: '',
      notes: '',
      files: []                   // [{name, size, enabled, text}]
    },
    bilingual: {
      enabled: true,
      marker: '*',                // ky tu dat truoc dong goc
      sfxTag: '(sfx)',
      tagSfxInPrompt: true        // yeu cau model gan (sfx) vao dau dong hieu ung am thanh
    },
    batch: {
      model: 'gemini-2.5-flash',
      sourceLang: 'ja',
      targetLang: 'vi',
      contentType: 'manga',
      skipSfx: false,
      styleGuide: true,
      concurrency: 1,
      maxWidth: 1400,
      sliceTall: true,
      delayMs: 700
    }
  };

  const LANG_NAMES = {
    ja: 'Japanese (日本語)',
    ko: 'Korean (한국어)',
    zh: 'Chinese (中文)',
    en: 'English',
    vi: 'Vietnamese (Tiếng Việt)'
  };

  // ---------------- store ----------------
  const clone = o => JSON.parse(JSON.stringify(o));

  function mergeDeep(base, patch) {
    if (!patch || typeof patch !== 'object') return base;
    Object.keys(patch).forEach(k => {
      const v = patch[k];
      if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
        mergeDeep(base[k], v);
      } else if (v !== undefined) {
        base[k] = v;
      }
    });
    return base;
  }

  function load() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      return raw ? mergeDeep(clone(DEFAULTS), JSON.parse(raw)) : clone(DEFAULTS);
    } catch (e) {
      console.warn('[VB] load config loi:', e);
      return clone(DEFAULTS);
    }
  }

  let data = load();

  function save() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(data));
      return true;
    } catch (e) {
      console.warn('[VB] save config loi (co the vuot quota localStorage):', e);
      return false;
    }
  }

  function resetAll() { data = clone(DEFAULTS); save(); }

  // ---------------- key pool ----------------
  const cooldown = new Map();   // key -> timestamp het cooldown
  let rr = 0;
  const stats = { calls: 0, ok: 0, fail: 0, byKey: {} };

  const getKeys = () => (data.apiKeys || []).map(k => (k || '').trim()).filter(Boolean).slice(0, MAX_KEYS);
  const keyLabel = k => (k ? k.slice(0, 6) + '…' + k.slice(-4) : '');
  const isCooling = k => (cooldown.get(k) || 0) > Date.now();
  const coolKey = (k, ms) => cooldown.set(k, Date.now() + (ms || 30000));

  function remainingCool() {
    const ks = getKeys();
    if (!ks.length) return 0;
    return Math.max(0, Math.min(...ks.map(k => (cooldown.get(k) || 0) - Date.now())));
  }
  const allCooling = () => { const ks = getKeys(); return ks.length > 0 && ks.every(isCooling); };

  function nextKey() {
    const ks = getKeys();
    if (!ks.length) return null;
    const free = ks.filter(k => !isCooling(k));
    const pool = free.length ? free : ks;
    if (data.keyMode === 'sticky') return pool[0];
    const k = pool[rr % pool.length];
    rr++;
    return k;
  }

  function keyStatusList() {
    return getKeys().map(k => ({
      label: keyLabel(k),
      cooling: isCooling(k),
      coolLeft: Math.max(0, Math.round(((cooldown.get(k) || 0) - Date.now()) / 1000)),
      used: stats.byKey[k] || 0
    }));
  }

  async function testKey(key) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`;
    const res = await fetch(url, { __vbManaged: true });
    if (res.ok) return { ok: true };
    const t = await res.text().catch(() => '');
    return { ok: false, status: res.status, message: t.slice(0, 200) };
  }

  // ---------------- helpers ----------------
  const langName = c => LANG_NAMES[c] || c;

  function sleep(ms, opt) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(resolve, ms);
      if (opt && opt.signal) {
        opt.signal.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
      }
    });
  }

  function extractText(json) {
    const cand = json && json.candidates && json.candidates[0];
    const parts = (cand && cand.content && cand.content.parts) || [];
    return parts.map(p => p.text || '').join('').trim();
  }

  function blockReason(json) {
    const pf = json && json.promptFeedback;
    if (pf && pf.blockReason) return 'Bi chan: ' + pf.blockReason;
    const cand = json && json.candidates && json.candidates[0];
    if (cand && cand.finishReason && cand.finishReason !== 'STOP') return 'finishReason: ' + cand.finishReason;
    return '';
  }

  // ---------------- goi Gemini (co failover key) ----------------
  async function callGemini(opt) {
    const keys = getKeys();
    if (!keys.length) throw new Error('Chưa có API key nào. Mở "Nâng cao" → tab API Keys (tối đa 5 key).');

    const model = opt.model || data.batch.model;
    const body = {
      contents: [{ role: 'user', parts: opt.parts }],
      generationConfig: Object.assign({ temperature: 0.3, topP: 0.95, maxOutputTokens: 8192 }, opt.generationConfig || {})
    };
    if (opt.systemInstruction) body.systemInstruction = { parts: [{ text: opt.systemInstruction }] };

    const rounds = opt.rounds || 3;
    const maxAttempts = Math.max(keys.length * rounds, 3);
    let lastErr = null;

    for (let i = 0; i < maxAttempts; i++) {
      if (opt.shouldStop && opt.shouldStop()) throw new Error('Đã dừng theo yêu cầu.');
      const key = nextKey();
      if (!key) throw new Error('Không có key khả dụng.');
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;

      stats.calls++;
      stats.byKey[key] = (stats.byKey[key] || 0) + 1;

      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: opt.signal,
          __vbManaged: true                 // danh dau de fetch-hook khong xu ly lai
        });

        if (res.ok) {
          const json = await res.json();
          const text = extractText(json);
          if (!text) throw new Error(blockReason(json) || 'Model trả về rỗng.');
          stats.ok++;
          return text;
        }

        const errTxt = await res.text().catch(() => '');
        stats.fail++;

        if (res.status === 429 || res.status === 503 || res.status === 500) {
          coolKey(key, res.status === 429 ? 45000 : 12000);
          lastErr = new Error(`HTTP ${res.status} (key ${keyLabel(key)})`);
          opt.onStatus && opt.onStatus(`HTTP ${res.status} → đổi key khác (${keyLabel(key)})`);
          const wait = allCooling() ? Math.min(Math.max(remainingCool(), 1000), 20000) : 500;
          await sleep(wait, opt);
          continue;
        }
        if (res.status === 400 && /API key not valid|API_KEY_INVALID/i.test(errTxt)) {
          coolKey(key, 10 * 60 * 1000);
          lastErr = new Error('API key không hợp lệ: ' + keyLabel(key));
          opt.onStatus && opt.onStatus(lastErr.message);
          continue;
        }
        if (res.status === 403) {
          coolKey(key, 5 * 60 * 1000);
          lastErr = new Error(`HTTP 403 (key ${keyLabel(key)}): ${errTxt.slice(0, 160)}`);
          continue;
        }
        throw Object.assign(new Error(`HTTP ${res.status}: ${errTxt.slice(0, 300)}`), { vbFatal: true });
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        if (e.vbFatal) throw e;          // 400/404/401… -> báo ngay, không retry vô ích
        lastErr = e;
        opt.onStatus && opt.onStatus('Lỗi: ' + e.message);
        await sleep(700, opt);
      }
    }
    throw lastErr || new Error('Gọi Gemini thất bại.');
  }

  // ---------------- context ----------------
  function contextCharCount() {
    const c = data.context;
    const fileChars = (c.files || []).filter(f => f.enabled !== false).reduce((s, f) => s + (f.text || '').length, 0);
    return (c.title + c.synopsis + c.tone + c.glossary + c.notes).length + fileChars;
  }

  function hasContext() {
    const c = data.context;
    if (!c.enabled) return false;
    return !!(c.title.trim() || c.synopsis.trim() || c.tone.trim() || c.glossary.trim() || c.notes.trim() ||
      (c.files || []).some(f => f.enabled !== false && (f.text || '').trim()));
  }

  function buildContextBlock(targetName, mode) {
    const c = data.context;
    if (!c.enabled) return '';
    const blocks = [];
    if (c.title.trim())    blocks.push('WORK TITLE: ' + c.title.trim());
    if (c.synopsis.trim()) blocks.push('STORY SO FAR / SETTING:\n' + c.synopsis.trim());
    if (c.tone.trim())     blocks.push('TONE & NARRATIVE VOICE TO KEEP:\n' + c.tone.trim());
    if (c.glossary.trim()) blocks.push('GLOSSARY — use EXACTLY these renderings (names, terms, forms of address):\n' + c.glossary.trim());
    if (c.notes.trim())    blocks.push('EXTRA NOTES:\n' + c.notes.trim());

    const files = (c.files || []).filter(f => f.enabled !== false && (f.text || '').trim());
    if (files.length) {
      let ref = files.map(f => `<<< FILE: ${f.name} >>>\n${f.text.trim()}`).join('\n\n');
      if (ref.length > MAX_CTX_CHARS) ref = '…(đã cắt bớt phần đầu)…\n' + ref.slice(-MAX_CTX_CHARS);
      blocks.push('REFERENCE MATERIAL (previous chapters, raw script, character sheet…):\n' + ref);
    }
    if (!blocks.length) return '';

    return `--- STORY CONTEXT (reference only — do NOT translate, do NOT output any part of this block) ---
${blocks.join('\n\n')}

HOW TO USE THIS CONTEXT
1. Keep names, nicknames, honorifics, pronouns/forms of address (xưng hô) and special terms EXACTLY consistent with the glossary and the material above.
2. Match the established tone, register and each character's individual voice; a line must sound like the same person who spoke in the reference material.
3. Use the context only to disambiguate (gender, who is speaking to whom, singular/plural, past events, running jokes). NEVER add information that is not in the current image/script.
4. The context NEVER changes the required output format, the number of lines, or their order.
--- END STORY CONTEXT ---`;
  }

  // ---------------- prompts (dung cho trang batch) ----------------
  function buildOcrPrompt(o) {
    const src = langName(o.sourceLang);
    const order = o.contentType === 'manga'
      ? 'Manga order: top-to-bottom, RIGHT-TO-LEFT (right panel/bubble first).'
      : 'Webtoon order: strictly top-to-bottom, left-to-right.';
    const sfx = o.skipSfx
      ? '- IGNORE sound effects / onomatopoeia drawn outside bubbles. Extract dialogue, narration boxes and on-screen text only.'
      : `- Sound effects / onomatopoeia: keep them, but write each one on its own line prefixed with "${o.sfxTag || '(sfx)'} ".`;
    return `You are a precise comic text extractor (OCR).
Extract every piece of text from this image in ${src}.
${order}

OUTPUT RULES
- Output ONLY the extracted text. No translation, no numbering, no bullets, no comments, no markdown.
- ONE LINE PER BUBBLE / narration box / caption. If a bubble has several visual lines, merge them into one line with single spaces.
- Keep the original wording, punctuation, and small kana/furigana notes if legible.
${sfx}
- Skip watermarks, page numbers, credits and unreadable text.
- If the image contains no text at all, output exactly: [NO TEXT]`;
  }

  function buildTranslatePrompt(o) {
    const src = langName(o.sourceLang), dst = langName(o.targetLang);
    const ctx = o.contextBlock ? o.contextBlock + '\n\n' : '';
    const style = o.styleBlock ? o.styleBlock + '\n\n' : '';
    const prev = o.prevTail ? `PREVIOUS PAGE (already translated, for flow only — do NOT re-output):\n${o.prevTail}\n\n` : '';
    const sfxRule = o.tagSfx
      ? `- A line that is a sound effect keeps its "${o.sfxTag}" prefix in the translation, e.g. "${o.sfxTag} Rầm!".`
      : '';
    return `${ctx}${style}You are a professional comic translator. Translate the script below from ${src} to ${dst}.

ABSOLUTE FORMAT RULES
- Output EXACTLY ${o.lineCount} line(s): one translated line per input line, in the same order.
- Never merge, split, drop, reorder, number or comment lines. Never output the original text.
- If a line cannot be translated meaningfully, output the closest natural equivalent (never leave it empty).
${sfxRule}

TRANSLATION RULES
- Natural spoken ${dst}, the way a real person would say it in that situation — not word-for-word.
- Keep each character's voice, level of politeness, slang, stammering, cut-off sentences and verbal tics.
- Keep interjections and emphasis; keep honorifics/forms of address consistent with the context block.
- Do not censor, do not summarise, do not add explanations or translator notes.

${prev}--- SCRIPT (${o.lineCount} lines) ---
${o.text}`;
  }

  function getStyleBlock(targetName, mode) {
    try {
      if (window.STYLE_SKILL && typeof window.STYLE_SKILL.buildBlock === 'function') {
        return window.STYLE_SKILL.buildBlock(targetName, mode || 'translate');
      }
    } catch (e) { /* ignore */ }
    return '';
  }

  // ---------------- song ngu ----------------
  function splitLines(t) {
    return String(t || '')
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map(s => s.trim())
      .filter(s => s && s !== '[NO TEXT]');
  }

  const SFX_RE = /^\s*(?:\(\s*sfx\s*\)|\[\s*sfx\s*\]|sfx\s*[:：\-–]|効果音\s*[:：]|효과음\s*[:：])\s*/i;
  const isSfxLine = l => SFX_RE.test(l || '');
  const stripSfx = l => String(l || '').replace(SFX_RE, '').trim();

  /**
   * Ghep ban dich + dong goc.
   *   Bản dịch
   *   *原文
   * SFX:
   *   (sfx) Rầm!
   *   *(sfx) ドォン
   */
  function mergeBilingual(sourceText, translatedText, opt) {
    const cfg = Object.assign({}, data.bilingual, opt || {});
    const marker = cfg.marker || '*';
    const tag = cfg.sfxTag || '(sfx)';
    const src = splitLines(sourceText);
    const dst = splitLines(translatedText);
    const n = Math.max(src.length, dst.length);
    const out = [];

    for (let i = 0; i < n; i++) {
      const rawS = src[i] || '';
      const rawT = dst[i] || '';
      if (!rawS && !rawT) continue;
      const sfx = isSfxLine(rawS) || isSfxLine(rawT);
      let t = sfx ? `${tag} ${stripSfx(rawT)}`.trim() : rawT;
      let s = sfx ? `${tag} ${stripSfx(rawS)}`.trim() : rawS;
      if (!t) t = '⟨thiếu bản dịch⟩';
      out.push(t);
      if (s) out.push(marker + s);
      out.push('');
    }
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  // ---------------- anh -> inline part ----------------
  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result).split(',')[1]);
      fr.onerror = () => reject(fr.error || new Error('Không đọc được ảnh'));
      fr.readAsDataURL(blob);
    });
  }

  function mimeOf(name) {
    const e = String(name).toLowerCase().split('.').pop();
    if (e === 'png') return 'image/png';
    if (e === 'webp') return 'image/webp';
    if (e === 'heic' || e === 'heif') return 'image/heic';
    return 'image/jpeg';
  }

  /** Thu nho anh (neu can) va tra ve {parts:[...], slices:n} */
  async function imageToParts(blob, o) {
    const maxWidth = (o && o.maxWidth) || 0;
    const sliceTall = !!(o && o.sliceTall);
    const sliceH = (o && o.sliceHeight) || 3000;
    let bmp = null;
    try { bmp = await createImageBitmap(blob); } catch (e) { bmp = null; }

    if (!bmp) {
      return [{ inline_data: { mime_type: blob.type || 'image/jpeg', data: await blobToBase64(blob) } }];
    }

    const scale = maxWidth && bmp.width > maxWidth ? maxWidth / bmp.width : 1;
    const w = Math.round(bmp.width * scale);
    const h = Math.round(bmp.height * scale);

    const pieces = [];
    if (sliceTall && h > sliceH * 1.3) {
      const overlap = Math.round(sliceH * 0.06);
      for (let y = 0; y < h; y += (sliceH - overlap)) {
        pieces.push([y, Math.min(sliceH, h - y)]);
        if (y + sliceH >= h) break;
      }
    } else {
      pieces.push([0, h]);
    }

    const parts = [];
    for (const [y, ph] of pieces) {
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = ph;
      const ctx = cv.getContext('2d');
      ctx.drawImage(bmp, 0, y / scale, bmp.width, ph / scale, 0, 0, w, ph);
      const dataUrl = cv.toDataURL('image/jpeg', 0.92);
      parts.push({ inline_data: { mime_type: 'image/jpeg', data: dataUrl.split(',')[1] } });
    }
    bmp.close && bmp.close();
    return parts;
  }

  function naturalCompare(a, b) {
    return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
  }

  // ---------------- public ----------------
  window.VB = {
    MAX_KEYS, LANG_NAMES,
    get data() { return data; },
    save, load: () => (data = load()), resetAll,
    getKeys, keyLabel, nextKey, coolKey, isCooling, keyStatusList, testKey, stats,
    callGemini, sleep,
    hasContext, contextCharCount, buildContextBlock,
    buildOcrPrompt, buildTranslatePrompt, getStyleBlock,
    splitLines, isSfxLine, stripSfx, mergeBilingual,
    imageToParts, blobToBase64, mimeOf, naturalCompare, langName
  };
})();
