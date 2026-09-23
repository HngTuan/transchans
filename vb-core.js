/* vb-core.js — VisionBox Extension Core v2
 * - Pool API key KHÔNG giới hạn số lượng: xoay vòng + cooldown + giới hạn RPM/key
 * - Kho Context (thư viện) lưu theo <Tên truyện> <khoảng chương>
 * - Prompt dịch nâng cấp: AI NHÌN ẢNH để chọn xưng hô + khớp dòng với bóng thoại
 * - Bộ prompt dựng Context 8 phần (port từ trans.py v5.0)
 */
(() => {
  'use strict';

  const LS_KEY    = 'visionbox_ext_v1';
  const LS_CTXLIB = 'visionbox_ctxlib_v1';
  const MAX_CTX_CHARS = 60000;
  const SOFT_MAX_KEYS = 200;

  // ================= DEFAULTS =================
  const DEFAULTS = {
    apiKeys: [],
    keyMode: 'rotate',          // rotate | sticky
    rpmPerKey: 12,
    context: {
      enabled: true,
      applyToOcr: false,
      title: '',
      synopsis: '',
      tone: '',
      glossary: '',
      notes: '',
      files: []                 // [{name, size, enabled, text}]
    },
    bilingual: { enabled: true, marker: '*', sfxTag: '(sfx)', tagSfxInPrompt: true },
    batch: {
      model: 'gemini-2.5-flash', sourceLang: 'ja', targetLang: 'vi',
      contentType: 'manga', skipSfx: false, styleGuide: true,
      concurrency: 1, maxWidth: 1400, sliceTall: true, delayMs: 700, auditOcr: false
    },
    ctxb: {                      // cấu hình trang "Tạo context"
      model: 'gemini-2.5-flash',
      series: '', range: '',
      batchSize: 8, maxSide: 1280, quality: 0.9,
      useWeb: true, accumulate: true, autoBase: true, unionRange: true,
      genreAuto: true, genres: [], genreExtra: '', notes: '',
      targetLang: 'vi', delayMs: 800
    }
  };

  const LANG_NAMES = {
    ja: 'Japanese (日本語)', ko: 'Korean (한국어)', zh: 'Chinese (中文)',
    en: 'English', vi: 'Vietnamese (Tiếng Việt)'
  };

  // ================= THỂ LOẠI (port trans.py) =================
  const GENRE_PRESETS = {
    'Action': 'Nhịp nhanh, câu ngắn và dứt khoát. Động từ mạnh, hạn chế trạng từ rườm rà. Thoại giao tranh cắt vụn, hô hào ngắn. SFX mạnh: Rầm, Xoẹt, Choang, Ầm.',
    'Adventure': 'Giọng tường thuật háo hức, mô tả không gian gọn nhưng gợi hình. Địa danh giữ nhất quán.',
    'Fantasy': 'Từ vựng huyền huyễn ổn định: phép thuật, ma pháp, tinh linh, thánh vật. Tránh Hán–Việt nặng nếu không cần.',
    'Isekai': 'Giọng kể có chút hài và tự thoại nội tâm nhiều. Thuật ngữ chuyển sinh, kỹ năng, cấp độ theo chuẩn cộng đồng.',
    'Tu tiên / Xianxia': 'Hán–Việt vừa phải, trang trọng: cảnh giới, đan dược, linh khí, đạo hữu. Xưng hô theo vai vế môn phái.',
    'Võ lâm / Murim': 'Giọng hào sảng, xưng hô võ lâm (lão phu, tại hạ, cô nương) khi hợp bối cảnh; thoại đối đầu ngắn, sắc.',
    'Sci-fi': 'Thuật ngữ kỹ thuật chính xác, giữ tên riêng khoa học; không làm mềm hoá thuật ngữ chuyên môn.',
    'Mecha': 'Tên máy/khí giới giữ nguyên dạng phổ biến; lệnh chiến đấu ngắn, dứt như khẩu lệnh.',
    'Cyberpunk': 'Giọng lạnh, tiếng lóng đô thị, câu cụt. Cho phép chêm tiếng Anh đã quen dùng.',
    'Horror': 'Câu ngắn, khoảng lặng nhiều, dùng dấu … tạo nhịp nghẹn. Tránh giải thích.',
    'Psychological': 'Nội tâm dài hơn, mạch lập luận rõ, từ chính xác về cảm xúc; giữ sự lạnh và mơ hồ có chủ ý.',
    'Mystery / Trinh thám': 'Suy luận logic chặt; giữ nguyên manh mối, không diễn giải thêm.',
    'Thriller': 'Nhịp dồn, câu ngắn dần khi cao trào; hạn chế từ đệm.',
    'Drama': 'Thoại giàu cảm xúc nhưng tiết chế, tránh sáo rỗng. Ưu tiên khẩu ngữ thật.',
    'Romance': 'Thoại mềm, tinh tế; xưng hô là trục cảm xúc chính, theo sát tiến triển quan hệ để đổi cặp đúng lúc.',
    'Harem': 'Giọng mỗi nhân vật nữ phải khác biệt rõ; hài tình huống giữ nhẹ, tránh thô.',
    'Comedy': 'Hài thoại tự nhiên kiểu Việt, được phép chuyển chơi chữ sang chơi chữ tương đương. Nhịp chốt câu gọn.',
    'Slice of Life': 'Khẩu ngữ hằng ngày, thoại rời rạc tự nhiên, không văn vẻ hoá.',
    'School Life': 'Xưng hô học đường: tớ/cậu, mình/bạn, anh/em theo khoá; senpai xử lý theo quy ước PHẦN 8.',
    'Sports': 'Hô hào ngắn, thuật ngữ thể thao chuẩn tiếng Việt; lời bình sôi nổi nhưng gọn.',
    'Cooking / Gourmet': 'Tên món và nguyên liệu giữ dạng phổ biến, có thể kèm chữ gốc; miêu tả vị giác gợi hình.',
    'Idol / Music': 'Thuật ngữ sân khấu, tên bài giữ nguyên; thoại giữ năng lượng cao.',
    'Historical / Cổ trang': 'Trang trọng, ít từ hiện đại; chức danh và địa danh nhất quán theo bảng thuật ngữ.',
    'Military / War': 'Khẩu lệnh, cấp bậc, mã hiệu đúng chuẩn quân sự tiếng Việt.',
    'Supernatural': 'Yêu quái, linh dị: giữ tên gốc kèm giải nghĩa lần đầu, sau đó dùng nhất quán.',
    'Game / System (LitRPG)': 'Khung hệ thống theo mẫu chuẩn: [Thông báo], Kỹ năng, Cấp, EXP, Nhiệm vụ. Giữ ngoặc và viết hoa nhất quán.',
    'Regression / Hồi quy': 'Phân biệt rõ mốc quá khứ và hiện tại trong nội tâm; giọng nhân vật chính già dặn hơn tuổi.',
    'Villainess': 'Giọng quý tộc châm biếm, lịch sự nhưng có gai; xưng hô theo tước vị.',
    'Shounen': 'Nhiệt, thẳng, nhiều câu cảm thán; tình bạn và quyết tâm nói thẳng.',
    'Shoujo': 'Mềm, nhiều nội tâm; nhịp câu chậm, dấu … dùng nhiều.',
    'Seinen': 'Người lớn, tiết chế, ít cảm thán; cho phép câu dài hơn và từ vựng sắc sảo.',
    'Josei': 'Trưởng thành, thực tế, thoại nhiều hàm ý; tránh ngôn tình hoá.',
    'Ecchi': 'Giữ mức gợi mà không thô; tránh dung tục hoá quá mức so với bản gốc.',
    'BL': 'Xưng hô nam–nam theo tiến triển quan hệ; giữ tinh tế, tránh khuôn mẫu.',
    'GL': 'Xưng hô nữ–nữ theo tiến triển quan hệ; giữ tinh tế, tránh khuôn mẫu.',
    'Iyashikei / Chữa lành': 'Nhịp chậm, câu êm, ưu tiên hình ảnh yên bình; không kịch tính hoá.'
  };
  const GENRES = Object.keys(GENRE_PRESETS);

  // ================= STORE =================
  const clone = o => JSON.parse(JSON.stringify(o));
  function mergeDeep(base, patch) {
    if (!patch || typeof patch !== 'object') return base;
    Object.keys(patch).forEach(k => {
      const v = patch[k];
      if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) mergeDeep(base[k], v);
      else if (v !== undefined) base[k] = v;
    });
    return base;
  }
  function load() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      const d = raw ? mergeDeep(clone(DEFAULTS), JSON.parse(raw)) : clone(DEFAULTS);
      d.apiKeys = (d.apiKeys || []).map(k => String(k || '').trim()).filter(Boolean);
      return d;
    } catch (e) { console.warn('[VB] load config lỗi:', e); return clone(DEFAULTS); }
  }
  let data = load();
  function save() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(data)); return true; }
    catch (e) { console.warn('[VB] save lỗi (có thể vượt quota localStorage):', e); return false; }
  }
  function resetAll() { data = clone(DEFAULTS); save(); }

  // ================= KEY POOL (không giới hạn) =================
  const cooldown = new Map();
  const calls = new Map();            // key -> [timestamp...]
  let rr = 0;
  const stats = { calls: 0, ok: 0, fail: 0, byKey: {} };

  const getKeys = () => (data.apiKeys || []).map(k => (k || '').trim()).filter(Boolean).slice(0, SOFT_MAX_KEYS);
  const keyLabel = k => (k ? k.slice(0, 6) + '…' + k.slice(-4) : '');
  const isCooling = k => (cooldown.get(k) || 0) > Date.now();
  const coolKey = (k, ms) => cooldown.set(k, Date.now() + (ms || 30000));
  const allCooling = () => { const ks = getKeys(); return ks.length > 0 && ks.every(isCooling); };
  function remainingCool() {
    const ks = getKeys();
    if (!ks.length) return 0;
    return Math.max(0, Math.min.apply(null, ks.map(k => (cooldown.get(k) || 0) - Date.now())));
  }
  function rpmBusy(k) {
    const lim = Math.max(1, +data.rpmPerKey || 12);
    const now = Date.now();
    const arr = (calls.get(k) || []).filter(t => now - t < 60000);
    calls.set(k, arr);
    return arr.length >= lim;
  }
  function markCall(k) { const arr = calls.get(k) || []; arr.push(Date.now()); calls.set(k, arr); }

  function nextKey() {
    const ks = getKeys();
    if (!ks.length) return null;
    if (data.keyMode === 'sticky') {
      const free = ks.filter(k => !isCooling(k));
      return (free[0] || ks[0]);
    }
    const free = ks.filter(k => !isCooling(k) && !rpmBusy(k));
    const pool = free.length ? free : (ks.filter(k => !isCooling(k)).length ? ks.filter(k => !isCooling(k)) : ks);
    const k = pool[rr % pool.length];
    rr++;
    return k;
  }

  function keyStatusList() {
    return getKeys().map(k => ({
      label: keyLabel(k), cooling: isCooling(k),
      coolLeft: Math.max(0, Math.round(((cooldown.get(k) || 0) - Date.now()) / 1000)),
      used: stats.byKey[k] || 0
    }));
  }

  async function testKey(key) {
    try {
      const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?key=' + encodeURIComponent(key), { __vbManaged: true });
      if (res.ok) return { ok: true };
      const t = await res.text().catch(() => '');
      return { ok: false, status: res.status, message: t.slice(0, 160) };
    } catch (e) { return { ok: false, message: e.message }; }
  }

  /** Tách key từ text/file: mỗi dòng 1 key, chấp nhận cả CSV/JSON/.env */
  function parseKeys(text) {
    const raw = String(text || '');
    let list = [];
    try {
      const j = JSON.parse(raw);
      if (Array.isArray(j)) list = j.map(x => typeof x === 'string' ? x : (x && (x.key || x.apiKey)) || '');
      else if (j && Array.isArray(j.keys)) list = j.keys.map(x => typeof x === 'string' ? x : (x && x.key) || '');
    } catch (e) { /* không phải JSON */ }
    if (!list.length) {
      list = raw.split(/[\r\n,;]+/).map(s => s.replace(/^[^=]*=\s*/, '').trim().replace(/^["']|["']$/g, ''));
    }
    const out = [], seen = new Set();
    list.forEach(k => {
      k = String(k || '').trim();
      if (k.length >= 15 && !/\s/.test(k) && !seen.has(k)) { seen.add(k); out.push(k); }
    });
    return out.slice(0, SOFT_MAX_KEYS);
  }

  // ================= TIỆN ÍCH =================
  const langName = c => LANG_NAMES[c] || c;
  const fmt = (t, o) => String(t).replace(/\{(\w+)\}/g, (m, k) => (o && o[k] !== undefined && o[k] !== null ? o[k] : m));
  function sleep(ms, opt) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(resolve, ms);
      if (opt && opt.signal) opt.signal.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
    });
  }
  const naturalCompare = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
  const chunkList = (arr, n) => { n = Math.max(1, n | 0); const o = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; };
  const safeName = s => String(s || 'Khong_ten').replace(/[\\/:*?"<>|\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Khong_ten';

  function parseJsonLoose(text) {
    if (!text) return null;
    let t = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    try { return JSON.parse(t); } catch (e) {}
    const pairs = [['{', '}'], ['[', ']']];
    for (const [a, b] of pairs) {
      const i = t.indexOf(a), j = t.lastIndexOf(b);
      if (i !== -1 && j > i) { try { return JSON.parse(t.slice(i, j + 1)); } catch (e) {} }
    }
    return null;
  }

  // --- khoảng chương ---
  function chapterNumbers(name) {
    const s = String(name || '');
    const m = /(\d{1,6})\s*[-–~]\s*(\d{1,6})/.exec(s);
    if (m) { const a = +m[1], b = +m[2]; if (a <= b) return [a, b]; }
    const stem = s.replace(/\.[A-Za-z0-9]{1,5}$/, '');
    const k = stem.match(/(?:chap(?:ter)?|chuong|chương|ch|ep|episode|tap|tập)\s*[._\-#]*\s*(\d{1,6})/ig);
    if (k && k.length) { const n = +(/(\d{1,6})\s*$/.exec(k[k.length - 1]) || [])[1]; if (!isNaN(n)) return [n]; }
    const nums = stem.match(/\d{1,6}/g);
    return nums ? [+nums[nums.length - 1]] : [];
  }
  function rangeLabel(names) {
    let nums = [];
    (names || []).forEach(n => { nums = nums.concat(chapterNumbers(n)); });
    if (!nums.length) { const n = Math.max(1, (names || []).length); return n === 1 ? '1' : '1-' + n; }
    const a = Math.min.apply(null, nums), b = Math.max.apply(null, nums);
    return a === b ? String(a) : a + '-' + b;
  }
  function cleanRange(text) {
    let s = String(text || '').replace(/[^\d\-–~]/g, '').replace(/[–~]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    const p = s.split('-').filter(Boolean);
    if (!p.length) return '';
    if (p.length === 1) return String(+p[0]);
    let a = +p[0], b = +p[p.length - 1];
    if (a > b) { const t = a; a = b; b = t; }
    return a === b ? String(a) : a + '-' + b;
  }
  function unionRange(a, b) {
    const bd = l => { const c = cleanRange(l); if (!c) return null; const p = c.split('-'); return [+p[0], +p[p.length - 1]]; };
    const x = bd(a), y = bd(b);
    if (!x) return cleanRange(b);
    if (!y) return cleanRange(a);
    const lo = Math.min(x[0], y[0]), hi = Math.max(x[1], y[1]);
    return lo === hi ? String(lo) : lo + '-' + hi;
  }

  // ================= GỌI GEMINI =================
  const FLAGS = { schema: true, tools: true };

  async function callGemini(opt) {
    const keys = getKeys();
    if (!keys.length) throw new Error('Chưa có API key. Mở ⚙ Nâng cao → tab API Keys.');

    const model = opt.model || data.batch.model;
    const gen = Object.assign({ temperature: 0.3, topP: 0.95, maxOutputTokens: 8192 }, opt.generationConfig || {});
    if (opt.jsonOut || opt.schema) gen.responseMimeType = 'application/json';
    if (opt.schema && FLAGS.schema) gen.responseSchema = opt.schema;

    const body = { contents: [{ role: 'user', parts: opt.parts }], generationConfig: gen };
    const sys = opt.system || opt.systemInstruction;
    if (sys) body.systemInstruction = { parts: [{ text: sys }] };
    if (opt.useSearch && FLAGS.tools) body.tools = [{ google_search: {} }];

    const rounds = opt.rounds || 3;
    const maxAttempts = Math.max(keys.length * rounds, 4);
    let lastErr = null;

    for (let i = 0; i < maxAttempts; i++) {
      if (opt.shouldStop && opt.shouldStop()) throw new Error('Đã dừng theo yêu cầu.');
      const key = nextKey();
      if (!key) throw new Error('Không có key khả dụng.');
      if (rpmBusy(key) && !allCooling()) await sleep(700, opt);
      markCall(key);
      stats.calls++; stats.byKey[key] = (stats.byKey[key] || 0) + 1;

      try {
        const res = await fetch(
          'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(key),
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: opt.signal, __vbManaged: true }
        );

        if (res.ok) {
          const json = await res.json();
          const cand = (json.candidates || [])[0];
          const text = (((cand && cand.content && cand.content.parts) || []).map(p => p.text || '').join('')).trim();
          if (!text) {
            if (cand && cand.finishReason === 'MAX_TOKENS') {
              gen.maxOutputTokens = Math.min(Math.round((gen.maxOutputTokens || 8192) * 1.8), 65536);
              lastErr = new Error('Trả lời bị cắt → tăng maxOutputTokens');
              opt.onStatus && opt.onStatus('Trả lời bị cắt, thử lại với ' + gen.maxOutputTokens + ' token…');
              continue;
            }
            const why = (json.promptFeedback && json.promptFeedback.blockReason) || (cand && cand.finishReason) || 'rỗng';
            throw new Error('Gemini: ' + why);
          }
          stats.ok++;
          return text;
        }

        const errTxt = await res.text().catch(() => '');
        const low = errTxt.toLowerCase();
        stats.fail++;

        if (res.status === 400 && FLAGS.schema && low.indexOf('schema') !== -1) {
          FLAGS.schema = false; delete gen.responseSchema;
          opt.onStatus && opt.onStatus('Model không nhận responseSchema → bỏ schema, gọi lại.');
          continue;
        }
        if (res.status === 400 && FLAGS.tools && (low.indexOf('tool') !== -1 || low.indexOf('search') !== -1)) {
          FLAGS.tools = false; delete body.tools;
          opt.onStatus && opt.onStatus('Model không hỗ trợ tra web → tắt tra web.');
          continue;
        }
        if (res.status === 429 || res.status === 503 || res.status === 500) {
          coolKey(key, res.status === 429 ? 45000 : 12000);
          lastErr = new Error('HTTP ' + res.status + ' (key ' + keyLabel(key) + ')');
          opt.onStatus && opt.onStatus('HTTP ' + res.status + ' → đổi key khác…');
          await sleep(allCooling() ? Math.min(Math.max(remainingCool(), 1200), 20000) : 600, opt);
          continue;
        }
        if (res.status === 400 && /API key not valid|API_KEY_INVALID/i.test(errTxt)) {
          coolKey(key, 600000);
          lastErr = new Error('API key không hợp lệ: ' + keyLabel(key));
          continue;
        }
        if (res.status === 401 || res.status === 403) {
          coolKey(key, 300000);
          lastErr = new Error('HTTP ' + res.status + ' (key ' + keyLabel(key) + ')');
          continue;
        }
        throw Object.assign(new Error('HTTP ' + res.status + ': ' + errTxt.slice(0, 300)), { vbFatal: true });
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        if (e.vbFatal) throw e;
        lastErr = e;
        opt.onStatus && opt.onStatus('Lỗi: ' + e.message);
        await sleep(700, opt);
      }
    }
    throw lastErr || new Error('Gọi Gemini thất bại.');
  }

  async function callGeminiJson(opt) {
    for (let i = 0; i < 3; i++) {
      const raw = await callGemini(Object.assign({}, opt, { jsonOut: true }));
      const j = parseJsonLoose(raw);
      if (j) return j;
      opt = Object.assign({}, opt, { generationConfig: Object.assign({}, opt.generationConfig, { temperature: Math.min(0.9, ((opt.generationConfig || {}).temperature || 0.3) + 0.15) }) });
      opt.onStatus && opt.onStatus('JSON sai định dạng, gọi lại…');
    }
    return null;
  }

  // ================= CONTEXT (khối chèn vào prompt) =================
  function contextCharCount() {
    const c = data.context;
    const f = (c.files || []).filter(x => x.enabled !== false).reduce((s, x) => s + (x.text || '').length, 0);
    return (c.title + c.synopsis + c.tone + c.glossary + c.notes).length + f;
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
    const b = [];
    if (c.title.trim())    b.push('WORK TITLE: ' + c.title.trim());
    if (c.synopsis.trim()) b.push('STORY SO FAR / SETTING:\n' + c.synopsis.trim());
    if (c.tone.trim())     b.push('TONE & NARRATIVE VOICE TO KEEP:\n' + c.tone.trim());
    if (c.glossary.trim()) b.push('GLOSSARY — use EXACTLY these renderings:\n' + c.glossary.trim());
    if (c.notes.trim())    b.push('EXTRA NOTES:\n' + c.notes.trim());
    const files = (c.files || []).filter(f => f.enabled !== false && (f.text || '').trim());
    if (files.length) {
      let ref = files.map(f => '<<< FILE: ' + f.name + ' >>>\n' + f.text.trim()).join('\n\n');
      if (ref.length > MAX_CTX_CHARS) ref = '…(đã cắt bớt phần đầu)…\n' + ref.slice(-MAX_CTX_CHARS);
      b.push('REFERENCE MATERIAL (context file, previous chapters, character sheet…):\n' + ref);
    }
    if (!b.length) return '';
    return `--- STORY CONTEXT (reference only — do NOT translate, do NOT output any part of this block) ---
${b.join('\n\n')}

HOW TO USE THIS CONTEXT
1. Names, nicknames, honorifics, FORMS OF ADDRESS (xưng hô) and special terms must match this document EXACTLY. The pair table (PHẦN 4) overrides your own instinct.
2. If a source word appears in the original-script lookup table (PHẦN 7), use the exact rendering listed there.
3. Match the established tone, register and each character's individual voice.
4. Use the context only to disambiguate (gender, who speaks to whom, past events). NEVER add information absent from the current page.
5. The context NEVER changes the required output format, the number of lines, or their order.
--- END STORY CONTEXT ---`;
  }

  /** Khối "nhìn ảnh để chọn xưng hô + khớp bóng thoại" — dùng cho MỌI prompt dịch */
  function buildVisionBlock(targetName, order) {
    const dst = targetName || 'the target language';
    const ord = order || 'the natural reading order of this comic';
    return `--- VISUAL GROUNDING & FORMS OF ADDRESS (silent analysis — never output any of it) ---
STEP 1 — MAP LINES TO BUBBLES
- Look at the page image. Find every speech bubble, thought bubble, caption box and on-panel text, in ${ord}. Count them.
- Script line 1 = the 1st text unit in that order, line 2 = the 2nd, and so on. Verify each line against its bubble using length, punctuation and wording. If a line clearly belongs to a different bubble than its position suggests, still keep the given line order, but translate that line using the context of the bubble it truly matches.
- A bubble's tail points at its speaker. Thought bubbles (cloud/dotted) are inner monologue: render them as inner voice, not as spoken dialogue. Caption boxes are narration: use narrative register, never a spoken tone.

STEP 2 — READ THE PEOPLE, THEN CHOOSE THE PRONOUNS
For each bubble decide from the ART, not only from the words: who speaks, who they speak to (eye line, body facing, panel layout), apparent age gap, gender, uniform / rank / clothing, social setting (school, office, court, battlefield, family home), facial expression and emotional intensity (calm, shouting, crying, mocking, pleading).
- Then choose the correct pair of ${dst} first/second-person pronouns and terms of address for that speaker→listener pair.
- KEEP THE PAIR STABLE for the whole page and consistent with the STORY CONTEXT block. Only switch pair when the art itself shows the relationship shifting (sudden rage, sudden intimacy, a reveal) — that is meaningful, not noise.
- Speaking to a crowd, to oneself, or to an unseen person uses the neutral pair defined by the context; never invent a familiar pair for a stranger.
- Honorific suffixes and rank words in the source are evidence about the relationship: read them, then express the same social distance naturally in ${dst} instead of transliterating blindly.

STEP 3 — MATCH THE BUBBLE, NOT THE DICTIONARY
- A small bubble needs a short line; a large jagged bubble needs a shout; a trailing bubble needs an unfinished sentence. Fit the length and the energy of the drawn bubble.
--- END VISUAL GROUNDING ---`;
  }

  // ================= PROMPT OCR / DỊCH =================
  function buildOcrPrompt(o) {
    const src = langName(o.sourceLang);
    const order = o.contentType === 'manga'
      ? 'Manga order: top-to-bottom, RIGHT-TO-LEFT (rightmost panel/bubble of each tier first).'
      : 'Webtoon order: strictly top-to-bottom, then left-to-right.';
    const sfx = o.skipSfx
      ? '- IGNORE sound effects / onomatopoeia drawn onto the artwork with no enclosing outline. Extract dialogue, narration boxes and on-screen signs only.'
      : '- Sound effects / onomatopoeia: keep them, each on its own line, in true reading position, prefixed with "' + (o.sfxTag || '(sfx)') + ' ".';
    return `You are a precise comic text extractor (OCR).
Extract every piece of text from this image in ${src}.
${order}

BUBBLE BOUNDARY RULE (most important, most often gotten wrong)
- A bubble is ONE fully enclosed outline (oval, cloud, jagged shout shape, or rectangular caption box). ALL text inside that one outline is ONE output line, even when it visually wraps onto 2-5 rows — join the wrapped fragments with single spaces.
- Two different outlines = two different output lines, even if they touch, overlap, or read as one continuous sentence.
- Before answering, re-check each line: does it correspond to EXACTLY one outline on the page?

OUTPUT RULES
- Output ONLY the extracted text. No translation, no numbering, no bullets, no comments, no markdown.
- Keep the original wording and punctuation, character for character.
${sfx}
- Skip watermarks, page numbers, credits, scanlation group names and unreadable text.
- Skip a bubble entirely if it has no legible text; never write "(blank)" / "(no text)".
- If the image contains no text at all, output exactly: [NO TEXT]`;
  }

  function buildTranslatePrompt(o) {
    const src = langName(o.sourceLang), dst = langName(o.targetLang);
    const order = o.contentType === 'manga'
      ? 'manga order (top-to-bottom, right-to-left)'
      : 'webtoon order (top-to-bottom, left-to-right)';
    const ctx = o.contextBlock ? o.contextBlock + '\n\n' : '';
    const style = o.styleBlock ? o.styleBlock + '\n\n' : '';
    const vision = o.noVision ? '' : buildVisionBlock(dst, order) + '\n\n';
    const prev = o.prevTail ? 'PREVIOUS PAGE (already translated, for flow only — do NOT re-output):\n' + o.prevTail + '\n\n' : '';
    const sfxRule = o.tagSfx ? '- A line that is a sound effect keeps its "' + o.sfxTag + '" prefix in the translation, e.g. "' + o.sfxTag + ' Rầm!".\n' : '';
    return `${ctx}${style}${vision}You are a professional comic translator. The page image is attached: you can SEE it. Translate the script below from ${src} to ${dst}.

ABSOLUTE FORMAT RULES
- Output EXACTLY ${o.lineCount} line(s): one translated line per input line, in the same order.
- Never merge, split, drop, reorder, number or comment lines. Never output the original text, the analysis, or any header.
${sfxRule}- If a line cannot be translated meaningfully, output the closest natural equivalent (never leave it empty).

TRANSLATION RULES
- Natural spoken ${dst}, the way a real person would say it in that exact situation — translate meaning and nuance, not sentence structure.
- Apply the forms of address you decided in the visual analysis above; they must stay consistent with the STORY CONTEXT.
- Keep each character's voice, politeness level, slang, stammering, cut-off sentences, interjections and verbal tics.
- Use normal sentence case even if the source is ALL CAPS. Keep 「」 …！？ nuance with the ${dst} equivalents.
- Do not censor, summarise, explain, or add translator notes.

${prev}--- SCRIPT (${o.lineCount} lines, one bubble per line, in reading order) ---
${o.text}`;
  }

  /** Soát lại OCR: gộp đúng bóng thoại + đúng thứ tự đọc (port P_AUDIT) */
  function buildAuditPrompt(o) {
    const src = langName(o.sourceLang);
    const order = o.contentType === 'manga'
      ? 'manga order: top-to-bottom, RIGHT-TO-LEFT'
      : 'webtoon order: top-to-bottom, LEFT-TO-RIGHT';
    return `You are proofreading an existing OCR scan of this ${src} comic page against the actual image.

PREVIOUS OCR RESULT (one line per bubble, may contain mistakes):
${o.text}

FIX, IN THIS PRIORITY ORDER
1. Text of ONE bubble wrongly split across several lines → merge back into ONE line (join with single spaces). This is the most frequent error.
2. Two DIFFERENT bubbles wrongly merged into one line → split them back.
3. Wrong reading order → reorder to ${order}. Re-check every bubble against the drawing, not against the previous list.
4. Missing bubbles / captions / on-screen signs → add them at their correct position.
5. Wrong characters → correct them. Do NOT translate; keep the original ${src} text exactly.

Never invent text. Never write "(blank)". If the previous result was already correct, return it unchanged.
Return ONLY the corrected lines, one bubble per line, nothing else.`;
  }

  function getStyleBlock(targetName, mode) {
    try {
      if (window.STYLE_SKILL && typeof window.STYLE_SKILL.buildBlock === 'function')
        return window.STYLE_SKILL.buildBlock(targetName, mode || 'translate');
    } catch (e) {}
    return '';
  }

  // ================= PROMPT DỰNG CONTEXT (port trans.py) =================
  const SYS_ANALYST = 'Bạn là biên tập viên kiêm nhà phân tích truyện tranh, xây dựng tài liệu tham chiếu (context) cho nhóm dịch tiếng Việt. Bạn đọc trực tiếp trang truyện: thoại, nội tâm, lời dẫn, chữ nền, biểu cảm. Bạn LUÔN ghi lại chữ gốc (kanji/kana hoặc chữ gốc của raw) cho mọi tên riêng và thuật ngữ. Trả lời tiếng Việt, chỉ ghi điều thực sự có trong ảnh, không bịa.';

  const SYS_KEEPER = 'Bạn là người quản thủ tài liệu context của một bộ truyện dài kỳ. Nguyên tắc tối cao: DỮ LIỆU CŨ LÀ BẤT KHẢ XÂM PHẠM. Bạn chỉ được BỔ SUNG dữ liệu mới vào đúng chỗ, tuyệt đối không xoá, không viết lại, không rút gọn, không đổi cách dịch tên riêng/thuật ngữ đã chốt trong bản cũ. Mỗi lần cập nhật, bản context trả về phải CHỨA TRỌN VẸN bản cũ cộng thêm phần mới. Nếu phát hiện xung đột, giữ bản cũ và ghi chú xung đột ở dòng mới.';

  const P_GENRE = `Đây là một số trang mẫu của tác phẩm{title_part}.

Nhìn tranh, bố cục, trang phục, hiệu ứng, kiểu thoại và xác định THỂ LOẠI.
Chỉ được chọn nhãn trong danh sách sau (chọn 2–5 nhãn phù hợp nhất, xếp theo mức đúng giảm dần):
{list}

Trả JSON: genres = danh sách nhãn đã chọn; note = 1–3 câu tiếng Việt giải thích căn cứ và mô tả không khí/văn phong chủ đạo. Không tạo nhãn mới nếu đã có nhãn tương đương.`;

  const P_CTX_BATCH = `Đây là {n} trang liên tiếp của "{chap}" (thứ tự đọc: {files}).

THỂ LOẠI VÀ ĐỊNH HƯỚNG VĂN PHONG ĐÃ BIẾT:
{genres}
{known}
Đọc kỹ từng trang và trả JSON đầy đủ, CHI TIẾT (đây là dữ liệu thô để dựng context, thà dài hơn là thiếu):

- characters: mỗi nhân vật xuất hiện gồm:
  name_src = tên viết bằng CHỮ GỐC đúng như trong trang; romaji = phiên âm; name_vi = tên tiếng Việt đề xuất dùng nhất quán;
  importance = main / support / minor; role, traits, voice (mức lịch sự, tật ngôn ngữ, độ dài câu, từ hay dùng);
  self_ref = cách nhân vật TỰ XƯNG trong raw kèm suy luận sang tiếng Việt;
  addressing = danh sách cặp xưng hô với TỪNG nhân vật khác: to = tên nhân vật kia, raw = từ gọi trong raw, pair = cặp đại từ tiếng Việt đề xuất (ví dụ "tôi – cậu"), note = điều kiện đổi cặp.
  Với nhân vật minor: chỉ cần một cặp mặc định mang tính hình thức.
  Quan trọng: hãy NHÌN TRANH để suy ra tuổi tác, giới tính, vai vế, đồng phục/chức vụ, biểu cảm — đó là căn cứ chọn cặp xưng hô.

- relations: "A – B: quan hệ".
- glossary: term_src (CHỮ GỐC) | romaji | meaning | suggest_vi | note.
- src_words: src (chữ gốc) | romaji | vi | kind (name/term/honorific/sfx/phrase/other). Ghi cả hậu tố và SFX hay lặp.
- beats: diễn biến theo thứ tự, mỗi trang ít nhất một dòng nếu có tình tiết.
- genres: thể loại bạn nhận thấy ở các trang này.
- tone: không khí, văn phong chủ đạo.
- cautions: chỗ dễ dịch sai, chơi chữ, phương ngữ, chữ mờ, chữ gốc dễ nhầm mặt chữ.

Trường không có dữ liệu để mảng rỗng. Không bịa nhân vật/thuật ngữ chưa xuất hiện.
{notes}`;

  const P_RESEARCH = `Hãy TRA CỨU TRÊN MẠNG để bổ sung thông tin phục vụ bản dịch tiếng Việt.

Từ khóa/tên truyện người dùng cung cấp: {title}
Thể loại đã xác định: {genres}
Dữ kiện nhận ra từ ảnh: {hints}

Tìm và tóm tắt (nếu không chắc, ghi rõ "không xác định" — TUYỆT ĐỐI không bịa):
1. Tên tác phẩm (gốc + romaji / EN / VN), tác giả, thể loại, bối cảnh, tình trạng phát hành.
2. Nhân vật chính: CHỮ GỐC tên + romaji + cách viết phổ biến trong các bản dịch tiếng Việt.
3. Thuật ngữ riêng: chữ gốc + cách các nhóm dịch tiếng Việt thường chuyển ngữ (kèm biến thể).
4. Quy ước xưng hô cộng đồng dịch hay dùng cho bộ này và cho các bộ cùng thể loại.
5. Từ vựng/văn phong đặc trưng của thể loại này trong các bản dịch tiếng Việt phổ biến.
6. Cảnh báo: tên dễ nhầm, chơi chữ, thuật ngữ đã có bản dịch chính thức.

Trả lời tiếng Việt, gạch đầu dòng ngắn gọn, luôn kèm chữ gốc khi nêu tên riêng/thuật ngữ.`;

  const CTX_LAYOUT = `Bố cục đúng 8 phần sau:

PHẦN 1. TỔNG QUAN TÁC PHẨM
- 3–5 đoạn văn xuôi: bối cảnh, tuyến truyện chính, mâu thuẫn, không khí, đối tượng đọc.
- Kèm dòng: Tên gốc [romaji] → tên Việt đang dùng.

PHẦN 2. THỂ LOẠI VÀ ĐỊNH HƯỚNG VĂN PHONG THEO THỂ LOẠI
- Liệt kê thể loại chính và phụ. Với mỗi thể loại: nhịp câu, độ dài câu, mức trang trọng, loại từ vựng nên dùng, điều nên tránh.
- Chốt 5–10 dòng "LUẬT VĂN PHONG CỦA BỘ NÀY".

PHẦN 3. HỒ SƠ NHÂN VẬT
Mỗi nhân vật một khối, chính trước, phụ sau:
  CHỮ GỐC [romaji] → TÊN VIỆT CHỐT   (mức: chính / phụ / mờ nhạt)
  - Cách viết khác, biệt danh, chức danh (kèm chữ gốc).
  - Mô tả: vai trò, tính cách, động cơ, tuyến phát triển.
  - Ngoại hình nhận dạng trong tranh: tuổi ước lượng, giới tính, tóc, đồng phục/trang phục, đặc điểm dễ nhận — để dịch giả nhìn khung tranh là biết ai đang nói.
  - Giọng nói: mức lịch sự, tật ngôn ngữ, độ dài câu, từ hay dùng, cách chửi/thán từ.
  - Tự xưng trong raw → đại từ tiếng Việt tương ứng.
  - Xuất hiện từ: chương đầu tiên nhận ra nhân vật.
Nhân vật mờ nhạt: gộp cuối phần, mỗi người 1–2 dòng.

PHẦN 4. BẢNG XƯNG HÔ THEO CẶP NHÂN VẬT
- Ghi theo TRÌNH TỰ từng nhân vật với từng nhân vật khác, dạng:
    A → B: "tôi – cậu"  (căn cứ: từ gọi trong raw; khi tức giận đổi "tao – mày")
- Bắt buộc ghi cả chiều ngược lại B → A.
- Nhân vật phụ mờ nhạt: một dòng mặc định trung tính.
- Mục QUY TẮC CHUNG: xưng hô khi nói với đám đông, khi tự sự, khi gọi tên kèm hậu tố, và mốc truyện được phép đổi cặp.

PHẦN 5. DÒNG THỜI GIAN CỐT TRUYỆN
- Gạch đầu dòng sự kiện theo thứ tự, ghi kèm chương/trang nếu suy được. Giữ chi tiết, ghi rõ mốc chương để lần cập nhật sau nối tiếp được.

PHẦN 6. THUẬT NGỮ VÀ KHÁI NIỆM
Mỗi mục một dòng:
  CHỮ GỐC [romaji] → BẢN DỊCH CHỐT | Nghĩa | Biến thể cần tránh | Lý do chọn
Nhóm theo loại: hệ thống/sức mạnh, tổ chức, địa danh, vật phẩm, chiêu thức, chức danh.

PHẦN 7. BẢNG TRA NHANH CHỮ GỐC (NHẬN MẶT CHỮ — CHỐNG DỊCH SAI)
- Mỗi dòng: CHỮ GỐC [romaji] → tiếng Việt (loại: tên/thuật ngữ/hậu tố/SFX/cụm hay gặp).
- Bắt buộc có: toàn bộ tên nhân vật, hậu tố, các cụm thoại hay lặp, SFX thường gặp và cách phiên tiếng Việt đã chốt.
- Mục CẶP CHỮ DỄ NHẦM: chữ gốc trông giống nhau hoặc đồng âm khác nghĩa, kèm cách phân biệt.

PHẦN 8. QUY ƯỚC NGÔN NGỮ VÀ VĂN PHONG
- Nguyên tắc: dịch Ý và SẮC THÁI, KHÔNG gò bó theo cấu trúc câu raw.
- Mức trang trọng chung; xử lý hậu tố; tiếng đệm/thán từ; mức chửi thề; câu hỏi tu từ; độc thoại nội tâm; lời dẫn.
- TỪ NÊN DÙNG và TỪ NÊN TRÁNH.
- Quy ước hình thức: câu ngắn cho bóng thoại nhỏ, dấu câu (…, !?, —), viết hoa, số đếm, SFX.
- Vùng dễ sai: chơi chữ, phương ngữ, giọng nhân vật đặc biệt và cách xử lý.`;

  const P_CTX_MERGE = `Bạn nhận dữ liệu phân tích các trang (theo thứ tự truyện), thông tin tra cứu trên mạng và yêu cầu riêng của người dùng. Hãy tổng hợp thành MỘT file context tiếng Việt.

TÊN TRUYỆN / TỪ KHÓA: {series}
KHOẢNG CHƯƠNG ĐANG QUÉT: {rng}
THỂ LOẠI VÀ ĐỊNH HƯỚNG VĂN PHONG (bắt buộc dùng làm khung cho toàn bộ file):
{genres}

--- PHÂN TÍCH TRANG ---
{notes}
--- THÔNG TIN TRA CỨU ---
{web}
--- YÊU CẦU RIÊNG CỦA NGƯỜI DÙNG ---
{user}
--- HẾT DỮ LIỆU ---

ĐỊNH DẠNG: VĂN BẢN THUẦN (.txt). Không dùng Markdown. Chỉ dùng TIÊU ĐỀ IN HOA và gạch đầu dòng "-".

Dòng đầu file ghi:  CONTEXT: {series} — CHƯƠNG {rng}
Dòng thứ hai ghi:   ĐÃ XỬ LÝ CÁC CHƯƠNG: {rng}

QUY TẮC VÀNG VỀ CHỮ GỐC: mọi tên riêng, thuật ngữ, hậu tố, cụm đặc trưng phải ghi CHỮ GỐC ĐỨNG TRƯỚC, rồi romaji, rồi mới tới bản tiếng Việt chốt:
    日本語 [romaji] → Tiếng Việt chốt
Nếu không đọc được chữ gốc thì ghi "(chưa rõ chữ gốc)", không bỏ trống và không bịa.

{layout}

Gộp trùng lặp nhưng GIỮ TOÀN BỘ chi tiết hữu ích cho dịch giả, không bịa tình tiết.
Chỉ xuất nội dung file context, không nói gì thêm.`;

  const P_CTX_UPDATE = `Bạn đang CẬP NHẬT file context đã có của bộ truyện, sau khi quét thêm chương mới.

TÊN TRUYỆN / TỪ KHÓA: {series}
CHƯƠNG ĐÃ CÓ TRONG CONTEXT CŨ: {old_rng}
CHƯƠNG MỚI VỪA QUÉT: {rng}
THỂ LOẠI VÀ ĐỊNH HƯỚNG VĂN PHONG:
{genres}

============ CONTEXT CŨ (BẤT KHẢ XÂM PHẠM — PHẢI GIỮ NGUYÊN 100%) ============
{old}
============ HẾT CONTEXT CŨ ============

--- PHÂN TÍCH TRANG MỚI (chương {rng}) ---
{notes}
--- THÔNG TIN TRA CỨU ---
{web}
--- YÊU CẦU RIÊNG CỦA NGƯỜI DÙNG ---
{user}
--- HẾT DỮ LIỆU MỚI ---

CHÍN LUẬT BẮT BUỘC KHI CẬP NHẬT:
1. KHÔNG XOÁ bất kỳ dòng nào của context cũ. Không rút gọn, không viết lại. Mọi câu chữ cũ phải xuất hiện y nguyên trong bản trả về.
2. CHỈ ĐƯỢC THÊM. Dữ liệu mới chèn vào ĐÚNG PHẦN tương ứng.
3. Mỗi khối dữ liệu mới phải có nhãn "[bs {rng}]" ở đầu dòng hoặc đầu khối.
4. Tên riêng, thuật ngữ, SFX, cặp xưng hô ĐÃ CHỐT ở bản cũ thì giữ nguyên tuyệt đối. Nếu xung đột, GIỮ BẢN CŨ và thêm dòng: "[bs {rng}] LƯU Ý XUNG ĐỘT: … (vẫn dùng bản đã chốt)".
5. Nhân vật cũ có diễn biến mới: KHÔNG sửa mô tả cũ, thêm dòng "[bs {rng}] Diễn biến: …" hoặc "[bs {rng}] Xưng hô đổi từ chương …: …".
6. PHẦN 5 phải nối tiếp đúng thứ tự thời gian, không đảo lộn mốc cũ.
7. Cập nhật hai dòng đầu file thành:
      CONTEXT: {series} — CHƯƠNG {new_rng}
      ĐÃ XỬ LÝ CÁC CHƯƠNG: {new_rng}
   và cuối file nối mục "LỊCH SỬ CẬP NHẬT" một dòng: "- Bổ sung chương {rng} ({stamp})".
8. Giữ nguyên định dạng văn bản thuần, bố cục 8 PHẦN, quy tắc chữ gốc đứng trước.
9. Bản trả về BẮT BUỘC dài hơn hoặc bằng context cũ. Không bao giờ được ngắn hơn.

{layout}

Chỉ xuất nội dung file context đầy đủ (cũ + mới), không nói gì thêm.`;

  // ---- schema ----
  const S_GENRE = {
    type: 'OBJECT',
    properties: { genres: { type: 'ARRAY', items: { type: 'STRING' } }, note: { type: 'STRING' } },
    required: ['genres']
  };
  const S_CTX = {
    type: 'OBJECT',
    properties: {
      characters: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
        name_src: { type: 'STRING' }, romaji: { type: 'STRING' }, name_vi: { type: 'STRING' },
        importance: { type: 'STRING' }, role: { type: 'STRING' }, traits: { type: 'STRING' },
        appearance: { type: 'STRING' }, voice: { type: 'STRING' }, self_ref: { type: 'STRING' },
        addressing: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
          to: { type: 'STRING' }, raw: { type: 'STRING' }, pair: { type: 'STRING' }, note: { type: 'STRING' } } } }
      } } },
      relations: { type: 'ARRAY', items: { type: 'STRING' } },
      glossary: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
        term_src: { type: 'STRING' }, romaji: { type: 'STRING' }, meaning: { type: 'STRING' },
        suggest_vi: { type: 'STRING' }, note: { type: 'STRING' } } } },
      src_words: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
        src: { type: 'STRING' }, romaji: { type: 'STRING' }, vi: { type: 'STRING' }, kind: { type: 'STRING' } } } },
      beats: { type: 'ARRAY', items: { type: 'STRING' } },
      genres: { type: 'ARRAY', items: { type: 'STRING' } },
      tone: { type: 'STRING' },
      cautions: { type: 'ARRAY', items: { type: 'STRING' } }
    }
  };

  function genrePack(genres, extra) {
    const lines = (genres || []).map(g => GENRE_PRESETS[g] ? '- ' + g + ': ' + GENRE_PRESETS[g] : '- ' + g);
    if (extra && extra.trim()) lines.push('- Ghi chú thể loại của người dùng: ' + extra.trim());
    return lines.length ? lines.join('\n') : '(chưa xác định thể loại — hãy tự suy ra từ nội dung và ghi rõ vào PHẦN 2)';
  }
  function normalizeGenres(raw) {
    const matched = [], unknown = [];
    const low = {}; GENRES.forEach(g => { low[g.toLowerCase()] = g; });
    (raw || []).forEach(item => {
      const s = String(item || '').trim(); if (!s) return;
      const key = s.toLowerCase();
      let g = low[key] || null;
      if (!g) { Object.keys(low).forEach(lk => { if (g) return; const head = lk.split(' /')[0].split(' (')[0].trim(); if (head && (key.indexOf(head) !== -1 || head.indexOf(key) !== -1)) g = low[lk]; }); }
      if (g) { if (matched.indexOf(g) === -1) matched.push(g); }
      else if (unknown.indexOf(s) === -1) unknown.push(s);
    });
    return { matched, unknown };
  }

  /** Trích các dòng "GỐC [romaji] → Việt" của context cũ (port _known_block) */
  function knownBlock(base, limit) {
    limit = limit || 6000;
    const out = []; let n = 0;
    String(base || '').split('\n').forEach(l => {
      const s = l.trim();
      if (n > limit || out.length >= 200) return;
      if (s.indexOf('→') !== -1 && s.length >= 4 && s.length <= 180) { out.push('- ' + s.replace(/^-\s*/, '')); n += s.length; }
    });
    return out.length ? out.join('\n') : '(không trích được — hãy đọc kỹ context cũ ở phần sau)';
  }

  /** Rút gợi ý cho bước tra web (port _hints) */
  function hintsFrom(notes) {
    const names = [], terms = []; let tone = '';
    (notes || []).forEach(d => {
      (d.characters || []).forEach(c => {
        const s = [c.name_src, c.romaji, c.name_vi].filter(Boolean).join(' / ');
        if (s && names.indexOf(s) === -1 && names.length < 25) names.push(s);
      });
      (d.glossary || []).forEach(g => {
        const s = [g.term_src, g.romaji, g.suggest_vi].filter(Boolean).join(' / ');
        if (s && terms.indexOf(s) === -1 && terms.length < 25) terms.push(s);
      });
      if (!tone && d.tone) tone = d.tone;
    });
    return 'Nhân vật: ' + (names.join('; ') || '(chưa rõ)') +
      ' | Thuật ngữ: ' + (terms.join('; ') || '(chưa rõ)') +
      ' | Văn phong: ' + (tone || '(chưa rõ)');
  }

  // ================= THƯ VIỆN CONTEXT =================
  function libLoad() {
    try { const r = localStorage.getItem(LS_CTXLIB); const j = r ? JSON.parse(r) : null; return (j && Array.isArray(j.items)) ? j : { items: [] }; }
    catch (e) { return { items: [] }; }
  }
  function libSaveRaw(db) {
    try { localStorage.setItem(LS_CTXLIB, JSON.stringify(db)); return true; }
    catch (e) { console.warn('[VB] lưu thư viện context lỗi:', e); return false; }
  }
  const CTXLIB = {
    all() { return libLoad().items.slice().sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0)); },
    bySeries(series) {
      const s = safeName(series).toLowerCase();
      return this.all().filter(i => safeName(i.series).toLowerCase() === s)
        .sort((a, b) => { const ra = cleanRange(a.range).split('-'), rb = cleanRange(b.range).split('-'); return (+rb[rb.length - 1] || 0) - (+ra[ra.length - 1] || 0) || (b.savedAt - a.savedAt); });
    },
    latest(series) { return this.bySeries(series)[0] || null; },
    get(id) { return this.all().filter(i => i.id === id)[0] || null; },
    save(series, range, text) {
      const db = libLoad();
      const name = safeName(series) + ' ' + (cleanRange(range) || 'toan-bo') + '.txt';
      const item = { id: 'c' + Date.now() + Math.floor(Math.random() * 999), series: safeName(series), range: cleanRange(range), name, text: String(text || ''), savedAt: Date.now() };
      db.items = db.items.filter(i => !(safeName(i.series) === item.series && i.name === item.name));
      db.items.push(item);
      const keep = {};
      db.items = db.items.sort((a, b) => b.savedAt - a.savedAt).filter(i => { keep[i.series] = (keep[i.series] || 0) + 1; return keep[i.series] <= 20; });
      libSaveRaw(db);
      return item;
    },
    remove(id) { const db = libLoad(); db.items = db.items.filter(i => i.id !== id); return libSaveRaw(db); },
    clear() { return libSaveRaw({ items: [] }); }
  };

  /** Nạp 1 file context vào bộ ngữ cảnh đang dùng khi dịch */
  function applyContextFile(name, text, opt) {
    const c = data.context;
    c.files = (c.files || []).filter(f => f.name !== name);
    c.files.push({ name, size: (text || '').length, enabled: true, text: String(text || '') });
    if (opt && opt.replaceAll) c.files = c.files.filter(f => f.name === name);
    if (opt && opt.title) c.title = opt.title;
    c.enabled = true;
    save();
  }

  // ================= SONG NGỮ =================
  function splitLines(t) {
    return String(t || '').replace(/\r\n?/g, '\n').split('\n').map(s => s.trim()).filter(s => s && s !== '[NO TEXT]');
  }
  const SFX_RE = /^\s*(?:\(\s*sfx\s*\)|\[\s*sfx\s*\]|sfx\s*[:：\-–]|効果音\s*[:：]|효과음\s*[:：])\s*/i;
  const isSfxLine = l => SFX_RE.test(l || '');
  const stripSfx = l => String(l || '').replace(SFX_RE, '').trim();

  function mergeBilingual(sourceText, translatedText, opt) {
    const cfg = Object.assign({}, data.bilingual, opt || {});
    const marker = cfg.marker || '*', tag = cfg.sfxTag || '(sfx)';
    const src = splitLines(sourceText), dst = splitLines(translatedText);
    const n = Math.max(src.length, dst.length), out = [];
    for (let i = 0; i < n; i++) {
      const rawS = src[i] || '', rawT = dst[i] || '';
      if (!rawS && !rawT) continue;
      const sfx = isSfxLine(rawS) || isSfxLine(rawT);
      let t = sfx ? (tag + ' ' + stripSfx(rawT)).trim() : rawT;
      const s = sfx ? (tag + ' ' + stripSfx(rawS)).trim() : rawS;
      if (!t) t = '⟨thiếu bản dịch⟩';
      out.push(t);
      if (s) out.push(marker + s);
      out.push('');
    }
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  // ================= ẢNH =================
  function blobToBase64(blob) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result).split(',')[1]);
      fr.onerror = () => rej(fr.error || new Error('Không đọc được ảnh'));
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
  async function loadBitmap(blob) {
    if (typeof createImageBitmap === 'function') { try { return await createImageBitmap(blob); } catch (e) {} }
    return await new Promise((res, rej) => {
      const url = URL.createObjectURL(blob), img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); res(img); };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Ảnh không hợp lệ')); };
      img.src = url;
    });
  }
  async function imageToParts(blob, o) {
    o = o || {};
    const maxWidth = o.maxWidth || 0, sliceTall = !!o.sliceTall, sliceH = o.sliceHeight || 3000;
    let bmp = null;
    try { bmp = await loadBitmap(blob); } catch (e) { bmp = null; }
    if (!bmp) return [{ inline_data: { mime_type: blob.type || 'image/jpeg', data: await blobToBase64(blob) } }];

    const scale = maxWidth && bmp.width > maxWidth ? maxWidth / bmp.width : 1;
    const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
    const pieces = [];
    if (sliceTall && h > sliceH * 1.3) {
      const overlap = Math.round(sliceH * 0.06);
      for (let y = 0; y < h; y += (sliceH - overlap)) { pieces.push([y, Math.min(sliceH, h - y)]); if (y + sliceH >= h) break; }
    } else pieces.push([0, h]);

    const parts = [];
    for (let i = 0; i < pieces.length; i++) {
      const y = pieces[i][0], ph = pieces[i][1];
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = ph;
      cv.getContext('2d').drawImage(bmp, 0, y / scale, bmp.width, ph / scale, 0, 0, w, ph);
      parts.push({ inline_data: { mime_type: 'image/jpeg', data: cv.toDataURL('image/jpeg', o.quality || 0.92).split(',')[1] } });
    }
    if (bmp.close) try { bmp.close(); } catch (e) {}
    return parts;
  }

  // ================= EXPORT =================
  window.VB = {
    MAX_KEYS: SOFT_MAX_KEYS, LANG_NAMES, GENRES, GENRE_PRESETS,
    get data() { return data; },
    save, load: () => (data = load()), resetAll,
    getKeys, keyLabel, nextKey, coolKey, isCooling, keyStatusList, testKey, parseKeys, stats,
    callGemini, callGeminiJson, sleep, fmt, parseJsonLoose,
    hasContext, contextCharCount, buildContextBlock, buildVisionBlock, applyContextFile,
    buildOcrPrompt, buildTranslatePrompt, buildAuditPrompt, getStyleBlock,
    splitLines, isSfxLine, stripSfx, mergeBilingual,
    imageToParts, blobToBase64, mimeOf, naturalCompare, langName,
    chapterNumbers, rangeLabel, cleanRange, unionRange, safeName, chunkList,
    genrePack, normalizeGenres, knownBlock, hintsFrom,
    CTXLIB,
    CTX: { SYS_ANALYST, SYS_KEEPER, P_GENRE, P_CTX_BATCH, P_RESEARCH, P_CTX_MERGE, P_CTX_UPDATE, CTX_LAYOUT, S_CTX, S_GENRE }
  };
})();
