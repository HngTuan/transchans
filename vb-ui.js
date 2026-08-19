/* vb-ui.js — UI mo rong cho trang chinh
 * - Nut "Nâng cao" mo modal 3 tab: API Keys | Ngữ cảnh | Song ngữ & Xuất
 * - Nut "Dịch hàng loạt" mo batch.html
 * - Hook window.fetch: xoay 5 key khi 429 + chen khoi context vao prompt cua renderer.js
 *   (KHONG can sua renderer.js)
 */
(() => {
  'use strict';
  if (!window.VB) { console.error('[VB-UI] Thieu vb-core.js'); return; }
  const VB = window.VB;
  const $ = id => document.getElementById(id);

  // ============ 1. FETCH GATE: context + xoay key + chong 429 ============
  const origFetch = window.fetch.bind(window);
  let hookStatusEl = null;
  const setHookStatus = t => { if (hookStatusEl) hookStatusEl.textContent = t || ''; };
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // Hang doi tuan tu: moi request toi Gemini cach nhau it nhat minGap ms.
  // minGap TU DONG gian ra khi dinh 429 va tu co lai khi chay tron tru -
  // day la thu giup giam 429 nhieu nhat, hon ca viec xoay key.
  const GATE = {
    minGap: 1500, floor: 800, ceil: 20000,
    lastAt: 0, chain: Promise.resolve(), okStreak: 0, maxRetry: 8
  };
  window.VBGate = GATE;

  function schedule(task) {
    const run = GATE.chain.then(async () => {
      const wait = GATE.lastAt + GATE.minGap - Date.now();
      if (wait > 0) await sleep(wait);
      GATE.lastAt = Date.now();
      return task();
    });
    GATE.chain = run.then(() => {}, () => {});
    return run;
  }

  function onGateOk() {
    if (++GATE.okStreak >= 4 && GATE.minGap > GATE.floor) {
      GATE.minGap = Math.max(GATE.floor, Math.round(GATE.minGap * 0.85));
      GATE.okStreak = 0;
    }
  }
  function onGateBusy() {
    GATE.okStreak = 0;
    GATE.minGap = Math.min(GATE.ceil, Math.max(2500, Math.round(GATE.minGap * 1.7)));
  }

  // Google tra ve thoi gian nen cho trong error.details[].retryDelay ("23s")
  function parseRetryDelay(text) {
    try {
      const j = JSON.parse(text);
      const d = (j.error && j.error.details || []).find(x => x && x.retryDelay);
      const m = d && /^([\d.]+)s$/.exec(d.retryDelay);
      if (m) return Math.ceil(parseFloat(m[1]) * 1000);
    } catch (e) {}
    return 0;
  }

  function targetLangName() {
    const sel = document.getElementById('target-lang-select');
    return VB.langName(sel ? sel.value : 'vi');
  }

  function injectContext(bodyText) {
    if (!VB.hasContext()) return bodyText;
    let obj;
    try { obj = JSON.parse(bodyText); } catch (e) { return bodyText; }
    if (!obj || !Array.isArray(obj.contents)) return bodyText;

    const allText = obj.contents.flatMap(c => c.parts || []).map(p => p.text || '').join('\n');
    if (!allText || allText.indexOf('--- STORY CONTEXT') !== -1) return bodyText;

    // Nhan dien CHINH XAC theo cau mo dau cua tung prompt trong renderer.js,
    // khong dung tu khoa "translate" (prompt OCR cung chua tu nay).
    const isTranslate = /elite comic localizer|refining an existing/i.test(allText);
    if (!isTranslate && !VB.data.context.applyToOcr) return bodyText;

    let block = VB.buildContextBlock(targetLangName(), isTranslate ? 'translate' : 'ocr');
    if (!block) return bodyText;

    if (isTranslate && VB.data.bilingual.enabled && VB.data.bilingual.tagSfxInPrompt) {
      block += `\n\nSFX TAGGING RULE
- If a line of the script is a sound effect / onomatopoeia, prefix its translation with "${VB.data.bilingual.sfxTag} " (everything else unchanged, still exactly one output line per input line).`;
    }

    const first = obj.contents[0];
    if (first && Array.isArray(first.parts)) first.parts.unshift({ text: block });
    else obj.contents.unshift({ role: 'user', parts: [{ text: block }] });
    return JSON.stringify(obj);
  }

  const applyKey = (u, k) => {
    try { const p = new URL(u); p.searchParams.set('key', k); return p.toString(); }
    catch (e) { return u.replace(/([?&])key=[^&]*/, `$1key=${encodeURIComponent(k)}`); }
  };

  window.fetch = async function (input, init) {
    try {
      if (init && init.__vbManaged) return origFetch(input, init);
      const url0 = (typeof input === 'string') ? input : (input && input.url) || '';
      if (!/generativelanguage\.googleapis\.com/.test(url0)) return origFetch(input, init);

      let url = url0, opts;
      if (typeof input !== 'string' && input && input.url) {
        const req = input;
        opts = {
          method: req.method, headers: new Headers(req.headers),
          body: (req.method && req.method !== 'GET' && req.method !== 'HEAD') ? await req.clone().text() : undefined,
          mode: req.mode, credentials: req.credentials, cache: req.cache,
          redirect: req.redirect, referrer: req.referrer, signal: req.signal
        };
      } else {
        opts = Object.assign({}, init || {});
        if (opts.headers && !(opts.headers instanceof Headers)) opts.headers = new Headers(opts.headers);
      }
      opts.__vbManaged = true;
      if (typeof opts.body === 'string' && /:generateContent/.test(url)) opts.body = injectContext(opts.body);

      return schedule(async () => {
        const keys = VB.getKeys();
        let last = null, lastText = '';
        for (let attempt = 0; attempt <= GATE.maxRetry; attempt++) {
          const k = keys.length ? VB.nextKey() : null;
          const u = k ? applyKey(url, k) : url;
          if (k && opts.headers && opts.headers.has && opts.headers.has('x-goog-api-key')) opts.headers.set('x-goog-api-key', k);

          const res = await origFetch(u, opts);
          if (res.status !== 429 && res.status !== 503 && res.status !== 500) {
            onGateOk();
            setHookStatus(res.ok ? `${k ? VB.keyLabel(k) + ' ' : ''}✓ (gap ${GATE.minGap}ms)` : `HTTP ${res.status}`);
            return res;
          }

          last = res;
          lastText = await res.clone().text().catch(() => '');
          if (k) VB.coolKey(k, res.status === 429 ? 45000 : 12000);
          onGateBusy();
          GATE.lastAt = Date.now();

          const freeKey = keys.some(x => !VB.isCooling(x));
          const suggested = parseRetryDelay(lastText);
          const backoff = Math.min(60000, 1200 * Math.pow(2, attempt)) + Math.floor(Math.random() * 600);
          const wait = suggested || (freeKey ? 600 : backoff);
          setHookStatus(`HTTP ${res.status} → cho ${Math.round(wait / 1000)}s, gap ${GATE.minGap}ms`);
          await sleep(wait);
        }
        return new Response(lastText, { status: last ? last.status : 429, statusText: last ? last.statusText : '' });
      });
    } catch (e) {
      console.warn('[VB-UI] fetch gate loi, dung fetch goc:', e);
      return origFetch(input, init);
    }
  };


  // ============ 2. MODAL ============
  const MODAL_HTML = `
<div class="vb-modal-backdrop" id="vb-modal" hidden>
  <div class="vb-modal">
    <div class="vb-modal-head">
      <div class="vb-tabs">
        <button class="vb-tab is-active" data-tab="keys">🔑 API Keys</button>
        <button class="vb-tab" data-tab="ctx">📚 Ngữ cảnh</button>
        <button class="vb-tab" data-tab="bi">🈁 Song ngữ &amp; Xuất</button>
      </div>
      <button class="vb-x" id="vb-close" title="Đóng">✕</button>
    </div>

    <div class="vb-modal-body">
      <!-- ---- TAB API KEYS ---- -->
      <section class="vb-pane is-active" data-pane="keys">
        <p class="vb-hint">Nhập tối đa <b>5 API key</b>. Tool tự xoay vòng key cho từng request; key nào dính <b>429</b> sẽ bị cho “nghỉ” 45 giây và tự chuyển sang key khác.</p>
        <div id="vb-key-rows"></div>
        <div class="vb-row">
          <label class="vb-inline"><input type="radio" name="vb-keymode" value="rotate"> Xoay vòng (khuyên dùng)</label>
          <label class="vb-inline"><input type="radio" name="vb-keymode" value="sticky"> Dùng 1 key đến khi lỗi</label>
        </div>
        <details class="vb-details">
          <summary>Dán nhanh nhiều key</summary>
          <textarea id="vb-key-bulk" rows="5" placeholder="Mỗi dòng 1 key (hoặc ngăn bằng dấu phẩy)…"></textarea>
          <button class="vb-btn" id="vb-key-bulk-apply">Điền vào 5 ô</button>
        </details>
        <div class="vb-keystatus" id="vb-key-status"></div>
      </section>

      <!-- ---- TAB NGU CANH ---- -->
      <section class="vb-pane" data-pane="ctx">
        <label class="vb-inline vb-strong"><input type="checkbox" id="vb-ctx-enabled"> Bật ngữ cảnh khi dịch</label>
        <label class="vb-inline"><input type="checkbox" id="vb-ctx-ocr"> Dùng cả cho bước OCR (chính xác tên riêng hơn, tốn token hơn)</label>

        <div class="vb-grid2">
          <div class="vb-field"><label>Tên truyện</label><input type="text" id="vb-ctx-title" placeholder="VD: Kimi no Na wa"></div>
          <div class="vb-field"><label>Văn phong / giọng kể</label><input type="text" id="vb-ctx-tone" placeholder="VD: học đường, hài nhẹ, xưng hô tớ–cậu"></div>
        </div>
        <div class="vb-field"><label>Tóm tắt / bối cảnh</label><textarea id="vb-ctx-synopsis" rows="4" placeholder="Ai là ai, chuyện đã xảy ra tới đâu…"></textarea></div>
        <div class="vb-field"><label>Bảng thuật ngữ &amp; tên riêng (mỗi dòng: gốc = bản dịch)</label><textarea id="vb-ctx-glossary" rows="5" placeholder="鈴木 = Suzuki&#10;先輩 = tiền bối&#10;魔王軍 = Ma Vương quân"></textarea></div>
        <div class="vb-field"><label>Ghi chú thêm cho AI</label><textarea id="vb-ctx-notes" rows="3" placeholder="VD: nhân vật A luôn nói trống không, không dịch tên chiêu thức…"></textarea></div>

        <div class="vb-field">
          <label>Import file ngữ cảnh (.txt, .md, .json, .csv, .docx) — chương trước, kịch bản raw, character sheet…</label>
          <div class="vb-row">
            <label class="vb-btn vb-btn-primary" for="vb-ctx-file">+ Chọn file</label>
            <input type="file" id="vb-ctx-file" accept=".txt,.md,.json,.csv,.docx,text/plain" multiple hidden>
            <button class="vb-btn vb-btn-danger" id="vb-ctx-clear-files">Xoá hết file</button>
            <span class="vb-hint" id="vb-ctx-count"></span>
          </div>
          <div id="vb-ctx-files" class="vb-filelist"></div>
        </div>
      </section>

      <!-- ---- TAB SONG NGU ---- -->
      <section class="vb-pane" data-pane="bi">
        <label class="vb-inline vb-strong"><input type="checkbox" id="vb-bi-enabled"> Bật chế độ song ngữ (chèn dòng gốc dưới mỗi lời thoại)</label>
        <label class="vb-inline"><input type="checkbox" id="vb-bi-sfx"> Yêu cầu AI gắn nhãn SFX vào bản dịch</label>
        <div class="vb-grid2">
          <div class="vb-field"><label>Ký tự đứng trước dòng gốc</label><input type="text" id="vb-bi-marker" maxlength="4"></div>
          <div class="vb-field"><label>Nhãn SFX</label><input type="text" id="vb-bi-sfxtag" maxlength="12"></div>
        </div>
        <pre class="vb-sample">Cậu đang làm gì thế?
*何してるの？

(sfx) Rầm!
*(sfx) ドォン</pre>
        <div class="vb-row">
          <button class="vb-btn vb-btn-primary" id="vb-bi-build">Tạo bản song ngữ từ 2 bảng tổng hợp</button>
          <button class="vb-btn" id="vb-bi-copy">Copy</button>
          <button class="vb-btn" id="vb-bi-txt">Xuất .txt</button>
          <button class="vb-btn" id="vb-bi-docx">Xuất .docx</button>
        </div>
        <textarea id="vb-bi-out" rows="14" placeholder="Kết quả song ngữ sẽ hiện ở đây…"></textarea>
        <p class="vb-hint">Ghép theo thứ tự dòng của “All OCR” và “All translations”. Nếu số dòng lệch nhau, dòng thiếu sẽ được đánh dấu ⟨thiếu bản dịch⟩ để bạn sửa tay.</p>
      </section>
    </div>

    <div class="vb-modal-foot">
      <span class="vb-hint" id="vb-save-hint"></span>
      <span class="vb-spacer"></span>
      <button class="vb-btn" id="vb-reset">Khôi phục mặc định</button>
      <button class="vb-btn vb-btn-primary" id="vb-save">Lưu</button>
    </div>
  </div>
</div>`;

  function mount() {
    const holder = document.createElement('div');
    holder.innerHTML = MODAL_HTML;
    document.body.appendChild(holder.firstElementChild);

    // --- nut tren topbar ---
    const isStudio = document.body.classList.contains('vb-studio-page');
    const bar = document.querySelector('.topbar-controls') || document.querySelector('.topbar') || document.body;
    const wrap = document.createElement('div');
    wrap.className = 'field vb-topbar-field';
    wrap.innerHTML = `
      <label>Mở rộng</label>
      <div class="vb-topbar-btns">
        <button type="button" class="btn btn-secondary" id="vb-open">⚙ Nâng cao</button>
        <button type="button" class="btn btn-secondary" id="vb-goto">${isStudio ? '← Trang chính' : '🧰 Studio'}</button>
        <span class="vb-hookstatus" id="vb-hook-status"></span>
      </div>`;
    bar.appendChild(wrap);
    hookStatusEl = $('vb-hook-status');
    $('vb-open').addEventListener('click', open);
    $('vb-goto').addEventListener('click', () => { location.href = isStudio ? 'index.html' : 'studio.html'; });

    buildKeyRows();
    bindContext();
    bindBilingual();
    $('vb-save').addEventListener('click', saveAll);
    $('vb-reset').addEventListener('click', () => {
      if (!confirm('Khôi phục toàn bộ cấu hình mở rộng về mặc định?')) return;
      VB.resetAll(); fillForm(); renderFiles(); note('Đã khôi phục mặc định');
    });

    // --- [FIX LỖI: LOGIC CHUYỂN TAB VÀ ĐÓNG MODAL] ---
    $('vb-close').addEventListener('click', close);
    $('vb-modal').addEventListener('click', e => {
      // Đóng modal khi bấm vào vùng xám bên ngoài
      if (e.target === $('vb-modal')) close();
    });

    document.querySelectorAll('.vb-tab').forEach(tab => {
      tab.addEventListener('click', e => {
        // Xóa class active ở tất cả tab và pane
        document.querySelectorAll('.vb-tab').forEach(t => t.classList.remove('is-active'));
        document.querySelectorAll('.vb-pane').forEach(p => p.classList.remove('is-active'));
        
        // Gắn class active cho tab vừa click
        const target = e.currentTarget;
        target.classList.add('is-active');
        
        // Gắn class active cho pane tương ứng để hiện nội dung
        const paneId = target.dataset.tab;
        const pane = document.querySelector(`.vb-pane[data-pane="${paneId}"]`);
        if (pane) pane.classList.add('is-active');
      });
    });
    // --------------------------------------------------

    fillForm();
    renderFiles();
    importNativeKey();
    setInterval(renderKeyStatus, 1500);
  }

  const note = t => { const el = $('vb-save-hint'); if (el) { el.textContent = t; setTimeout(() => { if (el.textContent === t) el.textContent = ''; }, 2500); } };
  function open() { fillForm(); renderFiles(); renderKeyStatus(); $('vb-modal').hidden = false; }
  function close() { $('vb-modal').hidden = true; }

  // --- keys ---
  function buildKeyRows() {
    const box = $('vb-key-rows');
    box.innerHTML = '';
    for (let i = 0; i < VB.MAX_KEYS; i++) {
      const row = document.createElement('div');
      row.className = 'vb-keyrow';
      row.innerHTML = `
        <span class="vb-keyno">${i + 1}</span>
        <input type="password" class="vb-keyinput" data-i="${i}" placeholder="AIza… (để trống nếu không dùng)">
        <button class="vb-btn vb-btn-icon" data-act="eye" data-i="${i}" title="Hiện/ẩn">👁</button>
        <button class="vb-btn vb-btn-icon" data-act="test" data-i="${i}" title="Kiểm tra key">✓</button>
        <button class="vb-btn vb-btn-icon" data-act="del" data-i="${i}" title="Xoá">✕</button>
        <span class="vb-keymsg" data-msg="${i}"></span>`;
      box.appendChild(row);
    }
    box.addEventListener('click', async e => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const i = +btn.dataset.i;
      const input = box.querySelector(`.vb-keyinput[data-i="${i}"]`);
      const msg = box.querySelector(`[data-msg="${i}"]`);
      if (btn.dataset.act === 'eye') input.type = input.type === 'password' ? 'text' : 'password';
      if (btn.dataset.act === 'del') { input.value = ''; msg.textContent = ''; }
      if (btn.dataset.act === 'test') {
        const k = input.value.trim();
        if (!k) { msg.textContent = 'trống'; return; }
        msg.textContent = 'đang kiểm tra…';
        const r = await VB.testKey(k).catch(err => ({ ok: false, message: err.message }));
        msg.textContent = r.ok ? '✓ hợp lệ' : `✕ ${r.status || ''} ${r.message || ''}`.slice(0, 60);
        msg.className = 'vb-keymsg ' + (r.ok ? 'ok' : 'bad');
      }
    });
    $('vb-key-bulk-apply').addEventListener('click', () => {
      const list = $('vb-key-bulk').value.split(/[\n,;\s]+/).map(s => s.trim()).filter(Boolean).slice(0, VB.MAX_KEYS);
      box.querySelectorAll('.vb-keyinput').forEach((inp, i) => { inp.value = list[i] || ''; });
      note(`Đã điền ${list.length} key`);
    });
  }

  function renderKeyStatus() {
    const el = $('vb-key-status');
    if (!el || $('vb-modal').hidden) return;
    const list = VB.keyStatusList();
    el.innerHTML = list.length
      ? list.map(k => `<span class="vb-chip ${k.cooling ? 'cool' : 'ok'}">${k.label} · ${k.used} lần${k.cooling ? ` · nghỉ ${k.coolLeft}s` : ''}</span>`).join('')
      : '<span class="vb-hint">Chưa có key nào được lưu.</span>';
  }

  /** Neu pool trong ma o key goc cua tool da co key -> hut vao lam key 1 */
  function importNativeKey() {
    const native = $('api-key-input');
    if (native && native.value.trim() && !VB.getKeys().length) {
      VB.data.apiKeys[0] = native.value.trim();
      VB.save();
    }
  }

  function syncPrimaryKey() {
    const native = $('api-key-input');
    const k = VB.getKeys()[0];
    if (native && k && native.value !== k) {
      native.value = k;
      native.dispatchEvent(new Event('input', { bubbles: true }));
      native.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  // --- context ---
  function bindContext() {
    $('vb-ctx-file').addEventListener('change', async e => {
      const files = Array.from(e.target.files || []);
      for (const f of files) {
        try {
          const text = await readContextFile(f);
          VB.data.context.files.push({ name: f.name, size: f.size, enabled: true, text });
        } catch (err) { alert(`Không đọc được ${f.name}: ${err.message}`); }
      }
      VB.save(); renderFiles(); e.target.value = '';
    });
    $('vb-ctx-clear-files').addEventListener('click', () => {
      if (!VB.data.context.files.length) return;
      if (!confirm('Xoá toàn bộ file ngữ cảnh đã import?')) return;
      VB.data.context.files = []; VB.save(); renderFiles();
    });
  }

  async function readContextFile(file) {
    const name = file.name.toLowerCase();
    if (name.endsWith('.docx')) {
      if (typeof JSZip === 'undefined') throw new Error('Thiếu JSZip để đọc .docx');
      const zip = await JSZip.loadAsync(file);
      const xmlFile = zip.file('word/document.xml');
      if (!xmlFile) throw new Error('File .docx không hợp lệ');
      const xml = await xmlFile.async('string');
      return xml
        .replace(/<w:p[ >][\s\S]*?<\/w:p>|<w:p\/>/g, m => m.replace(/<[^>]+>/g, '') + '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    }
    return (await file.text()).trim();
  }

  function renderFiles() {
    const box = $('vb-ctx-files');
    const files = VB.data.context.files || [];
    box.innerHTML = files.length ? '' : '<span class="vb-hint">Chưa import file nào.</span>';
    files.forEach((f, i) => {
      const row = document.createElement('div');
      row.className = 'vb-fileitem';
      row.innerHTML = `
        <label class="vb-inline"><input type="checkbox" ${f.enabled !== false ? 'checked' : ''} data-fi="${i}"> <b>${f.name}</b></label>
        <span class="vb-hint">${(f.text || '').length.toLocaleString()} ký tự</span>
        <button class="vb-btn vb-btn-icon" data-fdel="${i}" title="Xoá">✕</button>`;
      box.appendChild(row);
    });
    box.onclick = e => {
      const del = e.target.closest('[data-fdel]');
      if (del) { VB.data.context.files.splice(+del.dataset.fdel, 1); VB.save(); renderFiles(); }
    };
    box.onchange = e => {
      const cb = e.target.closest('[data-fi]');
      if (cb) { VB.data.context.files[+cb.dataset.fi].enabled = cb.checked; VB.save(); updateCount(); }
    };
    updateCount();
  }

  function updateCount() {
    const n = VB.contextCharCount();
    $('vb-ctx-count').textContent = `Tổng ngữ cảnh: ${n.toLocaleString()} ký tự` + (n > 24000 ? ' (sẽ tự cắt bớt phần cũ nhất)' : '');
  }

  // --- bilingual ---
  function bindBilingual() {
    $('vb-bi-build').addEventListener('click', () => {
      const out = buildBilingualFromSummaries();
      $('vb-bi-out').value = out || '';
      note(out ? 'Đã tạo bản song ngữ' : 'Chưa có dữ liệu ở 2 bảng tổng hợp');
    });
    $('vb-bi-copy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText($('vb-bi-out').value); note('Đã copy'); }
      catch (e) { note('Copy thất bại'); }
    });
    $('vb-bi-txt').addEventListener('click', () => exportBi('txt'));
    $('vb-bi-docx').addEventListener('click', () => exportBi('docx'));
  }

  async function exportBi(fmt) {
    const content = $('vb-bi-out').value.trim();
    if (!content) return note('Chưa có nội dung');
    const name = (VB.data.context.title || 'visionbox-song-ngu').replace(/[\\/:*?"<>|]/g, '_');
    const ok = await window.fileExport.save(content, fmt, name);
    note(ok ? `Đã xuất .${fmt}` : 'Xuất thất bại');
  }

  const readEl = el => !el ? '' : ('value' in el && typeof el.value === 'string' ? el.value : el.innerText || '');

  const HEADER_RE = /^\s*(?:[-=_*#~]{3,}.*|.*\.(?:png|jpe?g|webp|heic|heif)\s*$|(?:image|img|ảnh|hình|page|trang)\s*[#]?\d+.*|\[[^\]]+\])\s*$/i;

  function toBlocks(text) {
    const blocks = [];
    let cur = { header: '', lines: [] };
    String(text || '').replace(/\r\n?/g, '\n').split('\n').forEach(raw => {
      const line = raw.trim();
      if (!line) return;
      if (HEADER_RE.test(line)) {
        if (cur.header || cur.lines.length) blocks.push(cur);
        cur = { header: line, lines: [] };
      } else cur.lines.push(line);
    });
    if (cur.header || cur.lines.length) blocks.push(cur);
    return blocks;
  }

  function buildBilingualFromSummaries() {
    const ocr = readEl($('summary-ocr-all')).trim();
    const tra = readEl($('summary-translation-all')).trim();
    if (!ocr || !tra) return '';
    const a = toBlocks(ocr), b = toBlocks(tra);
    const out = [];
    if (a.length === b.length && a.length > 1) {
      for (let i = 0; i < a.length; i++) {
        if (b[i].header) out.push(b[i].header);
        out.push(VB.mergeBilingual(a[i].lines.join('\n'), b[i].lines.join('\n')));
        out.push('');
      }
    } else {
      out.push(VB.mergeBilingual(
        a.flatMap(x => x.lines).join('\n'),
        b.flatMap(x => x.lines).join('\n')
      ));
    }
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  // --- form ---
  function fillForm() {
    const d = VB.data;
    document.querySelectorAll('.vb-keyinput').forEach((inp, i) => { inp.value = d.apiKeys[i] || ''; });
    document.querySelectorAll('[name="vb-keymode"]').forEach(r => { r.checked = r.value === d.keyMode; });
    $('vb-ctx-enabled').checked = d.context.enabled;
    $('vb-ctx-ocr').checked = d.context.applyToOcr;
    $('vb-ctx-title').value = d.context.title;
    $('vb-ctx-tone').value = d.context.tone;
    $('vb-ctx-synopsis').value = d.context.synopsis;
    $('vb-ctx-glossary').value = d.context.glossary;
    $('vb-ctx-notes').value = d.context.notes;
    $('vb-bi-enabled').checked = d.bilingual.enabled;
    $('vb-bi-sfx').checked = d.bilingual.tagSfxInPrompt;
    $('vb-bi-marker').value = d.bilingual.marker;
    $('vb-bi-sfxtag').value = d.bilingual.sfxTag;
  }

  function saveAll() {
    const d = VB.data;
    d.apiKeys = Array.from(document.querySelectorAll('.vb-keyinput')).map(i => i.value.trim()).slice(0, VB.MAX_KEYS);
    const mode = document.querySelector('[name="vb-keymode"]:checked');
    d.keyMode = mode ? mode.value : 'rotate';
    d.context.enabled = $('vb-ctx-enabled').checked;
    d.context.applyToOcr = $('vb-ctx-ocr').checked;
    d.context.title = $('vb-ctx-title').value;
    d.context.tone = $('vb-ctx-tone').value;
    d.context.synopsis = $('vb-ctx-synopsis').value;
    d.context.glossary = $('vb-ctx-glossary').value;
    d.context.notes = $('vb-ctx-notes').value;
    d.bilingual.enabled = $('vb-bi-enabled').checked;
    d.bilingual.tagSfxInPrompt = $('vb-bi-sfx').checked;
    d.bilingual.marker = $('vb-bi-marker').value || '*';
    d.bilingual.sfxTag = $('vb-bi-sfxtag').value || '(sfx)';
    VB.save();
    syncPrimaryKey();
    updateCount();
    renderKeyStatus();
    note('Đã lưu ✓');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
