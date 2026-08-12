(() => {
  (function setupWebFallbackAPIs() {
    const WEB_CONFIG_KEY = 'visionbox_config_cache_v1';

    if (!window.appConfig || typeof window.appConfig.get !== 'function') {
      window.appConfig = {
        async get() {
          try {
            const raw = localStorage.getItem(WEB_CONFIG_KEY);
            return raw ? JSON.parse(raw) : {};
          } catch (err) {
            console.warn('[web-fallback] appConfig.get loi, tra ve config rong:', err);
            return {};
          }
        },
        async set(cfg) {
          try {
            localStorage.setItem(WEB_CONFIG_KEY, JSON.stringify(cfg));
            return true;
          } catch (err) {
            // Thuong gap nhat: vuot quota localStorage (~5-10MB) do cache
            // qua nhieu anh/lich su. Khong lam vo app, chi bao loi ra console.
            console.warn('[web-fallback] appConfig.set loi (co the do vuot dung luong luu tru cua trinh duyet):', err);
            return false;
          }
        }
      };
    }

    if (!window.fileExport || typeof window.fileExport.save !== 'function') {
      // Tao file .docx (OOXML) THAT tren web bang JSZip (thu vien JS thuan,
      // chay duoc trong trinh duyet, khong can Node/require). Chi dung khi
      // KHONG co window.fileExport that (tuc la ban Electron/exe da co san
      // API rieng qua preload.js va se KHONG bao gio vao nhanh nay) - nen
      // sua o day khong anh huong gi den ban build exe.
      //
      // Yeu cau: file jszip.min.js phai duoc nap TRUOC renderer.js trong
      // index.html, vi du:
      //   <script src="jszip.min.js"></script>
      //   <script src="renderer.js"></script>
      const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

      function escapeXml(str) {
        return String(str)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&apos;');
      }

      function buildDocumentXml(content) {
        const lines = String(content).split(/\r\n|\r|\n/);
        const paragraphs = lines.map(line => {
          if (line.trim() === '') return '<w:p/>';
          return `<w:p><w:r><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r></w:p>`;
        }).join('');
        return XML_HEADER +
          '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
          '<w:body>' + paragraphs +
          '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417"/></w:sectPr>' +
          '</w:body></w:document>';
      }

      async function buildDocxBlob(content) {
        if (typeof JSZip === 'undefined') {
          throw new Error('Thieu thu vien JSZip (nho nap jszip.min.js truoc renderer.js trong index.html)');
        }
        const zip = new JSZip();
        zip.file('[Content_Types].xml', XML_HEADER +
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
          '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
          '</Types>');
        zip.folder('_rels').file('.rels', XML_HEADER +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
          '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
          '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
          '</Relationships>');
        zip.folder('docProps').file('core.xml', XML_HEADER +
          '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
          'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
          `<dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created>` +
          '</cp:coreProperties>');
        zip.folder('docProps').file('app.xml', XML_HEADER +
          '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>VisionBox Web Export</Application></Properties>');
        zip.folder('word').file('document.xml', buildDocumentXml(content));
        return zip.generateAsync({
          type: 'blob',
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        });
      }

      window.fileExport = {
        async save(content, format, suggestedName) {
          try {
            if (format === 'docx') {
              const blob = await buildDocxBlob(content);
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `${suggestedName}.docx`;
              document.body.appendChild(a);
              a.click();
              a.remove();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
              return true;
            }
            const ext = format || 'txt';
            const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${suggestedName}.${ext}`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            return true;
          } catch (err) {
            console.warn('[web-fallback] fileExport.save loi:', err);
            return false;
          }
        }
      };
    }

    if (!window.openExternal || typeof window.openExternal.open !== 'function') {
      window.openExternal = {
        async open(url) {
          window.open(url, '_blank', 'noopener,noreferrer');
          return true;
        }
      };
    }
  })();

  // ---------- unified SVG icon set (dung chung cho markup tao dong bang JS) ----------
  const ICON_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  const ICON_REFRESH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>';
  const ICON_RESIZE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg>';

  // ---------- DOM refs ----------
  const imageInput = document.getElementById('image-input');
  const placeholder = document.getElementById('placeholder');
  const mangaResults = document.getElementById('manga-results');
  const ocrBatchBtn = document.getElementById('ocr-batch-btn');
  const translateBatchBtn = document.getElementById('translate-batch-btn');
  const clearAllBtn = document.getElementById('clear-all-btn');
  const combinedBatchBtn = document.getElementById('combined-batch-btn');
  // Nut nav-fab-toggle (hinh tron o goc) se "bien hinh" thanh vien dai de
  // hien thanh tien trinh khi dang OCR/dich hang loat - xem showBatchProgressUI().
  const navFabToggleBtn = document.getElementById('nav-fab-toggle');
  const batchCurrent = document.getElementById('batch-current');
  const batchTotal = document.getElementById('batch-total');
  const batchProgressFill = document.getElementById('batch-progress-fill');
  const batchStopBtn = document.getElementById('batch-stop-btn');
  const summarySection = document.getElementById('summary-section');
  const summaryOcrAll = document.getElementById('summary-ocr-all');
  const summaryTranslationAll = document.getElementById('summary-translation-all');
  const sourceLangSelect = document.getElementById('source-lang-select');
  const targetLangSelect = document.getElementById('target-lang-select');
  const skipSfxToggle = document.getElementById('skip-sfx-toggle');
  const styleGuideToggle = document.getElementById('style-guide-toggle');
  const themeSelect = document.getElementById('theme-select');
  const contentTypeBtn = document.getElementById('content-type-btn');
  const contentTypeBtnLabel = document.getElementById('content-type-btn-label');
  const contentTypeMenu = document.getElementById('content-type-menu');
  const modelSelect = document.getElementById('model-select');
  const modelCustomInput = document.getElementById('model-custom-input');
  const apiKeyInput = document.getElementById('api-key-input');
  const toggleKeyBtn = document.getElementById('toggle-key-btn');
  const getKeyBtn = document.getElementById('get-key-btn');
  // Thong bao (toast) gio hien ngay trong pill nav-fab-toggle thay vi goc man hinh
  const navFabToastDot = document.getElementById('nav-fab-toast-dot');
  const navFabToastText = document.getElementById('nav-fab-toast-text');
  // Hop thoai xac nhan (Yes/No) va hop nhap huong dan Refine Translation gio
  // cung "muon" pill nav-fab-toggle thay vi mo modal rieng giua man hinh -
  // xem showConfirmDialog()/showRefineTranslatePromptDialog() ben duoi.
  const navFabScrim = document.getElementById('nav-fab-scrim');
  const navFabConfirmText = document.getElementById('nav-fab-confirm-text');
  const navFabConfirmYesBtn = document.getElementById('nav-fab-confirm-yes');
  const navFabConfirmNoBtn = document.getElementById('nav-fab-confirm-no');
  const navFabPromptInput = document.getElementById('nav-fab-prompt-input');
  const navFabPromptRunBtn = document.getElementById('nav-fab-prompt-run');
  const navFabPromptCancelBtn = document.getElementById('nav-fab-prompt-cancel');

  // ---------- selection (chon anh cu the) ----------
  const selectionBar = document.getElementById('selection-bar');
  const selectionCountEl = document.getElementById('selection-count');
  const selectionOcrBtn = document.getElementById('selection-ocr-btn');
  const selectionRefineBtn = document.getElementById('selection-refine-btn');
  const selectionRefineMenu = selectionRefineBtn?.closest('.refine-dropdown')?.querySelector('.refine-menu');
  const selectionRefineOcrBtn = document.getElementById('selection-refine-ocr-btn');
  const selectionRefineTranslateBtn = document.getElementById('selection-refine-translate-btn');
  const selectionTranslateBtn = document.getElementById('selection-translate-btn');
  const selectionCancelBtn = document.getElementById('selection-cancel-btn');
  const navFabSelectionHead = document.getElementById('nav-fab-selection-head');
  const navFabSelectionCount = document.getElementById('nav-fab-selection-count');
  const navFabSelectionAll = document.getElementById('nav-fab-selection-all');
  const navFabSelectionClear = document.getElementById('nav-fab-selection-clear');

  // ---------- info modal (usage / logs) ----------
  const infoModal = document.getElementById('info-modal');
  const infoModalTitle = document.getElementById('info-modal-title');
  const infoModalBody = document.getElementById('info-modal-body');
  const infoModalClose = document.getElementById('info-modal-close');
  const usageBtn = document.getElementById('usage-btn');
  const viewLogsBtn = document.getElementById('view-logs-btn');
  const aboutBtn = document.getElementById('about-btn');

  // ---------- replace bar (tim/thay the OCR + ban dich cua tung anh) ----------
  // TODO: hien tai moi co giao dien dong/mo. Logic tim kiem, dieu huong
  // match, va replace se duoc noi day sau khi giao dien duoc chot.
  const replaceBtn = document.getElementById('replace-btn');
  const replaceBar = document.getElementById('replace-bar');
  const replaceCloseBtn = document.getElementById('replace-close-btn');
  const replaceFindInput = document.getElementById('replace-find-input');
  const replaceWithInput = document.getElementById('replace-with-input');
  const replaceMatchCount = document.getElementById('replace-match-count');
  const replacePrevBtn = document.getElementById('replace-prev-btn');
  const replaceNextBtn = document.getElementById('replace-next-btn');
  const replaceScopeOcr = document.getElementById('replace-scope-ocr');
  const replaceScopeTranslation = document.getElementById('replace-scope-translation');
  const replaceWholeWord = document.getElementById('replace-whole-word');
  const replaceCaseSensitive = document.getElementById('replace-case-sensitive');
  const replaceOneBtn = document.getElementById('replace-one-btn');
  const replaceAllBtn = document.getElementById('replace-all-btn');

let currentLang = 'en';

function t(key, params) {
  let str = STRINGS[currentLang]?.[key] || STRINGS.en[key] || key;
  if (params) {
    Object.keys(params).forEach(k => {
      str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), params[k]);
    });
  }
  return str;
}
function applyLanguage(lang) {
  currentLang = lang;
  // Cập nhật các phần tử có data-i18n
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    if (el.hasAttribute('data-i18n-placeholder')) {
      el.placeholder = t(key);
    } else if (el.hasAttribute('data-i18n-title')) {
      el.title = t(key);
    } else if (el.hasAttribute('data-i18n-value')) {
      el.value = t(key);
    } else {
      el.textContent = t(key);
    }
  });

  // Cập nhật các phần tử không có data-i18n (cần gán trực tiếp)
  // Ví dụ: batch buttons, selection bar, summary, ...
  document.getElementById('ocr-batch-btn').textContent = t('ocr_all');
  document.getElementById('translate-batch-btn').textContent = t('translate_all');
  document.getElementById('combined-batch-btn').textContent = t('ocr_translate_all');
  document.getElementById('clear-all-btn').textContent = t('clear_all');
  document.querySelector('.brand-sub').textContent = t('brand_sub');
  // ... thêm các phần tử khác tương tự

  // Cập nhật các label
  document.querySelector('label[for="source-lang-select"]').textContent = t('source_lang_label');
  document.querySelector('label[for="target-lang-select"]').textContent = t('target_lang_label');
  document.querySelector('label[for="skip-sfx-toggle"] .toggle-label').textContent = t('skip_sfx_label');
  const styleGuideLabelEl = document.querySelector('label[for="style-guide-toggle"] .toggle-label');
    if (styleGuideLabelEl) styleGuideLabelEl.textContent = t('style_guide_label');

  // ... v.v.

  // Cập nhật lại option "Ngôn ngữ nguồn" (select này bị JS ghi đè innerHTML
  // trong applyContentType() nên data-i18n không tự quét tới được)
  applyContentType(currentContentType, sourceLangSelect.value);

  // Cập nhật selection bar
  updateSelectionUI(); // Hàm này sẽ được sửa để dùng t() bên trong

  // Lưu config
  scheduleSaveConfig();
}
  const MAX_IMAGES = 100;
  const API_DELAY_MS = 2500;

// Chặn toàn bộ phím tắt trình duyệt, chỉ cho phép các phím tắt ứng dụng
document.addEventListener('keydown', (e) => {
  const ctrl = e.ctrlKey || e.metaKey;
  const shift = e.shiftKey;
  const key = e.key.toLowerCase();

  // Danh sách phím tắt ứng dụng ĐƯỢC PHÉP
const allowedAppShortcuts = [
  { ctrl: true, shift: false, key: 'o' },     // Ctrl+O: mở file picker
  { ctrl: true, shift: true, key: 'o' },      // Ctrl+Shift+O: OCR all
  { ctrl: true, shift: true, key: 't' },      // Ctrl+Shift+T: Translate all
  { ctrl: true, shift: true, key: 'r' },      // Ctrl+Shift+R: Refine Translation all
  { ctrl: true, shift: true, key: 'a' },      // Ctrl+Shift+A: Select all
  { ctrl: true, shift: true, key: 'd' },      // Ctrl+Shift+D: Deselect all
  { ctrl: true, shift: true, key: 'c' },      // Ctrl+Shift+C: Clear all
  { ctrl: true, shift: false, key: 'h' },     // Ctrl+H: Replace bar
  { ctrl: true, shift: false, key: 's' },     // Ctrl+S: Save edit mode
  { ctrl: true, shift: false, key: 'z' },     // Ctrl+Z: Undo replace
  { ctrl: true, shift: false, key: 'c' },     // Ctrl+C: Copy (mo khoa, dung binh thuong o moi noi)
  { ctrl: true, shift: false, key: 'v' }      // Ctrl+V: Paste (mo khoa, dung binh thuong o moi noi)
];  


const targetId = e.target && e.target.id;
const isInEditableEditBox = e.target && e.target.isContentEditable &&
  typeof targetId === 'string' &&
  (targetId.startsWith('ocr-') || targetId.startsWith('translation-') ||
   targetId === 'summary-ocr-all' || targetId === 'summary-translation-all');
const isCtrlAAllowedHere = ctrl && !shift && key === 'a' &&
  (targetId === 'nav-fab-prompt-input' || targetId === 'api-key-input' || isInEditableEditBox);

// Chỉ cho phép nếu là phím tắt của ứng dụng, hoặc các phím thông thường...
const isAppShortcut = allowedAppShortcuts.some(s => 
  s.ctrl === ctrl && s.shift === shift && s.key === key
);

  if (ctrl || e.metaKey || e.altKey) {
    if (!isAppShortcut && !isCtrlAAllowedHere) {
      e.preventDefault();
      e.stopPropagation();
    }
  }
}, true);


 // capture phase để chặn trước các listener khác

  let uploadedImages = [];
  let isProcessing = false;
  let stopRequested = false;
  let uidCounter = 0;
  const selectedUids = new Set();
  const editingState = { 'summary-ocr-all': false, 'summary-translation-all': false };

  // ---------- usage tracking + error logs ----------
  let usageStats = { totalCalls: 0, successCalls: 0, failedCalls: 0 };
  let errorLogs = [];
  const MAX_ERROR_LOGS = 200;

  function logError(message) {
    errorLogs.unshift({ time: new Date().toISOString(), message: String(message) });
    if (errorLogs.length > MAX_ERROR_LOGS) errorLogs.length = MAX_ERROR_LOGS;
    scheduleSaveConfig();
  }

  // ---------- synced image preview size ----------
  const PREVIEW_MIN = 160;
  const PREVIEW_MAX = 520;
  const PREVIEW_DEFAULT = 240;
  let currentPreviewWidth = PREVIEW_DEFAULT;

  function setPreviewWidth(px) {
    currentPreviewWidth = Math.min(PREVIEW_MAX, Math.max(PREVIEW_MIN, px));
    document.documentElement.style.setProperty('--img-preview-width', currentPreviewWidth + 'px');
    document.querySelectorAll('.image-size-slider').forEach(s => { s.value = currentPreviewWidth; });
    // Doi chieu rong anh cung lam doi chieu rong cot OCR/dich (vi cot chu
    // chiem phan con lai), co the lam chu wrap thanh nhieu/it dong hon ->
    // can dong bo lai chieu cao vung anh cho tat ca the.
    syncAllImageSectionHeights();
  }

  // Chieu cao MAC DINH cua vung anh khi noi dung OCR/dich con ngan (giong
  // muc mac dinh truoc day). Neu cot chu cao hon muc nay (nhieu dong), vung
  // anh se PHINH THEO cho khop, khong bi "lun" thap hon cot chu nua. Van
  // giu 1 tran an toan de anh webtoon cuc dai khong keo ca the phinh vo han.
  const IMG_SECTION_BASE_HEIGHT = 420;
  const IMG_SECTION_CEILING = 900;

  function syncImageSectionHeight(item) {
    if (!item) return;
    const imageSection = item.querySelector('.manga-image-section');
    const textSection = item.querySelector('.manga-text-section');
    if (!imageSection || !textSection) return;
    // QUAN TRONG: phai RESET vung anh ve baseline TRUOC khi do chieu cao
    // cot chu, roi moi do. Neu khong, scrollHeight cua textSection se bi
    // "khoa" theo chieu cao da bi keo gian (stretch) tu lan truoc (vi khi
    // anh cao hon, flex stretch keo ca cot chu cao theo dung bang do, va
    // scrollHeight luc nay tra ve dung chieu cao DA BI KEO GIAN chu khong
    // phai chieu cao noi dung THAT SU) - khien vung anh khong bao gio tu
    // co lai duoc sau khi xoa bot chu. Reset ve baseline truoc se loai bo
    // anh huong keo gian nay, cho phep do dung chieu cao noi dung that.
    imageSection.style.maxHeight = `${IMG_SECTION_BASE_HEIGHT}px`;
    const textHeight = textSection.scrollHeight;
    const target = Math.min(IMG_SECTION_CEILING, Math.max(IMG_SECTION_BASE_HEIGHT, textHeight));
    imageSection.style.maxHeight = `${target}px`;
  }

  function syncAllImageSectionHeights() {
    mangaResults.querySelectorAll('.manga-item').forEach(syncImageSectionHeight);
  }

  function syncImageSectionHeightByIndex(index) {
    syncImageSectionHeight(mangaResults.querySelector(`[data-index="${index}"]`));
  }

  window.addEventListener('resize', () => {
    clearTimeout(syncAllImageSectionHeights._t);
    syncAllImageSectionHeights._t = setTimeout(syncAllImageSectionHeights, 150);
  });

  // LANG_NAMES: dung de dua vao PROMPT gui cho AI (luon giu tieng Anh, khong
  // doi theo ngon ngu giao dien) - KHONG dung de hien thi len UI.
  const LANG_NAMES = { ko: 'Korean', en: 'English', vi: 'Vietnamese', zh: 'Chinese', ja: 'Japanese', 'manga-en': 'English' };
  // LANG_DISPLAY_KEYS + langDisplayName(): dung de HIEN THI len UI (dropdown,
  // hop thoai xac nhan...), tu dong doi theo ngon ngu giao dien hien tai.
  const LANG_DISPLAY_KEYS = { ko: 'lang_ko', en: 'lang_en', vi: 'lang_vi', zh: 'lang_zh', ja: 'lang_ja', 'manga-en': 'lang_manga_en' };
  function langDisplayName(code) {
    const key = LANG_DISPLAY_KEYS[code];
    return key ? t(key) : code;
  }

  // ---------- config + project persistence ----------
  // Luu chung 1 file json (qua window.appConfig): moi lan set() se GHI DE
  // toan bo noi dung file bang du lieu moi nhat - khong giu lich su, khong
  // co ban cu. Vi vay payload luon duoc build lai DAY DU (settings + project)
  // moi khi goi scheduleSaveConfig(), du chi 1 truong thay doi.
  function buildProjectPayload() {
    return {
      images: uploadedImages.map(img => ({
        name: img.file?.name || 'image',
        size: img.file?.size || 0,
        ocrResult: img.ocrResult || '',
        translationResult: img.translationResult || '',
        // Luu ca lich su version (Vers) de khoi phuc lai duoc khi mo lai anh nay
        ocrHistory: Array.isArray(img.ocrHistory) ? img.ocrHistory : [],
        translationHistory: Array.isArray(img.translationHistory) ? img.translationHistory : []
      }))
    };
  }

  function buildConfigPayload() {
    return {
      apiKey: apiKeyInput.value.trim(),
      model: getSelectedModel(),
      contentType: currentContentType,
      sourceLang: sourceLangSelect.value,
      targetLang: targetLangSelect.value,
      skipSfx: skipSfxToggle.checked,
      styleGuide: styleGuideToggle.checked,      
      theme: themeSelect.value,
      contentFontSize: contentFontSize,
      project: buildProjectPayload(),
      usageStats: usageStats,
      errorLogs: errorLogs,
      language: currentLang,
    };
  }

  // Khong con luu base64 anh (qua nang), nen khi mo lai app KHONG the tu ve
  // lai thumbnail. Thay vao do, ket qua OCR/dich cua lan truoc duoc giu tam
  // trong pendingRestoreMap (khoa = "ten file|dung luong"), va se duoc tu
  // dong ap lai NEU nguoi dung keo/tha dung anh cu vao (xem handleNewFiles).
  let pendingRestoreMap = new Map();

  async function loadConfig() {
    const cfg = (await window.appConfig.get()) || {};
    if (cfg.apiKey) apiKeyInput.value = cfg.apiKey;
    if (cfg.model) {
      const knownValues = Array.from(modelSelect.options).map(o => o.value);
      if (knownValues.includes(cfg.model)) {
        modelSelect.value = cfg.model;
      } else {
        modelSelect.value = '__custom__';
        modelCustomInput.style.display = 'block';
        modelCustomInput.value = cfg.model;
      }
    }
    // Xac dinh Content type: uu tien gia tri da luu, neu chua co (config cu)
    // thi suy ra tu sourceLang da luu, mac dinh la webtoon.
    let contentType = 'webtoon';
    if (cfg.contentType === 'webtoon' || cfg.contentType === 'manga') {
      contentType = cfg.contentType;
    } else if (cfg.sourceLang === 'ja' || cfg.sourceLang === 'manga-en') {
      contentType = 'manga';
    }
    setContentTypeUI(contentType);
    applyContentType(contentType, cfg.sourceLang);

    if (cfg.targetLang) targetLangSelect.value = cfg.targetLang;
    if (typeof cfg.skipSfx === 'boolean') skipSfxToggle.checked = cfg.skipSfx;
    if (typeof cfg.styleGuide === 'boolean') styleGuideToggle.checked = cfg.styleGuide;
    if (cfg.theme === 'dark' || cfg.theme === 'light') {
      themeSelect.value = cfg.theme;
    } else if (typeof cfg.darkMode === 'boolean') {
      // Tuong thich nguoc voi config cu (truoc day luu dang cong tac boolean darkMode)
      themeSelect.value = cfg.darkMode ? 'dark' : 'light';
    }
    applyTheme(themeSelect.value === 'dark');

    if (typeof cfg.contentFontSize === 'number' && !Number.isNaN(cfg.contentFontSize)) {
      applyFontSize(cfg.contentFontSize);
    }
{
  const langToApply = cfg.language || 'en';
  const langSelectEl = document.getElementById('lang-select');
  if (langSelectEl) langSelectEl.value = langToApply;
  applyLanguage(langToApply);
}
    if (cfg.usageStats && typeof cfg.usageStats === 'object') {
      usageStats = {
        totalCalls: Number(cfg.usageStats.totalCalls) || 0,
        successCalls: Number(cfg.usageStats.successCalls) || 0,
        failedCalls: Number(cfg.usageStats.failedCalls) || 0
      };
    }
    if (Array.isArray(cfg.errorLogs)) {
      errorLogs = cfg.errorLogs.filter(e => e && e.message).slice(0, MAX_ERROR_LOGS);
    }

    const savedImages = cfg.project?.images;
    if (Array.isArray(savedImages) && savedImages.length > 0) {
      pendingRestoreMap = new Map();
      savedImages.forEach((img) => {
        if (!img.ocrResult && !img.translationResult) return;
        pendingRestoreMap.set(`${img.name}|${img.size}`, {
          ocrResult: img.ocrResult || '',
          translationResult: img.translationResult || '',
          ocrHistory: Array.isArray(img.ocrHistory) ? img.ocrHistory : [],
          translationHistory: Array.isArray(img.translationHistory) ? img.translationHistory : []
        });
      });
      if (pendingRestoreMap.size > 0) {
        showToast(t('cache_ready', { count: pendingRestoreMap.size }), 'info', 5000);
      }
    }
  }

  let saveTimeout;
  function scheduleSaveConfig() {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
      window.appConfig.set(buildConfigPayload());
    }, 600);
  }

  // ---------- auto-save dinh ky moi 5 phut (co thong bao) ----------
  // Doc lap voi scheduleSaveConfig() o tren (van chay am tham nhu cu moi khi
  // co thay doi). Cai nay chi la "nhip lam" dinh ky de dam bao khong bo lo
  // thay doi nao, dong thoi cho nguoi dung thay ro la dang/duoc luu.
  const AUTO_SAVE_INTERVAL_MS = 5 * 60 * 1000; // 5 phut

  async function performAutoSave() {
    if (uploadedImages.length === 0) return; // khong co gi de luu thi khoi lam phien
    const toastEl = showToast(t('saving'), 'info', 60000);
    try {
      await window.appConfig.set(buildConfigPayload());
      updateToast(toastEl, t('saved'), 'success', 2500);
    } catch (err) {
      updateToast(toastEl, t('save_failed'), 'error', 4000);
    }
  }

  setInterval(performAutoSave, AUTO_SAVE_INTERVAL_MS);

  [apiKeyInput, sourceLangSelect, targetLangSelect, skipSfxToggle, styleGuideToggle].forEach(el => {
    el.addEventListener('change', scheduleSaveConfig);
    el.addEventListener('input', scheduleSaveConfig);
    styleGuideToggle.addEventListener('change', () => {
      showToast(styleGuideToggle.checked ? t('style_guide_on') : t('style_guide_off'), 'info', 2200);
  });

  });

  modelSelect.addEventListener('change', () => {
    modelCustomInput.style.display = modelSelect.value === '__custom__' ? 'block' : 'none';
    scheduleSaveConfig();
  });
  modelCustomInput.addEventListener('input', scheduleSaveConfig);

  function getSelectedModel() {
    if (modelSelect.value === '__custom__') {
      return modelCustomInput.value.trim() || 'gemini-3.1-flash-lite';
    }
    return modelSelect.value;
  }

  toggleKeyBtn.addEventListener('click', () => {
    apiKeyInput.type = apiKeyInput.type === 'password' ? 'text' : 'password';
  });

  // ---------- dark mode / light mode ----------
  // checked = dark mode (mac dinh, giao dien hien tai). Bo check = light mode.
  function applyTheme(isDark) {
    document.body.classList.toggle('light-theme', !isDark);
  }
  themeSelect.addEventListener('change', () => {
    applyTheme(themeSelect.value === 'dark');
    scheduleSaveConfig();
  });

document.getElementById('lang-select').addEventListener('change', (e) => {
  currentLang = e.target.value;
  applyLanguage(currentLang); // Hàm này sẽ được viết ở bước 4
  scheduleSaveConfig();
});
  // ---------- font size cua OCR + Translation (tung anh) va phan tong hop ----------
  // Dung chung 1 gia tri (bien CSS --content-font-size) cho .line-text
  // (OCR/Translation cua tung anh) va .summary-body (All OCR/All
  // translations), dung nhu yeu cau "dung chung size voi nhau".
  const fontSizeDecreaseBtn = document.getElementById('font-size-decrease');
  const fontSizeIncreaseBtn = document.getElementById('font-size-increase');
  const fontSizeValueEl = document.getElementById('font-size-value');
  const FONT_SIZE_MIN = 11;
  const FONT_SIZE_MAX = 22;
  const FONT_SIZE_DEFAULT = 14;
  let contentFontSize = FONT_SIZE_DEFAULT;

  function applyFontSize(px) {
    contentFontSize = Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, px));
    document.documentElement.style.setProperty('--content-font-size', `${contentFontSize}px`);
    fontSizeValueEl.textContent = `${contentFontSize}px`;
    fontSizeDecreaseBtn.disabled = contentFontSize <= FONT_SIZE_MIN;
    fontSizeIncreaseBtn.disabled = contentFontSize >= FONT_SIZE_MAX;
  }
  fontSizeDecreaseBtn.addEventListener('click', () => { applyFontSize(contentFontSize - 1); scheduleSaveConfig(); });
  fontSizeIncreaseBtn.addEventListener('click', () => { applyFontSize(contentFontSize + 1); scheduleSaveConfig(); });
  applyFontSize(FONT_SIZE_DEFAULT);

  // ---------- content type (Webtoon / Manga) - loc options cua source language ----------
  const SOURCE_LANG_OPTIONS = {
    webtoon: [
      { value: 'ko', i18nKey: 'lang_ko' },
      { value: 'en', i18nKey: 'lang_en' },
      { value: 'zh', i18nKey: 'lang_zh' }
    ],
    manga: [
      { value: 'ja', i18nKey: 'lang_manga_ja' },
      { value: 'manga-en', i18nKey: 'lang_manga_en' }
    ]
  };

  function applyContentType(type, preferredValue) {
    const options = SOURCE_LANG_OPTIONS[type] || SOURCE_LANG_OPTIONS.webtoon;
    const currentValue = preferredValue ?? sourceLangSelect.value;
    sourceLangSelect.innerHTML = options.map(o => `<option value="${o.value}">${t(o.i18nKey)}</option>`).join('');
    const stillValid = options.some(o => o.value === currentValue);
    sourceLangSelect.value = stillValid ? currentValue : options[0].value;
  }

 
  let currentContentType = 'webtoon';
  function contentTypeLabel(type) {
    return type === 'manga' ? t('content_type_manga') : t('content_type_webtoon');
  }

  function setContentTypeUI(type) {
    currentContentType = type;
    contentTypeBtnLabel.textContent = contentTypeLabel(type);
    contentTypeMenu.querySelectorAll('.content-type-option').forEach(opt => {
      opt.classList.toggle('active', opt.dataset.value === type);
    });
  }

  contentTypeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    contentTypeMenu.classList.toggle('open');
  });
  contentTypeMenu.querySelectorAll('.content-type-option').forEach(opt => {
    opt.addEventListener('click', (e) => {
      e.stopPropagation();
      const type = opt.dataset.value;
      contentTypeMenu.classList.remove('open');
      if (type === currentContentType) return;
      setContentTypeUI(type);
      applyContentType(type);
      scheduleSaveConfig();
    });
  });
  document.addEventListener('click', (e) => {
    if (!contentTypeMenu.classList.contains('open')) return;
    if (e.target.closest('.content-type-dropdown')) return;
    contentTypeMenu.classList.remove('open');
  });

  // ---------- settings panel (dropdown) ----------
  // Hien tai chi co Dark mode, nhung de san cho cac cai dat khac them sau
  // nay - chi can nhet them vao #settings-panel trong index.html.
  const settingsBtn = document.getElementById('settings-btn');
  const settingsPanel = document.getElementById('settings-panel');
  settingsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    settingsPanel.classList.toggle('open');
  });
  document.addEventListener('click', (e) => {
    if (!settingsPanel.classList.contains('open')) return;
    if (e.target.closest('.settings-dropdown')) return;
    settingsPanel.classList.remove('open');
  });

  // ---------- replace bar: tim/thay the tren OCR + ban dich CUA TUNG ANH ----------
  // Khong dung toi phan tong hop All OCR / All translations (dung theo yeu
  // cau). Du lieu goc luon la uploadedImages[i].ocrResult/.translationResult
  // (chuoi nhieu dong, ngan cach boi \n) - match duoc tim theo TUNG DONG de
  // khop voi cach renderTextBlockEl() tach dong thanh cac .line-row.
  let replaceMatches = [];
  let replaceActiveIndex = -1;
  let replaceHighlightEl = null;
  // Ngan xep undo: moi phan tu la 1 lan bam Replace/Replace all, chua
  // danh sach { imageIndex, kind, previousText } de khoi phuc lai dung
  // gia tri TRUOC khi thay the. Ctrl+Z (khi thanh Replace dang mo) se pop
  // ra va ghi de nguoc lai.
  let replaceUndoStack = [];

  function pushReplaceUndo(changes) {
    if (changes.length === 0) return;
    replaceUndoStack.push(changes);
  }

  function undoLastReplace() {
    const changes = replaceUndoStack.pop();
    if (!changes) {
      showToast(t('nothing_to_undo'), 'info');
      return;
    }
    changes.forEach(({ imageIndex, kind, previousText }) => {
      const imgData = uploadedImages[imageIndex];
      if (!imgData) return;
      if (kind === 'ocr') imgData.ocrResult = previousText;
      else imgData.translationResult = previousText;
      setTextBlock(`${kind}-${imageIndex}`, previousText);
    });
    updateSummary();
    recomputeReplaceMatches(true);
    showToast(t('replace_undone'), 'success');
  }

  function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  // Ky tu duoc coi la "thuoc 1 tu" (chu cai/so/underscore, ho tro Unicode
  // nen ap dung duoc cho ca tieng Viet/Han/Han/Nhat...) - dung de kiem tra
  // ranh gioi tu khi bat "Whole word", tranh truong hop tim "I" lai khop
  // vao giua "WIN".
  function isWordChar(ch) {
    if (!ch) return false;
    return /[\p{L}\p{N}_]/u.test(ch);
  }

  // Tim tat ca vi tri khop trong 1 chuoi (theo tung dong), tra ve
  // {lineIndex, start, end} - dung chung cho ca dem so luong va lay danh
  // sach match de highlight/dieu huong.
  function findLineMatches(text, needle, caseSensitive, wholeWord) {
    const results = [];
    if (!needle) return results;
    const lines = text.split('\n');
    const cmpNeedle = caseSensitive ? needle : needle.toLowerCase();
    lines.forEach((line, lineIndex) => {
      const hay = caseSensitive ? line : line.toLowerCase();
      let from = 0;
      while (true) {
        const pos = hay.indexOf(cmpNeedle, from);
        if (pos === -1) break;
        if (wholeWord && (isWordChar(line[pos - 1]) || isWordChar(line[pos + needle.length]))) {
          from = pos + 1; // khop giua 1 tu dai hon -> bo qua, chi nhich 1 ky tu de khong lo match khac
          continue;
        }
        results.push({ lineIndex, start: pos, end: pos + needle.length });
        from = pos + needle.length;
      }
    });
    return results;
  }

  function computeReplaceMatches() {
    const needle = replaceFindInput.value;
    const matches = [];
    if (!needle) return matches;
    const caseSensitive = replaceCaseSensitive.checked;
    const wholeWord = replaceWholeWord.checked;
    const searchOcr = replaceScopeOcr.checked;
    const searchTranslation = replaceScopeTranslation.checked;
    uploadedImages.forEach((imgData, imageIndex) => {
      if (searchOcr && imgData.ocrResult) {
        findLineMatches(imgData.ocrResult, needle, caseSensitive, wholeWord).forEach(m => {
          matches.push({ imageIndex, kind: 'ocr', ...m });
        });
      }
      if (searchTranslation && imgData.translationResult) {
        findLineMatches(imgData.translationResult, needle, caseSensitive, wholeWord).forEach(m => {
          matches.push({ imageIndex, kind: 'translation', ...m });
        });
      }
    });
    return matches;
  }

  function clearReplaceHighlight() {
    if (replaceHighlightEl) {
      replaceHighlightEl.textContent = replaceHighlightEl.textContent;
      replaceHighlightEl = null;
    }
  }

  function highlightReplaceMatch(match) {
    clearReplaceHighlight();
    if (!match) return;
    const el = document.getElementById(`${match.kind}-${match.imageIndex}`);
    if (!el) return;
    const row = el.children[match.lineIndex];
    const lineText = row?.querySelector('.line-text');
    if (!lineText) return;
    const text = lineText.textContent;
    const before = text.slice(0, match.start);
    const matched = text.slice(match.start, match.end);
    const after = text.slice(match.end);
    lineText.innerHTML = '';
    if (before) lineText.appendChild(document.createTextNode(before));
    const mark = document.createElement('mark');
    mark.className = 'replace-highlight-active';
    mark.textContent = matched;
    lineText.appendChild(mark);
    if (after) lineText.appendChild(document.createTextNode(after));
    replaceHighlightEl = lineText;
    mark.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  function updateReplaceMatchCountUI() {
    replaceMatchCount.textContent = replaceMatches.length === 0
      ? '0/0'
      : `${replaceActiveIndex + 1}/${replaceMatches.length}`;
    const hasMatches = replaceMatches.length > 0;
    replacePrevBtn.disabled = !hasMatches;
    replaceNextBtn.disabled = !hasMatches;
    replaceOneBtn.disabled = !hasMatches;
    replaceAllBtn.disabled = !hasMatches;
  }

  function recomputeReplaceMatches(keepIndex) {
    replaceMatches = computeReplaceMatches();
    if (replaceMatches.length === 0) {
      replaceActiveIndex = -1;
      clearReplaceHighlight();
    } else {
      const base = keepIndex && replaceActiveIndex >= 0 ? replaceActiveIndex : 0;
      replaceActiveIndex = Math.min(base, replaceMatches.length - 1);
      highlightReplaceMatch(replaceMatches[replaceActiveIndex]);
    }
    updateReplaceMatchCountUI();
  }

  function goToReplaceMatch(step) {
    if (replaceMatches.length === 0) return;
    replaceActiveIndex = (replaceActiveIndex + step + replaceMatches.length) % replaceMatches.length;
    highlightReplaceMatch(replaceMatches[replaceActiveIndex]);
    updateReplaceMatchCountUI();
  }

  // Thay the CHI 1 match dang active - sua truc tiep tren du lieu goc
  // (ocrResult/translationResult) roi ve lai khoi text tuong ung.
  function doReplaceOneMatch() {
    if (replaceMatches.length === 0) return;
    const match = replaceMatches[replaceActiveIndex];
    const imgData = uploadedImages[match.imageIndex];
    const original = match.kind === 'ocr' ? imgData.ocrResult : imgData.translationResult;
    const lines = original.split('\n');
    const line = lines[match.lineIndex];
    lines[match.lineIndex] = line.slice(0, match.start) + replaceWithInput.value + line.slice(match.end);
    const updated = lines.join('\n');
    pushReplaceUndo([{ imageIndex: match.imageIndex, kind: match.kind, previousText: original }]);
    if (match.kind === 'ocr') imgData.ocrResult = updated;
    else imgData.translationResult = updated;
    setTextBlock(`${match.kind}-${match.imageIndex}`, updated);
    updateSummary();
    recomputeReplaceMatches(true);
  }

  // Thay the TAT CA match trong pham vi da chon (OCR/Translation) - thay
  // truc tiep tung anh mot, khong dung toi phan tong hop.
  function doReplaceAllMatches() {
    const needle = replaceFindInput.value;
    if (!needle || replaceMatches.length === 0) return;
    const replacement = replaceWithInput.value;
    const caseSensitive = replaceCaseSensitive.checked;
    const wholeWord = replaceWholeWord.checked;
    const searchOcr = replaceScopeOcr.checked;
    const searchTranslation = replaceScopeTranslation.checked;
    const escaped = escapeRegExp(needle);
    // Whole word: dung lookaround Unicode thay vi \b (\b chi hieu ky tu
    // ASCII) de ranh gioi tu hoat dong dung voi ca chu cai co dau/CJK.
    const pattern = wholeWord ? `(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])` : escaped;
    const regex = new RegExp(pattern, caseSensitive ? 'gu' : 'giu');
    let replacedCount = 0;
    const undoChanges = [];

    uploadedImages.forEach((imgData, imageIndex) => {
      if (searchOcr && imgData.ocrResult && regex.test(imgData.ocrResult)) {
        regex.lastIndex = 0;
        replacedCount += (imgData.ocrResult.match(regex) || []).length;
        undoChanges.push({ imageIndex, kind: 'ocr', previousText: imgData.ocrResult });
        imgData.ocrResult = imgData.ocrResult.replace(regex, replacement);
        setTextBlock(`ocr-${imageIndex}`, imgData.ocrResult);
      }
      if (searchTranslation && imgData.translationResult && regex.test(imgData.translationResult)) {
        regex.lastIndex = 0;
        replacedCount += (imgData.translationResult.match(regex) || []).length;
        undoChanges.push({ imageIndex, kind: 'translation', previousText: imgData.translationResult });
        imgData.translationResult = imgData.translationResult.replace(regex, replacement);
        setTextBlock(`translation-${imageIndex}`, imgData.translationResult);
      }
    });

    pushReplaceUndo(undoChanges);
    updateSummary();
    recomputeReplaceMatches(false);
    showToast(replacedCount > 0 ? t('replaced_count', { count: replacedCount }) : t('no_matches_found'), replacedCount > 0 ? 'success' : 'info');
  }

  function openReplaceBar() {
    replaceBar.style.display = 'flex';
    settingsPanel.classList.remove('open');
    replaceFindInput.focus();
    replaceFindInput.select();
    recomputeReplaceMatches(true);
  }
  function closeReplaceBar() {
    replaceBar.style.display = 'none';
    clearReplaceHighlight();
    replaceMatches = [];
    replaceActiveIndex = -1;
    replaceUndoStack = [];
  }
  function isReplaceBarOpen() { return replaceBar.style.display === 'flex'; }

  replaceBtn.addEventListener('click', () => { isReplaceBarOpen() ? closeReplaceBar() : openReplaceBar(); });
  replaceCloseBtn.addEventListener('click', closeReplaceBar);

  replaceFindInput.addEventListener('input', () => recomputeReplaceMatches(false));
  replaceFindInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.shiftKey ? goToReplaceMatch(-1) : goToReplaceMatch(1);
    } else if (e.key === 'Escape') {
      closeReplaceBar();
    }
  });
  replaceWithInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); doReplaceOneMatch(); }
    else if (e.key === 'Escape') { closeReplaceBar(); }
  });
  replaceScopeOcr.addEventListener('change', () => recomputeReplaceMatches(true));
  replaceScopeTranslation.addEventListener('change', () => recomputeReplaceMatches(true));
  replaceWholeWord.addEventListener('change', () => recomputeReplaceMatches(false));
  replaceCaseSensitive.addEventListener('change', () => recomputeReplaceMatches(false));
  replacePrevBtn.addEventListener('click', () => goToReplaceMatch(-1));
  replaceNextBtn.addEventListener('click', () => goToReplaceMatch(1));
  replaceOneBtn.addEventListener('click', doReplaceOneMatch);
  replaceAllBtn.addEventListener('click', doReplaceAllMatches);

  // Phim tat: Ctrl+H (Cmd+H tren macOS) de mo/dong thanh Replace - khong
  // dung Ctrl+F vi trung voi Find mac dinh cua trinh duyet/webview.
  // Khi thanh Replace dang mo, Ctrl+Z (Cmd+Z) se hoan tac lan Replace/
  // Replace all gan nhat thay vi hanh vi undo mac dinh cua o input.
  document.addEventListener('keydown', (e) => {
    const modifier = e.ctrlKey || e.metaKey;
    if (modifier && (e.key === 'h' || e.key === 'H')) {
      e.preventDefault();
      if (isReplaceBarOpen()) { replaceFindInput.focus(); replaceFindInput.select(); }
      else openReplaceBar();
      return;
    }
    if (modifier && !e.shiftKey && (e.key === 'z' || e.key === 'Z') && isReplaceBarOpen()) {
      e.preventDefault();
      undoLastReplace();
      return;
    }
    if (e.key === 'Escape' && isReplaceBarOpen() && document.activeElement !== replaceFindInput && document.activeElement !== replaceWithInput) {
      closeReplaceBar();
    }
  });

getKeyBtn.addEventListener('click', async () => {
  const url = 'https://aistudio.google.com/api-keys';
  try {
    // Gọi command Rust đã có sẵn
    if (window.__TAURI__?.core?.invoke) {
      await window.__TAURI__.core.invoke('open_external_url', { url });
      return;
    }
    // Fallback nếu chạy ngoài Tauri (web)
    if (window.openExternal?.open) {
      await window.openExternal.open(url);
      return;
    }
    window.open(url, '_blank');
  } catch (err) {
    showToast(t('open_failed'), 'error', 6000);
  }
});

  // ---------- alert dialog (dung chung pill voi confirm, chi 1 nut OK) ----------
  function showAlertDialog(message) {
    return showConfirmDialog(message, t('ok_btn'), '', true).then(() => {});
  }

  // Kiem tra o API key da co noi dung chua TRUOC KHI lam bat ky viec gi khac
  // (doc anh, dung base64...) de khong ton thoi gian xu ly neu chua co key.
  async function ensureApiKeyOrWarn() {
    if (apiKeyInput.value.trim()) return true;
    await showAlertDialog(t('enter_api_key_first'));
    apiKeyInput.focus();
    return false;
  }

  function getApiKey() {
    const key = apiKeyInput.value.trim();
    if (!key) {
      showToast(t('enter_api_key_first'), 'error');
      apiKeyInput.focus();
      return null;
    }
    return key;
  }

  // ---------- pill width: MOT CHO DUY NHAT quyet dinh kich thuoc nav-fab-toggle ----------
  // Pill co 4 trang thai co the BAT DOC LAP va CHONG LEN NHAU cung luc:
  //   - pillIsProcessing: dang chay OCR/dich hang loat -> vien 248px co progress ben trong
  //   - activeToast: dang co thong bao can hien -> vien do JS do theo do dai chu
  //   - activeConfirm: dang cho nguoi dung tra loi Yes/No -> the tron 300x76
  //   - activePrompt: dang cho nguoi dung nhap huong dan Refine Translation -> vien 320px
  // Truoc day moi trang thai tu quyet dinh rieng: CSS lo width cua "processing"
  // (qua class), con JS lo width cua "toast" (qua inline style), roi khi toast
  // ket thuc thi xoa inline style de "nhuong lai" cho CSS quyet dinh. Hai co che
  // gianh quyen (class vs inline style) cung luc rat de sai kich thuoc dung luc
  // 2 trang thai dan xen (vd toast moi bat ra dung luc batch vua chay xong). Gio
  // ca classList LAN inline width/height deu chi duoc doc/ghi trong syncPillState() -
  // noi khac tuyet doi khong tu y dung navFabToggleBtn.style.width hay
  // .classList.add/remove('processing'/'toast'/'confirm'/'prompt') nua, chi doi
  // state roi goi ham nay. Uu tien: confirm/prompt (dang cho tra loi) > toast >
  // processing > tron mac dinh.
  const PILL_WIDTH_PROCESSING = 248;
  let pillIsProcessing = false;

  // Do kich thuoc THAT can thiet cho pill confirm/prompt bang cach nhan ban
  // #nav-fab-toggle (dang mang dung noi dung/nut hien tai), dat o ngoai vung
  // nhin voi width/height:auto de trinh duyet tu xep chu/nut theo dung CSS
  // that su, roi doc scrollWidth/scrollHeight - chinh xac tuyet doi voi moi
  // do dai text/nhan nut, thay vi mot con so co dinh doan truoc de vua/thieu.
  function measureInlinePillSize(stateClass, minWidth, maxWidth, minHeight) {
    const clone = navFabToggleBtn.cloneNode(true);
    clone.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
    clone.classList.remove('active');
    clone.classList.add(stateClass);
    clone.style.position = 'fixed';
    clone.style.left = '-9999px';
    clone.style.top = '-9999px';
    clone.style.width = 'auto';
    clone.style.height = 'auto';
    clone.style.visibility = 'hidden';
    clone.style.transition = 'none';
    clone.style.opacity = '1';
    document.body.appendChild(clone);
    const width = Math.min(maxWidth, Math.max(minWidth, clone.scrollWidth));
    const height = Math.max(minHeight, clone.scrollHeight);
    document.body.removeChild(clone);
    return { width, height };
  }

function syncPillState() {
  const busy = !!activeConfirm || !!activePrompt;
  navFabToggleBtn.classList.toggle('confirm', !!activeConfirm);
  navFabToggleBtn.classList.toggle('prompt', !!activePrompt);
  navFabToggleBtn.classList.toggle('processing', pillIsProcessing);
  navFabToggleBtn.classList.toggle('toast', !!activeToast && !busy);

if (activeConfirm) {
  const size = measureInlinePillSize('confirm', 200, 800, 48);
  navFabToggleBtn.style.width = `${size.width}px`;
  navFabToggleBtn.style.height = '48px';
} else if (activePrompt) {
      const size = measureInlinePillSize('prompt', 260, 360, 48);
      navFabToggleBtn.style.width = `${size.width}px`;
      navFabToggleBtn.style.height = '';
    } else if (activeToast) {
      // Toast luon uu tien: neu dang processing thi toast "de tam" len tren
      // progress (xem CSS .processing.toast .nav-fab-progress), progress van
      // chay ngam, pill se tro ve dung 248px ngay khi toast ket thuc.
      navFabToggleBtn.style.width = `${measureToastPillWidth(activeToast.message)}px`;
      navFabToggleBtn.style.height = '';
    } else if (pillIsProcessing) {
      navFabToggleBtn.style.width = `${PILL_WIDTH_PROCESSING}px`;
      navFabToggleBtn.style.height = '';
    } else {
      navFabToggleBtn.style.width = ''; // tron mac dinh 48px, CSS lo
      navFabToggleBtn.style.height = '';
    }
  }

  // ---------- toast (hien trong pill nav-fab-toggle) ----------
  // Thay vi hien khung rieng o goc man hinh, thong bao gio "muon" chinh
  // nut tron/vien thuoc nav-fab-toggle de hien noi dung: pill se dai ra
  // vua du de chua chu (do bang canvas, gioi han toi da TOAST_MAX_WIDTH),
  // hien 1 thong bao tai 1 thoi diem theo hang doi (toastQueue) - thong
  // bao sau se cho thong bao truoc hien xong roi moi den luot.
  const TOAST_MIN_WIDTH = 140;
  const TOAST_MAX_WIDTH = 496; // gap doi muc 248px cua trang thai processing
  const TOAST_FONT = '11.5px Consolas, "SFMono-Regular", ui-monospace, monospace';
  const toastMeasureCanvas = document.createElement('canvas');

  function measureToastPillWidth(text) {
    const ctx = toastMeasureCanvas.getContext('2d');
    ctx.font = TOAST_FONT;
    const textWidth = ctx.measureText(text).width;
    const dotWidth = 7, gap = 8, hPadding = 32; // 16px trai + 16px phai
    // .nav-fab-toggle (noi width nay duoc gan) dung box-sizing:border-box va
    // co border 1px moi ben -> 2px do bi "an" vao phan noi dung thay vi cong
    // them ra ngoai. Canvas do chu cung khong bao gio khop tuyet doi voi luc
    // DOM that render (font hinting/kerning khac nhau chut it). Thieu du vai
    // px nay la du de trinh duyet cat chu va hien dau "..." ngay ca voi
    // thong bao rat ngan. BORDER_WIDTH + SAFETY_BUFFER la noi DUY NHAT bu
    // vao cho hai khoan hut nay.
    const BORDER_WIDTH = 2; // 1px x 2 canh
    const SAFETY_BUFFER = 6;
    const total = dotWidth + gap + textWidth + hPadding + BORDER_WIDTH + SAFETY_BUFFER;
    return Math.min(TOAST_MAX_WIDTH, Math.max(TOAST_MIN_WIDTH, Math.ceil(total)));
  }

  let toastIdCounter = 0;
  let toastQueue = [];
  let activeToast = null;
  let activeToastTimer = null;
  // Trang thai cho confirm (Yes/No) va prompt (nhap huong dan Refine
  // Translation) hien inline trong pill nav-fab-toggle - xem syncPillState().
  let activeConfirm = null; // { resolve }
  let activePrompt = null;  // { resolve }

  function renderActiveToast() {
    navFabToastText.textContent = activeToast.message;
    navFabToastDot.className = `nav-fab-toast-dot ${activeToast.type}`;
    syncPillState();
  }

  function playNextToast() {
    if (activeToastTimer) { clearTimeout(activeToastTimer); activeToastTimer = null; }
    if (toastQueue.length === 0) {
      activeToast = null;
      syncPillState();
      return;
    }
    activeToast = toastQueue.shift();
    renderActiveToast();
    const wait = activeToast.durationMs > 0 ? activeToast.durationMs : 3200;
    activeToastTimer = setTimeout(playNextToast, wait);
  }

  function showToast(message, type = 'success', durationMs = 3200) {
    const entry = { id: ++toastIdCounter, message, type, durationMs };
    toastQueue.push(entry);
    if (!activeToast) playNextToast();
    return entry;
  }

  // Cap nhat noi dung 1 toast dang hien thi hoac dang cho trong hang doi
  // (dung cho trang thai "dang luu" -> "da luu"). Neu toast cu da hien
  // xong va bi go khoi hang doi roi thi tao toast moi thay the.
  function updateToast(toastHandle, message, type = 'success', durationMs = 3200) {
    if (!toastHandle) { showToast(message, type, durationMs); return; }
    if (activeToast && activeToast.id === toastHandle.id) {
      activeToast.message = message;
      activeToast.type = type;
      activeToast.durationMs = durationMs;
      renderActiveToast();
      if (activeToastTimer) clearTimeout(activeToastTimer);
      activeToastTimer = setTimeout(playNextToast, durationMs > 0 ? durationMs : 3200);
      return;
    }
    const queued = toastQueue.find(t => t.id === toastHandle.id);
    if (queued) {
      queued.message = message;
      queued.type = type;
      queued.durationMs = durationMs;
      return;
    }
    showToast(message, type, durationMs);
  }

  // ---------- custom confirm dialog (Yes/No) - hien inline trong pill nav-fab-toggle ----------
  // Truoc day mo #confirm-modal giua man hinh; gio "muon" chinh nut tron o
  // goc de dai ra thanh 1 the nho chua cau hoi + 2 nut Yes/No, dong bo animation
  // voi toast/processing (xem syncPillState()). Vi confirm co the duoc mo tu
  // BEN TRONG mot modal khac dang mo (vd nut Reset counter trong info-modal),
  // nav-fab duoc bump z-index tam thoi (.overlay-active) de luon noi len tren.
  function showConfirmDialog(message, yesLabel = t('yes_btn'), noLabel = t('no_btn'), alertMode = false) {
    return new Promise((resolve) => {
      navFabConfirmText.textContent = message.replace(/\n/g, ' ');
      navFabConfirmYesBtn.textContent = alertMode ? 'OK' : yesLabel;
      navFabConfirmNoBtn.textContent = noLabel;
      navFabConfirmNoBtn.style.display = alertMode ? 'none' : '';
      // Dong panel danh sach anh neu dang mo, tranh choi "2 the" cung luc.
      navFabPanel.classList.remove('open');
      navFabToggle.classList.remove('active');
      activeConfirm = { resolve };
      navFab.classList.add('overlay-active');
      navFabScrim.classList.add('open');
      syncPillState();
      // Doi pill dan xong (0.42s) roi moi focus, tranh giat layout giua chung animation
      setTimeout(() => navFabConfirmYesBtn?.focus(), 200);
    });
  }

  function resolveConfirmDialog(result) {
    if (!activeConfirm) return;
    const { resolve } = activeConfirm;
    activeConfirm = null;
    navFab.classList.remove('overlay-active');
    navFabScrim.classList.remove('open');
    syncPillState();
    resolve(result);
  }

  navFabConfirmYesBtn.addEventListener('click', (e) => { e.stopPropagation(); resolveConfirmDialog(true); });
  navFabConfirmNoBtn.addEventListener('click', (e) => { e.stopPropagation(); resolveConfirmDialog(false); });

    // Skill "writing-clearly-and-concisely" (Elements of Style, Strunk 1918).
  // Chi chen vao prompt DICH (Translate + Refine Translation), khong dung
  // cho OCR - OCR phai chep nguyen van, khong duoc "viet lai cho hay".
  // Tra ve chuoi rong khi cong tac dang tat => prompt giu nguyen nhu cu,
  // khong ton them token nao.
  function getStyleGuideBlock(targetName, mode = 'translate') {
    if (!styleGuideToggle || !styleGuideToggle.checked) return '';
    if (!window.STYLE_SKILL) {
      console.warn('VisionBox: khong tim thay style-guide.js - bo qua skill Elements of Style.');
      return '';
    }
    return '\n' + window.STYLE_SKILL.buildBlock(targetName, mode) + '\n';
  }
  
// ---------- prompts ----------
  // Viet bang tieng Anh chinh xac (thay vi tieng Viet khong dau) de Gemini
  // hieu dung y va bam sat huong dan hon - tieng Viet khong dau de gay
  // nhap nhang khi model token hoa/dien giai.
  function buildOcrPrompt(sourceLang, skipSfx) {
    // Bubble boundary rule - shared across all 4 languages. This is the fix
    // for the most common mistake: text inside one bubble getting wrapped
    // onto multiple output lines just because it word-wraps inside a
    // narrow bubble shape.
    const bubbleRule = `
BUBBLE BOUNDARY RULE (the single most important rule - read this carefully before anything else):
- A speech bubble is a single, fully enclosed graphical outline (an oval, a cloud shape, a jagged/spiky outline for shouting, or a rectangular caption/narration box). Any text located INSIDE one such outline belongs to ONE single bubble - no matter if it visually wraps into 2-5 lines because the bubble is narrow, changes font size mid-sentence, or contains ellipses ("...") or gaps.
- When you produce your output, you MUST merge ALL the text from the same bubble into a SINGLE output line (join the wrapped fragments with a single space). NEVER create an extra output line just because the text wraps naturally inside a bubble - this is the single most important rule to follow carefully, and the most common mistake when scanning densely-packed pages.
- EXAMPLE: if one bubble visually shows the text broken across 3 lines like:
    "I can't believe
    you actually
    did that!"
  your output for that ONE bubble must be a SINGLE line: "I can't believe you actually did that!" - do NOT output it as 3 separate lines.
- Conversely, two DIFFERENT bubbles (two separate graphical outlines) - even if placed close together, touching, or overlapping - MUST become two SEPARATE output lines. Never merge two different bubbles into one line, even if their text would read naturally as one continuous sentence.
- A rectangular caption/narration box (no pointed tail toward a character) is still a normal text unit that must be extracted in full just like a speech bubble - do NOT skip it or mistake it for SFX.
- Before finalizing your answer, double check each output line: does it correspond to EXACTLY one bubble outline in the image? If a line looks like it might actually be two merged bubbles, or a bubble that got split into two lines, fix it.`;

    const sfxInstruction = skipSfx
      ? `
SFX RULE (exclude completely):
- Completely IGNORE any sound-effect / onomatopoeia lettering that is drawn directly onto the artwork itself, with NO enclosing bubble or box outline around it (for example: footsteps, impact sounds, animal sounds, wind, explosions...).
- ONLY extract text that sits inside an actual speech bubble or caption box (see the bubble boundary rule above). Do not output any SFX line at all.`
      : `
SFX RULE (include, keep in true reading position):
- If the page contains SFX (stylized sound-effect lettering drawn directly onto the artwork, with no enclosing outline), include each one as its own separate output line, placed EXACTLY where it falls in the true reading order of the page - read the WHOLE page (both bubbles and SFX together) strictly in the reading order defined below, and output every element (bubble or SFX) as one line in that same visual order. Do NOT group all SFX together at the end of the output - an SFX that visually appears between two bubbles must appear between those two bubbles' lines in your output, matching the page's real top-to-bottom layout.
- For SFX specifically: look CAREFULLY at the actual shape of every letter as it appears in the image (SFX lettering is often rotated, distorted, stretched, or heavily stylized) and transcribe EXACTLY what you see. Do NOT guess a common/familiar SFX word if it does not match the actual letter shapes in the image - guessing instead of reading is the main cause of inaccurate SFX transcription.
- If an SFX is too stylized to read with full confidence, still transcribe your best reading of it, prioritizing accuracy to the actual lettering over guessing a "typical" sound effect.`;

    const outro = `
If a bubble/box truly has no legible text, skip that line entirely instead of writing a placeholder note/marker (such as "(blank)", "(empty)", "(bỏ trống)", "(để trống)", "(no text)"...).
Return ONLY the scanned text lines. Do not add a title, numbering, or any explanation.`;

    if (sourceLang === 'ko') {
      return `This is a page from a Korean comic (manhwa). Your task is to OCR the text from the speech bubbles / text boxes on this page.

IMPORTANT INSTRUCTIONS:
1. Scan in true reading order: top to bottom, left to right.
2. Each separate bubble/box goes on its own output line (see the bubble boundary rule below).
3. Do NOT translate anything - extract the original Korean text exactly as written.
4. Preserve every character and punctuation mark from the source text.
5. Do not add any explanation or commentary besides the scanned text.
${bubbleRule}
${sfxInstruction}
${outro}`;
    }

    if (sourceLang === 'zh') {
      return `This is a page from a Chinese comic (manhua). Your task is to OCR the text from the speech bubbles / text boxes on this page.

IMPORTANT INSTRUCTIONS:
1. Scan in true reading order: top to bottom, left to right.
2. Each separate bubble/box goes on its own output line (see the bubble boundary rule below).
3. Do NOT translate anything - extract the original Chinese text exactly as written.
4. Keep the original Han characters as-is - do not convert between Simplified and Traditional.
5. Preserve every punctuation mark and special character from the source text.
6. Do not add any explanation or commentary besides the scanned text.
${bubbleRule}
${sfxInstruction}
${outro}`;
    }

    if (sourceLang === 'ja') {
      return `This is a page from a Japanese manga. Your task is to OCR the text from the speech bubbles / text boxes on this page.

IMPORTANT INSTRUCTIONS:
1. Each separate bubble/box goes on its own single output line, with all wrapped text inside that bubble merged into that one line (see the bubble boundary rule below for the full rule and example). This is mandatory and is the instruction most often gotten wrong - read it carefully.
2. The ORDER in which bubbles are listed on the page MUST always follow standard manga reading order: top to bottom, right to left. This is mandatory.
3. Do NOT translate anything - extract the original Japanese text of each bubble exactly as written. This is mandatory.
4. If kanji is paired with furigana, scan only the main text (the kanji) and ignore the furigana.
5. Preserve punctuation marks and special characters from the source text.
6. Do not add any explanation or commentary besides the scanned text.
${bubbleRule}
${sfxInstruction}
${outro}`;
    }

    if (sourceLang === 'manga-en') {
      return `This is a page from an English-language manga (an English scanlation/edition that keeps the ORIGINAL Japanese manga panel layout - only the text itself has been translated/lettered into English, the physical page layout is untouched).

WARNING - THE #1 MISTAKE TO AVOID: seeing English text makes it very tempting to scan the page left-to-right like a normal English comic. That would be WRONG here. The panel and bubble LAYOUT on this page is still the original Japanese manga layout, which reads right-to-left, regardless of the fact that the lettering inside each bubble happens to be in English. Do not let the language of the text influence the layout reading direction.

FOLLOW THIS EXACT STEP-BY-STEP PROCEDURE TO DETERMINE THE READING ORDER (do this mentally before writing your final answer):
Step 1: Look at the page and mentally split it into horizontal rows ("tiers") of panels, based on the panel border lines, ordered from the TOP of the page down to the BOTTOM.
Step 2: Take the FIRST (topmost) tier. Look at how many panels are in that tier and where they sit left-to-right on the page.
Step 3: Within that tier, process the panels in this exact order: the panel drawn FURTHEST TO THE RIGHT comes first, then the next one to its left, and so on, ending with the panel FURTHEST TO THE LEFT in that tier. (For a tier with only one panel, there is nothing to reorder.)
Step 4: Within a single panel, if it contains two or more bubbles, order them the same way: the bubble positioned more to the right (or, if two bubbles are at roughly the same horizontal position, the one positioned higher up) comes before the one to its left / below it.
Step 5: After finishing a tier, move to the NEXT tier down and repeat steps 2-4, continuing until you reach the bottom of the page.
Step 6: Before writing your final output, mentally re-walk through the order you produced and confirm it matches this right-to-left-per-tier procedure - if any two bubbles look swapped, fix them now.

IMPORTANT INSTRUCTIONS:
1. Apply the step-by-step procedure above to determine the order of your output lines. This is mandatory.
2. WITHIN each individual bubble, the English text itself is naturally written and read left to right as normal English (do not reverse the letters or word order of the English text) - the procedure above only governs the ORDER BETWEEN different bubbles/panels, not the direction of the text inside one bubble.
3. Each separate bubble/box goes on its own single output line, with all wrapped text inside that bubble merged into that one line (see the bubble boundary rule below for the full rule and example). This is mandatory.
4. Do NOT translate anything - extract the original English text of each bubble exactly as written. This is mandatory.
5. Preserve punctuation marks and special characters from the source text.
6. Do not add any explanation or commentary besides the scanned text.
${bubbleRule}
${sfxInstruction}
${outro}`;
    }

    return `This is a page from an English-language comic. Your task is to OCR the text from the speech bubbles / text boxes on this page.

IMPORTANT INSTRUCTIONS:
1. Scan in true reading order: top to bottom, left to right.
2. Each separate bubble/box goes on its own output line (see the bubble boundary rule below).
3. Do NOT translate anything - extract the original English text exactly as written.
4. Preserve every character and punctuation mark from the source text.
5. Do not add any explanation or commentary besides the scanned text.
${bubbleRule}
${sfxInstruction}
${outro}`;
  }

  function buildTranslatePrompt(text, sourceLang, targetLang) {
    const sourceName = LANG_NAMES[sourceLang] || sourceLang;
    const targetName = LANG_NAMES[targetLang] || targetLang;
    
    return `You are an elite comic localizer and master translator with 20+ years of experience translating from ${sourceName} to ${targetName}.

Below is the OCR text scanned from a comic page, along with the image of that same page. EACH LINE is a separate speech bubble / text box.

OCR text:
${text}

--- MENTAL CONTEXT ANALYSIS (DO THIS SILENTLY BEFORE TRANSLATING) ---
To achieve a perfect localization, mentally analyze the IMAGE and the TEXT using this framework:
1. VISUAL CUES: What is happening in the panel? Are they fighting, whispering, or running? (Use the art to resolve ambiguous pronouns like "it", "this", or dropped subjects).
2. CHARACTER DYNAMICS: Who is speaking to whom? What is their age difference and relationship? (Crucial for choosing the exact correct pronouns, honorifics, and politeness levels in ${targetName}).
3. EMOTIONAL TONE: Read the facial expressions. Is the tone sarcastic, terrified, casual, or formal?

--- TRANSLATION INSTRUCTIONS ---
1. DYNAMIC EQUIVALENCE: Do not translate word-for-word. Translate the *contextual meaning*. Your output must sound exactly like what a native ${targetName} speaker would naturally say in this specific situation. Keep the dialogue punchy, concise, and direct.
2. ADAPTATION & SFX: Adapt idioms and jokes to ${targetName} equivalents. If a line is a standalone sound-effect/SFX word (e.g. BANG, THUD, meow), translate/transliterate it BRIEFLY into an equivalent in ${targetName} that keeps the spirit of a sound effect.
3. CAPITALIZATION: The source OCR text may be entirely in UPPERCASE letters, but your translation MUST use normal sentence case following the normal spelling conventions of ${targetName}. Do NOT capitalize an entire word/sentence just because the source text was uppercase.
4. THE JAPANESE WAVE DASH "〜" (or "～"): This indicates a drawn-out, elongated sound. Do NOT translate/replace it with an ellipsis "...", since that implies hesitation. Instead, render the elongated sound naturally (e.g., by lengthening the last vowel/sound).
5. STRICT FORMATTING (MANDATORY):
   - The number of lines in your translation MUST exactly match the number of lines in the OCR text.
   - EVERY line in the source must correspond to EXACTLY ONE line in the translation (never merge or split lines).
   - NEVER write a placeholder note/marker (such as "(blank)", "(empty)", "N/A"). If a line genuinely has nothing to translate, leave that line as a truly empty line.
   - NEVER output your "Mental Context Analysis" text. Output ONLY the final translated lines.

${getStyleGuideBlock(targetName, 'translate')}

Return ONLY the final translation. Do not add any explanation or notes.`;
}

  // ---------- Refine OCR (doc lap hoan toan voi buildOcrPrompt/buildTranslatePrompt o tren) ----------
  // Muc dich: gui LAI anh + ban OCR HIEN CO cho Gemini, yeu cau doi chieu
  // lai voi tung bong thoai/thoai ngoai trong anh de gom dung dong (sua
  // loi bi tach dong trong cung 1 bong thoai, hoac gop nham 2 bong khac
  // nhau). Prompt nay KHONG goi lai buildOcrPrompt va khong lam thay doi
  // hanh vi cua OCR/Translate thong thuong.
  function buildRefineOcrPrompt(sourceLang, skipSfx, previousOcrText, contentType) {
    const langName = LANG_NAMES[sourceLang] || sourceLang;
    const sfxNote = skipSfx
      ? `Sound-effect/onomatopoeia lettering drawn directly on the artwork (no bubble/box outline) should be EXCLUDED, same as before - do not add any SFX line.`
      : `If the page has sound-effect/onomatopoeia lettering drawn directly on the artwork (no bubble/box outline), keep it as its own separate line, placed exactly where it falls in true reading order among the bubbles.`;
    const readingOrderNote = contentType === 'manga'
      ? `The reading order MUST follow standard MANGA reading order: top to bottom, right to left. This is mandatory - re-check the order of every bubble against this direction, not just against the previous OCR result's order.`
      : `The reading order MUST follow standard WEBTOON reading order: top to bottom, left to right. This is mandatory - re-check the order of every bubble against this direction, not just against the previous OCR result's order.`;

    return `You are proofreading and correcting an existing OCR scan of a page from a ${langName} comic, by comparing it carefully against the actual image.

PREVIOUS OCR RESULT (this is what was scanned before, it may contain mistakes):
${previousOcrText}

THE MOST COMMON MISTAKE IN THE PREVIOUS RESULT: text that belongs to ONE single speech bubble (one fully enclosed outline - oval, cloud shape, jagged shout shape, or rectangular caption/narration box) got wrongly split into two or more separate lines above, usually because the text wraps into multiple visual rows inside a narrow bubble. Your main job is to fix this.

YOUR TASK:
1. Look carefully at the actual image and identify every individual bubble/box outline and every piece of SFX text (if applicable).
2. For each bubble/box, ALL of its text - no matter how many visual rows it wraps into inside the bubble - must become exactly ONE output line (join wrapped fragments with a single space).
3. If two DIFFERENT bubbles were wrongly merged into one line in the previous result, split them back into separate lines.
4. ${readingOrderNote}
5. Do NOT translate anything - keep the original ${langName} text exactly as written, character for character.
6. Do NOT invent, summarize, or drop any bubble's text - every bubble present in the image must be represented.
7. ${sfxNote}
8. If, after careful review, the previous OCR result was already correct, simply return it unchanged.
9. NEVER write a placeholder note/marker for a line (such as "(blank)", "(empty)", "(bỏ trống)", "(để trống)", "(no text)"...) - if a bubble truly has no legible text, skip that line entirely instead.

Return ONLY the corrected list of scanned text lines, one bubble/box per line, in reading order. Do not add a title, numbering, explanation, or any commentary.`;
  }

  // ---------- Refine Translation (doc lap hoan toan voi buildTranslatePrompt/buildRefineOcrPrompt o tren) ----------
  // Muc dich: gui LAI anh + OCR hien co + ban dich HIEN CO cho Gemini, cho
  // phep nguoi dung nhap them 1 yeu cau tuy chinh (vd doi xung ho, sat ngu
  // canh hon...). Prompt nay KHONG goi lai buildTranslatePrompt/buildRefineOcrPrompt
  // va khong lam thay doi hanh vi cua Translate/Refine OCR thong thuong.
  function buildRefineTranslatePrompt(sourceLang, targetLang, skipSfx, ocrText, previousTranslation, userInstruction) {
    const sourceName = LANG_NAMES[sourceLang] || sourceLang;
    const targetName = LANG_NAMES[targetLang] || targetLang;
    const sfxNote = skipSfx
      ? `Sound-effect/onomatopoeia lines (if any ended up in the previous translation) should be EXCLUDED - do not keep or add any SFX line.`
      : `If the source has sound-effect/onomatopoeia lines, keep translating/transliterating them briefly as sound effects, in the same line position as before - do not drop them.`;
    const extraInstructionBlock = userInstruction
      ? `
ADDITIONAL USER INSTRUCTION (apply this carefully together with everything above - if it conflicts with a general style choice below, the user instruction takes priority):
${userInstruction}
`
      : '';

    return `You are proofreading and refining an existing ${targetName} translation of a page from a ${sourceName} comic, by comparing it carefully against the source OCR text and the actual image.

SOURCE OCR TEXT (${sourceName}), one line per bubble:
${ocrText}

PREVIOUS TRANSLATION (${targetName}), one line per bubble, in the SAME order as the OCR text above (this is what was translated before, it may contain mistakes):
${previousTranslation}
${extraInstructionBlock}
YOUR TASK:
1. Compare each translated line against its corresponding OCR line and the image, and correct any mistranslation, awkward phrasing, wrong tone, or meaning that doesn't fit the page's context/art.
2. Keep the SAME number of lines and the SAME line order as the previous translation - never merge or split lines, and never add or remove a line.
3. Use NATURAL phrasing suited to the comic genre, with modern, easy-to-understand wording.
4. Convey the correct emotion and context of each bubble, using the image for context.
5. ${sfxNote}
6. If, after careful review, a line was already correct, keep it unchanged.
7. Do not add a title, numbering, explanation, or any commentary.
8. NEVER write a placeholder note/marker for a line (such as "(blank)", "(empty)", "(bỏ trống)", "(để trống)", "(no text)", "N/A"...) - if a line genuinely has nothing to translate, leave that line as a truly empty line (zero characters) instead of writing any word/note about it.
${getStyleGuideBlock(targetName, 'refine')}
Return ONLY the refined translation, one line per bubble, in the same order as above.`;
  }

  // ---------- Gemini calls ----------
  const MAX_429_RETRIES = 6;
  const RETRY_WAIT_MS = 10000; // 10 giay moi lan, toi da 6 lan = 60 giay

  // Chi co 1 luong goi API chay tai 1 thoi diem (bi khoa boi isProcessing),
  // nen chi can 1 "activeRetry" toan cuc de nut Stop retry co the huy ngay
  // lap tuc thay vi phai cho het thoi gian setTimeout.
  let activeRetry = null;
  let retryQueueCancelled = false;

  function enableTranslateButton(index) {
    const item = mangaResults.querySelector(`[data-index="${index}"]`);
    const btn = item?.querySelector('.single-translate-btn');
    if (btn) { btn.disabled = false; btn.title = ''; }
  }

  function enableRefineOcrButton(index) {
    const item = mangaResults.querySelector(`[data-index="${index}"]`);
    const btn = item?.querySelector('.refine-ocr-option');
    if (btn) { btn.title = t('refine_ocr_tooltip'); }
  }

  function enableRefineTranslateButton(index) {
    const item = mangaResults.querySelector(`[data-index="${index}"]`);
    const btn = item?.querySelector('.refine-translate-option');
    if (btn) { btn.title = t('refine_translate_tooltip'); }
  }

  function showRetryStopButton(index) {
    if (typeof index !== 'number') return;
    const item = mangaResults.querySelector(`[data-index="${index}"]`);
    const btn = item?.querySelector('.stop-retry-btn');
    if (btn) btn.style.display = 'inline-flex';
  }

  function hideRetryStopButton(index) {
    if (typeof index !== 'number') return;
    const item = mangaResults.querySelector(`[data-index="${index}"]`);
    const btn = item?.querySelector('.stop-retry-btn');
    if (btn) btn.style.display = 'none';
  }

  async function onStopRetryClick(index) {
    const confirmed = await showConfirmDialog(t('rate_limit_stop_confirm'));
    if (!confirmed) return;
    retryQueueCancelled = true;
    stopRequested = true;
    if (activeRetry) activeRetry.cancel();
    hideRetryStopButton(index);
    showToast(t('retry_stopped'), 'info');
  }

  async function callGemini({ apiKey, model, promptText, base64Image, mimeType, temperature, maxOutputTokens, itemIndex }) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const body = {
      contents: [{
        parts: [
          { text: promptText },
          { inline_data: { mime_type: mimeType || 'image/jpeg', data: base64Image } }
        ]
      }],
      generationConfig: {
        temperature: temperature ?? 0.2,
        topP: 0.9,
        topK: 40,
        maxOutputTokens: maxOutputTokens ?? 4096
      }
    };

    let attempt = 0;
    while (true) {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      // Dem CHINH XAC moi lan thuc su goi API (moi lan fetch, ke ca cac lan
      // bi 429 phai retry), khong dem trung, khong dem hut - de trang usage
      // trong Settings phan anh dung so lan da goi Gemini.
      usageStats.totalCalls++;
      if (response.ok) usageStats.successCalls++; else usageStats.failedCalls++;
      scheduleSaveConfig();

      if (response.status === 429) {
        attempt++;
        if (retryQueueCancelled) {
          throw new Error('Retry queue stopped by user.');
        }
        if (attempt > MAX_429_RETRIES) {
          let msg = 'API error (HTTP 429): rate limit exceeded. Please wait a bit and try again.';
          try {
            const errData = await response.json();
            msg = errData.error?.message || msg;
          } catch (_) {}
          throw new Error(msg);
        }
        showToast(t('rate_limited', { seconds: RETRY_WAIT_MS / 1000 }), 'warning');
        showRetryStopButton(itemIndex);

        const cancelled = await new Promise((resolve) => {
          const timer = setTimeout(() => resolve(false), RETRY_WAIT_MS);
          activeRetry = { cancel: () => { clearTimeout(timer); resolve(true); } };
        });
        activeRetry = null;
        hideRetryStopButton(itemIndex);

        if (cancelled || retryQueueCancelled) {
          throw new Error('Retry queue stopped by user.');
        }
        continue;
      }

      if (!response.ok) {
        let msg = `API error (HTTP ${response.status})`;
        try {
          const errData = await response.json();
          msg = errData.error?.message || msg;
        } catch (_) {}
        throw new Error(msg);
      }

      const data = await response.json();
      const parts = data.candidates?.[0]?.content?.parts || [];
      return parts.map(p => p.text || '').join('').trim();
    }
  }

  // Mot so truong hop Gemini khong de dong that su trong ma lai ghi 1 "nhan
  // danh dau" thay the (vd "(bỏ trống)", "(để trống)", "(blank)", "(empty)",
  // "(no text)"...). Coi cac dong CHI gom 1 nhan nhu vay la dong trong luon,
  // du prompt da duoc yeu cau khong lam vay - de phong khi model van lo.
  const BLANK_MARKER_RE = /^[\s(\[{]*(?:bỏ\s*trống|để\s*trống|dòng\s*trống|trống|blank|empty|no\s*text|untranslated|n\/a)[\s)\]}]*$/i;

  // Xoa cac dong TRONG (khong co ky tu nao sau khi trim tung dong, hoac chi
  // la 1 nhan danh dau bo trong nhu tren) khoi 1 khoi text nhieu dong - dung
  // chung cho ca 4 luong OCR / Translate / Refine OCR / Refine Translation,
  // de o OCR va o dich cua tung anh khong bao gio con dong trong.
  function stripEmptyLines(text) {
    if (!text) return text;
    return text
      .split('\n')
      .filter(line => {
        const trimmed = line.trim();
        if (!trimmed) return false;
        if (BLANK_MARKER_RE.test(trimmed)) return false;
        return true;
      })
      .join('\n');
  }

  async function runOCR(imageData, itemIndex) {
    const apiKey = getApiKey();
    if (!apiKey) throw new Error(t('missing_api_key'));
    const base64 = imageData.dataUrl.split(',')[1];
    const prompt = buildOcrPrompt(sourceLangSelect.value, skipSfxToggle.checked);
    let text = await callGemini({
      apiKey, model: getSelectedModel(), promptText: prompt, base64Image: base64, temperature: 0.1, itemIndex
    });
    text = text
      .replace(/\n\s*\n/g, '\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
    text = stripEmptyLines(text);
    if (!text) throw new Error(t('cannot_extract'));
    return text;
  }

  async function runTranslate(imageData, itemIndex) {
    const apiKey = getApiKey();
    if (!apiKey) throw new Error(t('missing_api_key'));
    const base64 = imageData.dataUrl.split(',')[1];
    const prompt = buildTranslatePrompt(imageData.ocrResult, sourceLangSelect.value, targetLangSelect.value);
    let text = await callGemini({
      apiKey, model: getSelectedModel(), promptText: prompt, base64Image: base64, temperature: 0.6, maxOutputTokens: 8192, itemIndex
    });
    text = text.replace(/^(Translation:|Translated text:|Here is the translation:)/i, '').trim();
    text = stripEmptyLines(text);
    if (!text) throw new Error(t('translation_empty'));
    return text;
  }

  // Neu anh dang o Edit mode (nguoi dung dang go tay sua o OCR/o dich ma
  // CHUA bam "Done" de luu), imageData.ocrResult/.translationResult van
  // con giu ban CU. Ham nay dong bo dung noi dung dang hien tren o (DOM)
  // vao imageData truoc khi build prompt Refine Translation, de dam bao
  // Refine luon gui dung ban dich dang co trong o translation cua anh do -
  // dung chung cho ca nut "Refine Translation" (tung anh) va "Refine
  // Translation selected" (hang loat), giu 2 luong nay dong bo voi nhau.
  function syncEditedTextIfEditing(index) {
    const imageData = uploadedImages[index];
    if (!imageData) return;
    const ocrEl = document.getElementById(`ocr-${index}`);
    const transEl = document.getElementById(`translation-${index}`);
    if (ocrEl && ocrEl.getAttribute('contenteditable') === 'true') {
      imageData.ocrResult = stripEmptyLines(getPlainText(ocrEl).trim());
    }
    if (transEl && transEl.getAttribute('contenteditable') === 'true') {
      imageData.translationResult = stripEmptyLines(getPlainText(transEl).trim());
    }
  }

  // Refine OCR: gui lai anh + ban OCR HIEN CO, yeu cau Gemini doi chieu lai
  // ranh gioi bong thoai de gom/tach dong cho dung. Doc lap voi runOCR -
  // khong tai su dung/khong lam thay doi runOCR hay runTranslate.
  async function runRefineOcr(imageData, itemIndex) {
    const apiKey = getApiKey();
    if (!apiKey) throw new Error(t('missing_api_key'));
    if (!imageData.ocrResult) throw new Error(t('no_ocr_to_refine'));
    const base64 = imageData.dataUrl.split(',')[1];
    const prompt = buildRefineOcrPrompt(sourceLangSelect.value, skipSfxToggle.checked, imageData.ocrResult, currentContentType);
    let text = await callGemini({
      apiKey, model: getSelectedModel(), promptText: prompt, base64Image: base64, temperature: 0.1, itemIndex
    });
    text = text
      .replace(/\n\s*\n/g, '\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
    text = stripEmptyLines(text);
    if (!text) throw new Error(t('refine_ocr_empty'));
    return text;
  }

  async function runRefineTranslate(imageData, itemIndex, userInstruction) {
    const apiKey = getApiKey();
    if (!apiKey) throw new Error(t('missing_api_key'));
    if (!imageData.translationResult) throw new Error(t('no_translation_to_refine'));
    const base64 = imageData.dataUrl.split(',')[1];
    const prompt = buildRefineTranslatePrompt(
      sourceLangSelect.value, targetLangSelect.value, skipSfxToggle.checked,
      imageData.ocrResult || '', imageData.translationResult, userInstruction
    );
    let text = await callGemini({
      apiKey, model: getSelectedModel(), promptText: prompt, base64Image: base64, temperature: 0.6, maxOutputTokens: 8192, itemIndex
    });
    text = text.replace(/^(Translation:|Translated text:|Here is the translation:)/i, '').trim();
    text = stripEmptyLines(text);
    if (!text) throw new Error(t('refine_translate_empty'));
    return text;
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ---------- UI: manga item ----------
  function createMangaItem(imageData, index) {
    const item = document.createElement('div');
    item.className = 'manga-item';
    item.dataset.index = index;
    item.innerHTML = `
      <div class="manga-item-body">
        <div class="manga-item-header">
          <div class="manga-item-title">
            <div class="image-size-dropdown">
              <button type="button" class="image-size-btn" title="${t('adjust_image_size')}"><span class="icon">${ICON_RESIZE}</span></button>
              <div class="image-size-menu">
                <span class="image-size-menu-label">${t('image_size')}</span>
                <input type="range" class="image-size-slider" min="160" max="520" step="10" value="240" title="${t('resize_preview')}">
                <button type="button" class="image-size-reset" title="${t('reset_original_size')}"><span class="icon">${ICON_REFRESH}</span></button>
              </div>
            </div>
            <span>${t('image_title', { index: index + 1, name: imageData.file.name })}</span>
            <small>${t('size_kb', { size: Math.round(imageData.file.size / 1024) })}</small>
          </div>
          <div class="manga-item-actions">
            <button class="btn btn-danger stop-retry-btn" style="display:none" title="${t('stop_retry_title')}">${t('stop_retry')}</button>
            <span class="status-badge">${t('status_idle')}</span>
            <button class="btn btn-secondary edit-item-btn">${t('edit_mode')}</button>
            <button class="btn btn-secondary single-ocr-btn">${t('ocr_single')}</button>
            <button class="btn btn-secondary single-translate-btn" ${imageData.ocrResult ? '' : 'disabled'} title="${imageData.ocrResult ? '' : t('run_ocr_first')}">${t('translate_single')}</button>
            <div class="refine-dropdown">
              <button type="button" class="btn btn-secondary refine-btn" title="${t('refine_tooltip')}">${t('refine')}</button>
              <div class="refine-menu">
                <button type="button" class="refine-option refine-ocr-option" title="${imageData.ocrResult ? t('refine_ocr_tooltip') : t('run_ocr_first')}">${t('refine_ocr')}</button>
                <button type="button" class="refine-option refine-translate-option" title="${imageData.translationResult ? t('refine_translate_tooltip') : t('run_translate_first')}">${t('refine_translate')}</button>
              </div>
            </div>
            <input type="checkbox" class="select-checkbox item-select-checkbox" style="margin-left: auto;" title="${t('select_this_image')}" ${selectedUids.has(imageData.uid) ? 'checked' : ''}>
            <button class="btn btn-danger delete-single-btn" title="${t('delete_this_image')}"><span class="icon">${ICON_X}</span></button>
          </div>
        </div>
        <div class="manga-item-content">
          <div class="manga-image-section">
            <img src="${imageData.dataUrl}" alt="${t('image_title', { index: index + 1, name: imageData.file.name })}" draggable="false">
          </div>
          <div class="image-resize-handle" title="${t('drag_to_resize')}"></div>
          <div class="manga-text-section">
<div class="text-column">
  <div class="text-column-header">
    <span>${t('ocr_column')}</span>
    <div style="display:flex; gap:4px;">
      <button class="copy-btn" data-copy-target="ocr-${index}">${t('copy')}</button>
      <button class="history-btn" data-type="ocr" data-index="${index}" title="${t('view_versions_title')}">${t('versions')}</button>
    </div>
  </div>
  <div class="text-content-body">
    <div id="ocr-${index}" class="text-content empty" data-placeholder="${t('ocr_placeholder')}"></div>
  </div>
</div>
<div class="text-column">
  <div class="text-column-header">
    <span>${t('translation_column')}</span>
    <div style="display:flex; gap:4px;">
      <button class="copy-btn" data-copy-target="translation-${index}">${t('copy')}</button>
      <button class="history-btn" data-type="translation" data-index="${index}" title="${t('view_versions_title')}">${t('versions')}</button>
    </div>
  </div>
  <div class="text-content-body">
    <div id="translation-${index}" class="text-content empty" data-placeholder="${t('translation_placeholder')}"></div>
  </div>
</div>
      </div>
    `;
item.querySelectorAll('.history-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const idx = parseInt(btn.dataset.index, 10);
    const type = btn.dataset.type;
    openHistoryModal(idx, type);
  });
});
    item.querySelector('.single-ocr-btn').addEventListener('click', () => processSingleOCR(index));
    item.querySelector('.single-translate-btn').addEventListener('click', () => processSingleTranslate(index));
    item.querySelector('.delete-single-btn').addEventListener('click', () => deleteSingleImage(index));
    item.querySelector('.edit-item-btn').addEventListener('click', (e) => toggleItemEdit(index, e.currentTarget));
    item.querySelector('.stop-retry-btn').addEventListener('click', () => onStopRetryClick(index));

    // ---------- Refine dropdown (Refine OCR / Refine Translation) ----------
    const refineBtn = item.querySelector('.refine-btn');
    const refineMenu = item.querySelector('.refine-menu');
    refineMenu.addEventListener('click', (e) => e.stopPropagation());
    refineBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      document.querySelectorAll('.refine-menu.open').forEach(m => { if (m !== refineMenu) m.classList.remove('open'); });
      document.querySelectorAll('.export-menu.open').forEach(m => m.classList.remove('open'));
      refineMenu.classList.toggle('open');
    });
    item.querySelector('.refine-ocr-option').addEventListener('click', (e) => {
      e.stopPropagation();
      refineMenu.classList.remove('open');
      processSingleRefineOcr(index);
    });
    item.querySelector('.refine-translate-option').addEventListener('click', (e) => {
      e.stopPropagation();
      refineMenu.classList.remove('open');
      onRefineTranslateClick(index);
    });
    item.querySelector('.item-select-checkbox').addEventListener('change', (e) => {
      toggleImageSelection(imageData.uid, e.currentTarget.checked);
    });

    const ocrEl = item.querySelector(`#ocr-${index}`);
    const transEl = item.querySelector(`#translation-${index}`);
    renderTextBlockEl(ocrEl, imageData.ocrResult, false);
    renderTextBlockEl(transEl, imageData.translationResult, false);
    attachLineEditing(ocrEl);
    attachLineEditing(transEl);

    const slider = item.querySelector('.image-size-slider');
    slider.value = currentPreviewWidth;
    slider.addEventListener('input', () => setPreviewWidth(parseInt(slider.value, 10)));

    item.querySelector('.image-size-reset').addEventListener('click', () => setPreviewWidth(PREVIEW_DEFAULT));

    const sizeBtn = item.querySelector('.image-size-btn');
    const sizeMenu = item.querySelector('.image-size-menu');
    sizeMenu.addEventListener('click', (e) => e.stopPropagation());
    sizeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const willOpen = !sizeMenu.classList.contains('open');
      document.querySelectorAll('.image-size-menu.open').forEach(m => m.classList.remove('open'));
      document.querySelectorAll('.image-size-btn.active').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.refine-menu.open').forEach(m => m.classList.remove('open'));
      if (willOpen) {
        sizeMenu.classList.add('open');
        sizeBtn.classList.add('active');
      }
    });

    const resizeHandle = item.querySelector('.image-resize-handle');
    resizeHandle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = currentPreviewWidth;
      const onMove = (ev) => setPreviewWidth(startWidth + (ev.clientX - startX));
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    return item;
  }

  function setItemStatus(index, status) {
    const item = mangaResults.querySelector(`[data-index="${index}"]`);
    if (!item) return;
    item.classList.remove('processing', 'completed', 'error');
    const badge = item.querySelector('.status-badge');
    const map = { processing: t('status_processing'), completed: t('status_completed'), error: t('status_error'), idle: t('status_idle') };
    if (status !== 'idle') item.classList.add(status);
    badge.textContent = map[status] || status;

    const navItem = document.querySelector(`.nav-fab-item[data-index="${index}"]`);
    if (navItem) {
      navItem.classList.remove('processing', 'completed', 'error');
      if (status !== 'idle') navItem.classList.add(status);
    }
  }

function setTextBlock(elId, text, isError = false, changedSegments) {
  renderTextBlock(elId, text, isError, changedSegments);
}

  // So dong cho o OCR/dich cua tung anh: gan LIEN VAO cau truc - moi dong
  // logic la 1 hang flex (.line-row) gom o so (.line-num) + noi dung
  // (.line-text) NAM CHUNG mot hang. Vi ca 2 la con truc tiep cua cung 1
  // flex container nen chieu cao luon khop tuyet doi khi text wrap xuong
  // nhieu hang - trinh duyet tu lo layout, khong can do getClientRects()
  // hay dong bo lai khi resize/doi model/doi kich thuoc anh nua.
  //
  // renderTextBlock(elId, ...) tim phan tu bang document.getElementById -
  // CHI hoat dong neu phan tu da duoc gan vao trang (document). Khi tao
  // moi 1 the manga-item (createMangaItem), phan tu con dang "roi", CHUA
  // duoc appendChild vao mangaResults, nen goi theo elId se KHONG tim
  // thay gi va am tham khong lam gi ca - day chinh la nguyen nhan khien
  // OCR/dich cua CAC ANH CU bi "mat trang" moi khi co anh moi duoc them
  // vao (rebuildResultsList() dung lai + tao lai toan bo DOM tu dau).
  // renderTextBlockEl(el, ...) nhan THANG phan tu (khong can no da o
  // trong document hay chua) nen dung duoc an toan trong ca 2 truong hop.


function renderTextBlock(elId, text, isError = false, changedSegments) {
  const el = document.getElementById(elId);
  renderTextBlockEl(el, text, isError, changedSegments);
}

// So sánh hai chuỗi văn bản (OCR/Translation) và trả về Set các chỉ số dòng bị thay đổi (0-based)
function getChangedLines(oldText, newText) {
  if (!oldText || !newText) return null;
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const changed = new Set();
  const maxLen = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < maxLen; i++) {
    const oldLine = oldLines[i] || '';
    const newLine = newLines[i] || '';
    if (oldLine !== newLine) {
      changed.add(i);
    }
  }
  return changed.size ? changed : null;
}

// Tách 1 dòng thành các "token" (cụm từ + khoảng trắng xen kẽ) để diff theo
// TỪ thay vì theo từng ký tự đơn lẻ - cho kết quả tự nhiên và ổn định hơn
// (vd: gõ thêm 1 chữ vào giữa từ sẽ không làm cả từ đó bị vỡ vụn ra highlight).
function tokenizeLineForDiff(line) {
  return line.match(/\s+|[^\s]+/g) || [];
}

// Thuật toán diff chuẩn dựa trên LCS (Longest Common Subsequence) - đúng cả
// khi 2 chuỗi lệch độ dài do có CHÈN hoặc XOÁ token ở giữa (không chỉ thay
// thế đúng vị trí). Đây là cách git diff / Google Docs... dùng để so sánh.
// Trả về danh sách op: {type: 'equal'|'insert'|'delete', token}
function diffTokensLCS(oldTokens, newTokens) {
  const n = oldTokens.length;
  const m = newTokens.length;
  // Bảng LCS được tính từ dưới lên trên, phải qua trái để backtrack thuận
  // chiều (tránh phải reverse mảng kết quả).
  const dp = new Array(n + 1);
  for (let i = 0; i <= n; i++) dp[i] = new Int32Array(m + 1);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = (oldTokens[i] === newTokens[j])
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const ops = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (oldTokens[i] === newTokens[j]) {
      ops.push({ type: 'equal', token: oldTokens[i] });
      i++; j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: 'delete', token: oldTokens[i] });
      i++;
    } else {
      ops.push({ type: 'insert', token: newTokens[j] });
      j++;
    }
  }
  while (i < n) { ops.push({ type: 'delete', token: oldTokens[i] }); i++; }
  while (j < m) { ops.push({ type: 'insert', token: newTokens[j] }); j++; }
  return ops;
}

// So sánh hai chuỗi văn bản (OCR/Translation) theo TỪNG DÒNG, trả về danh
// sách các đoạn (theo vị trí ký tự TRONG DÒNG MỚI) thực sự khác so với bản
// cũ - dùng diff LCS theo từ nên chính xác cả khi refine chèn/xoá/đổi từ
// ở giữa câu, thay vì bị lệch vị trí như cách so ký tự theo index cũ.
function getChangedSegmentsForLines(oldText, newText) {
  if (!oldText || !newText) return null;
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const result = [];
  const maxLen = Math.max(oldLines.length, newLines.length);

  for (let i = 0; i < maxLen; i++) {
    const oldLine = oldLines[i] || '';
    const newLine = newLines[i] || '';
    if (oldLine === newLine) continue;

    const oldTokens = tokenizeLineForDiff(oldLine);
    const newTokens = tokenizeLineForDiff(newLine);
    const ops = diffTokensLCS(oldTokens, newTokens);

    // Duyệt qua các op theo đúng thứ tự xuất hiện trong DÒNG MỚI (equal +
    // insert đều tiêu thụ 1 token của newLine, delete thì không - vì token
    // đó không còn tồn tại trong dòng mới nữa) để tính chính xác vị trí
    // ký tự start/end của từng đoạn "insert" (= phần thực sự mới/đổi).
    let pos = 0;
    let segStart = -1;
    const segments = [];
    for (const op of ops) {
      if (op.type === 'delete') continue; // không chiếm vị trí trong newLine
      if (op.type === 'insert') {
        if (segStart === -1) segStart = pos;
        pos += op.token.length;
      } else { // equal
        if (segStart !== -1) {
          segments.push({ start: segStart, end: pos });
          segStart = -1;
        }
        pos += op.token.length;
      }
    }
    if (segStart !== -1) segments.push({ start: segStart, end: pos });

    segments.forEach(seg => {
      result.push({ lineIndex: i, start: seg.start, end: seg.end });
    });
  }

  return result.length ? result : null;
}



function renderTextBlockEl(el, text, isError, changedSegments) {
  if (!el) return;
  el.innerHTML = '';
  el.classList.remove('error');

  if (!isError) text = stripEmptyLines(text);

  if (!text) {
    el.classList.add('empty');
    const ph = document.createElement('div');
    ph.className = 'line-empty-placeholder';
    ph.textContent = el.dataset.placeholder || '';
    el.appendChild(ph);
    return;
  }

  el.classList.remove('empty');
  if (isError) {
    el.classList.add('error');
    const msg = document.createElement('div');
    msg.className = 'line-empty-placeholder';
    msg.textContent = text;
    el.appendChild(msg);
    return;
  }

  const lines = text.split('\n');
  lines.forEach((lineText, i) => {
    const row = document.createElement('div');
    row.className = 'line-row';
    const num = document.createElement('span');
    num.className = 'line-num';
    num.setAttribute('contenteditable', 'false');
    num.textContent = String(i + 1);
    const txt = document.createElement('span');
    txt.className = 'line-text';

    // Lấy tất cả các segment thay đổi trên dòng này
    const segs = changedSegments?.filter(s => s.lineIndex === i) || [];
    if (segs.length) {
      // Sắp xếp segments theo start
      segs.sort((a, b) => a.start - b.start);
      let lastEnd = 0;
      segs.forEach(seg => {
        // Phần trước segment (không đổi)
        const before = lineText.slice(lastEnd, seg.start);
        if (before) txt.appendChild(document.createTextNode(before));
        // Phần thay đổi
        const changed = lineText.slice(seg.start, seg.end);
        const mark = document.createElement('mark');
        mark.className = 'refined-word';
        mark.textContent = changed;
        txt.appendChild(mark);
        lastEnd = seg.end;
      });
      // Phần còn lại sau segment cuối
      const after = lineText.slice(lastEnd);
      if (after) txt.appendChild(document.createTextNode(after));
    } else {
      txt.textContent = lineText;
    }

    row.appendChild(num);
    row.appendChild(txt);
    el.appendChild(row);
  });
}
  // Doc lai noi dung THAT (bo qua so thu tu) tu 1 khoi OCR/dich cua tung
  // anh - dung khi luu sau khi sua tay, copy, hoac gop vao summary. Neu
  // phan tu khong co cau truc .line-row (vd cac o summary dang la <pre>
  // thuong) thi fallback ve innerText nhu cu.
  function getPlainText(el) {
    if (!el) return '';
    const rows = el.querySelectorAll(':scope > .line-row');
    if (rows.length > 0) {
      return Array.from(rows).map(r => {
        const t = r.querySelector('.line-text');
        return t ? t.textContent : '';
      }).join('\n');
    }
    return el.innerText || el.textContent || '';
  }

  function renumberLines(container) {
    const rows = container.querySelectorAll(':scope > .line-row');
    rows.forEach((row, i) => {
      let num = row.querySelector(':scope > .line-num');
      if (!num) {
        num = document.createElement('span');
        num.className = 'line-num';
        num.setAttribute('contenteditable', 'false');
        row.insertBefore(num, row.firstChild);
      }
      num.textContent = String(i + 1);
    });
  }

  function getCaretOffsetWithin(lineTextEl, range) {
    const r = range.cloneRange();
    r.selectNodeContents(lineTextEl);
    r.setEnd(range.startContainer, range.startOffset);
    return r.toString().length;
  }

  function placeCaretAtStart(el) {
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  }

  function placeCaretAtEnd(el, offset) {
    const r = document.createRange();
    const textNode = el.firstChild;
    if (textNode && textNode.nodeType === Node.TEXT_NODE) {
      r.setStart(textNode, Math.min(offset, textNode.textContent.length));
    } else {
      r.selectNodeContents(el);
    }
    r.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  }

  // Gan Enter/Backspace thu cong cho 1 khoi OCR/dich dang co the o che do
  // edit: bam Enter se tach dong hien tai thanh 2 hang (.line-row) rieng,
  // Backspace o dau dong se gop nguoc lai dong truoc do - roi danh lai so
  // thu tu. Chi la thao tac cau truc/dem hang, khong do pixel gi ca.
  // Luu y: dan (paste) nhieu dong cung luc chua duoc chuan hoa lai cau
  // truc, se duoc renumberLines() vao 'input' co gang danh lai so nhung
  // khong dam bao hoan hao 100% cho moi truong hop dan phuc tap.
  function attachLineEditing(container) {
    container.addEventListener('keydown', (e) => {
      if (container.getAttribute('contenteditable') !== 'true') return;
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      const node = range.startContainer;
      const lineTextEl = node.nodeType === Node.TEXT_NODE
        ? node.parentElement?.closest('.line-text')
        : node.closest?.('.line-text');
      if (!lineTextEl) return;

      if (e.key === 'Enter') {
        e.preventDefault();
        const row = lineTextEl.closest('.line-row');
        const fullText = lineTextEl.textContent;
        const caretOffset = getCaretOffsetWithin(lineTextEl, range);
        const before = fullText.slice(0, caretOffset);
        const after = fullText.slice(caretOffset);
        lineTextEl.textContent = before;

        const newRow = document.createElement('div');
        newRow.className = 'line-row';
        const newNum = document.createElement('span');
        newNum.className = 'line-num';
        newNum.setAttribute('contenteditable', 'false');
        const newTxt = document.createElement('span');
        newTxt.className = 'line-text';
        newTxt.textContent = after;
        newRow.appendChild(newNum);
        newRow.appendChild(newTxt);
        row.after(newRow);

        renumberLines(container);
        placeCaretAtStart(newTxt);
      } else if (e.key === 'Backspace') {
        const caretOffset = getCaretOffsetWithin(lineTextEl, range);
        if (caretOffset === 0 && sel.isCollapsed) {
          const row = lineTextEl.closest('.line-row');
          const prevRow = row.previousElementSibling;
          if (prevRow && prevRow.classList.contains('line-row')) {
            e.preventDefault();
            const prevTxt = prevRow.querySelector('.line-text');
            const mergeAt = prevTxt.textContent.length;
            prevTxt.textContent += lineTextEl.textContent;
            row.remove();
            renumberLines(container);
            placeCaretAtEnd(prevTxt, mergeAt);
          }
        }
      }
    });

    container.addEventListener('input', () => {
      if (container.getAttribute('contenteditable') === 'true') renumberLines(container);
    });
  }

  function computeCombinedText(kind) {
    let combined = '';
    uploadedImages.forEach((imageData, index) => {
      const value = kind === 'ocr' ? imageData.ocrResult : imageData.translationResult;
      if (value) {
        combined += (combined ? '\n\n' : '') + `=== ${imageData.file.name} ===\n${value}`;
      }
    });
    return combined;
  }

  function updateSummary() {
    const allOcr = computeCombinedText('ocr');
    const allTranslation = computeCombinedText('translation');
    const hasOcr = !!allOcr;
    const hasTranslation = !!allTranslation;

    if (!editingState['summary-ocr-all']) {
      summaryOcrAll.textContent = hasOcr ? allOcr : t('no_ocr');
      summaryOcrAll.classList.toggle('empty', !hasOcr);
    }
    if (!editingState['summary-translation-all']) {
      summaryTranslationAll.textContent = hasTranslation ? allTranslation : t('no_translation');
      summaryTranslationAll.classList.toggle('empty', !hasTranslation);
    }
    if (hasOcr || hasTranslation) summarySection.style.display = 'flex';
    else summarySection.style.display = 'none';
    renderNavFabList();
  }

  // Nap lai TOAN BO noi dung tu cac anh cho 1 cot (ocr/translation), bat ke
  // dang o edit mode hay co sua tay truoc do - dung khi bam nut reload.
  function reloadSummaryBlock(targetId, kind) {
    const target = document.getElementById(targetId);
    if (!target) return;

    if (editingState[targetId]) {
      editingState[targetId] = false;
      target.removeAttribute('contenteditable');
      target.classList.remove('editing');
      const editBtn = document.querySelector(`.edit-mode-btn[data-edit-target="${targetId}"]`);
      if (editBtn) { editBtn.textContent = t('edit_mode'); editBtn.classList.remove('active'); }
    }

    const combined = computeCombinedText(kind);
    const has = !!combined;
    target.textContent = has ? combined : (kind === 'ocr' ? t('no_ocr') : t('no_translation'));
    target.classList.toggle('empty', !has);
    if (has) summarySection.style.display = 'flex';
    renderNavFabList();
    showToast(t('reloaded'), 'success');
  }

  // ---------- version history helpers ----------
  // Gioi han so version luu toi da cho MOI loai (OCR/Translation) cua tung
  // anh - tranh file config phinh to vo han theo thoi gian su dung.
  const MAX_HISTORY_PER_TYPE = 50;

  // Goi ham nay NGAY TRUOC khi ghi de imageData.ocrResult/translationResult
  // bang noi dung moi (text), o TAT CA cac diem thay doi noi dung: OCR,
  // Refine OCR, Translate, Refine Translation, Done edit mode, va Get (ap
  // dung 1 version cu tu hop Vers). Ham se luu ban CU (truoc khi thay doi)
  // thanh 1 version moi trong lich su, roi phan goi ben ngoai moi ghi de
  // bang gia tri moi. Bo qua neu chua co noi dung cu (rong), hoac neu noi
  // dung cu giong het noi dung moi (khong co gi thay doi thi khong luu them).
  function pushVersionBeforeChange(imageData, type, newText) {
    if (!imageData) return;
    const isOcr = type === 'ocr';
    const oldText = isOcr ? imageData.ocrResult : imageData.translationResult;
    if (!oldText) return;
    if (newText !== undefined && oldText === newText) return;
    const history = isOcr ? imageData.ocrHistory : imageData.translationHistory;
    if (!history) return;
    history.push({ text: oldText, time: Date.now() });
    if (history.length > MAX_HISTORY_PER_TYPE) {
      history.splice(0, history.length - MAX_HISTORY_PER_TYPE);
    }
  }

  // ---------- single actions ----------
  async function processSingleOCR(index) {
    if (isProcessing) { showToast(t('please_wait'), 'warning'); return; }
    if (!(await ensureApiKeyOrWarn())) return;
    const imageData = uploadedImages[index];
    if (!imageData) return;
    isProcessing = true;
    retryQueueCancelled = false;
    setItemStatus(index, 'processing');
    try {
const text = await runOCR(imageData, index);
pushVersionBeforeChange(imageData, 'ocr', text);
imageData.ocrResult = text;
      setTextBlock(`ocr-${index}`, text);
      setItemStatus(index, 'completed');
      enableTranslateButton(index);
      enableRefineOcrButton(index);
      updateSummary();
      updateButtonsAndPlaceholder();
      scheduleSaveConfig();
      syncImageSectionHeightByIndex(index);
      showToast(t('ocr_done', { index: index + 1 }), 'success');
    } catch (err) {
      setTextBlock(`ocr-${index}`, `${t('error_prefix')}: ${err.message}`, true);
      setItemStatus(index, 'error');
      syncImageSectionHeightByIndex(index);
      showToast(t('ocr_error', { index: index + 1 }), 'error');
      logError(`OCR error on image ${index + 1} (${imageData.file?.name || ''}): ${err.message}`);
    } finally {
      isProcessing = false;
      hideRetryStopButton(index);
    }
  }

  // Refine OCR (1 anh) - "trau chuot" lai ket qua OCR da co, gui lai anh +
  // ban OCR hien tai de Gemini doi chieu ranh gioi bong thoai. Neu anh
  // chua co OCR thi KHONG lam gi ca (dung nhu yeu cau).
 async function processSingleRefineOcr(index) {
  if (isProcessing) { showToast(t('please_wait'), 'warning'); return; }
  const imageData = uploadedImages[index];
  if (!imageData) return;
  if (!imageData.ocrResult) { showToast(t('run_ocr_first'), 'warning'); return; }
  if (!(await ensureApiKeyOrWarn())) return;
  isProcessing = true;
  retryQueueCancelled = false;
  setItemStatus(index, 'processing');
  try {
    const oldText = imageData.ocrResult;
    const text = await runRefineOcr(imageData, index);
    const changedSegments = getChangedSegmentsForLines(oldText, text);
    pushVersionBeforeChange(imageData, 'ocr', text);
    imageData.ocrResult = text;
    setTextBlock(`ocr-${index}`, text, false, changedSegments);
    setItemStatus(index, 'completed');
    updateSummary();
    scheduleSaveConfig();
    syncImageSectionHeightByIndex(index);
    showToast(t('refine_ocr_done', { index: index + 1 }), 'success');
  } catch (err) {
    setItemStatus(index, 'error');
    showToast(t('refine_ocr_error', { index: index + 1 }), 'error');
    logError(`Refine OCR error on image ${index + 1} (${imageData.file?.name || ''}): ${err.message}`);
  } finally {
    isProcessing = false;
    hideRetryStopButton(index);
  }
}

  // Hop nhap prompt tuy chinh cho Refine Translation - gio hien inline trong
  // pill nav-fab-toggle (o nhap 1 dong + nut Cancel/Refine) thay vi mo modal
  // rieng giua man hinh voi textarea 4 dong. Tra ve string (co the rong ""
  // neu nguoi dung khong nhap gi va bam Refine), hoac null neu bam Cancel.
function showRefineTranslatePromptDialog() {
  return new Promise((resolve) => {
    // === THÊM: Xóa sạch autofill ===
    navFabPromptInput.value = '';
    navFabPromptInput.setAttribute('autocomplete', 'off');
    navFabPromptInput.setAttribute('autocorrect', 'off');
    navFabPromptInput.setAttribute('autocapitalize', 'off');
    navFabPromptInput.setAttribute('spellcheck', 'false');
    navFabPromptInput.setAttribute('data-lpignore', 'true');
    
    // === THÊM: Xóa gợi ý cũ trong bộ nhớ autofill ===
    // Ẩn/hiện để trình duyệt reset autofill
    navFabPromptInput.style.display = 'none';
    navFabPromptInput.offsetHeight; // trigger reflow
    navFabPromptInput.style.display = '';

    navFabPanel.classList.remove('open');
    navFabToggle.classList.remove('active');
    activePrompt = { resolve };
    navFab.classList.add('overlay-active');
    navFabScrim.classList.add('open');
    syncPillState();

    // Focus + select sau khi animation kết thúc
    setTimeout(() => {
      navFabPromptInput?.focus();
      navFabPromptInput?.select();
    }, 200);
  });
}

  function resolveRefineTranslatePromptDialog(result) {
    if (!activePrompt) return;
    const { resolve } = activePrompt;
    activePrompt = null;
    navFab.classList.remove('overlay-active');
    navFabScrim.classList.remove('open');
    syncPillState();
    resolve(result);
  }

  navFabPromptRunBtn.addEventListener('click', (e) => { e.stopPropagation(); resolveRefineTranslatePromptDialog(navFabPromptInput.value.trim()); });
  navFabPromptCancelBtn.addEventListener('click', (e) => { e.stopPropagation(); resolveRefineTranslatePromptDialog(null); });
navFabPromptInput.addEventListener('keydown', (e) => {
  e.stopPropagation(); // <--- thêm dòng này ở đầu
  if (e.key === 'Enter') { e.preventDefault(); resolveRefineTranslatePromptDialog(navFabPromptInput.value.trim()); }
  else if (e.key === 'Escape') { e.preventDefault(); resolveRefineTranslatePromptDialog(null); }
});

  // Refine Translation (1 anh) - gui lai anh + ban dich hien co, cho phep
  // nhap them prompt tuy chinh. Neu anh chua co ban dich thi bao loi giong
  // het hanh vi cua Refine OCR khi chua co OCR, va KHONG mo hop thoai nhap
  // prompt (dung nhu yeu cau).
  async function onRefineTranslateClick(index) {
    if (isProcessing) { showToast(t('please_wait'), 'warning'); return; }
    const imageData = uploadedImages[index];
    if (!imageData) return;
    syncEditedTextIfEditing(index);
    if (!imageData.translationResult) { showToast(t('run_translate_first'), 'warning'); return; }
    if (!(await ensureApiKeyOrWarn())) return;
    const userInstruction = await showRefineTranslatePromptDialog();
    if (userInstruction === null) return; // nguoi dung bam Cancel
    await processSingleRefineTranslate(index, userInstruction);
  }

async function processSingleRefineTranslate(index, userInstruction) {
  if (isProcessing) { showToast(t('please_wait'), 'warning'); return; }
  const imageData = uploadedImages[index];
  if (!imageData) return;
  syncEditedTextIfEditing(index);
  if (!imageData.translationResult) { showToast(t('run_translate_first'), 'warning'); return; }
  if (!(await ensureApiKeyOrWarn())) return;
  isProcessing = true;
  retryQueueCancelled = false;
  setItemStatus(index, 'processing');
  try {
    const oldText = imageData.translationResult;
    const text = await runRefineTranslate(imageData, index, userInstruction);
    const changedSegments = getChangedSegmentsForLines(oldText, text);
    pushVersionBeforeChange(imageData, 'translation', text);
    imageData.translationResult = text;
    setTextBlock(`translation-${index}`, text, false, changedSegments);
    setItemStatus(index, 'completed');
    updateSummary();
    scheduleSaveConfig();
    syncImageSectionHeightByIndex(index);
    showToast(t('refine_translate_done', { index: index + 1 }), 'success');
  } catch (err) {
    setItemStatus(index, 'error');
    showToast(t('refine_translate_error', { index: index + 1 }), 'error');
    logError(`Refine translation error on image ${index + 1} (${imageData.file?.name || ''}): ${err.message}`);
  } finally {
    isProcessing = false;
    hideRetryStopButton(index);
  }
}


  async function processSingleTranslate(index) {
    if (isProcessing) { showToast(t('please_wait'), 'warning'); return; }
    if (!(await ensureApiKeyOrWarn())) return;
    const imageData = uploadedImages[index];
    if (!imageData) return;
    if (!imageData.ocrResult) { showToast(t('run_ocr_first'), 'warning'); return; }
    isProcessing = true;
    retryQueueCancelled = false;
    setItemStatus(index, 'processing');
    try {
const text = await runTranslate(imageData, index);
pushVersionBeforeChange(imageData, 'translation', text);
imageData.translationResult = text;
      setTextBlock(`translation-${index}`, text);
      setItemStatus(index, 'completed');
      enableRefineTranslateButton(index);
      updateSummary();
      scheduleSaveConfig();
      syncImageSectionHeightByIndex(index);
      showToast(t('translate_done', { index: index + 1 }), 'success');
    } catch (err) {
      setTextBlock(`translation-${index}`, `${t('error_prefix')}: ${err.message}`, true);
      setItemStatus(index, 'error');
      syncImageSectionHeightByIndex(index);
      showToast(t('translate_error', { index: index + 1 }), 'error');
      logError(`Translation error on image ${index + 1} (${imageData.file?.name || ''}): ${err.message}`);
    } finally {
      isProcessing = false;
      hideRetryStopButton(index);
    }
  }

  // ---------- edit mode per image (OCR + translation of that image) ----------
  function ensureEditableLines(elId) {
    const el = document.getElementById(elId);
    if (!el || el.querySelector(':scope > .line-row')) return;
    el.innerHTML = '';
    el.classList.remove('empty');
    const row = document.createElement('div');
    row.className = 'line-row';
    const num = document.createElement('span');
    num.className = 'line-num';
    num.setAttribute('contenteditable', 'false');
    num.textContent = '1';
    const txt = document.createElement('span');
    txt.className = 'line-text';
    row.appendChild(num);
    row.appendChild(txt);
    el.appendChild(row);
  }

  function toggleItemEdit(index, btn) {
    const ocrEl = document.getElementById(`ocr-${index}`);
    const transEl = document.getElementById(`translation-${index}`);
    if (!ocrEl || !transEl) return;

    const editing = ocrEl.getAttribute('contenteditable') === 'true';
    if (editing) {
      ocrEl.removeAttribute('contenteditable');
      transEl.removeAttribute('contenteditable');
      ocrEl.classList.remove('editing');
      transEl.classList.remove('editing');

      const imageData = uploadedImages[index];
      const ocrText = stripEmptyLines(getPlainText(ocrEl).trim());
      const transText = stripEmptyLines(getPlainText(transEl).trim());
      if (imageData) {
        pushVersionBeforeChange(imageData, 'ocr', ocrText);
        pushVersionBeforeChange(imageData, 'translation', transText);
        imageData.ocrResult = ocrText;
        imageData.translationResult = transText;
      }
      btn.textContent = t('edit_mode');
      btn.classList.remove('active');
      renderTextBlock(`ocr-${index}`, ocrText, false);
      renderTextBlock(`translation-${index}`, transText, false);
      updateSummary();
      updateButtonsAndPlaceholder();
      scheduleSaveConfig();
      syncImageSectionHeightByIndex(index);
      showToast(t('saved_image', { index: index + 1 }), 'success');
    } else {
      ocrEl.setAttribute('contenteditable', 'true');
      transEl.setAttribute('contenteditable', 'true');
      ensureEditableLines(`ocr-${index}`);
      ensureEditableLines(`translation-${index}`);
      ocrEl.classList.add('editing');
      transEl.classList.add('editing');
      btn.textContent = t('save');
      btn.classList.add('active');
      ocrEl.focus();
      showToast(t('edit_mode_on'), 'info');
    }
  }

  // ---------- delete single ----------
  async function deleteSingleImage(index) {
    if (isProcessing) {
      showToast(t('cannot_delete_now'), 'warning');
      return;
    }
    const imageData = uploadedImages[index];
    if (!imageData) return;
    const confirmed = await showConfirmDialog(t('delete_confirm', { name: imageData.file.name }));
    if (confirmed) {
      uploadedImages.splice(index, 1);
      selectedUids.delete(imageData.uid);
      rebuildResultsList();
      updateButtonsAndPlaceholder();
      updateSummary();
      updateSelectionUI();
      scheduleSaveConfig();
      showToast(t('deleted'), 'info');
    }
  }

  // ---------- batch actions ----------
  // Nut tron nav-fab "dai ra" thanh vien thuoc chua progress bar trong luc
  // chay batch, roi tu tro ve hinh tron khi xong (xem CSS .nav-fab-toggle.processing).
  // Trong luc dai ra, nguoi dung van bam vao duoc de mo/dong panel danh sach binh thuong.
  function showBatchProgressUI() {
    pillIsProcessing = true;
    syncPillState();
  }
  function hideBatchProgressUI() {
    pillIsProcessing = false;
    syncPillState();
  }

  function updateBatchProgress(current, total) {
    batchCurrent.textContent = current;
    batchTotal.textContent = total;
    batchProgressFill.style.width = total > 0 ? `${(current / total) * 100}%` : '0%';
    if (current === total && total > 0) {
      setTimeout(hideBatchProgressUI, 1500);
    }
  }

  async function processBatch(kind, indices, userInstruction = '') {
    if (isProcessing || uploadedImages.length === 0) return;
    const targetIndices = Array.isArray(indices) && indices.length > 0
      ? indices.slice().sort((a, b) => a - b)
      : uploadedImages.map((_, i) => i);
    if ((kind === 'translate' || kind === 'refine-ocr') && !targetIndices.some(i => uploadedImages[i]?.ocrResult)) {
      showToast(t('run_ocr_first'), 'error');
      return;
    }
    if (kind === 'refine-translate' && !targetIndices.some(i => uploadedImages[i]?.translationResult)) {
      showToast(t('run_translate_first'), 'error');
      return;
    }
    if (!(await ensureApiKeyOrWarn())) return;
    isProcessing = true;
    stopRequested = false;
    retryQueueCancelled = false;
    ocrBatchBtn.disabled = true;
    translateBatchBtn.disabled = true;
    combinedBatchBtn.disabled = true;
    clearAllBtn.disabled = true;
    showBatchProgressUI();

    const kindLabel = kind === 'ocr' ? t('ocr') : kind === 'refine-ocr' ? t('refine_ocr') : kind === 'refine-translate' ? t('refine_translate') : t('translation');
    const isRefineKind = kind === 'refine-ocr' || kind === 'refine-translate';
    let done = 0;
    let skipped = 0;
    let stoppedEarly = false;
    for (let idx = 0; idx < targetIndices.length; idx++) {
      const i = targetIndices[idx];
      const imageData = uploadedImages[i];
      if (!imageData) { done++; updateBatchProgress(done, targetIndices.length); continue; }
      if ((kind === 'translate' || kind === 'refine-ocr') && !imageData.ocrResult) {
        done++; skipped++; updateBatchProgress(done, targetIndices.length); continue;
      }
      if (kind === 'refine-translate' && !imageData.translationResult) {
        done++; skipped++; updateBatchProgress(done, targetIndices.length); continue;
      }

      setItemStatus(i, 'processing');
      updateBatchProgress(done, targetIndices.length);
      try {
if (kind === 'ocr') {
  const text = await runOCR(imageData, i);
  pushVersionBeforeChange(imageData, 'ocr', text);
  imageData.ocrResult = text;
  setTextBlock(`ocr-${i}`, text);
  enableTranslateButton(i);
  enableRefineOcrButton(i);
} 
else if (kind === 'refine-ocr') {
  const oldText = imageData.ocrResult;
  const text = await runRefineOcr(imageData, i);
  const changedSegments = getChangedSegmentsForLines(oldText, text);
  pushVersionBeforeChange(imageData, 'ocr', text);
  imageData.ocrResult = text;
  setTextBlock(`ocr-${i}`, text, false, changedSegments);
}
else if (kind === 'refine-translate') {
  syncEditedTextIfEditing(i);
  const oldText = imageData.translationResult;
  const text = await runRefineTranslate(imageData, i, userInstruction);
  const changedSegments = getChangedSegmentsForLines(oldText, text);
  pushVersionBeforeChange(imageData, 'translation', text);
  imageData.translationResult = text;
  setTextBlock(`translation-${i}`, text, false, changedSegments);
}
else {
  const text = await runTranslate(imageData, i);
  pushVersionBeforeChange(imageData, 'translation', text);
  imageData.translationResult = text;
  setTextBlock(`translation-${i}`, text);
  enableRefineTranslateButton(i);
}       setItemStatus(i, 'completed');
        updateSummary();
      } catch (err) {
        if (!isRefineKind) {
          setTextBlock(kind === 'ocr' ? `ocr-${i}` : `translation-${i}`, `${t('error_prefix')}: ${err.message}`, true);
        }
        setItemStatus(i, 'error');
        logError(`${kindLabel} error on image ${i + 1} (${imageData.file?.name || ''}): ${err.message}`);
      }
      done++;
      updateBatchProgress(done, targetIndices.length);
      scheduleSaveConfig();
      hideRetryStopButton(i);
      syncImageSectionHeightByIndex(i);
      if (stopRequested) { stoppedEarly = true; break; }
      if (idx < targetIndices.length - 1) await sleep(API_DELAY_MS);
    }

    isProcessing = false;
    stopRequested = false;
    ocrBatchBtn.disabled = false;
    combinedBatchBtn.disabled = false;
    clearAllBtn.disabled = false;
    updateButtonsAndPlaceholder(); // tinh lai translateBatchBtn.disabled dua tren hasOcr
    if (stoppedEarly) {
      hideBatchProgressUI();
      showToast(t('stopped', { done, total: targetIndices.length }), 'info');
    } else {
      const skippedReason = kind === 'refine-translate' ? 'no translation yet' : 'no OCR yet';
      const skippedNote = skipped > 0 ? ` (${skipped} skipped, ${skippedReason})` : '';
      showToast(t('batch_done', { kind: kindLabel, done: done - skipped }) + skippedNote, 'success');
    }
  }

  async function processCombinedBatch() {
    if (isProcessing || uploadedImages.length === 0) return;
    if (!(await ensureApiKeyOrWarn())) return;
    isProcessing = true;
    stopRequested = false;
    retryQueueCancelled = false;
    ocrBatchBtn.disabled = true;
    translateBatchBtn.disabled = true;
    combinedBatchBtn.disabled = true;
    clearAllBtn.disabled = true;
    showBatchProgressUI();

    let done = 0;
    let stoppedEarly = false;
    for (let i = 0; i < uploadedImages.length; i++) {
      const imageData = uploadedImages[i];
      setItemStatus(i, 'processing');
      updateBatchProgress(done, uploadedImages.length);

      try {
        const ocrText = await runOCR(imageData, i);
        pushVersionBeforeChange(imageData, 'ocr', ocrText);
        imageData.ocrResult = ocrText;
        setTextBlock(`ocr-${i}`, ocrText);
        enableTranslateButton(i);
        enableRefineOcrButton(i);
        updateSummary();

        await sleep(API_DELAY_MS);

        const translatedText = await runTranslate(imageData, i);
        pushVersionBeforeChange(imageData, 'translation', translatedText);
        imageData.translationResult = translatedText;
        setTextBlock(`translation-${i}`, translatedText);
        setItemStatus(i, 'completed');
        enableRefineTranslateButton(i);
        updateSummary();
      } catch (err) {
        if (!imageData.ocrResult) {
          setTextBlock(`ocr-${i}`, `${t('error_prefix')}: ${err.message}`, true);
        } else {
          setTextBlock(`translation-${i}`, `${t('error_prefix')}: ${err.message}`, true);
        }
        setItemStatus(i, 'error');
        logError(`OCR+Translate error on image ${i + 1} (${imageData.file?.name || ''}): ${err.message}`);
      }

      done++;
      updateBatchProgress(done, uploadedImages.length);
      scheduleSaveConfig();
      hideRetryStopButton(i);
      syncImageSectionHeightByIndex(i);
      if (stopRequested) { stoppedEarly = true; break; }
      if (i < uploadedImages.length - 1) await sleep(API_DELAY_MS);
    }

    isProcessing = false;
    stopRequested = false;
    ocrBatchBtn.disabled = false;
    combinedBatchBtn.disabled = false;
    clearAllBtn.disabled = false;
    updateButtonsAndPlaceholder(); // tinh lai translateBatchBtn.disabled dua tren hasOcr
    if (stoppedEarly) {
      hideBatchProgressUI();
      showToast(t('stopped', { done, total: uploadedImages.length }), 'info');
    } else {
      showToast(t('combined_done', { done }), 'success');
    }
  }

  ocrBatchBtn.addEventListener('click', async () => {
    const langName = langDisplayName(sourceLangSelect.value);
    const confirmed = await showConfirmDialog(t('ocr_source_confirm', { source: langName }), t('continue_btn'), t('cancel_btn'));
    if (!confirmed) return;
    processBatch('ocr');
  });
  translateBatchBtn.addEventListener('click', async () => {
    const sourceName = langDisplayName(sourceLangSelect.value);
    const targetName = langDisplayName(targetLangSelect.value);
    const confirmed = await showConfirmDialog(t('translate_source_target_confirm', { source: sourceName, target: targetName }), t('continue_btn'), t('cancel_btn'));
    if (!confirmed) return;
    processBatch('translate');
  });
  combinedBatchBtn.addEventListener('click', async () => {
    const sourceName = langDisplayName(sourceLangSelect.value);
    const targetName = langDisplayName(targetLangSelect.value);
    const confirmed = await showConfirmDialog(t('ocr_translate_confirm', { source: sourceName, target: targetName }), t('continue_btn'), t('cancel_btn'));
    if (!confirmed) return;
    processCombinedBatch();
  });

  batchStopBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!isProcessing || stopRequested) return;
    const confirmed = await showConfirmDialog(t('stop_queue_confirm'));
    if (confirmed) {
      stopRequested = true;
      showToast(t('stopping'), 'info');
    }
  });

  // ---------- upload (file picker + drag & drop) ----------
  function rebuildResultsList() {
    mangaResults.innerHTML = '';
    uploadedImages.forEach((imageData, i) => {
      mangaResults.appendChild(createMangaItem(imageData, i));
      // Quan trong: rebuildResultsList() ve lai TOAN BO DOM tu dau, va
      // createMangaItem() luon khoi tao badge mac dinh la "idle". Neu khong
      // set lai o day, cac anh CU da OCR/dich xong tu truoc se bi "tut" ve
      // trang thai idle tren giao dien (nhin nhu mat du lieu) moi khi co
      // anh moi duoc them vao (rebuildResultsList() chay lai lan nua).
      if (imageData.translationResult || imageData.ocrResult) setItemStatus(i, 'completed');
    });
    renderNavFabList();
    syncAllImageSectionHeights();
  }

  // ---------- selection (chon anh cu the de xu ly rieng) ----------
  function toggleImageSelection(uid, checked) {
    if (checked) selectedUids.add(uid);
    else selectedUids.delete(uid);
    syncSelectionCheckboxes();
    updateSelectionUI();
  }

  function getSelectedIndices() {
    const indices = [];
    uploadedImages.forEach((img, i) => { if (selectedUids.has(img.uid)) indices.push(i); });
    return indices;
  }

  function syncSelectionCheckboxes() {
    uploadedImages.forEach((img, i) => {
      const checked = selectedUids.has(img.uid);
      const cardCb = mangaResults.querySelector(`[data-index="${i}"] .item-select-checkbox`);
      if (cardCb) cardCb.checked = checked;
      const navItem = document.querySelector(`.nav-fab-item[data-index="${i}"]`);
      if (navItem) {
        navItem.classList.toggle('selected', checked);
        const navCb = navItem.querySelector('.nav-checkbox');
        if (navCb) navCb.checked = checked;
      }
    });
  }

  function updateSelectionUI() {
    const count = selectedUids.size;
    if (count > 0) {
      selectionBar.style.display = 'flex';
      selectionCountEl.textContent = count;
      navFabSelectionHead.style.display = 'flex';
      navFabSelectionCount.textContent = t('selection_count', { count });
    } else {
      selectionBar.style.display = 'none';
      navFabSelectionHead.style.display = 'none';
    }
  }

  function clearSelection() {
    if (selectedUids.size === 0) return;
    selectedUids.clear();
    syncSelectionCheckboxes();
    updateSelectionUI();
  }

async function clearSelectedImages() {
  if (selectedUids.size === 0) {
    showToast(t('no_images_selected'), 'info');
    return;
  }

  // Xác nhận xóa trên pill (đã hỗ trợ Enter/Esc)
  const confirmed = await showConfirmDialog(t('clear_selected_confirm'), t('yes_btn'), t('no_btn'));
  if (!confirmed) return;

  // Lấy danh sách các index cần xóa
  const indicesToRemove = [];
  uploadedImages.forEach((img, i) => {
    if (selectedUids.has(img.uid)) indicesToRemove.push(i);
  });

  // Xóa từ cuối lên để tránh ảnh hưởng đến chỉ số
  indicesToRemove.sort((a, b) => b - a);
  for (const idx of indicesToRemove) {
    uploadedImages.splice(idx, 1);
  }

  // Xóa sạch selection
  selectedUids.clear();

  // Cập nhật giao diện
  rebuildResultsList();
  updateButtonsAndPlaceholder();
  updateSummary();
  updateSelectionUI();
  scheduleSaveConfig();

  showToast(t('cleared_count', { count: indicesToRemove.length }), 'success');
}


  function selectAll() {
    if (uploadedImages.length === 0) return;
    uploadedImages.forEach((img) => selectedUids.add(img.uid));
    syncSelectionCheckboxes();
    updateSelectionUI();
  }

  selectionOcrBtn.addEventListener('click', async () => {
    const indices = getSelectedIndices();
    if (indices.length === 0) return;
    const langName = langDisplayName(sourceLangSelect.value);
    const confirmed = await showConfirmDialog(t('ocr_confirm', { source: langName, count: indices.length }), t('continue_btn'), t('cancel_btn'));
    if (!confirmed) return;
    processBatch('ocr', indices);
  });
  selectionRefineBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    document.querySelectorAll('.refine-menu.open').forEach(m => { if (m !== selectionRefineMenu) m.classList.remove('open'); });
    document.querySelectorAll('.export-menu.open').forEach(m => m.classList.remove('open'));
    selectionRefineMenu.classList.toggle('open');
  });
  selectionRefineMenu.addEventListener('click', (e) => e.stopPropagation());
  selectionRefineOcrBtn.addEventListener('click', async () => {
    selectionRefineMenu.classList.remove('open');
    const indices = getSelectedIndices();
    if (indices.length === 0) return;
    const eligible = indices.filter(i => uploadedImages[i]?.ocrResult);
    if (eligible.length === 0) {
      showToast(t('run_ocr_first'), 'error');
      return;
    }
    const confirmed = await showConfirmDialog(t('refine_ocr_confirm', { count: eligible.length }), t('continue_btn'), t('cancel_btn'));
    if (!confirmed) return;
    processBatch('refine-ocr', indices);
  });
  selectionRefineTranslateBtn.addEventListener('click', async () => {
    selectionRefineMenu.classList.remove('open');
    const indices = getSelectedIndices();
    if (indices.length === 0) return;
    indices.forEach(i => syncEditedTextIfEditing(i));
    const eligible = indices.filter(i => uploadedImages[i]?.translationResult);
    if (eligible.length === 0) {
      showToast(t('run_translate_first'), 'error');
      return;
    }
    const userInstruction = await showRefineTranslatePromptDialog();
    if (userInstruction === null) return; // nguoi dung bam Cancel
    const confirmed = await showConfirmDialog(t('refine_translate_confirm', { count: eligible.length }), t('continue_btn'), t('cancel_btn'));
    if (!confirmed) return;
    processBatch('refine-translate', indices, userInstruction);
  });
  selectionTranslateBtn.addEventListener('click', async () => {
    const indices = getSelectedIndices();
    if (indices.length === 0) return;
    const sourceName = langDisplayName(sourceLangSelect.value);
    const targetName = langDisplayName(targetLangSelect.value);
    const confirmed = await showConfirmDialog(t('translate_confirm', { source: sourceName, target: targetName, count: indices.length }), t('continue_btn'), t('cancel_btn'));
    if (!confirmed) return;
    processBatch('translate', indices);
  });
  selectionCancelBtn.addEventListener('click', clearSelection);
  navFabSelectionAll.addEventListener('click', selectAll);
  navFabSelectionClear.addEventListener('click', clearSelectedImages);

  // ---------- floating nav (jump to top/bottom, jump to a specific image) ----------
  function renderNavFabList() {
    const listEl = document.getElementById('nav-fab-list');
    if (!listEl) return;
    listEl.innerHTML = '';

    if (uploadedImages.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'nav-fab-list-empty';
      empty.textContent = t('no_images');
      listEl.appendChild(empty);
      updateNavFabErrorBadge(0);
      return;
    }

    let errorCount = 0;
    uploadedImages.forEach((imageData, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'nav-fab-item';
      btn.dataset.index = i;

      const item = mangaResults.querySelector(`[data-index="${i}"]`);
      if (item) {
        if (item.classList.contains('processing')) btn.classList.add('processing');
        else if (item.classList.contains('completed')) btn.classList.add('completed');
        else if (item.classList.contains('error')) { btn.classList.add('error'); errorCount++; }
      }
      if (selectedUids.has(imageData.uid)) btn.classList.add('selected');

      const dot = document.createElement('span');
      dot.className = 'nav-fab-item-dot';
      const label = document.createElement('span');
      label.className = 'nav-fab-item-label';
      label.textContent = t('nav_image_label', { index: i + 1 });
      const navCb = document.createElement('input');
      navCb.type = 'checkbox';
      navCb.className = 'select-checkbox nav-checkbox';
      navCb.title = t('select_this_image');
      navCb.checked = selectedUids.has(imageData.uid);
      navCb.addEventListener('click', (e) => e.stopPropagation());
      navCb.addEventListener('change', (e) => toggleImageSelection(imageData.uid, e.currentTarget.checked));
      btn.appendChild(dot);
      btn.appendChild(label);
      btn.appendChild(navCb);

      btn.addEventListener('click', () => {
        const target = mangaResults.querySelector(`[data-index="${i}"]`);
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });

      listEl.appendChild(btn);
    });
    updateNavFabErrorBadge(errorCount);

    if (summarySection.style.display !== 'none') {
      const divider = document.createElement('div');
      divider.className = 'nav-fab-divider';
      listEl.appendChild(divider);

      const sBtn = document.createElement('button');
      sBtn.type = 'button';
      sBtn.className = 'nav-fab-item nav-fab-item-summary';
      const sDot = document.createElement('span');
      sDot.className = 'nav-fab-item-dot';
      const sLabel = document.createElement('span');
      sLabel.textContent = t('summary_nav');
      sBtn.appendChild(sDot);
      sBtn.appendChild(sLabel);
      sBtn.addEventListener('click', () => {
        summarySection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      listEl.appendChild(sBtn);
    }
  }

  // ---------- badge loi tren nut tron + nhay toi anh loi ----------
  // errorJumpCursor: nho da nhay toi anh loi thu may trong lan bam gan
  // nhat, de lan bam TIEP THEO nhay sang anh loi ke tiep (xoay vong het
  // roi quay lai anh loi dau) thay vi cu bam la nhay ve anh loi dau tien.
  let errorJumpCursor = -1;
  const navFabErrorBadgeEl = document.getElementById('nav-fab-error-badge');

  function updateNavFabErrorBadge(errorCount) {
    if (!navFabErrorBadgeEl) return;
    if (errorCount > 0) {
      navFabErrorBadgeEl.textContent = errorCount > 99 ? '99+' : String(errorCount);
      navFabErrorBadgeEl.title = errorCount === 1
        ? t('jump_to_error_image')
        : t('jump_to_error_images', { count: errorCount });
      navFabErrorBadgeEl.classList.add('show');
    } else {
      navFabErrorBadgeEl.classList.remove('show');
      errorJumpCursor = -1; // het loi -> reset, lan sau co loi moi thi bat dau lai tu anh dau
    }
  }

  function jumpToNextErrorImage() {
    const errorItems = Array.from(mangaResults.querySelectorAll('.manga-item.error'));
    if (errorItems.length === 0) return;
    errorJumpCursor = (errorJumpCursor + 1) % errorItems.length;
    const target = errorItems[errorJumpCursor];
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.remove('jump-flash');
    void target.offsetWidth; // ep reflow de restart animation neu bam lien tuc vao cung 1 anh
    target.classList.add('jump-flash');
    target.addEventListener('animationend', () => target.classList.remove('jump-flash'), { once: true });
  }

  if (navFabErrorBadgeEl) {
    navFabErrorBadgeEl.addEventListener('click', (e) => {
      e.stopPropagation(); // khong duoc lam pill toggle mo/dong panel danh sach
      jumpToNextErrorImage();
    });
  }

  const navFab = document.getElementById('nav-fab');
  const navFabToggle = document.getElementById('nav-fab-toggle');
  const navFabPanel = document.getElementById('nav-fab-panel');
  const navFabTop = document.getElementById('nav-fab-top');
  const navFabBottom = document.getElementById('nav-fab-bottom');

  navFabToggle.addEventListener('click', () => {
    if (activeConfirm || activePrompt) return; // pill dang ban de hoi Yes/No hoac nhap prompt
    navFabPanel.classList.toggle('open');
    navFabToggle.classList.toggle('active');
  });

  // navFabToggle gio la <div role="button">, khong con la <button> that
  // (de long duoc nut Stop ben trong) - can tu them ho tro ban phim.
navFabToggle.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return; // <--- thêm dòng này ở đầu
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    navFabToggle.click();
  }
});

  // Esc de dong nhanh confirm/prompt dang mo trong pill, giong hanh vi quen
  // thuoc cua hop thoai (khong resolve gi voi confirm -> tinh la No/huy).
document.addEventListener('keydown', (e) => {
  const ctrl = e.ctrlKey || e.metaKey;
  const shift = e.shiftKey;

  // Ctrl+O: mở file picker
  if (ctrl && !shift && (e.key === 'o' || e.key === 'O')) {
    e.preventDefault();
    if (imageInput) imageInput.click();
    return;
  }
// Ctrl+Shift+C: Clear all images
if (ctrl && shift && (e.key === 'c' || e.key === 'C')) {
  e.preventDefault();
  if (uploadedImages.length === 0) {
    showToast(t('no_images_to_clear'), 'warning');
    return;
  }
  clearAllBtn.click(); // Kích hoạt nút Clear all
  return;
}
  // Ctrl+Shift+O: OCR all
  if (ctrl && shift && (e.key === 'o' || e.key === 'O')) {
    e.preventDefault();
    if (uploadedImages.length === 0) {
      showToast(t('no_images_to_ocr'), 'warning');
      return;
    }
    ocrBatchBtn.click();
    return;
  }
// Ctrl+Shift+A: Select all images
if (ctrl && shift && (e.key === 'a' || e.key === 'A')) {
  e.preventDefault();
  if (uploadedImages.length === 0) return;
  selectAll();
  return;
}
  // Ctrl+Shift+T: Translate all
  if (ctrl && shift && (e.key === 't' || e.key === 'T')) {
    e.preventDefault();
    if (uploadedImages.length === 0) {
      showToast(t('no_images_to_translate'), 'warning');
      return;
    }
    const hasOcr = uploadedImages.some(img => img.ocrResult);
    if (!hasOcr) {
      showToast(t('run_ocr_first'), 'error');
      return;
    }
    translateBatchBtn.click();
    return;
  }
// Ctrl+Shift+D: Deselect all
if (ctrl && shift && (e.key === 'd' || e.key === 'D')) {
  e.preventDefault();
  clearSelection();
  return;
}
  // Ctrl+Shift+R: Refine Translation all (có prompt)
  if (ctrl && shift && (e.key === 'r' || e.key === 'R')) {
    e.preventDefault();
    if (uploadedImages.length === 0) {
      showToast(t('no_images'), 'warning');
      return;
    }
    const hasTranslation = uploadedImages.some(img => img.translationResult);
    if (!hasTranslation) {
      showToast(t('run_translate_first'), 'error');
      return;
    }
    // Mở prompt refine translation
    onRefineTranslateClickAll(); // Hàm mới
    return;
  }  if (e.key === 'Enter') {
    if (activeConfirm) {
      e.preventDefault();
      resolveConfirmDialog(true);
    }
    return;
  }
  if (e.key !== 'Escape') return;
  if (activeConfirm) resolveConfirmDialog(false);
  else if (activePrompt) resolveRefineTranslatePromptDialog(null);
});

  navFabTop.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  navFabBottom.addEventListener('click', () => {
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  });

  document.addEventListener('click', (e) => {
    if (!navFabPanel.classList.contains('open')) return;
    if (e.target.closest('#nav-fab')) return;
    navFabPanel.classList.remove('open');
    navFabToggle.classList.remove('active');
  });

  function updateButtonsAndPlaceholder() {
    if (uploadedImages.length === 0) {
      ocrBatchBtn.disabled = true;
      translateBatchBtn.disabled = true;
      combinedBatchBtn.disabled = true;
      clearAllBtn.disabled = true;
      placeholder.style.display = 'block';
      summarySection.style.display = 'none';
      hideBatchProgressUI();
    } else {
      ocrBatchBtn.disabled = false;
      combinedBatchBtn.disabled = false;
      clearAllBtn.disabled = false;
      const hasOcr = uploadedImages.some(i => i.ocrResult);
      translateBatchBtn.disabled = !hasOcr;
      placeholder.style.display = 'none';
    }
  }

  // Doc file thanh dataUrl (base64) - dung chung cho moi anh them vao.
  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = () => reject(reader.error || new Error(t('could_not_read_file')));
      reader.readAsDataURL(file);
    });
  }

  async function handleNewFiles(fileList) {
    let files = Array.from(fileList).filter(f => f.type.startsWith('image/'));
    if (files.length === 0) {
      showToast(t('images_only'), 'error');
      return;
    }

    // Chong trung: neu anh (cung ten + cung dung luong byte) da co san trong
    // danh sach hien tai thi bo qua, khong tao them entry moi giong het.
    const existingKeys = new Set(uploadedImages.map(img => `${img.file?.name}|${img.file?.size}`));
    const duplicateNames = [];
    files = files.filter((file) => {
      const key = `${file.name}|${file.size}`;
      if (existingKeys.has(key)) { duplicateNames.push(file.name); return false; }
      existingKeys.add(key); // tranh trung ngay trong cung 1 lan tha nhieu file giong nhau
      return true;
    });
    if (files.length === 0) {
      showToast(t('skipped_duplicates', { count: duplicateNames.length }), 'warning', 4000);
      return;
    }

    if (uploadedImages.length + files.length > MAX_IMAGES) {
      showToast(t('max_images', { max: MAX_IMAGES }), 'error');
      return;
    }
    files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

    placeholder.style.display = 'none';
    if (files.length > 10) showToast(t('preparing', { count: files.length }), 'info', 3000);

    const restoredNames = [];
    const temp = await Promise.all(files.map(async (file) => {
      const dataUrl = await readFileAsDataUrl(file);
      const restoreKey = `${file.name}|${file.size}`;
      const restored = pendingRestoreMap.get(restoreKey);
      if (restored) {
        pendingRestoreMap.delete(restoreKey);
        restoredNames.push(file.name);
      }
return {
  uid: ++uidCounter,
  dataUrl,
  file,
  ocrResult: restored?.ocrResult || '',
  translationResult: restored?.translationResult || '',
  ocrHistory: Array.isArray(restored?.ocrHistory) ? restored.ocrHistory.slice() : [],
  translationHistory: Array.isArray(restored?.translationHistory) ? restored.translationHistory.slice() : []
};
    }));

    uploadedImages = uploadedImages.concat(temp);
    rebuildResultsList();
    updateButtonsAndPlaceholder();
    if (restoredNames.length > 0) updateSummary();
    scheduleSaveConfig();

    showToast(t('added_images', { count: files.length }), 'success');
    if (duplicateNames.length > 0) {
      showToast(t('skipped_duplicates', { count: duplicateNames.length }), 'warning', 4000);
    }
    if (restoredNames.length > 0) {
      showToast(t('restored_images', { count: restoredNames.length }), 'info', 4000);
    }
    if (pendingRestoreMap.size > 0 && restoredNames.length > 0) {
      showToast(t('unmatched_cache', { count: pendingRestoreMap.size }), 'warning', 4000);
    }
  }

  imageInput.addEventListener('change', (event) => {
    if (event.target.files.length === 0) return;
    handleNewFiles(event.target.files);
    imageInput.value = '';
  });

  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => e.preventDefault());

  const dropzone = document.getElementById('dropzone');
  let dragCounter = 0;

  dropzone.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragCounter++;
    dropzone.classList.add('drag-over');
  });
  dropzone.addEventListener('dragover', (e) => e.preventDefault());
  dropzone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      dropzone.classList.remove('drag-over');
    }
  });
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dragCounter = 0;
    dropzone.classList.remove('drag-over');
    if (e.dataTransfer?.files?.length) handleNewFiles(e.dataTransfer.files);
  });

  async function clearAll() {
    if (isProcessing) {
      showToast(t('cannot_clear_now'), 'warning');
      return;
    }
    if (uploadedImages.length === 0) return;
    const confirmed = await showConfirmDialog(t('delete_all_confirm'));
    if (confirmed) {
      uploadedImages = [];
      selectedUids.clear();
      mangaResults.innerHTML = '';
      summarySection.style.display = 'none';
      placeholder.style.display = 'block';
      hideBatchProgressUI();
      ocrBatchBtn.disabled = true;
      translateBatchBtn.disabled = true;
      combinedBatchBtn.disabled = true;
      clearAllBtn.disabled = true;
      renderNavFabList();
      updateSelectionUI();
      scheduleSaveConfig();
      showToast(t('cleared_all'), 'info');
    }
  }
  clearAllBtn.addEventListener('click', clearAll);

  // ---------- reload summary from all images ----------
  document.querySelectorAll('.summary-reload-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.reloadTarget;
      const kind = targetId === 'summary-ocr-all' ? 'ocr' : 'translation';
      reloadSummaryBlock(targetId, kind);
    });
  });

  // ---------- edit mode (summary OCR / translation) ----------
  document.querySelectorAll('.edit-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.editTarget;
      const target = document.getElementById(targetId);
      if (!target) return;
      const isEditing = editingState[targetId];
      if (isEditing) {
        editingState[targetId] = false;
        target.removeAttribute('contenteditable');
        target.classList.remove('editing');
        btn.textContent = t('edit_mode');
        btn.classList.remove('active');
        showToast(t('save'), 'success');
      } else {
        editingState[targetId] = true;
        target.setAttribute('contenteditable', 'true');
        target.classList.remove('empty');
        target.classList.add('editing');
        target.focus();
        btn.textContent = t('save');
        btn.classList.add('active');
        showToast(t('edit_mode_on'), 'info');
      }
    });
  });

  // ---------- export (txt / docx) ----------
  document.querySelectorAll('.export-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const menu = btn.nextElementSibling;
      document.querySelectorAll('.export-menu.open').forEach(m => { if (m !== menu) m.classList.remove('open'); });
      menu.classList.toggle('open');
    });
  });
  document.addEventListener('click', () => {
    document.querySelectorAll('.export-menu.open').forEach(m => m.classList.remove('open'));
    document.querySelectorAll('.image-size-menu.open').forEach(m => m.classList.remove('open'));
    document.querySelectorAll('.image-size-btn.active').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.refine-menu.open').forEach(m => m.classList.remove('open'));
  });

  document.querySelectorAll('.export-option').forEach(opt => {
    opt.addEventListener('click', async (e) => {
      e.stopPropagation();
      const dropdown = opt.closest('.export-dropdown');
      const exportBtn = dropdown.querySelector('.export-btn');
      const menu = dropdown.querySelector('.export-menu');
      menu.classList.remove('open');

      const targetId = exportBtn.dataset.exportTarget;
      const suggestedName = exportBtn.dataset.exportName || 'export';
      const format = opt.dataset.format;
      const target = document.getElementById(targetId);
      const content = target ? target.innerText.trim() : '';

      if (!content) { showToast(t('no_content'), 'warning'); return; }

      try {
        const saved = await window.fileExport.save(content, format, suggestedName);
        if (saved) showToast(t('exported', { format }), 'success');
      } catch (err) {
        showToast(t('export_failed'), 'error');
        logError(`Export error (${format}, ${suggestedName}): ${err?.message || err}`);
      }
    });
  });

function adjustFabPanelDirection() {
  const panel = document.getElementById('nav-fab-panel');
  const toggle = document.getElementById('nav-fab-toggle');
  if (!panel || !toggle) return;

  // Đảm bảo panel tạm hiển thị để đo chiều cao (nếu đang ẩn)
  const wasOpen = panel.classList.contains('open');
  if (!wasOpen) {
    panel.style.visibility = 'hidden';
    panel.style.display = 'flex'; // hoặc 'flex' đúng với CSS
  }

  const toggleRect = toggle.getBoundingClientRect();
  const panelHeight = panel.scrollHeight; // chiều cao thật của panel
  const spaceAbove = toggleRect.top;
  const spaceBelow = window.innerHeight - toggleRect.bottom;
  const GAP = 10; // khoảng cách với mép màn hình

  if (spaceBelow >= panelHeight + GAP) {
    // Mở xuống dưới
    panel.style.top = '100%';
    panel.style.bottom = 'auto';
    panel.style.marginTop = '8px';
    panel.style.marginBottom = '0';
  } else {
    // Mở lên trên
    panel.style.top = 'auto';
    panel.style.bottom = '100%';
    panel.style.marginTop = '0';
    panel.style.marginBottom = '8px';
  }

  if (!wasOpen) {
    panel.style.display = '';
    panel.style.visibility = '';
  }
}

// Gọi mỗi khi mở panel
navFabToggle.addEventListener('click', () => {
  if (activeConfirm || activePrompt) return;
  // ... code cũ (toggle class) ...
  // Sau khi toggle class 'open', gọi:
  if (navFabPanel.classList.contains('open')) {
    setTimeout(adjustFabPanelDirection, 10);
  }
});

// Cập nhật hướng khi kéo nút hoặc resize cửa sổ
window.addEventListener('resize', adjustFabPanelDirection);
// Và khi kết thúc kéo thả (trong onDragEnd) thêm một dòng:
adjustFabPanelDirection();


  // ---------- copy ----------
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.copy-btn');
    if (!btn) return;
    const target = document.getElementById(btn.dataset.copyTarget);
    const plain = target ? getPlainText(target).trim() : '';
    if (plain) {
      navigator.clipboard.writeText(plain)
        .then(() => showToast(t('copied'), 'success'))
        .catch(err => showToast(t('copy_failed'), 'error'));
    }
  });

  // ---------- info modal: API usage stats + error logs ----------
  function openInfoModal(title) {
    infoModalTitle.textContent = title;
    infoModal.style.display = 'flex';
  }
  infoModalClose.addEventListener('click', () => { infoModal.style.display = 'none'; });
  infoModal.addEventListener('click', (e) => {
    if (e.target === infoModal) infoModal.style.display = 'none';
  });

  function renderUsageModal() {
    const { totalCalls, successCalls, failedCalls } = usageStats;
    infoModalBody.innerHTML = `
      <div class="usage-stats-grid">
        <div class="usage-stat-card">
          <div class="usage-stat-value">${totalCalls}</div>
          <div class="usage-stat-label">${t('usage_total_calls')}</div>
        </div>
        <div class="usage-stat-card success">
          <div class="usage-stat-value">${successCalls}</div>
          <div class="usage-stat-label">${t('usage_success')}</div>
        </div>
        <div class="usage-stat-card errors">
          <div class="usage-stat-value">${failedCalls}</div>
          <div class="usage-stat-label">${t('usage_failed')}</div>
        </div>
      </div>
      <p class="usage-note">${t('usage_note')}</p>
      <div class="info-modal-actions">
        <button type="button" id="usage-reset-btn" class="btn btn-danger">${t('reset_counter')}</button>
      </div>
    `;
    document.getElementById('usage-reset-btn').addEventListener('click', async () => {
      const confirmed = await showConfirmDialog(t('reset_usage_confirm'));
      if (!confirmed) return;
      usageStats = { totalCalls: 0, successCalls: 0, failedCalls: 0 };
      scheduleSaveConfig();
      infoModal.style.display = 'none';
      showToast(t('usage_reset'), 'info');
    });
  }

  function renderLogsModal() {
    if (errorLogs.length === 0) {
      infoModalBody.innerHTML = `<div class="log-list-empty">${t('no_errors')}</div>`;
      return;
    }
    const rows = errorLogs.map((entry) => {
      let timeStr = entry.time;
      try { timeStr = new Date(entry.time).toLocaleString(); } catch (_) {}
      const safeMsg = String(entry.message).replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return `<div class="log-entry"><div class="log-entry-time">${timeStr}</div><div class="log-entry-msg">${safeMsg}</div></div>`;
    }).join('');
    infoModalBody.innerHTML = `
      <div class="log-list">${rows}</div>
      <div class="info-modal-actions">
        <button type="button" id="logs-clear-btn" class="btn btn-danger">${t('clear_logs_btn')}</button>
      </div>
    `;
    document.getElementById('logs-clear-btn').addEventListener('click', async () => {
      const confirmed = await showConfirmDialog(t('clear_logs_confirm'));
      if (!confirmed) return;
      errorLogs = [];
      scheduleSaveConfig();
      infoModal.style.display = 'none';
      showToast(t('logs_cleared'), 'info');
    });
  }

  usageBtn.addEventListener('click', () => {
    settingsPanel.classList.remove('open');
    openInfoModal(t('api_usage'));
    renderUsageModal();
  });
  viewLogsBtn.addEventListener('click', () => {
    settingsPanel.classList.remove('open');
    openInfoModal(t('error_logs_title'));
    renderLogsModal();
  });

  // ---------- xac nhan truoc khi dong cua so (nut X) ----------
  // Dua vao Tauri window API de bat su kien dong cua so va chan lai bang
  // hop thoai xac nhan co san cua tool (showConfirmDialog). Neu API nay
  // khong duoc Tauri expose (tuy cau hinh withGlobalTauri/capabilities ben
  // Rust ma minh khong co de kiem tra), tinh nang se tu bo qua, KHONG lam
  // hong chuc nang dong cua so binh thuong cua nguoi dung.
  async function setupCloseConfirmation() {
    const T = window.__TAURI__;
    if (!T) return;

    let win = null;
    try {
      if (T.window?.getCurrentWindow) win = T.window.getCurrentWindow();
      else if (T.webviewWindow?.getCurrentWebviewWindow) win = T.webviewWindow.getCurrentWebviewWindow();
    } catch (_) {}

    if (!win || typeof win.onCloseRequested !== 'function') {
      console.warn('VisionBox: khong tim thay Tauri window API (onCloseRequested) - bo qua xac nhan truoc khi dong cua so.');
      return;
    }

    win.onCloseRequested(async (event) => {
      const confirmed = await showConfirmDialog(t('close_confirm'));
      if (!confirmed) {
        event.preventDefault();
        return;
      }
      // Bo dem so lan goi API chi tinh trong PHIEN LAM VIEC hien tai - reset
      // ve 0 va luu lai truoc khi thoat, de lan mo tool ke tiep bat dau tu 0.
      try {
        usageStats = { totalCalls: 0, successCalls: 0, failedCalls: 0 };
        await window.appConfig.set(buildConfigPayload());
      } catch (_) {}
    });
  }
  setupCloseConfirmation();


function openHistoryModal(index, type) {
  const imageData = uploadedImages[index];
  if (!imageData) return;
  const history = type === 'ocr' ? imageData.ocrHistory : imageData.translationHistory;
  const current = type === 'ocr' ? imageData.ocrResult : imageData.translationResult;

  if (!history || history.length === 0) {
    showToast(t('no_versions'), 'info');
    return;
  }

  // Tạo modal nếu chưa có
  let modal = document.getElementById('history-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'history-modal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
  <div class="modal-box history-modal-box">
    <div class="info-modal-head">
      <h2 id="history-modal-title">History</h2>
      <button type="button" id="history-modal-close" class="icon-btn" title="Close">
        <span class="icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></span>
      </button>
    </div>
    <div id="history-modal-body" class="history-modal-body">
      <div class="history-split">
        <!-- Cột trái: Current version -->
        <div class="history-current-wrapper">
          <div class="history-current-label">Current version</div>
          <div class="history-current-content" id="history-current-content"></div>
        </div>
        <!-- Cột phải: Saved versions -->
        <div class="history-list-wrapper">
          <div class="history-list-label">Saved versions (<span id="history-count">0</span>)</div>
          <div class="history-list-items" id="history-list-items"></div>
        </div>
      </div>
    </div>
  </div>
`;
    document.body.appendChild(modal);
    document.getElementById('history-modal-close').addEventListener('click', () => {
      modal.style.display = 'none';
    });
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.style.display = 'none';
    });
  }

  const title = document.getElementById('history-modal-title');
  title.textContent = t('versions_title', { kind: type === 'ocr' ? t('ocr') : t('translation'), index: index + 1 });

  // Cập nhật current version
  const currentContent = document.getElementById('history-current-content');
  currentContent.innerHTML = renderHistoryTextBlock(current, type);

  // Cập nhật danh sách versions
  const listItems = document.getElementById('history-list-items');
  const countSpan = document.getElementById('history-count');
  countSpan.textContent = history.length;
  // Vers luu gan day nhat hien o TREN CUNG danh sach. Mang history van luu
  // theo thu tu thoi gian (cu -> moi), nen chi doi thu tu DUYET khi render
  // (tu cuoi ve dau); data-version van la INDEX THAT trong mang history de
  // applyVersion() lay dung ban ghi, con "Version #" van danh so theo thu
  // tu luu that (cu nhat la #1) de khong bi nhay so khi co ban moi.
  const displayOrder = history.map((_, i) => i).reverse();
  listItems.innerHTML = displayOrder.map((i) => {
    const entry = history[i];
    // Tương thích cả item cũ (chuỗi thuần, chưa có timestamp) lẫn item mới { text, time }
    const text = (entry && typeof entry === 'object') ? entry.text : entry;
    const time = (entry && typeof entry === 'object') ? entry.time : null;
    const timeLabel = formatHistoryTime(time);
    return `
    <div class="history-item">
      <div class="history-item-header">
        <span class="history-item-version">Version #${i + 1}${timeLabel ? `<span class="history-item-time">${timeLabel}</span>` : ''}</span>
        <button class="history-apply-btn" data-index="${index}" data-type="${type}" data-version="${i}">Get</button>
      </div>
      <div class="history-item-content">${renderHistoryTextBlock(text, type)}</div>
    </div>
  `;
  }).join('');

  // Gắn sự kiện cho các nút Get
  listItems.querySelectorAll('.history-apply-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.index, 10);
      const tp = btn.dataset.type;
      const ver = parseInt(btn.dataset.version, 10);
      applyVersion(idx, tp, ver);
    });
  });

  modal.style.display = 'flex';
}


function formatHistoryTime(timestamp) {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  if (isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  const now = new Date();
  const sameDay = d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const hhmm = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  if (sameDay) return hhmm;
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${hhmm}`;
}

function renderHistoryTextBlock(text, type) {
  if (!text) return `<div class="history-empty">(empty)</div>`;
  const lines = text.split('\n');
  return lines.map((line, i) => `
    <div class="history-line-row">
      <span class="history-line-num">${i + 1}</span>
      <span class="history-line-text">${escapeHtml(line)}</span>
    </div>
  `).join('');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function applyVersion(index, type, versionIndex) {
  const imageData = uploadedImages[index];
  if (!imageData) return;
  const history = type === 'ocr' ? imageData.ocrHistory : imageData.translationHistory;
  if (!history || versionIndex >= history.length) return;

  const entry = history[versionIndex];
  const text = (entry && typeof entry === 'object') ? entry.text : entry;

  // Truoc khi ap version cu (Get), luu lai noi dung HIEN TAI thanh 1 version
  // moi trong lich su - de khong bi mat, van co the quay lai duoc sau nay.
  pushVersionBeforeChange(imageData, type, text);

  if (type === 'ocr') {
    imageData.ocrResult = text;
    setTextBlock(`ocr-${index}`, text);
  } else {
    imageData.translationResult = text;
    setTextBlock(`translation-${index}`, text);
  }
  updateSummary();
  scheduleSaveConfig();
  showToast(t('applied_version', { n: versionIndex + 1 }), 'success');

  // Đóng modal
  const modal = document.getElementById('history-modal');
  if (modal) modal.style.display = 'none';
}

// Thêm phím tắt Ctrl+S (Cmd+S) để lưu edit mode
document.addEventListener('keydown', (e) => {
  const modifier = e.ctrlKey || e.metaKey;
  if (modifier && (e.key === 's' || e.key === 'S')) {
    const editingItems = document.querySelectorAll('.manga-item .text-content.editing');
    if (editingItems.length === 0) return;
    e.preventDefault(); // Ngăn trình duyệt lưu trang

    const indices = new Set();
    editingItems.forEach(el => {
      const id = el.id;
      const match = id.match(/(ocr|translation)-(\d+)/);
      if (match) {
        const index = parseInt(match[2], 10);
        indices.add(index);
      }
    });

    indices.forEach(index => {
      const item = document.querySelector(`.manga-item[data-index="${index}"]`);
      if (!item) return;
      const btn = item.querySelector('.edit-item-btn.active');
      if (btn) {
        toggleItemEdit(index, btn);
      }
    });

    showToast(t('saved_edit'), 'success');
  }
});

async function onRefineTranslateClickAll() {
  if (isProcessing) { showToast(t('please_wait'), 'warning'); return; }
  // Lấy tất cả indices có translation
  const indices = uploadedImages
    .map((img, i) => img.translationResult ? i : -1)
    .filter(i => i !== -1);
  if (indices.length === 0) {
    showToast(t('no_translations_to_refine'), 'warning');
    return;
  }
  // Đồng bộ edit mode cho các ảnh có translation
  indices.forEach(i => syncEditedTextIfEditing(i));
  const userInstruction = await showRefineTranslatePromptDialog();
  if (userInstruction === null) return; // Cancel
  // Xác nhận? Có thể bỏ qua confirm vì đã có prompt
  processBatch('refine-translate', indices, userInstruction);
}

function renderShortcutsModal() {
  // Lấy hoặc tạo modal nếu chưa có
  let modal = document.getElementById('shortcuts-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'shortcuts-modal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-box shortcuts-modal-box">
        <div class="info-modal-head">
          <h2>${t('shortcuts_title')}</h2>
          <button type="button" id="shortcuts-modal-close" class="icon-btn" title="${t('close_title')}">
            <span class="icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></span>
          </button>
        </div>
        <div id="shortcuts-modal-body" class="shortcuts-modal-body">
          <div class="shortcuts-grid">
            <div class="shortcut-item"><kbd>Ctrl+O</kbd><span>${t('shortcut_open_file')}</span></div>
            <div class="shortcut-item"><kbd>Ctrl+Shift+O</kbd><span>${t('shortcut_ocr_all')}</span></div>
            <div class="shortcut-item"><kbd>Ctrl+Shift+T</kbd><span>${t('shortcut_translate_all')}</span></div>
            <div class="shortcut-item"><kbd>Ctrl+Shift+R</kbd><span>${t('shortcut_refine_translate_all')}</span></div>
            <div class="shortcut-item"><kbd>Ctrl+Shift+A</kbd><span>${t('shortcut_select_all_images')}</span></div>
            <div class="shortcut-item"><kbd>Ctrl+Shift+D</kbd><span>${t('shortcut_deselect_all')}</span></div>
            <div class="shortcut-item"><kbd>Ctrl+Shift+C</kbd><span>${t('shortcut_clear_all_images')}</span></div>
            <div class="shortcut-item"><kbd>Ctrl+H</kbd><span>${t('shortcut_open_replace')}</span></div>
            <div class="shortcut-item"><kbd>Ctrl+S</kbd><span>${t('shortcut_save_edit_mode')}</span></div>
            <div class="shortcut-item"><kbd>Enter</kbd><span>${t('shortcut_confirm_dialog')}</span></div>
            <div class="shortcut-item"><kbd>Esc</kbd><span>${t('shortcut_cancel_dialog')}</span></div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    // Đóng modal
    document.getElementById('shortcuts-modal-close').addEventListener('click', () => {
      modal.style.display = 'none';
    });
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.style.display = 'none';
    });
  }

  // Cập nhật lại text theo ngôn ngữ hiện tại (phòng khi modal đã được tạo từ trước
  // bằng ngôn ngữ khác)
  modal.querySelector('.info-modal-head h2').textContent = t('shortcuts_title');
  document.getElementById('shortcuts-modal-close').title = t('close_title');
  const spans = modal.querySelectorAll('.shortcut-item span');
  const shortcutKeys = [
    'shortcut_open_file', 'shortcut_ocr_all', 'shortcut_translate_all',
    'shortcut_refine_translate_all', 'shortcut_select_all_images', 'shortcut_deselect_all',
    'shortcut_clear_all_images', 'shortcut_open_replace', 'shortcut_save_edit_mode',
    'shortcut_confirm_dialog', 'shortcut_cancel_dialog'
  ];
  spans.forEach((span, i) => { if (shortcutKeys[i]) span.textContent = t(shortcutKeys[i]); });

  modal.style.display = 'flex';
}

aboutBtn.addEventListener('click', () => {
  settingsPanel.classList.remove('open');
  renderShortcutsModal();
});

  loadConfig();
  renderNavFabList();
})();
