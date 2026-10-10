/* =============================================================================
 * vb-merge.js — trang Gộp bản dịch (merge.html). Cần vb-shared.js nạp trước.
 * ========================================================================== */
(function () {
  'use strict';
  const VB = window.VBS;
  if (!VB || !document.getElementById('m-out')) return;
  const $ = VB.$, sleep = VB.sleep;

  const S = { running: false, abort: null };
  const setStatus = t => { const e = $('m-status'); if (e) e.textContent = t; };
  const setProg = p => { const e = $('m-progress'); if (e) e.style.width = Math.max(0, Math.min(100, p)) + '%'; };

  const lines = t => String(t || '').replace(/\r/g, '').split('\n').filter(l => l.trim() !== '');
  const isSfx = l => /\[SFX\]/i.test(l);
  const isNar = l => /\[(NARRATION|NARR|CHỮ NỀN)\]/i.test(l);

  function info() {
    const a = lines($('m-a').value), b = lines($('m-b').value);
    $('m-info-a').textContent = a.length ? `· ${a.length} dòng` : '';
    $('m-info-b').textContent = b.length ? `· ${b.length} dòng` : '';
    if (!S.running) setStatus(a.length && b.length ? `A ${a.length} dòng · B ${b.length} dòng — sẵn sàng.` : 'Cần cả hai bản dịch.');
  }

  function offlineMerge(A, B, o) {
    const n = Math.max(A.length, B.length), out = [];
    for (let i = 0; i < n; i++) {
      const a = (A[i] || '').trim(), b = (B[i] || '').trim();
      let pick = a.length >= b.length ? a : b;
      if (!pick) pick = a || b;
      if (o.dropSfx && isSfx(pick)) continue;
      if (!o.keepNar && isNar(pick)) continue;
      out.push(pick);
    }
    return out.join('\n');
  }

  function prompt(o) {
    const p = [];
    p.push(`Bạn là biên tập viên truyện tranh. Dưới đây là HAI bản dịch ${o.dst === 'en' ? 'tiếng Anh' : 'tiếng Việt'} của cùng một đoạn, do hai AI khác nhau tạo ra.`);
    p.push('Nhiệm vụ: hợp nhất thành MỘT bản tốt nhất — chọn cách diễn đạt tự nhiên hơn ở từng dòng, sửa xưng hô cho nhất quán trong cả đoạn, giữ đúng số dòng và đúng thứ tự.');
    p.push('Không bịa thêm dòng, không gộp hai dòng thành một, không bỏ dòng (trừ các loại bị yêu cầu loại bỏ).');
    if (o.dropSfx) p.push('Loại bỏ mọi dòng [SFX].');
    if (!o.keepNar) p.push('Loại bỏ dòng narration / chữ nền.');
    if (o.style) { const g = window.STYLE_GUIDE || window.styleGuide; const t = !g ? '' : (typeof g === 'string' ? g : (g.text || g.prompt || '')); if (t) p.push('', 'ELEMENTS OF STYLE', t.slice(0, 3000)); }
    if (o.context) p.push('', '===== NGỮ CẢNH (tên riêng và xưng hô phải theo đây) =====', o.context.slice(0, 15000), '===== HẾT NGỮ CẢNH =====');
    p.push('', 'Đầu ra: chỉ các dòng đã gộp, mỗi dòng một mục, không đánh số lại, không lời dẫn, không markdown.');
    if (o.bi) p.push('Mỗi mục xuất hai dòng: dòng đầu là bản A gốc đặt sau ">", dòng sau là bản đã gộp.');
    p.push('', '===== BẢN A =====', o.a, '', '===== BẢN B =====', o.b);
    return p.join('\n');
  }

  async function run() {
    if (S.running) return;
    const A = lines($('m-a').value), B = lines($('m-b').value);
    if (!A.length || !B.length) { alert('Cần cả hai bản dịch.'); return; }

    const o = {
      model: $('m-model').value, dst: $('m-dst').value,
      anchor: $('m-anchor').value,
      chunk: Math.max(10, parseInt($('m-chunk').value, 10) || 60),
      delay: Math.max(0, parseInt($('m-delay').value, 10) || 0),
      dropSfx: $('m-dropsfx').checked, keepNar: $('m-keepnar').checked,
      bi: $('m-bi').checked, style: $('m-style').checked,
      context: $('m-ctx').checked ? VB.ctx.get() : '',
      offline: $('m-offline').checked
    };

    if (o.offline) {
      $('m-out').value = offlineMerge(A, B, o);
      $('m-stat').textContent = `Gộp offline · ${lines($('m-out').value).length} dòng`;
      setStatus('Xong (offline, không gọi API).'); setProg(100);
      return;
    }
    if (!VB.keys.load().length) { alert('Chưa có API key. Bấm 🔑 trên thanh điều hướng, hoặc bật “Chế độ offline”.'); return; }

    const base = o.anchor === 'b' ? B : o.anchor === 'a' ? A : (A.length >= B.length ? A : B);
    const other = base === A ? B : A;

    try { await VB.models.discover(); } catch (_) {}

    S.running = true; S.abort = new AbortController();
    $('m-run').disabled = true; $('m-stop').disabled = false;
    const parts = [];
    const total = Math.ceil(base.length / o.chunk);
    let fails = 0;

    for (let i = 0, k = 0; i < base.length; i += o.chunk, k++) {
      if (S.abort.signal.aborted) break;
      setStatus(`Gộp đoạn ${k + 1}/${total}…`);
      const a = (base === A ? A : B).slice(i, i + o.chunk).join('\n');
      const b = other.slice(i, i + o.chunk).join('\n');
      try {
        const r = await VB.gemini.call(o.model, [{ text: prompt(Object.assign({}, o, { a, b })) }],
          { signal: S.abort.signal, maxTokens: 8192, temperature: 0.3, onNote: () => {} });
        parts.push(r.text.replace(/^```[a-z]*\n?|```$/gm, '').trim());
        fails = 0;
      } catch (e) {
        const m = String(e.message || e);
        if (m.includes('dừng')) break;
        parts.push(offlineMerge(a.split('\n'), b.split('\n'), o));
        if (++fails >= 3) { alert('Dừng vì lỗi lặp lại:\n\n' + m); break; }
      }
      setProg(((k + 1) / total) * 100);
      $('m-out').value = parts.join('\n');
      if (o.delay) await sleep(o.delay);
    }

    S.running = false;
    $('m-run').disabled = false; $('m-stop').disabled = true;
    $('m-stat').textContent = `${lines($('m-out').value).length} dòng kết quả`;
    setStatus(S.abort.signal.aborted ? 'Đã dừng.' : 'Hoàn tất.');
  }

  function bind() {
    const hook = (slot, fileId, taId, clearId) => {
      $(fileId).onchange = async e => {
        const f = e.target.files && e.target.files[0]; if (!f) return;
        try { $(taId).value = await VB.file.read(f); info(); VB.toast('Đã nạp ' + f.name); }
        catch (x) { alert('Không đọc được: ' + x.message); }
        e.target.value = '';
      };
      $(clearId).onclick = () => { $(taId).value = ''; info(); };
    };
    hook('a', 'm-file-a', 'm-a', 'm-clear-a');
    hook('b', 'm-file-b', 'm-b', 'm-clear-b');

    $('m-a').oninput = info; $('m-b').oninput = info;
    $('m-run').onclick = run;
    $('m-stop').onclick = () => { if (S.abort) S.abort.abort(); setStatus('Đang dừng…'); };
    $('m-copy').onclick = () => VB.file.copy($('m-out').value);
    $('m-txt').onclick = () => VB.file.saveAs($('m-out').value, 'txt', 'ban-gop');
    $('m-docx').onclick = () => VB.file.saveAs($('m-out').value, 'docx', 'ban-gop');
    $('m-zip').onclick = async () => {
      const z = new JSZip();
      z.file('ban-gop.txt', $('m-out').value);
      z.file('ban-A.txt', $('m-a').value);
      z.file('ban-B.txt', $('m-b').value);
      VB.file.download(await z.generateAsync({ type: 'blob' }), 'visionbox-gop.zip');
    };
    window.addEventListener('beforeunload', e => { if (S.running) { e.preventDefault(); e.returnValue = ''; } });
  }

  bind(); info();
})();
