(function () {
  'use strict';

  var CDN_HTML2CANVAS = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
  var CDN_JSPDF = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
  var CDN_XLSX = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';

  var loaded = {};
  function loadScriptOnce(src) {
    if (loaded[src]) return loaded[src];
    loaded[src] = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = function () { resolve(); };
      s.onerror = function () { delete loaded[src]; reject(new Error('Không tải được: ' + src)); };
      document.head.appendChild(s);
    });
    return loaded[src];
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  // Đuôi file có nên chuyển sang PDF không
  function isConvertible(file) {
    var name = (file.name || '').toLowerCase();
    var t = file.type || '';
    if (t === 'application/pdf' || /\.pdf$/.test(name)) return false;
    if (t && t.startsWith('image/')) return false;
    return /\.(docx|xlsx|xls|csv|txt)$/.test(name)
      || t === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      || t === 'application/vnd.ms-excel'
      || t === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      || t === 'text/plain';
  }

  async function ensureMammoth() {
    if (window.mammoth) return;
    if (window.AiRag && typeof window.AiRag.loadMammothLib === 'function') {
      await window.AiRag.loadMammothLib();
    }
    if (!window.mammoth) throw new Error('Không tải được bộ đọc Word');
  }

  async function ensureSheetJs() {
    if (window.XLSX) return;
    await loadScriptOnce(CDN_XLSX);
    if (!window.XLSX) throw new Error('Không tải được bộ đọc Excel');
  }

  // Bước 1: dựng HTML từ nội dung file
  async function buildHtml(file) {
    var name = (file.name || '').toLowerCase();
    var t = file.type || '';
    var isDocx = t === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || /\.docx$/.test(name);
    var isExcel = /\.(xlsx|xls|csv)$/.test(name)
      || ['application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv'].indexOf(t) !== -1;
    var isTxt = t === 'text/plain' || /\.txt$/.test(name);

    if (isDocx) {
      await ensureMammoth();
      var buf = await file.arrayBuffer();
      var result = await window.mammoth.convertToHtml({ arrayBuffer: buf });
      return result.value || '<p>(Tài liệu trống)</p>';
    }
    if (isExcel) {
      await ensureSheetJs();
      var wb = window.XLSX.read(await file.arrayBuffer(), { type: 'array' });
      var html = '';
      wb.SheetNames.slice(0, 10).forEach(function (sn) {
        html += '<div class="d2p-sheet"><h3>' + escapeHtml(sn) + '</h3>' + window.XLSX.utils.sheet_to_html(wb.Sheets[sn]) + '</div>';
      });
      return html || '<p>(Sheet trống)</p>';
    }
    if (isTxt) {
      var text = await file.text();
      return '<pre class="d2p-pre">' + escapeHtml(text) + '</pre>';
    }
    throw new Error('Định dạng không hỗ trợ chuyển đổi');
  }

  // Bước 2: HTML -> ảnh -> PDF A4 nhiều trang
  async function htmlToPdf(html, onStatus) {
    if (onStatus) onStatus('Đang chuyển đổi sang PDF…');
    await Promise.all([loadScriptOnce(CDN_HTML2CANVAS), loadScriptOnce(CDN_JSPDF)]);
    var jsPDFCtor = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
    if (!window.html2canvas || !jsPDFCtor) throw new Error('Không tải được bộ tạo PDF');

    var holder = document.createElement('div');
    holder.className = 'doc2pdf-page';
    holder.innerHTML = html;
    holder.style.cssText = 'position:fixed;left:-10000px;top:0;width:794px;background:#fff;color:#111;padding:32px 36px;font-family:-apple-system,Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.55;z-index:-1;';
    var style = document.createElement('style');
    style.textContent =
      '.doc2pdf-page *{box-sizing:border-box;max-width:100%;}' +
      '.doc2pdf-page img{max-width:100%;height:auto;}' +
      '.doc2pdf-page h1{font-size:26px;margin:0 0 12px;}' +
      '.doc2pdf-page h2{font-size:21px;margin:18px 0 10px;}' +
      '.doc2pdf-page h3{font-size:17px;margin:16px 0 8px;}' +
      '.doc2pdf-page p{margin:7px 0;}' +
      '.doc2pdf-page table{border-collapse:collapse;width:100%;margin:10px 0;font-size:12.5px;}' +
      '.doc2pdf-page td,.doc2pdf-page th{border:1px solid #cbd5e1;padding:5px 9px;text-align:left;vertical-align:top;}' +
      '.doc2pdf-page tr:nth-child(even) td{background:#f6f8fb;}' +
      '.doc2pdf-page .d2p-sheet h3{color:#4f46e5;}' +
      '.doc2pdf-page .d2p-pre{white-space:pre-wrap;overflow-wrap:anywhere;font-family:Consolas,monospace;font-size:12.5px;}';
    document.head.appendChild(style);
    document.body.appendChild(holder);

    try {
      var canvas = await window.html2canvas(holder, { scale: Math.min(window.devicePixelRatio || 1, 2), backgroundColor: '#ffffff', logging: false, useCORS: true });
    } finally {
      holder.remove();
      style.remove();
    }

    if (onStatus) onStatus('Đang tạo các trang PDF…');
    var pdf = new jsPDFCtor({ unit: 'pt', format: 'a4' });
    var pageW = 595.28, pageH = 841.89;
    var sliceH = Math.floor(canvas.width * (pageH / pageW));
    var total = Math.max(1, Math.ceil(canvas.height / sliceH));
    for (var i = 0; i < total; i++) {
      if (i > 0) pdf.addPage();
      var h = Math.min(sliceH, canvas.height - i * sliceH);
      var slice = document.createElement('canvas');
      slice.width = canvas.width;
      slice.height = h;
      var ctx = slice.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, slice.width, slice.height);
      ctx.drawImage(canvas, 0, i * sliceH, canvas.width, h, 0, 0, canvas.width, h);
      pdf.addImage(slice.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, pageW, (h / canvas.width) * pageW);
    }
    return pdf.output('blob');
  }

  /**
   * Chuyển file Word/Excel/TXT sang PDF.
   * Trả về { blob, name, type, converted } — nếu không chuyển đổi được thì trả nguyên bản gốc.
   */
  async function toPdf(file, onStatus) {
    if (!file) return file;
    if (!isConvertible(file)) return { blob: file, name: file.name, type: file.type, converted: false };
    try {
      var html = await buildHtml(file);
      var blob = await htmlToPdf(html, onStatus);
      var pdfName = (file.name || 'tai-lieu').replace(/\.[^.]+$/, '') + '.pdf';
      return { blob: blob, name: pdfName, type: 'application/pdf', converted: true };
    } catch (err) {
      console.warn('Chuyển PDF thất bại, giữ file gốc:', err);
      if (onStatus) onStatus(null);
      return { blob: file, name: file.name, type: file.type, converted: false, error: err };
    }
  }

  window.EduPulseDoc2Pdf = { toPdf: toPdf, isConvertible: isConvertible };
})();
