/* vb-merge.js — Gop 2 ban dich thanh 1 ban tot nhat
 * Quy trinh: parse 2 file -> khop chuong/trang -> AI chon & hoa tron y cua
 * ca hai, dong thoi phan loai D (thoai) / N (narration) / S (SFX) -> loc SFX.
 */
(() => {
  'use strict';
  const VB = window.VB, FMT = VB && VB.FMT;
  if (!VB || !FMT) { console.error('[VB-MERGE] thieu vb-core.js / vb-format.js'); return; }
  const $ = id => document.getElementById(id);

  let stopFlag = false, running = false, resultChapters = [];

  // ---------- nhan dien SFX (dung cho che do offline + hau kiem ket qua AI) ----------
  const SFX_WORD = /^(?:r[ầâ]m|[ầâ]m|b[ụu]p|b[ốô]p|b[ịi]ch|xo[ẹe]t|v[úu]t|v[èe]o|keng|choang|[àa]o|[ùu]|s[ộo]t|ph[ựu]t|t[ạa]ch|b[ụu]p|b[ằă]ng|bang|boom|crash|thud|whoosh|clang|slam|slash|tick|tock|beep|ping|swoosh|kaboom|pow|zap)[\s!?.…~\-–—]*$/i;
  function looksSfx(line) {
    const s = String(line || '').trim();
    if (!s) return false;
    if (VB.isSfxLine(s)) return true;
    const core = VB.stripSfx(s).replace(/[\s!?.…~\-–—*"'“”‘’()]/g, '');
    if (!core) return true;                                   // chi con dau cau
    if (SFX_WORD.test(s)) return true;
    if (core.length <= 8 && /^[A-Z]+$/.test(core)) return true; // BANG, THUD…
    if (/^(.)\1{2,}$/.test(core)) return true;                  // aaaa, ùùùù
    return false;
  }

  // ---------- nap du lieu ----------
  function parseSide(text) {
    const t = String(text || '').trim();
    if (!t) return [];
    const chapters = FMT.parseTransText(t);
    // File text thuong (khong co header) -> parseTransText van tra ve 1 chuong 1 trang
    return chapters;
  }

  function describe(chapters) {
    if (!chapters.length) return 'trống';
    const pages = chapters.reduce((s, c) => s + c.pages.length, 0);
    const lines = chapters.reduce((s, c) => s + c.pages.reduce((x, p) => x + p.lines.length, 0), 0);
    return `${chapters.length} chương · ${pages} trang · ${lines} dòng`;
  }

  function refreshInfo() {
    $('m-info-a').textContent = describe(parseSide($('m-a').value));
    $('m-info-b').textContent = describe(parseSide($('m-b').value));
  }

  // ---------- khop chuong / trang ----------
  function pairChapters(A, B) {
    const out = [];
    const used = new Set();
    A.forEach((ca, i) => {
      let j = B.findIndex((cb, k) => !used.has(k) && cb.name.trim().toLowerCase() === ca.name.trim().toLowerCase());
      if (j === -1 && B[i] && !used.has(i)) j = i;
      if (j !== -1) used.add(j);
      out.push({ name: ca.name, a: ca, b: j === -1 ? null : B[j] });
    });
    B.forEach((cb, k) => { if (!used.has(k)) out.push({ name: cb.name, a: null, b: cb }); });
    return out;
  }

  function pairPages(ca, cb) {
    const pa = ca ? ca.pages : [], pb = cb ? cb.pages : [];
    const n = Math.max(pa.length, pb.length);
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = pa[i] || null, b = pb[i] || null;
      out.push({
        no: (a && a.no) || (b && b.no) || i + 1,
        name: (a && a.name) || (b && b.name) || `image-${String(i + 1).padStart(2, '0')}`,
        a: a ? a.lines : [], b: b ? b.lines : [],
        source: (a && a.source && a.source.length) ? a.source : ((b && b.source) || [])
      });
    }
    return out;
  }

  // ---------- prompt gop ----------
  function buildPrompt(jobs, o) {
    const dst = VB.langName(o.targetLang);
    const ctx = o.useContext && VB.hasContext() ? VB.buildContextBlock(dst, 'refine') + '\n\n' : '';
    const style = o.styleGuide ? VB.getStyleBlock(dst, 'refine') + '\n\n' : '';
    const body = jobs.map(j => {
      const list = arr => arr.length ? arr.map((l, i) => `${i + 1}. ${l}`).join('\n') : '(empty)';
      return `### PAGE ${j.gid} (output exactly ${j.expect} lines)\n[A]\n${list(j.a)}\n[B]\n${list(j.b)}`;
    }).join('\n\n');

    return `${ctx}${style}You are a senior comic translation EDITOR working in ${dst}.

You are given TWO independent ${dst} translations (A and B) of the SAME comic pages. Your job is to produce ONE final, best version of each line by combining the strengths of both.

HOW TO MERGE EACH LINE
1. Compare A and B for the same line. Keep the reading that is more accurate to the situation, more natural as spoken ${dst}, and better suited to the character's voice.
2. You may take the meaning from one version and the phrasing from the other, or write a better third phrasing if BOTH are clumsy — but never invent information that is absent from both A and B.
3. Prefer short, punchy, bubble-friendly lines. Keep stammering, cut-off sentences, interjections, verbal tics and honorifics; those are meaningful, not padding.
4. Keep names, terms and forms of address consistent across the whole output; if A and B disagree on a name, pick one and use it everywhere.

CLASSIFY EVERY LINE
- D = character dialogue or inner thought
- N = narration / caption box / on-screen sign text
- S = sound effect or onomatopoeia (SFX)

ALIGNMENT
- A and B may have a different number of lines (one of them merged bubbles, split them, or included/excluded SFX). Align them by meaning and reading order.
- For each page you MUST output exactly the number of lines stated in that page's header, numbered 1..N in reading order.
- If one side is empty or missing a line, base that line on the other side alone.

OUTPUT FORMAT — nothing else, no comments, no markdown:
### PAGE <id>
1|D|<final text>
2|S|<final text>
...
Repeat the "### PAGE <id>" header for every page, in the same order as given below.

--- PAGES ---
${body}`;
  }

  function parseOutput(text) {
    const map = new Map();
    let cur = null;
    String(text || '').replace(/\r\n?/g, '\n').split('\n').forEach(raw => {
      const line = raw.trim();
      if (!line) return;
      let m = /^#{1,6}\s*PAGE\s+(\d+)/i.exec(line);
      if (m) { cur = []; map.set(+m[1], cur); return; }
      if (!cur) return;
      m = /^(\d+)\s*\|\s*([DNS])\s*\|\s?(.*)$/i.exec(line);
      if (m) { cur.push({ idx: +m[1], kind: m[2].toUpperCase(), text: m[3].trim() }); return; }
      m = /^(\d+)\s*[|.)]\s?(.*)$/.exec(line);
      if (m) cur.push({ idx: +m[1], kind: 'D', text: m[2].trim() });
    });
    return map;
  }

  // ---------- gop offline (khong goi AI) ----------
  function mergeOffline(job) {
    const anchor = job.anchorSide === 'b' ? job.b : job.a;
    const other = job.anchorSide === 'b' ? job.a : job.b;
    return anchor.map((l, i) => {
      const alt = other[i] || '';
      // uu tien dong dai hon mot chut (thuong day du y hon), giu anchor neu xap xi
      const pick = (alt && alt.length > l.length * 1.25) ? alt : l;
      return { kind: looksSfx(pick) ? 'S' : 'D', text: pick };
    });
  }

  // ---------- chay ----------
  async function run() {
    if (running) return;
    const A = parseSide($('m-a').value), B = parseSide($('m-b').value);
    if (!A.length && !B.length) return alert('Chưa nạp bản dịch nào.');

    const o = {
      model: $('m-model').value,
      targetLang: $('m-dst').value,
      anchor: $('m-anchor').value,
      chunkLines: Math.max(10, +$('m-chunk').value || 60),
      delayMs: +$('m-delay').value || 0,
      dropSfx: $('m-dropsfx').checked,
      keepNarration: $('m-keepnar').checked,
      bilingual: $('m-bi').checked,
      styleGuide: $('m-style').checked,
      useContext: $('m-ctx').checked,
      offline: $('m-offline').checked
    };
    if (!o.offline && !VB.getKeys().length)
      return alert('Chưa có API key. Về trang chính → ⚙ Nâng cao → tab API Keys.');

    running = true; stopFlag = false;
    $('m-run').disabled = true; $('m-stop').disabled = false;

    // Dung danh sach job phang, moi job = 1 trang
    const chapters = pairChapters(A, B);
    const jobs = [];
    let gid = 0;
    const built = chapters.map(pair => {
      const pages = pairPages(pair.a, pair.b).map(p => {
        const anchorSide = o.anchor === 'a' ? 'a' : o.anchor === 'b' ? 'b'
          : (p.b.length > p.a.length ? 'b' : 'a');
        const expect = Math.max(1, (anchorSide === 'b' ? p.b : p.a).length || Math.max(p.a.length, p.b.length));
        const job = { gid: ++gid, no: p.no, name: p.name, a: p.a, b: p.b, source: p.source, anchorSide, expect, out: null };
        if (p.a.length || p.b.length) jobs.push(job);
        return job;
      });
      return { name: pair.name, pages };
    });

    let done = 0;
    const total = jobs.length;
    const setP = () => { $('m-progress').style.width = total ? Math.round(done / total * 100) + '%' : '0%'; };

    if (o.offline) {
      jobs.forEach(j => { j.out = mergeOffline(j); done++; });
      setP();
    } else {
      // chia lo theo tong so dong
      const chunks = [];
      let cur = [], curLines = 0;
      jobs.forEach(j => {
        if (cur.length && curLines + j.expect > o.chunkLines) { chunks.push(cur); cur = []; curLines = 0; }
        cur.push(j); curLines += j.expect;
      });
      if (cur.length) chunks.push(cur);

      for (let c = 0; c < chunks.length && !stopFlag; c++) {
        const chunk = chunks[c];
        $('m-status').textContent = `Đang gộp lô ${c + 1}/${chunks.length} (${chunk.length} trang)…`;
        try {
          const text = await VB.callGemini({
            model: o.model,
            parts: [{ text: buildPrompt(chunk, o) }],
            generationConfig: { temperature: 0.35, maxOutputTokens: 8192 },
            shouldStop: () => stopFlag,
            onStatus: t => { $('m-status').textContent = t; }
          });
          const map = parseOutput(text);
          chunk.forEach(j => {
            const rows = map.get(j.gid);
            j.out = (rows && rows.length) ? rows.sort((x, y) => x.idx - y.idx) : mergeOffline(j);
          });
        } catch (e) {
          if (/Đã dừng/.test(e.message)) break;
          chunk.forEach(j => { j.out = mergeOffline(j); });
          $('m-status').textContent = 'Lỗi lô ' + (c + 1) + ': ' + e.message + ' → dùng bản ghép offline cho lô này.';
        }
        done += chunk.length; setP();
        if (o.delayMs && c < chunks.length - 1) await VB.sleep(o.delayMs);
      }
    }

    // ---- loc SFX / narration + dung file ket qua ----
    let dropped = 0;
    resultChapters = built.map(ch => ({
      name: ch.name,
      pages: ch.pages.map(p => {
        const rows = (p.out || []).filter(r => r.text && !/^⟨/.test(r.text));
        const keep = rows.filter(r => {
          const isSfx = r.kind === 'S' || looksSfx(r.text);
          if (o.dropSfx && isSfx) { dropped++; return false; }
          if (!o.keepNarration && r.kind === 'N') return false;
          return true;
        });
        return { no: p.no, name: p.name, lines: keep.map(r => r.text), source: o.bilingual ? p.source : [] };
      })
    }));

    $('m-out').value = FMT.buildFileText(resultChapters, { bilingual: o.bilingual });
    $('m-stat').textContent = `${resultChapters.length} chương · đã bỏ ${dropped} dòng SFX`;
    $('m-status').textContent = stopFlag ? 'Đã dừng.' : 'Hoàn tất ✔';
    running = false; $('m-run').disabled = false; $('m-stop').disabled = true;
  }

  // ---------- xuat ----------
  async function exportZip() {
    if (!resultChapters.length) return alert('Chưa có kết quả.');
    const zip = new JSZip();
    resultChapters.forEach(c => zip.file(FMT.safeName(c.name) + '.txt',
      FMT.buildChapterText(c.name, c.pages, { bilingual: $('m-bi').checked })));
    FMT.downloadBlob(await zip.generateAsync({ type: 'blob' }),
      FMT.safeName(VB.data.context.title || 'visionbox-merged') + '.zip');
  }

  // ---------- bind ----------
  function init() {
    $('m-keyinfo').textContent = VB.getKeys().length ? `${VB.getKeys().length} API key sẵn sàng` : '⚠ Chưa có API key';
    $('m-back').addEventListener('click', () => { location.href = 'index.html'; });

    ['a', 'b'].forEach(k => {
      $('m-file-' + k).addEventListener('change', async e => {
        const f = e.target.files && e.target.files[0];
        if (!f) return;
        try { $('m-' + k).value = await FMT.readAnyFile(f); refreshInfo(); }
        catch (err) { alert('Không đọc được file: ' + err.message); }
        e.target.value = '';
      });
      $('m-slot-' + k).addEventListener('click', () => {
        const v = FMT.getSlot(k);
        if (!v) return alert('Chưa có dữ liệu gửi từ trang chính. Bấm “→ Gộp (' + k.toUpperCase() + ')” bên đó trước.');
        $('m-' + k).value = v; refreshInfo();
      });
      $('m-clear-' + k).addEventListener('click', () => { $('m-' + k).value = ''; refreshInfo(); });
      $('m-' + k).addEventListener('input', refreshInfo);
    });

    $('m-run').addEventListener('click', run);
    $('m-stop').addEventListener('click', () => { stopFlag = true; $('m-status').textContent = 'Đang dừng…'; });
    $('m-copy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText($('m-out').value); $('m-stat').textContent = 'Đã copy ✓'; } catch (e) {}
    });
    $('m-txt').addEventListener('click', () => FMT.download($('m-out').value, FMT.safeName(VB.data.context.title || 'visionbox-merged'), 'txt'));
    $('m-docx').addEventListener('click', () => FMT.download($('m-out').value, FMT.safeName(VB.data.context.title || 'visionbox-merged'), 'docx'));
    $('m-zip').addEventListener('click', exportZip);
    refreshInfo();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
