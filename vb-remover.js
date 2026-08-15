/* vb-remover.js — Xoa toan bo chu tren anh bang model anh cua Gemini
 * Tu xoay vong 5 API key (dung chung pool voi vb-core), tu cat anh webtoon
 * qua dai thanh nhieu lat -> xu ly tung lat -> ghep lai theo dung kich thuoc.
 */
(() => {
  'use strict';
  const VB = window.VB, FMT = VB && VB.FMT;
  if (!VB) { console.error('[VB-REMOVER] thieu vb-core.js'); return; }
  const $ = id => document.getElementById(id);

  const LANG_TXT = {
    ja: 'Japanese text (kanji, hiragana, katakana, furigana, vertical text, handwritten notes, sound effects and onomatopoeia)',
    ko: 'Korean text (hangul, hanja, vertical text, handwritten notes, sound effects and onomatopoeia)',
    zh: 'Chinese text (simplified and traditional hanzi, vertical text, handwritten notes, sound effects and onomatopoeia)',
    en: 'English text (printed lettering, handwritten notes, sound effects and onomatopoeia)',
    all: 'text in ANY language (Japanese, Korean, Chinese, English…, including furigana, vertical text, handwritten notes, sound effects and onomatopoeia)'
  };

  const DEFAULT_PROMPT = `Remove ALL {LANG} from this image, including any text inside speech bubbles, captions and signs. Redraw ONLY the areas that were covered by the text: seamlessly reconstruct the background, patterns, textures, screentones and line art that should logically continue underneath, matching the original art style, line weight, colors and lighting exactly. DO NOT change anything else in the image: keep the exact same composition, characters, poses, objects, framing, aspect ratio, resolution and color grading. Do not add any new text, watermark, signature or decoration. Output the full edited image only.`;

  let items = [];      // {id, name, path, blob, url, outBlob, outUrl, status, error}
  let running = false, stopFlag = false, uid = 0;

  // ================= goi API anh (co xoay key + backoff 429) =================
  async function callImageEdit(promptText, part, model, opt) {
    const keys = VB.getKeys();
    if (!keys.length) throw new Error('Chưa có API key. Về trang chính → ⚙ Nâng cao → tab API Keys.');
    const modalitySets = [['IMAGE'], ['TEXT', 'IMAGE']];
    let modalityIdx = 0, lastErr = null;

    for (let attempt = 0; attempt < Math.max(keys.length * 3, 6); attempt++) {
      if (opt && opt.shouldStop && opt.shouldStop()) throw new Error('Đã dừng theo yêu cầu.');
      const key = VB.nextKey();
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
      const body = {
        contents: [{ role: 'user', parts: [{ text: promptText }, part] }],
        generationConfig: { responseModalities: modalitySets[modalityIdx], temperature: 0.2 }
      };

      let res;
      try {
        res = await fetch(url, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body), __vbManaged: true
        });
      } catch (e) { lastErr = e; await VB.sleep(800); continue; }

      if (res.ok) {
        const json = await res.json();
        const parts = (json.candidates && json.candidates[0] && json.candidates[0].content &&
          json.candidates[0].content.parts) || [];
        const img = parts.find(p => p.inlineData || p.inline_data);
        if (img) {
          const d = img.inlineData || img.inline_data;
          return { data: d.data, mime: d.mimeType || d.mime_type || 'image/png' };
        }
        const txt = parts.map(p => p.text || '').join(' ').trim();
        throw new Error(txt ? ('Model trả về chữ thay vì ảnh: ' + txt.slice(0, 160)) : 'Model không trả về ảnh nào.');
      }

      const errTxt = await res.text().catch(() => '');
      if (res.status === 429 || res.status === 503 || res.status === 500) {
        VB.coolKey(key, res.status === 429 ? 45000 : 12000);
        lastErr = new Error(`HTTP ${res.status} (key ${VB.keyLabel(key)})`);
        opt && opt.onStatus && opt.onStatus(`HTTP ${res.status} → đổi key / chờ…`);
        await VB.sleep(Math.min(30000, 1200 * Math.pow(2, attempt)));
        continue;
      }
      if (res.status === 400 && /responseModalities|modalit/i.test(errTxt) && modalityIdx < modalitySets.length - 1) {
        modalityIdx++; continue;                                   // doi kieu tra ve roi thu lai
      }
      if (res.status === 400 && /API key not valid/i.test(errTxt)) {
        VB.coolKey(key, 10 * 60 * 1000);
        lastErr = new Error('API key không hợp lệ: ' + VB.keyLabel(key));
        continue;
      }
      throw new Error(`HTTP ${res.status}: ${errTxt.slice(0, 220)}`);
    }
    throw lastErr || new Error('Gọi model ảnh thất bại.');
  }
  VB.callGeminiImage = callImageEdit;

  // ================= xu ly anh =================
  const b64ToBlob = (b64, mime) => {
    const bin = atob(b64), arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime || 'image/png' });
  };
  const blobToB64 = blob => new Promise((ok, no) => {
    const fr = new FileReader();
    fr.onload = () => ok(String(fr.result).split(',')[1]);
    fr.onerror = () => no(fr.error || new Error('Không đọc được ảnh'));
    fr.readAsDataURL(blob);
  });

  function canvasToBlob(cv, png) {
    return new Promise(ok => cv.toBlob(b => ok(b), png ? 'image/png' : 'image/jpeg', png ? undefined : 0.94));
  }

  /** Ve 1 bitmap ra blob voi kich thuoc chi dinh */
  async function drawToBlob(src, w, h, png) {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    cv.getContext('2d').drawImage(src, 0, 0, w, h);
    return canvasToBlob(cv, png);
  }

  async function processOne(item, o) {
    const bmp = await createImageBitmap(item.blob);
    const W = bmp.width, H = bmp.height;
    const scale = o.maxWidth && W > o.maxWidth ? o.maxWidth / W : 1;
    const w = Math.round(W * scale), h = Math.round(H * scale);

    // cat lat KHONG chong lan (chong lan se lam vet noi bi lech khi ghep)
    const cuts = [];
    if (o.cut && h > o.sliceH * 1.25) {
      for (let y = 0; y < h; y += o.sliceH) cuts.push([y, Math.min(o.sliceH, h - y)]);
    } else cuts.push([0, h]);

    const prompt = o.prompt.replace(/\{LANG\}/g, LANG_TXT[o.lang] || LANG_TXT.all);
    const outCv = document.createElement('canvas');
    outCv.width = o.fitBack ? W : w;
    outCv.height = o.fitBack ? H : h;
    const ctx = outCv.getContext('2d');
    const ky = outCv.height / h;

    for (let i = 0; i < cuts.length; i++) {
      if (stopFlag) throw new Error('Đã dừng theo yêu cầu.');
      const [y, ph] = cuts[i];
      const piece = document.createElement('canvas');
      piece.width = w; piece.height = ph;
      piece.getContext('2d').drawImage(bmp, 0, y / scale, W, ph / scale, 0, 0, w, ph);
      const b64 = piece.toDataURL('image/png').split(',')[1];

      item.status = cuts.length > 1 ? `đang xử lý lát ${i + 1}/${cuts.length}` : 'đang xử lý';
      renderGrid();

      const res = await callImageEdit(prompt, { inline_data: { mime_type: 'image/png', data: b64 } }, o.model, {
        shouldStop: () => stopFlag,
        onStatus: t => { $('r-status').textContent = `${item.name}: ${t}`; }
      });
      const outBmp = await createImageBitmap(b64ToBlob(res.data, res.mime));
      ctx.drawImage(outBmp, 0, Math.round(y * ky), outCv.width, Math.round(ph * ky));
      outBmp.close && outBmp.close();
    }
    bmp.close && bmp.close();

    item.outBlob = await canvasToBlob(outCv, o.png);
    item.outUrl = URL.createObjectURL(item.outBlob);
  }

  // ================= nap file =================
  const IMG_RE = /\.(png|jpe?g|webp|bmp|gif|heic|heif)$/i;

  async function addFiles(files) {
    for (const f of files) {
      if (/\.zip$/i.test(f.name)) {
        if (typeof JSZip === 'undefined') { alert('Thiếu jszip.min.js'); continue; }
        const zip = await JSZip.loadAsync(f);
        const entries = [];
        zip.forEach((path, e) => {
          if (e.dir || /(^|\/)__MACOSX\//.test(path) || /(^|\/)\._/.test(path) || !IMG_RE.test(path)) return;
          entries.push({ path, e });
        });
        entries.sort((a, b) => VB.naturalCompare(a.path, b.path));
        for (const en of entries) {
          const blob = await en.e.async('blob');
          pushItem(en.path.split('/').pop(), en.path, blob);
        }
      } else if (f.type.startsWith('image/') || IMG_RE.test(f.name)) {
        pushItem(f.name, f.name, f);
      }
    }
    items.sort((a, b) => VB.naturalCompare(a.path, b.path));
    renderGrid();
    $('r-info').textContent = `${items.length} ảnh đang chờ.`;
    $('r-status').textContent = items.length ? 'Sẵn sàng. Bấm “Bắt đầu xoá chữ”.' : 'Chưa nạp ảnh.';
  }

  function pushItem(name, path, blob) {
    items.push({
      id: ++uid, name, path,
      blob: blob.type ? blob : new Blob([blob], { type: VB.mimeOf(name) }),
      url: URL.createObjectURL(blob), outBlob: null, outUrl: null, status: 'chờ', error: ''
    });
  }

  // ================= render =================
  const escHtml = s => String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

  function renderGrid() {
    const box = $('r-grid');
    if (!items.length) { box.innerHTML = '<span class="vb-hint">Chưa có ảnh nào.</span>'; return; }
    box.innerHTML = items.map(it => `
      <div class="vb-imgcard ${it.error ? 'error' : it.outUrl ? 'done' : ''}" data-id="${it.id}">
        <div class="vb-imgcard-head">
          <b title="${escHtml(it.path)}">${escHtml(it.name)}</b>
          <span class="vb-badge">${escHtml(it.error || it.status)}</span>
        </div>
        <img src="${it.outUrl || it.url}" alt="${escHtml(it.name)}" data-toggle="${it.id}">
        <div class="vb-row">
          <button class="vb-btn vb-btn-icon" data-cmp="${it.id}">${it.outUrl ? 'Xem gốc/sau' : '—'}</button>
          <button class="vb-btn vb-btn-icon" data-dl="${it.id}" ${it.outBlob ? '' : 'disabled'}>⬇</button>
          <button class="vb-btn vb-btn-icon vb-btn-danger" data-del="${it.id}">✕</button>
        </div>
      </div>`).join('');
  }

  $('r-grid') && $('r-grid').addEventListener('click', e => {
    const find = a => items.find(i => i.id === +a);
    const cmp = e.target.closest('[data-cmp]'), dl = e.target.closest('[data-dl]'), del = e.target.closest('[data-del]'), tg = e.target.closest('[data-toggle]');
    if (cmp || tg) {
      const it = find((cmp || tg).dataset.cmp || (cmp || tg).dataset.toggle);
      if (!it || !it.outUrl) return;
      const img = (cmp || tg).closest('.vb-imgcard').querySelector('img');
      img.src = img.src === it.outUrl ? it.url : it.outUrl;
      return;
    }
    if (dl) {
      const it = find(dl.dataset.dl);
      if (it && it.outBlob) FMT.downloadBlob(it.outBlob, outName(it));
      return;
    }
    if (del) {
      items = items.filter(i => i.id !== +del.dataset.del);
      renderGrid();
    }
  });

  const outName = it => it.name.replace(/\.[^.]+$/, '') + '-clean.' + ($('r-png').checked ? 'png' : 'jpg');

  // ================= chay =================
  function readOptions() {
    const mv = $('r-model').value;
    return {
      model: mv === '__custom__' ? ($('r-model-custom').value.trim() || 'gemini-2.5-flash-image') : mv,
      lang: $('r-lang').value,
      conc: +$('r-conc').value || 1,
      delayMs: +$('r-delay').value || 0,
      maxWidth: +$('r-width').value || 0,
      sliceH: +$('r-slice').value || 1400,
      cut: $('r-cut').checked,
      fitBack: $('r-fit').checked,
      png: $('r-png').checked,
      prompt: $('r-prompt').value.trim() || DEFAULT_PROMPT
    };
  }

  async function run(list) {
    const targets = list || items.filter(i => !i.outBlob);
    if (!targets.length) return alert('Không có ảnh nào cần xử lý.');
    if (!VB.getKeys().length) return alert('Chưa có API key. Về trang chính → ⚙ Nâng cao → tab API Keys.');

    const o = readOptions();
    running = true; stopFlag = false;
    $('r-run').disabled = true; $('r-stop').disabled = false;

    let cursor = 0, done = 0;
    const setP = () => { $('r-progress').style.width = Math.round(done / targets.length * 100) + '%'; };

    const worker = async () => {
      while (!stopFlag) {
        const i = cursor++;
        if (i >= targets.length) return;
        const it = targets[i];
        it.error = ''; it.status = 'đang xử lý';
        renderGrid();
        try {
          await processOne(it, o);
          it.status = 'xong ✔';
        } catch (e) {
          if (/Đã dừng/.test(e.message)) { it.status = 'đã dừng'; return; }
          it.error = e.message; it.status = 'lỗi';
        }
        done++; setP(); renderGrid();
        if (o.delayMs) await VB.sleep(o.delayMs);
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(3, o.conc)) }, worker));

    running = false; stopFlag = false;
    $('r-run').disabled = false; $('r-stop').disabled = true;
    const bad = items.filter(i => i.error).length;
    $('r-status').textContent = bad ? `Xong, còn ${bad} ảnh lỗi (bấm “Chạy lại ảnh lỗi”).` : 'Hoàn tất tất cả ✔';
  }

  async function zipAll() {
    const done = items.filter(i => i.outBlob);
    if (!done.length) return alert('Chưa có ảnh nào đã xử lý.');
    const zip = new JSZip();
    done.forEach(it => {
      const dir = it.path.includes('/') ? it.path.slice(0, it.path.lastIndexOf('/') + 1) : '';
      zip.file(dir + outName(it), it.outBlob);
    });
    FMT.downloadBlob(await zip.generateAsync({ type: 'blob' }),
      FMT.safeName(VB.data.context.title || 'visionbox-clean') + '.zip');
  }

  // ================= bind =================
  function init() {
    $('r-prompt').value = DEFAULT_PROMPT;
    $('r-keyinfo').textContent = VB.getKeys().length ? `${VB.getKeys().length} API key sẵn sàng` : '⚠ Chưa có API key';
    $('r-back').addEventListener('click', () => { location.href = 'index.html'; });
    $('r-model').addEventListener('change', () => {
      $('r-model-custom').style.display = $('r-model').value === '__custom__' ? 'block' : 'none';
    });
    $('r-prompt-reset').addEventListener('click', () => { $('r-prompt').value = DEFAULT_PROMPT; });
    $('r-files').addEventListener('change', e => { addFiles(Array.from(e.target.files || [])); e.target.value = ''; });

    const drop = $('r-drop');
    ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', e => addFiles(Array.from(e.dataTransfer.files || [])));

    $('r-run').addEventListener('click', () => run());
    $('r-retry').addEventListener('click', () => run(items.filter(i => i.error)));
    $('r-stop').addEventListener('click', () => { stopFlag = true; $('r-status').textContent = 'Đang dừng sau ảnh hiện tại…'; });
    $('r-zip').addEventListener('click', zipAll);
    window.addEventListener('beforeunload', e => { if (running) { e.preventDefault(); e.returnValue = ''; } });
    renderGrid();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
