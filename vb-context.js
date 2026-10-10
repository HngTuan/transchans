/* =============================================================================
 * vb-context.js — trang Tạo ngữ cảnh (studio.html)
 * Pipeline theo trans.py: quét ảnh theo lô → trích xuất → gộp cộng dồn 8 phần.
 * Cần vb-shared.js nạp trước.
 * ========================================================================== */
(function () {
  'use strict';
  const VB = window.VBS;
  if (!VB || !document.getElementById('c-out')) return;
  const $ = VB.$, sleep = VB.sleep;

  const GENRES = {
    'Shounen / Hành động': 'Nhịp nhanh, câu ngắn dứt khoát, giữ khí thế chiến đấu; tên chiêu thức giữ nguyên dạng gốc kèm chú thích lần đầu.',
    'Shoujo / Lãng mạn': 'Lời thoại mềm, nhiều sắc thái cảm xúc; xưng hô biến đổi tinh tế theo tiến triển tình cảm.',
    'Seinen / Tâm lý': 'Văn trầm, câu dài hơn, giữ tính đa nghĩa; không đơn giản hoá ẩn dụ.',
    'Josei / Đời thường': 'Giọng trưởng thành, tự nhiên, ít kịch tính hoá.',
    'Hài hước': 'Ưu tiên nhịp punchline; chơi chữ được phép Việt hoá miễn giữ được tiếng cười.',
    'Kinh dị / Giật gân': 'Câu cụt, nhiều khoảng lặng; giữ sự mơ hồ gây sợ, không giải thích thừa.',
    'Isekai / Fantasy': 'Thuật ngữ thế giới quan phải thống nhất; chức danh, cấp bậc lập bảng riêng.',
    'Học đường': 'Xưng hô theo khối lớp và vai vế câu lạc bộ (tiền bối / hậu bối).',
    'Thể thao': 'Giữ thuật ngữ chuyên môn; lời hô trong trận ngắn và mạnh.',
    'Lịch sử / Cổ trang': 'Dùng từ Hán Việt hợp cảnh, tránh từ hiện đại; xưng hô theo tôn ti.',
    'BL': 'Xưng hô nam–nam theo tiến triển quan hệ; giữ sự tinh tế, tránh khuôn mẫu.',
    'GL': 'Xưng hô nữ–nữ theo tiến triển quan hệ; giữ sự tinh tế, tránh khuôn mẫu.',
    'Chữa lành / Iyashikei': 'Nhịp chậm, câu êm, ưu tiên hình ảnh yên bình; không kịch tính hoá.'
  };

  const SECTIONS = [
    'PHẦN 1 — TỔNG QUAN TÁC PHẨM',
    'PHẦN 2 — THỂ LOẠI & ĐỊNH HƯỚNG VĂN PHONG',
    'PHẦN 3 — DANH SÁCH NHÂN VẬT',
    'PHẦN 4 — BẢNG XƯNG HÔ THEO CẶP',
    'PHẦN 5 — THUẬT NGỮ & TÊN RIÊNG',
    'PHẦN 6 — BỐI CẢNH & THẾ GIỚI QUAN',
    'PHẦN 7 — GIỌNG ĐIỆU RIÊNG TỪNG NHÂN VẬT',
    'PHẦN 8 — LƯU Ý DỊCH THUẬT'
  ];

  const S = { pages: [], chapters: [], running: false, abort: null, base: '', baseName: '' };

  /* ------------------------------------------------------------ tiện ích */
  function log(msg, cls) {
    const box = $('c-log'); if (!box) return;
    const d = document.createElement('div'); if (cls) d.className = cls;
    d.textContent = `[${new Date().toLocaleTimeString('vi-VN')}] ${msg}`;
    box.appendChild(d); box.scrollTop = box.scrollHeight;
  }
  const setStatus = t => { const e = $('c-status'); if (e) e.textContent = t; };
  const setProg = p => { const e = $('c-progress'); if (e) e.style.width = Math.max(0, Math.min(100, p)) + '%'; };

  function renderGenres() {
    const box = $('c-genres'); box.innerHTML = '';
    Object.keys(GENRES).forEach(g => {
      const l = document.createElement('label'); l.className = 'vbs-chip';
      const i = document.createElement('input'); i.type = 'checkbox'; i.value = g;
      l.append(i, document.createTextNode(g));
      box.appendChild(l);
    });
  }
  const pickedGenres = () => Array.from($('c-genres').querySelectorAll('input:checked')).map(i => i.value);

  function renderSrc() {
    $('c-srcinfo').textContent = S.pages.length
      ? `Đã nạp ${S.pages.length} trang từ ${S.chapters.length || 1} nguồn.`
      : 'Chưa nạp ảnh nào.';
    const box = $('c-chaplist'); box.innerHTML = '';
    S.chapters.forEach(c => {
      const row = document.createElement('div'); row.className = 'vbs-chapter';
      row.innerHTML = `<span class="vbs-chapter-name">${c.name}</span><span class="vbs-hint">${c.pages.length} trang</span>`;
      box.appendChild(row);
    });
    if (S.pages.length) setStatus('Sẵn sàng tạo ngữ cảnh.');
  }

  function guessRange() {
    const nums = [];
    S.chapters.forEach(c => { const m = String(c.name).match(/(\d{1,4})/g); if (m) m.forEach(x => nums.push(parseInt(x, 10))); });
    if (!nums.length) return '';
    const a = Math.min.apply(null, nums), b = Math.max.apply(null, nums);
    return a === b ? String(a) : `${a}-${b}`;
  }

  /* ------------------------------------------------------------- nạp ảnh */
  async function addZip(file) {
    setStatus(`Đang đọc ${file.name}…`);
    const chs = await VB.zipToChapters(file);
    if (!chs.length) { setStatus(`${file.name}: không có ảnh.`); return; }
    chs.forEach(c => {
      S.chapters.push(c);
      c.pages.forEach(p => S.pages.push({ name: `${c.name}/${p.name}`, blob: p.blob }));
    });
    renderSrc();
    if (!$('c-range').value) $('c-range').value = guessRange();
    if (!$('c-series').value) $('c-series').value = file.name.replace(/\.zip$/i, '').replace(/[_-]+/g, ' ').trim();
  }

  function addImages(files) {
    const list = Array.from(files).filter(f => /^image\//.test(f.type));
    if (!list.length) return;
    list.sort((a, b) => VB.coll.compare(a.name, b.name));
    const ch = { name: 'Ảnh rời', pages: list.map(f => ({ name: f.name, blob: f })) };
    S.chapters.push(ch);
    ch.pages.forEach(p => S.pages.push({ name: p.name, blob: p.blob }));
    renderSrc();
  }

  /* -------------------------------------------------------------- prompt */
  const LANG = { ja: 'tiếng Nhật', ko: 'tiếng Hàn', zh: 'tiếng Trung', en: 'tiếng Anh' };

  function genreBlock() {
    const picked = pickedGenres();
    const extra = $('c-genre-extra').value.trim();
    const lines = [];
    if (picked.length) {
      lines.push('Thể loại người dùng chỉ định: ' + picked.join(', '));
      picked.forEach(g => lines.push(`  • ${g}: ${GENRES[g]}`));
    }
    if ($('c-genre-auto').checked) lines.push('Bạn được phép bổ sung thể loại khác nếu ảnh cho thấy rõ, và phải nêu lý do ngắn.');
    if (extra) lines.push('Ghi chú văn phong riêng: ' + extra);
    return lines.join('\n');
  }

  function extractPrompt(o) {
    const p = [];
    p.push(`Bạn là trợ lý biên tập truyện tranh. Bạn ĐANG NHÌN THẤY ${o.count} trang truyện ${LANG[o.src] || o.src} đính kèm (lô ${o.batch}/${o.total}).`);
    p.push(`Nhiệm vụ: TRÍCH XUẤT dữ liệu nền phục vụ dịch thuật sang ${o.dst === 'en' ? 'tiếng Anh' : 'tiếng Việt'}. KHÔNG dịch toàn bộ truyện, chỉ ghi nhận dữ kiện.`);
    p.push('');
    p.push('Hãy quan sát kỹ HÌNH ẢNH chứ không chỉ chữ: khuôn mặt, tuổi ước lượng, giới tính, trang phục, đồng phục, phù hiệu, chức vụ, kiểu tóc, chiều cao tương đối, biểu cảm, khoảng cách cơ thể và ai cúi đầu trước ai. Những chi tiết này quyết định cặp xưng hô tiếng Việt.');
    if (o.genres) { p.push(''); p.push('ĐỊNH HƯỚNG THỂ LOẠI'); p.push(o.genres); }
    if (o.notes) { p.push(''); p.push('YÊU CẦU RIÊNG CỦA NGƯỜI DÙNG'); p.push(o.notes); }
    p.push('');
    p.push('Xuất đúng các mục sau, mục nào không có dữ liệu thì ghi "(chưa có)":');
    p.push('[NHÂN VẬT] mỗi dòng: Tên gốc | Tên phiên âm/Việt | giới tính | tuổi ước lượng | vai trò | dấu hiệu nhận dạng trên hình');
    p.push('[XƯNG HÔ] mỗi dòng: A → B | A tự xưng | A gọi B | căn cứ từ hình ảnh hoặc lời thoại');
    p.push('[THUẬT NGỮ] mỗi dòng: chữ gốc | nghĩa | cách dịch đề xuất | ghi chú');
    p.push('[BỐI CẢNH] gạch đầu dòng ngắn về nơi chốn, thời đại, tổ chức, luật lệ thế giới.');
    p.push('[GIỌNG ĐIỆU] mỗi dòng: Nhân vật | đặc điểm lời nói (cộc lốc, lễ phép, giọng vùng miền, tật nói…)');
    p.push('[SỰ KIỆN] 3–6 gạch đầu dòng tóm tắt diễn biến trong các trang này.');
    p.push('[THỂ LOẠI] thể loại bạn nhận ra từ hình ảnh, kèm lý do một câu.');
    p.push('Viết ngắn gọn, không văn vẻ, không lặp lại đề bài.');
    return p.join('\n');
  }

  function mergePrompt(o) {
    const p = [];
    p.push('Bạn là người giữ hồ sơ ngữ cảnh cho nhóm dịch truyện tranh.');
    p.push('NGUYÊN TẮC TỐI THƯỢNG: CHỈ ĐƯỢC THÊM. Tuyệt đối không xoá, không sửa, không rút gọn, không diễn giải lại bất kỳ dòng nào đã có trong HỒ SƠ CŨ. Nếu dữ liệu mới mâu thuẫn với cũ, giữ cả hai và ghi "(mâu thuẫn — cần người kiểm tra)".');
    p.push(`Phần dữ liệu mới bổ sung phải gắn nhãn [BỔ SUNG ${o.rangeLabel}] ở cuối dòng.`);
    p.push('');
    p.push('Xuất lại TOÀN BỘ hồ sơ hoàn chỉnh theo đúng 8 phần dưới đây, đúng tiêu đề, không thêm phần nào khác:');
    SECTIONS.forEach(s => p.push(s));
    p.push('');
    p.push('Quy định từng phần:');
    p.push('• PHẦN 3 lập bảng dạng: Tên gốc | Tên dùng trong bản dịch | giới tính | tuổi | vai trò | nhận dạng.');
    p.push('• PHẦN 4 là bảng xưng hô theo CẶP, mỗi dòng: A → B | A tự xưng là … | A gọi B là … | căn cứ. Phải phủ hết các cặp nhân vật đã xuất hiện.');
    p.push('• PHẦN 5 giữ nguyên chữ gốc bên cạnh cách dịch đã chốt.');
    p.push('• PHẦN 8 ghi các bẫy dịch: chơi chữ, kính ngữ, câu lặp, tên chiêu thức, điều cần hỏi tác giả.');
    p.push('Viết bằng ' + (o.dst === 'en' ? 'tiếng Anh' : 'tiếng Việt') + ', dạng văn bản thuần, không markdown, không ``` .');
    p.push('');
    if (o.base) { p.push('===== HỒ SƠ CŨ (giữ nguyên 100%) ====='); p.push(o.base); p.push('===== HẾT HỒ SƠ CŨ ====='); p.push(''); }
    p.push('===== DỮ LIỆU MỚI TRÍCH TỪ ẢNH =====');
    p.push(o.fresh);
    p.push('===== HẾT DỮ LIỆU MỚI =====');
    if (o.genres) { p.push(''); p.push('ĐỊNH HƯỚNG THỂ LOẠI (đưa vào PHẦN 2)'); p.push(o.genres); }
    if (o.notes) { p.push(''); p.push('YÊU CẦU RIÊNG (đưa vào PHẦN 8)'); p.push(o.notes); }
    if (o.series) { p.push(''); p.push('Tên tác phẩm: ' + o.series); }
    return p.join('\n');
  }

  /* --------------------------------------------------------------- chạy */
  async function run() {
    if (S.running) return;
    if (!S.pages.length) { alert('Chưa nạp ảnh.'); return; }
    if (!VB.keys.load().length) { alert('Chưa có API key. Bấm 🔑 trên thanh điều hướng.'); return; }

    const cfg = {
      model: $('c-model').value,
      src: $('c-src').value,
      dst: $('c-dst').value,
      size: Math.max(2, parseInt($('c-batchsize').value, 10) || 8),
      maxB: Math.max(0, parseInt($('c-maxbatch').value, 10) || 0),
      delay: Math.max(0, parseInt($('c-delay').value, 10) || 0),
      width: Math.max(600, parseInt($('c-width').value, 10) || 1280),
      accum: $('c-accum').checked
    };
    const series = $('c-series').value.trim() || 'Tác phẩm';
    const range = $('c-range').value.trim() || guessRange() || 'mới';
    const genres = genreBlock(), notes = $('c-notes').value.trim();

    let batches = [];
    for (let i = 0; i < S.pages.length; i += cfg.size) batches.push(S.pages.slice(i, i + cfg.size));
    if (cfg.maxB && batches.length > cfg.maxB) {
      const step = batches.length / cfg.maxB, picked = [];
      for (let i = 0; i < cfg.maxB; i++) picked.push(batches[Math.floor(i * step)]);
      batches = picked;
      log(`Giới hạn ${cfg.maxB} lô — lấy mẫu rải đều toàn bộ truyện.`, 'warn');
    }

    S.running = true; S.abort = new AbortController();
    $('c-start').disabled = true; $('c-stop').disabled = false;
    setProg(0); log(`Bắt đầu: ${S.pages.length} trang → ${batches.length} lô, model ${cfg.model}`);

    try { await VB.models.discover(); } catch (e) { log('Không dò được model: ' + e.message, 'warn'); }

    const fresh = [];
    let fails = 0;
    for (let i = 0; i < batches.length; i++) {
      if (S.abort.signal.aborted) break;
      const b = batches[i];
      setStatus(`Phân tích lô ${i + 1}/${batches.length} (${b.length} trang)…`);
      try {
        const parts = [{ text: extractPrompt({ count: b.length, batch: i + 1, total: batches.length, src: cfg.src, dst: cfg.dst, genres, notes }) }];
        for (const p of b) {
          const arr = await VB.img.parts(p.blob, cfg.width, false);
          parts.push({ inline_data: { mime_type: 'image/jpeg', data: arr[0] } });
        }
        const r = await VB.gemini.call(cfg.model, parts, { signal: S.abort.signal, maxTokens: 4096, onNote: m => log(m, 'warn') });
        fresh.push(`----- LÔ ${i + 1} (${b[0].name} → ${b[b.length - 1].name}) -----\n${r.text}`);
        log(`Lô ${i + 1} xong (${r.text.length} ký tự, model ${r.model})`, 'ok');
        fails = 0;
      } catch (e) {
        const msg = String(e.message || e);
        if (msg.includes('dừng')) break;
        log(`Lô ${i + 1} lỗi: ${msg}`, 'bad');
        if (++fails >= 3 || /Không còn API key|404/.test(msg)) {
          alert('Dừng sớm vì lỗi lặp lại:\n\n' + msg + '\n\nBấm 🔑 → Kiểm tra key để chẩn đoán.');
          break;
        }
      }
      setProg(((i + 1) / batches.length) * 90);
      if (cfg.delay) await sleep(cfg.delay);
    }

    if (fresh.length && !S.abort.signal.aborted) {
      setStatus('Đang tổng hợp hồ sơ ngữ cảnh…');
      log('Tổng hợp ' + fresh.length + ' lô thành hồ sơ 8 phần…');
      const base = cfg.accum ? (S.base || '') : '';
      try {
        const r = await VB.gemini.call(cfg.model, [{
          text: mergePrompt({ base, fresh: fresh.join('\n\n'), genres, notes, series, dst: cfg.dst, rangeLabel: 'CHƯƠNG ' + range })
        }], { signal: S.abort.signal, maxTokens: 8192, temperature: 0.25, onNote: m => log(m, 'warn') });

        let final = r.text.replace(/^```[a-z]*\n?|```$/gm, '').trim();
        if (base && final.length < base.length * 0.85) {
          log('Bản gộp ngắn hơn hồ sơ cũ — kích hoạt bảo hiểm, nối thêm thay vì thay thế.', 'warn');
          final = base + `\n\n===== [BỔ SUNG CHƯƠNG ${range}] =====\n` + final;
        }
        $('c-out').value = final;
        $('c-outinfo').textContent = `${final.length.toLocaleString('vi-VN')} ký tự · ${series} ${range}`;
        log('Hoàn tất.', 'ok');
      } catch (e) {
        log('Lỗi tổng hợp: ' + e.message, 'bad');
        $('c-out').value = (S.base ? S.base + '\n\n' : '') + '===== DỮ LIỆU THÔ CHƯA TỔNG HỢP =====\n' + fresh.join('\n\n');
      }
    }

    S.running = false; setProg(100);
    $('c-start').disabled = false; $('c-stop').disabled = true;
    setStatus(S.abort.signal.aborted ? 'Đã dừng.' : 'Xong — kiểm tra kết quả ở mục 5.');
  }

  /* -------------------------------------------------------- thư viện nền */
  function refreshLib() {
    const sel = $('c-lib'); const cur = sel.value;
    sel.innerHTML = '<option value="">— Thư viện ngữ cảnh đã lưu —</option>';
    VB.ctx.libList().forEach((it, i) => {
      const o = document.createElement('option');
      o.value = String(i);
      o.textContent = `${it.name} (${new Date(it.at).toLocaleDateString('vi-VN')})`;
      sel.appendChild(o);
    });
    sel.value = cur;
  }
  function setBase(text, name) {
    S.base = text || ''; S.baseName = name || '';
    $('c-baseinfo').textContent = S.base ? `Nền: ${S.baseName} · ${S.base.length.toLocaleString('vi-VN')} ký tự` : 'Chưa có bản nền.';
  }

  /* ------------------------------------------------------------- sự kiện */
  function bind() {
    $('c-zip').onchange = async e => { for (const f of Array.from(e.target.files || [])) { try { await addZip(f); } catch (x) { setStatus('Lỗi zip: ' + x.message); } } e.target.value = ''; };
    $('c-imgs').onchange = e => { addImages(e.target.files); e.target.value = ''; };

    const d = $('c-drop');
    ['dragenter', 'dragover'].forEach(t => d.addEventListener(t, e => { e.preventDefault(); d.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(t => d.addEventListener(t, e => { e.preventDefault(); d.classList.remove('over'); }));
    d.addEventListener('drop', async e => {
      const fs = Array.from(e.dataTransfer.files || []);
      for (const f of fs) if (/\.zip$/i.test(f.name)) { try { await addZip(f); } catch (x) { setStatus('Lỗi zip: ' + x.message); } }
      addImages(fs.filter(f => /^image\//.test(f.type)));
    });

    $('c-start').onclick = run;
    $('c-stop').onclick = () => { if (S.abort) S.abort.abort(); setStatus('Đang dừng…'); };

    $('c-basefile').onchange = async e => {
      const f = e.target.files && e.target.files[0]; if (!f) return;
      try { setBase(await VB.file.read(f), f.name); log('Đã nạp bản nền: ' + f.name, 'ok'); }
      catch (x) { alert('Không đọc được file: ' + x.message); }
      e.target.value = '';
    };
    $('c-libload').onclick = () => {
      const i = $('c-lib').value; if (i === '') { alert('Chưa chọn bản nào.'); return; }
      const it = VB.ctx.libList()[parseInt(i, 10)];
      if (it) { setBase(it.text, it.name); log('Nạp từ thư viện: ' + it.name, 'ok'); }
    };
    $('c-baseclear').onclick = () => setBase('', '');

    $('c-apply').onclick = () => {
      const t = $('c-out').value.trim();
      if (!t) { alert('Chưa có nội dung.'); return; }
      VB.ctx.set(t); VB.toast('Đã đặt làm ngữ cảnh hiện hành');
    };
    $('c-save').onclick = () => {
      const t = $('c-out').value.trim(); if (!t) { alert('Chưa có nội dung.'); return; }
      const name = `${$('c-series').value.trim() || 'Tác phẩm'} ${$('c-range').value.trim() || guessRange() || ''}`.trim();
      VB.ctx.libSave(name, t); refreshLib(); VB.toast('Đã lưu: ' + name);
    };
    $('c-copy').onclick = () => VB.file.copy($('c-out').value);
    $('c-txt').onclick = () => VB.file.saveAs($('c-out').value, 'txt', `${$('c-series').value || 'ngu-canh'} ${$('c-range').value || ''}`);
    $('c-docx').onclick = () => VB.file.saveAs($('c-out').value, 'docx', `${$('c-series').value || 'ngu-canh'} ${$('c-range').value || ''}`);

    window.addEventListener('beforeunload', e => { if (S.running) { e.preventDefault(); e.returnValue = ''; } });
  }

  renderGenres(); bind(); refreshLib(); renderSrc();
  if ($('c-autobase').checked) {
    const lib = VB.ctx.libList();
    if (lib.length) setBase(lib[0].text, lib[0].name + ' (tự nạp)');
    else { const cur = VB.ctx.get(); if (cur) setBase(cur, 'ngữ cảnh hiện hành'); }
  }
})();
