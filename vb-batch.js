<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>VisionBox — Dịch hàng loạt</title>
<link rel="stylesheet" href="vb-extra.css">
</head>
<body>
<header class="vbs-top">
  <div><h1>VisionBox · Dịch hàng loạt</h1><p class="vbs-hint">Nạp zip → dịch cả bộ → xuất txt/docx/zip</p></div>
</header>
<nav class="vbs-nav"></nav>

<main class="vbs-main">
  <section class="vbs-card">
    <h2>1. Nạp file ZIP</h2>
    <div class="vbs-drop" id="b-drop">
      <p>Kéo &amp; thả file <b>.zip</b> vào đây, hoặc</p>
      <label class="vbs-btn primary" for="b-zip">Chọn file .zip</label>
      <input type="file" id="b-zip" accept=".zip" multiple hidden>
      <p class="vbs-hint">Mỗi folder = 1 chương. Ảnh ngoài folder gom vào “(gốc)”.</p>
    </div>
    <div id="b-zipinfo" class="vbs-hint"></div>
  </section>

  <section class="vbs-card">
    <h2>2. Cấu hình dịch</h2>
    <div class="vbs-row">
      <button class="vbs-btn" id="b-test">🔍 Kiểm tra key &amp; model</button>
      <button class="vbs-btn" id="b-refresh-models">↻ Nạp lại model</button>
      <span class="vbs-hint" id="b-modelinfo"></span>
    </div>
    <div class="vbs-grid3">
      <div class="vbs-field"><label>Model (tự dò từ API key)</label><select id="b-model" data-model></select></div>
      <div class="vbs-field"><label>Loại truyện</label><select id="b-type"><option value="manga">Manga (phải → trái)</option><option value="webtoon">Webtoon (trên → dưới)</option></select></div>
      <div class="vbs-field"><label>Ngôn ngữ gốc</label><select id="b-src"><option value="ja">Japanese (日本語)</option><option value="ko">Korean (한국어)</option><option value="zh">Chinese (中文)</option><option value="en">English</option></select></div>
      <div class="vbs-field"><label>Dịch sang</label><select id="b-dst"><option value="vi">Vietnamese</option><option value="en">English</option><option value="ja">Japanese</option><option value="ko">Korean</option><option value="zh">Chinese</option></select></div>
      <div class="vbs-field"><label>Luồng song song</label><select id="b-conc"><option value="1">1 (an toàn nhất)</option><option value="2">2</option><option value="3">3</option></select></div>
      <div class="vbs-field"><label>Nghỉ giữa 2 ảnh (ms)</label><input type="number" id="b-delay" min="0" step="100" value="700"></div>
      <div class="vbs-field"><label>Thu nhỏ ảnh tối đa (px)</label><input type="number" id="b-width" min="600" step="100" value="1400"></div>
    </div>
    <div class="vbs-row">
      <label class="vbs-inline"><input type="checkbox" id="b-skipsfx"> Bỏ qua SFX</label>
      <label class="vbs-inline"><input type="checkbox" id="b-style" checked> Elements of Style</label>
      <label class="vbs-inline"><input type="checkbox" id="b-slice" checked> Tự cắt ảnh quá dài</label>
      <label class="vbs-inline"><input type="checkbox" id="b-bi" checked> Xuất song ngữ</label>
      <label class="vbs-inline"><input type="checkbox" id="b-ctx" checked> Dùng ngữ cảnh đã lưu</label>
      <span class="vbs-hint" id="b-ctxinfo"></span>
    </div>
    <details id="b-log-open"><summary>Nhật ký &amp; chẩn đoán</summary><div id="b-log" class="vbs-log"></div></details>
  </section>

  <section class="vbs-card">
    <h2>3. Chọn chương</h2>
    <div class="vbs-row">
      <button class="vbs-btn" id="b-all">Chọn tất cả</button>
      <button class="vbs-btn" id="b-none">Bỏ chọn</button>
      <button class="vbs-btn" id="b-invert">Đảo chọn</button>
      <input type="text" id="b-filter" placeholder="Lọc theo tên chương…">
      <span class="vbs-sp"></span>
      <button class="vbs-btn primary" id="b-start">▶ Bắt đầu dịch</button>
      <button class="vbs-btn danger" id="b-stop" disabled>■ Dừng</button>
    </div>
    <div class="vbs-progress"><div id="b-progress"></div></div>
    <div class="vbs-hint" id="b-status">Chưa nạp chương nào.</div>
    <div id="b-list"></div>
  </section>

  <section class="vbs-card">
    <h2>4. Kết quả</h2>
    <div class="vbs-row">
      <button class="vbs-btn primary" id="b-zipall">⬇ Tải tất cả (.zip)</button>
      <button class="vbs-btn" id="b-copyall">Copy tất cả</button>
    </div>
    <div id="b-results"></div>
  </section>
</main>

<script src="jszip.min.js"></script>
<script src="style-guide.js"></script>
<script src="vb-shared.js"></script>
<script src="vb-batch.js"></script>
</body>
</html>
