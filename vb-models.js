/* =============================================================================
 * vb-models.js — TỰ ĐỘNG đồng bộ danh sách model Gemini cho TOÀN HỆ THỐNG
 * (index.html, studio.html, batch.html, merge.html). Không có nút bấm nào.
 *  - Lấy key ở mọi nơi tool đang lưu (Studio, ⚙ Nâng cao, ô API key trang chính)
 *  - Gọi models.list, lọc model sinh văn bản/nhìn ảnh, xếp MỚI NHẤT lên đầu
 *  - Cache 6 giờ, tự làm mới nền khi mở trang / đổi key / mỗi 6 giờ
 *  - Đổ vào #model-select (giữ "Other model...") và mọi select[data-model]
 *  PHẢI nạp TRƯỚC renderer.js và vb-shared.js.
 * ========================================================================== */
(function () {
  'use strict';
  if (window.VBModels) return;
  const API = 'https://generativelanguage.googleapis.com/v1beta';
  const LS = 'vb_models_sync_v2';
  const TTL = 6 * 3600 * 1000;
  const FALLBACK = ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3-flash-preview', 'gemini-3.5-flash-lite',
    'gemini-3.1-flash-lite', 'gemini-3.1-pro-preview', 'gemini-2.5-flash', 'gemini-2.5-flash-lite',
    'gemini-2.5-pro', 'gemini-flash-latest'];
  const EXCLUDE = /(tts|embedding|image|imagen|banana|live|veo|lyria|transcribe|translate|audio|robotics|computer-use|deep-research|antigravity|omni|aqa|guard|gemma|learnlm)/i;

  function readCache() {
    try { const c = JSON.parse(localStorage.getItem(LS) || 'null'); if (c && Array.isArray(c.list) && c.list.length) return c; } catch (_) {}
    return {};
  }
  const fresh = () => { const c = readCache(); return !!c.at && Date.now() - c.at < TTL; };
  let LIST = readCache().list || FALLBACK.map(id => ({ id, label: '' }));
  let syncing = null;

  function info(id) {
    const m = /^gemini-(\d+(?:\.\d+)?)/i.exec(id);
    return {
      ver: m ? parseFloat(m[1]) : 0,
      tier: /flash-lite/i.test(id) ? 1 : /flash/i.test(id) ? 0 : /pro/i.test(id) ? 2 : 3,
      pre: /preview|exp/i.test(id) ? 1 : 0,
      alias: /latest/i.test(id) ? 1 : 0
    };
  }
  function sortList(arr) {
    return arr.sort((a, b) => {
      const x = info(a.id), y = info(b.id);
      return x.alias - y.alias || x.tier - y.tier || y.ver - x.ver || x.pre - y.pre || a.id.localeCompare(b.id);
    });
  }
  function normalize(raw) {
    const seen = new Set(), out = [];
    raw.forEach(m => {
      const id = String(m.id || '').trim();
      if (!/^gemini-/i.test(id) || EXCLUDE.test(id) || seen.has(id)) return;
      const v = info(id).ver; if (v && v < 2.5) return;
      seen.add(id); out.push({ id, label: m.label || '' });
    });
    // Ẩn bản preview nếu đã có bản stable cùng tên gốc
    const stable = new Set(out.filter(m => !/preview|exp/i.test(m.id)).map(m => m.id));
    return sortList(out.filter(m => !/preview|exp/i.test(m.id) || !stable.has(m.id.replace(/-(preview|exp).*$/i, ''))));
  }

  function keys() {
    const out = [];
    const add = k => { k = String(k || '').trim(); if (k.length >= 15 && !/\s/.test(k) && !out.includes(k)) out.push(k); };
    try { (JSON.parse(localStorage.getItem('vbs_api_keys_v1') || '[]') || []).forEach(add); } catch (_) {}
    try { ((JSON.parse(localStorage.getItem('visionbox_ext_v1') || '{}') || {}).apiKeys || []).forEach(add); } catch (_) {}
    try { add((JSON.parse(localStorage.getItem('visionbox_config_cache_v1') || '{}') || {}).apiKey); } catch (_) {}
    const el = document.getElementById('api-key-input'); if (el) add(el.value);
    return out;
  }

  async function fetchList(key) {
    const out = []; let token = '';
    for (let p = 0; p < 5; p++) {
      const res = await fetch(`${API}/models?pageSize=1000${token ? '&pageToken=' + encodeURIComponent(token) : ''}`,
        { headers: { 'x-goog-api-key': key }, __vbManaged: true });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const d = await res.json();
      (d.models || []).forEach(m => {
        const meth = m.supportedGenerationMethods || [];
        if (meth.length && !meth.includes('generateContent')) return;
        out.push({ id: String(m.name || '').replace(/^models\//, ''), label: m.displayName || '' });
      });
      token = d.nextPageToken || ''; if (!token) break;
    }
    return out;
  }

  function sync(force) {
    if (!force && fresh()) return Promise.resolve(LIST);
    if (syncing) return syncing;
    const ks = keys();
    if (!ks.length) return Promise.resolve(LIST);
    syncing = (async () => {
      for (const k of ks.slice(0, 3)) {
        try {
          const l = normalize(await fetchList(k));
          if (!l.length) continue;
          LIST = l;
          try { localStorage.setItem(LS, JSON.stringify({ at: Date.now(), list: LIST })); } catch (_) {}
          fillAll();
          window.dispatchEvent(new CustomEvent('vb:models', { detail: LIST }));
          return LIST;
        } catch (e) { console.warn('[vb-models] không dò được bằng 1 key:', e.message); }
      }
      return LIST;
    })().finally(() => { syncing = null; });
    return syncing;
  }

  function fillSelect(sel) {
    const main = sel.id === 'model-select';
    const sig = LIST.map(m => m.id).join('|');
    if (sel.dataset.vbmSig === sig) return;
    sel.dataset.vbmSig = sig;
    const custom = main ? sel.querySelector('option[value="__custom__"]') : null;
    const customInput = main ? document.getElementById('model-custom-input') : null;
    const cur = sel.value;
    let remembered = '';
    try { remembered = !main && sel.id ? (localStorage.getItem('vbs_model_' + sel.id) || '') : ''; } catch (_) {}

    sel.innerHTML = '';
    LIST.forEach(m => {
      const o = document.createElement('option');
      o.value = m.id;
      o.textContent = m.label && m.label !== m.id ? `${m.id} — ${m.label}` : m.id;
      sel.appendChild(o);
    });
    if (custom) sel.appendChild(custom);

    const has = v => !!v && LIST.some(m => m.id === v);
    let want = cur === '__custom__' && customInput ? customInput.value.trim() : cur;
    if (!has(want) && has(remembered)) want = remembered;
    if (has(want)) {
      sel.value = want;
      if (cur === '__custom__' && customInput) { customInput.style.display = 'none'; sel.dispatchEvent(new Event('change', { bubbles: true })); }
    } else if (cur === '__custom__' && custom) {
      sel.value = '__custom__';
    } else {
      sel.value = LIST[0].id;                     // model cũ đã bị gỡ -> tự chuyển sang model mới nhất
      if (cur && cur !== sel.value) sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (!main && !sel._vbm) {
      sel._vbm = 1;
      sel.addEventListener('change', () => { try { localStorage.setItem('vbs_model_' + sel.id, sel.value); } catch (_) {} });
    }
  }
  function fillAll() { document.querySelectorAll('#model-select, select[data-model]').forEach(fillSelect); }

  function boot() {
    fillAll();
    setTimeout(() => sync(false), 1200);
    setInterval(() => sync(false), TTL);
    window.addEventListener('vbs:keys', () => sync(true));
    window.addEventListener('storage', e => { if (/api_keys|visionbox_ext|config_cache/.test(e.key || '')) sync(!readCache().at); });
    const k = document.getElementById('api-key-input');
    if (k) k.addEventListener('change', () => { if (!readCache().at) sync(true); });
  }

  window.VBModels = { list: () => LIST.slice(), ids: () => LIST.map(m => m.id), sync, fillAll, fallback: FALLBACK };
  fillAll(); // đổ ngay từ cache, trước khi renderer.js đọc cấu hình
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
