(() => {
  // Kiểm tra xem có đang chạy trong môi trường Tauri (Desktop App) không
  if (!window.__TAURI__ || !window.__TAURI__.core) {
    console.log('[preload.js] Chạy trên trình duyệt web, nhường quyền cho Web Fallback.');
    return;
  }

  const { invoke } = window.__TAURI__.core;

  window.appConfig = {
    get: () => invoke('config_get'),
    set: (data) => invoke('config_set', { data })
  };

  // format: 'txt' | 'docx' — mo hop thoai native de chon noi luu, roi ghi file.
  // Tra ve true neu da luu, false neu nguoi dung bam Cancel.
  window.fileExport = {
    save: (content, format, suggestedName) => invoke('export_file', { content, format, suggestedName })
  };
})();
