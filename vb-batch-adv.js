/* =============================================================================
 * vb-batch-adv.js — hộp "⚙ Nâng cao" cho batch.html (giống nút Nâng cao ở trang chính)
 * Tab: 📚 Ngữ cảnh (nhiều nguồn + file + nhập tay) · 🈁 Song ngữ & Xuất · 🔑 API Keys
 * Cần vb-shared.js nạp trước. Mọi thay đổi tự lưu.
 * ========================================================================== */
(function () {
  'use strict';
  const VB = window.VBS;
  if (!VB || !document.getElementById('b-list')) return;
  const $ = VB.$;
  const LS = 'vbs_batch_adv_v1', LS_MAIN = 'visionbox_ext_v1';
  const DEF = { enabled: true, useStudio: true, useMain: false, title: '', tone: '', synopsis: '', glossary: '', notes: '', maxChars: 30000, marker: '*', sfxTag: '(sfx)' };
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtN = n => n.toLocaleString('vi-VN');
  let cfg = load(), saveT = null, mounted = false;

  function load() {
    let c = {};
    try { c = JSON.parse(localStorage.getItem(LS) || '{}') || {}; } catch (_) {}
    c = Object.assign({}, DEF, c);
    c.lib = Array.isArray(c.lib) ? c.lib : [];
    c.files = Array.isArray(c.files) ? c.files : [];
    return c;
  }
  function save() {
    clearTimeout(saveT);
    saveT = setTimeout(() => {
      try { localStorage.setItem(LS, JSON.stringify(cfg)); msg('Đã tự lưu ✓'); }
      catch (e) { msg('⚠ Không lưu được: bộ nhớ trình duyệt đầy (' + e.message + ')'); }
      window.dispatchEvent(new Event('vbs:adv'));
    }, 250);
    updTotal();
  }
  function msg(t) { const e = $('adv-msg'); if (e) e.textContent = t; }

  function mainCtx() {
    try {
      const c = (JSON.parse(localStorage.getItem(LS_MAIN) || '{}') || {}).context || {};
      const b = [];
      if (c.title) b.push('Tên truyện: ' + c.title);
      if (c.tone) b.push('Văn phong: ' + c.tone);
      if (c.synopsis) b.push('Tóm tắt:\n' + c.synopsis);
      if (c.glossary) b.push('Thuật ngữ:\n' + c.glossary);
      if (c.notes) b.push('Ghi chú:\n' + c.notes);
      (c.files || []).filter(f => f && f.enabled !== false && f.text).forEach(f => b.push('<<< ' + f.name + ' >>>\n' + f.text));
      return b.join('\n\n').trim();
    } catch (_) { return ''; }
  }

  /** Gộp mọi nguồn đã chọn thành 1 khối ngữ cảnh (cắt theo giới hạn ký tự). */
  function build() {
    if (!cfg.enabled) return '';
    const head = [];
    if (cfg.title.trim()) head.push('TÊN TRUYỆN: ' + cfg.title.trim());
    if (cfg.tone.trim()) head.push('VĂN PHONG / GIỌNG KỂ: ' + cfg.tone.trim());
    if (cfg.synopsis.trim()) head.push('TÓM TẮT / BỐI CẢNH:\n' + cfg.synopsis.trim());
    if (cfg.glossary.trim()) head.push('THUẬT NGỮ & TÊN RIÊNG (dùng ĐÚNG như sau):\n' + cfg.glossary.trim());
    if (cfg.notes.trim()) head.push('GHI CHÚ CHO AI:\n' + cfg.notes.trim());
    const docs = [];
    if (cfg.useStudio) { const t = VB.ctx.get().trim(); if (t) docs.push(['Ngữ cảnh hiện hành (Studio)', t]); }
    if (cfg.useMain) { const t = mainCtx(); if (t) docs.push(['Ngữ cảnh trang chính', t]); }
    const lib = VB.ctx.libList();
    cfg.lib.forEach(n => { const it = lib.find(x => x.name === n); if (it && it.text) docs.push(['Thư viện: ' + n, it.text]); });
    cfg.files.filter(f => f.enabled !== false && f.text).forEach(f => docs.push(['File: ' + f.name, f.text]));
    const max = Math.max(2000, +cfg.maxChars || 30000);
    let out = head.join('\n\n');
    for (const [name, text] of docs) {
      const blk = `\n\n<<< ${name} >>>\n${text.trim()}`;
      if (out.length + blk.length > max) {
        const room = max - out.length - name.length - 40;
        if (room > 500) out += `\n\n<<< ${name} (đã cắt bớt) >>>\n` + text.trim().slice(0, room);
        break;
      }
      out += blk;
    }
    return out.trim();
  }

  const HTML = `
<div class="vbs-modal-box wide" role="dialog" aria-modal="true" aria-label="Nâng cao">
  <div class="vbs-modal-head"><b>⚙ Nâng cao · Dịch hàng loạt</b><button type="button" class="vbs-x" id="adv-x" aria-label="Đóng">✕</button></div>
  <div class="vbs-advtabs">
    <button type="button" class="vbs-tab on" data-t="ctx">📚 Ngữ cảnh</button>
    <button type="button" class="vbs-tab" data-t="out">🈁 Song ngữ &amp; Xuất</button>
    <button type="button" class="vbs-tab" data-t="key">🔑 API Keys</button>
  </div>
  <section class="vbs-pane on" data-p="ctx">
    <div class="vbs-row"><label class="vbs-inline"><input type="checkbox" id="adv-en"> <b>Bật ngữ cảnh khi dịch</b></label><span class="vbs-sp"></span><span class="vbs-hint" id="adv-total"></span></div>
    <div class="vbs-sec">
      <div class="vbs-sec-head"><b>Nguồn ngữ cảnh</b><span class="vbs-hint">Tick bao nhiêu nguồn cũng được — tool gộp theo thứ tự.</span></div>
      <label class="vbs-inline"><input type="checkbox" id="adv-studio"> Ngữ cảnh hiện hành của Studio <span class="vbs-hint" id="adv-studio-n"></span></label><br>
      <label class="vbs-inline"><input type="checkbox" id="adv-main"> Ngữ cảnh trong “⚙ Nâng cao” của trang chính <span class="vbs-hint" id="adv-main-n"></span></label>
      <div class="vbs-hint" style="margin-top:8px">Thư viện ngữ cảnh đã lưu:</div>
      <div class="vbs-list" id="adv-lib"></div>
    </div>
    <div class="vbs-sec">
      <div class="vbs-sec-head"><b>File ngữ cảnh riêng</b><span class="vbs-hint">.txt .md .json .csv .docx</span></div>
      <div class="vbs-row">
        <label class="vbs-btn primary" for="adv-file">+ Chọn file</label>
        <input type="file" id="adv-file" accept=".txt,.md,.json,.csv,.docx,text/plain" multiple hidden>
        <button type="button" class="vbs-btn danger" id="adv-file-clear">Xoá hết file</button>
      </div>
      <div class="vbs-list" id="adv-files"></div>
    </div>
    <div class="vbs-sec">
      <div class="vbs-sec-head"><b>Nhập tay</b></div>
      <div class="vbs-grid2">
        <div class="vbs-field"><label>Tên truyện</label><input type="text" id="adv-title" placeholder="VD: Enigmatica"></div>
        <div class="vbs-field"><label>Văn phong / giọng kể</label><input type="text" id="adv-tone" placeholder="VD: học đường, hài nhẹ, tớ–cậu"></div>
      </div>
      <div class="vbs-field"><label>Tóm tắt / bối cảnh</label><textarea id="adv-synopsis" rows="3"></textarea></div>
      <div class="vbs-field"><label>Thuật ngữ &amp; tên riêng (mỗi dòng: gốc = bản dịch)</label><textarea id="adv-glossary" rows="4" placeholder="鈴木 = Suzuki&#10;先輩 = tiền bối"></textarea></div>
      <div class="vbs-field"><label>Ghi chú thêm cho AI</label><textarea id="adv-notes" rows="2"></textarea></div>
      <div class="vbs-field" style="max-width:280px"><label>Giới hạn độ dài ngữ cảnh (ký tự)</label><input type="number" id="adv-max" min="2000" step="1000"></div>
    </div>
  </section>
  <section class="vbs-pane" data-p="out">
    <div class="vbs-grid2">
      <div class="vbs-field"><label>Ký tự đứng trước dòng gốc</label><input type="text" id="adv-marker" maxlength="4"></div>
      <div class="vbs-field"><label>Nhãn SFX</label><input type="text" id="adv-sfxtag" maxlength="12"></div>
    </div>
    <p class="vbs-hint">Bật/tắt “Kèm dòng gốc” ở mục 2 của trang. Định dạng giống hệt trang chính (gộp được ở “Gộp bản dịch”):</p>
    <pre class="vbs-sample" id="adv-sample"></pre>
  </section>
  <section class="vbs-pane" data-p="key">
    <p class="vbs-hint" id="adv-keyinfo"></p>
    <div class="vbs-row"><button type="button" class="vbs-btn primary" id="adv-keys">🔑 Mở quản lý API key</button></div>
    <p class="vbs-hint">Danh sách model tự đồng bộ theo key — không cần làm gì thêm.</p>
  </section>
  <div class="vbs-row" style="margin-top:14px"><span class="vbs-hint" id="adv-msg">Mọi thay đổi được lưu tự động.</span><span class="vbs-sp"></span><button type="button" class="vbs-btn primary" id="adv-done">Xong</button></div>
</div>`;

  function updTotal() {
    if (!mounted) return;
    const n = build().length;
    $('adv-total').textContent = cfg.enabled ? `Tổng: ${fmtN(n)} ký tự sẽ gửi kèm mỗi trang` : 'Đang TẮT ngữ cảnh';
    $('adv-studio-n').textContent = `(${fmtN(VB.ctx.get().length)} ký tự)`;
    $('adv-main-n').textContent = `(${fmtN(mainCtx().length)} ký tự)`;
    const mk = cfg.marker || '*', tg = cfg.sfxTag || '(sfx)';
    $('adv-sample').textContent = `=== Chapter 01 ===\n\n[Trang 01 — 001.png]\nCậu đang làm gì thế?\n${mk}何してるの？\n\n${tg} Rầm!\n${mk}${tg} ドォン\n\n[Trang 02 — 002.png]\n(không có chữ)`;
    const s = VB.keys.stat();
    $('adv-keyinfo').textContent = `Đang có ${s.total} key · dùng được ${s.usable} · đang nghỉ ${s.usable - s.free} · lỗi ${s.dead}.`;
  }

  function renderLib() {
    const box = $('adv-lib'), lib = VB.ctx.libList();
    box.innerHTML = lib.length ? '' : '<span class="vbs-hint">(chưa có — tạo ở trang “Tạo ngữ cảnh” rồi bấm 💾 Lưu vào thư viện)</span>';
    lib.forEach(it => {
      const row = document.createElement('label'); row.className = 'vbs-item';
      row.innerHTML = `<input type="checkbox"${cfg.lib.includes(it.name) ? ' checked' : ''}><b>${esc(it.name)}</b>` +
        `<span class="vbs-hint">${fmtN((it.text || '').length)} ký tự · ${new Date(it.at).toLocaleDateString('vi-VN')}</span>`;
      row.querySelector('input').onchange = e => { cfg.lib = cfg.lib.filter(n => n !== it.name); if (e.target.checked) cfg.lib.push(it.name); save(); };
      box.appendChild(row);
    });
  }
  function renderFiles() {
    const box = $('adv-files');
    box.innerHTML = cfg.files.length ? '' : '<span class="vbs-hint">Chưa có file nào.</span>';
    cfg.files.forEach((f, i) => {
      const row = document.createElement('div'); row.className = 'vbs-item';
      row.innerHTML = `<input type="checkbox"${f.enabled !== false ? ' checked' : ''}><b>${esc(f.name)}</b>` +
        `<span class="vbs-hint">${fmtN((f.text || '').length)} ký tự</span><button type="button" class="vbs-btn danger" style="padding:3px 8px">✕</button>`;
      row.querySelector('input').onchange = e => { f.enabled = e.target.checked; save(); };
      row.querySelector('button').onclick = () => { cfg.files.splice(i, 1); renderFiles(); save(); };
      box.appendChild(row);
    });
  }

  function fill() {
    $('adv-en').checked = !!cfg.enabled; $('adv-studio').checked = !!cfg.useStudio; $('adv-main').checked = !!cfg.useMain;
    ['title', 'tone', 'synopsis', 'glossary', 'notes'].forEach(k => { $('adv-' + k).value = cfg[k] || ''; });
    $('adv-max').value = cfg.maxChars; $('adv-marker').value = cfg.marker; $('adv-sfxtag').value = cfg.sfxTag;
    renderLib(); renderFiles(); updTotal();
  }

  function tab(name) {
    document.querySelectorAll('#vbs-adv .vbs-tab').forEach(t => t.classList.toggle('on', t.dataset.t === name));
    document.querySelectorAll('#vbs-adv .vbs-pane').forEach(p => p.classList.toggle('on', p.dataset.p === name));
  }
  function open(which) { if (!mounted) mount(); fill(); tab(which || 'ctx'); $('vbs-adv').classList.add('on'); }
  function close() { $('vbs-adv').classList.remove('on'); }

  function mount() {
    if (mounted) return;
    const m = document.createElement('div'); m.id = 'vbs-adv'; m.className = 'vbs-modal'; m.innerHTML = HTML;
    document.body.appendChild(m); mounted = true;
    m.addEventListener('mousedown', e => { if (e.target === m) close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && m.classList.contains('on')) close(); });
    $('adv-x').onclick = close; $('adv-done').onclick = close;
    m.querySelectorAll('.vbs-tab').forEach(t => { t.onclick = () => tab(t.dataset.t); });
    $('adv-en').onchange = e => { cfg.enabled = e.target.checked; save(); };
    $('adv-studio').onchange = e => { cfg.useStudio = e.target.checked; save(); };
    $('adv-main').onchange = e => { cfg.useMain = e.target.checked; save(); };
    ['title', 'tone', 'synopsis', 'glossary', 'notes'].forEach(k => { $('adv-' + k).oninput = e => { cfg[k] = e.target.value; save(); }; });
    $('adv-max').oninput = e => { cfg.maxChars = Math.max(2000, parseInt(e.target.value, 10) || 30000); save(); };
    $('adv-marker').oninput = e => { cfg.marker = e.target.value || '*'; save(); };
    $('adv-sfxtag').oninput = e => { cfg.sfxTag = e.target.value || '(sfx)'; save(); };
    $('adv-file').onchange = async e => {
      for (const f of Array.from(e.target.files || [])) {
        try {
          const text = String(await VB.file.read(f)).trim();
          cfg.files = cfg.files.filter(x => x.name !== f.name);
          cfg.files.push({ name: f.name, text, enabled: true });
        } catch (x) { alert('Không đọc được ' + f.name + ': ' + x.message); }
      }
      e.target.value = ''; renderFiles(); save();
    };
    $('adv-file-clear').onclick = () => { if (cfg.files.length && confirm('Xoá toàn bộ file ngữ cảnh riêng?')) { cfg.files = []; renderFiles(); save(); } };
    $('adv-keys').onclick = () => { close(); VB.keyModal(); };
    window.addEventListener('vbs:keys', updTotal);
    window.addEventListener('vbs:ctx', updTotal);
  }

  function addNavButton() {
    const key = $('vbs-navkey');
    if (!key || $('vbs-navadv')) return;
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'vbs-btn'; b.id = 'vbs-navadv'; b.textContent = '⚙ Nâng cao';
    b.onclick = () => open('ctx');
    key.parentNode.insertBefore(b, key);
  }

  VB.adv = { get cfg() { return cfg; }, build, open };
  function init() { mount(); addNavButton(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
