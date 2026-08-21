/* EduPulse AI RAG — trích xuất, index và truy vấn tài liệu trên thiết bị (on-device, free) */
(function () {
  'use strict';

  const DB_NAME = 'edupulse-ai';
  const DB_VERSION = 1;
  const STORE = 'docs';
  const CHUNK_SIZE = 1500;
  const CHUNK_OVERLAP = 150;
  const MAX_RESULTS = 3;
  const RAG_KEYWORDS = /tài liệu|tai lieu|file|đề thi|de thi|đề|de\b|tóm tắt|tom tat|trích|trich|chương|chuong|bài tập|bai tap|giải đề|giai de|ôn tập|on tap|nội dung|noi dung|đọc|doc\b/i;

  const PDF_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const PDF_LIB = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  const MAMMOTH_LIB = 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.8.0/mammoth.browser.min.js';
  let mammothPromise = null;

  function loadMammothLib() {
    if (window.mammoth) return Promise.resolve();
    if (!mammothPromise) {
      mammothPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = MAMMOTH_LIB;
        script.onload = () => (window.mammoth ? resolve() : reject(new Error('Không tải được mammoth')));
        script.onerror = () => { mammothPromise = null; reject(new Error('Không tải được mammoth')); };
        document.head.appendChild(script);
      });
    }
    return mammothPromise;
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'libraryId' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function dbPut(value) {
    return openDb().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }

  function dbGet(libraryId) {
    return openDb().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).get(libraryId);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    }));
  }

  function dbAll() {
    return openDb().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    }));
  }

  function dbDelete(libraryId) {
    return openDb().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(libraryId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }

  function htmlToText(html) {
    const doc = new DOMParser().parseFromString(html || '', 'text/html');
    return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function chunkText(text) {
    const clean = (text || '').replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim();
    if (!clean) return [];
    const chunks = [];
    if (clean.length <= CHUNK_SIZE) {
      chunks.push(clean);
      return chunks;
    }
    let start = 0;
    while (start < clean.length) {
      let end = Math.min(start + CHUNK_SIZE, clean.length);
      if (end < clean.length) {
        const breakAt = clean.lastIndexOf('\n', end);
        if (breakAt > start + CHUNK_SIZE * 0.5) end = breakAt;
      }
      const piece = clean.slice(start, end).trim();
      if (piece) chunks.push(piece);
      if (end >= clean.length) break;
      start = Math.max(end - CHUNK_OVERLAP, start + 1);
    }
    return chunks;
  }

  function tokenize(text) {
    const tokens = (text || '').toLocaleLowerCase('vi-VN').match(/[\p{L}\p{N}]+/gu) || [];
    return tokens;
  }

  function buildInvertedIndex(chunks) {
    const index = new Map();
    chunks.forEach((chunk, chunkIndex) => {
      const terms = new Map();
      tokenize(chunk).forEach(term => { terms.set(term, (terms.get(term) || 0) + 1); });
      terms.forEach((count, term) => {
        if (!index.has(term)) index.set(term, []);
        index.get(term).push({ chunkIndex, count });
      });
    });
    return index;
  }

  function bm25Score(queryTokens, chunks, index) {
    const N = chunks.length;
    const avgLen = chunks.reduce((sum, c) => sum + tokenize(c).length, 0) / Math.max(1, N);
    const scores = new Array(N).fill(0);
    const k1 = 1.5;
    const b = 0.75;
    const queryTerms = [...new Set(queryTokens)];
    for (const term of queryTerms) {
      const postings = index.get(term);
      if (!postings) continue;
      const df = postings.length;
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
      for (const posting of postings) {
        const docLen = tokenize(chunks[posting.chunkIndex]).length;
        const denom = posting.count + k1 * (1 - b + b * docLen / avgLen);
        scores[posting.chunkIndex] += idf * posting.count * (k1 + 1) / denom;
      }
    }
    return scores;
  }

  function isSupportedType(type) {
    if (!type) return false;
    if (type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return true;
    if (type === 'application/pdf') return true;
    if (type.startsWith('text/')) return true;
    return false;
  }

  async function getBlob(item) {
    const bridge = window.EDUPULSE_APP;
    if (!bridge || typeof bridge.getAttachmentBlob !== 'function') {
      throw new Error('App chưa sẵn sàng để đọc tài liệu.');
    }
    return bridge.getAttachmentBlob(item.fileId);
  }

  function loadPdfLib() {
    return new Promise((resolve, reject) => {
      if (window.pdfjsLib) { resolve(window.pdfjsLib); return; }
      const script = document.createElement('script');
      script.src = PDF_LIB;
      script.onload = () => {
        if (!window.pdfjsLib) { reject(new Error('Không tải được pdf.js')); return; }
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER;
        resolve(window.pdfjsLib);
      };
      script.onerror = () => reject(new Error('Không tải được pdf.js'));
      document.head.appendChild(script);
    });
  }

  async function extractPdfText(arrayBuffer) {
    const pdfjsLib = await loadPdfLib();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let text = '';
    for (let pageIndex = 1; pageIndex <= pdf.numPages; pageIndex++) {
      const page = await pdf.getPage(pageIndex);
      const content = await page.getTextContent();
      text += (content.items || []).map(item => item.str || '').join(' ') + '\n';
    }
    return text.replace(/\s+/g, ' ').trim();
  }

  async function extractText(item) {
    const type = item.type || '';
    if (!isSupportedType(type)) {
      return { unsupported: true, reason: 'Loại tài liệu chưa hỗ trợ đọc nội dung (chỉ .docx, .pdf, .txt).' };
    }
    const { blob } = await getBlob(item);
    const arrayBuffer = await blob.arrayBuffer();
    let text = '';
    if (type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      try {
        await loadMammothLib();
      } catch (error) {
        return { unsupported: true, reason: 'Chưa tải được bộ đọc .docx.' };
      }
      const result = await window.mammoth.convertToHtml({ arrayBuffer });
      text = htmlToText(result.value);
    } else if (type === 'application/pdf') {
      text = await extractPdfText(arrayBuffer);
    } else {
      text = new TextDecoder('utf-8').decode(arrayBuffer);
    }
    if (!text.trim()) return { unsupported: true, reason: 'Không trích được văn bản từ tài liệu này (có thể là bản quét/ảnh).' };
    return { text: text.trim() };
  }

  async function indexLibraryItem(item) {
    try {
      if (!item || !item.libraryId || !item.fileId) return { ok: false, reason: 'Thiếu thông tin tài liệu.' };
      const extracted = await extractText(item);
      if (extracted.unsupported) {
        await dbPut({ libraryId: item.libraryId, fileId: item.fileId, name: item.name, type: item.type, unsupported: true, reason: extracted.reason, indexedAt: Date.now() });
        return { ok: false, unsupported: true, reason: extracted.reason };
      }
      const chunks = chunkText(extracted.text);
      await dbPut({
        libraryId: item.libraryId,
        fileId: item.fileId,
        name: item.name,
        type: item.type,
        chunks,
        indexedAt: Date.now()
      });
      return { ok: true, chunkCount: chunks.length };
    } catch (error) {
      return { ok: false, reason: String(error?.message || error) };
    }
  }

  async function ensureIndexed(item) {
    const existing = await dbGet(item.libraryId);
    if (existing && existing.chunks && existing.chunks.length) return existing;
    return indexLibraryItem(item);
  }

  async function searchLibrary(query) {
    const queryTokens = tokenize(query);
    if (!queryTokens.length) return { available: true, count: 0, matches: [] };
    const docs = await dbAll();
    if (!docs.length) return { available: true, count: 0, matches: [], note: 'Chưa có tài liệu nào được đánh index.' };
    const ranked = [];
    for (const doc of docs) {
      if (!doc.chunks || !doc.chunks.length) continue;
      const scores = bm25Score(queryTokens, doc.chunks, buildInvertedIndex(doc.chunks));
      const best = scores
        .map((score, chunkIndex) => ({ score, chunkIndex }))
        .sort((a, b) => b.score - a.score)
        .filter(entry => entry.score > 0)
        .slice(0, MAX_RESULTS);
      if (best.length) ranked.push({ doc, best });
    }
    ranked.sort((a, b) => b.best[0].score - a.best[0].score);
    const topDocs = ranked.slice(0, MAX_RESULTS);
    const matches = topDocs.map(entry => ({
      libraryId: entry.doc.libraryId,
      name: entry.doc.name,
      type: entry.doc.type
    }));
    const chunks = [];
    topDocs.forEach(entry => {
      entry.best.forEach(hit => {
        chunks.push({ libraryId: entry.doc.libraryId, name: entry.doc.name, text: entry.doc.chunks[hit.chunkIndex] });
      });
    });
    return { available: true, count: matches.length, matches, chunks };
  }

  function isRagQuestion(question) {
    return RAG_KEYWORDS.test(String(question || '').toLocaleLowerCase('vi-VN'));
  }

  async function buildContext(question) {
    try {
      const query = String(question || '').trim();
      if (!query || !isRagQuestion(query)) return '';
      const result = await searchLibrary(query);
      if (!result.available || !result.chunks || !result.chunks.length) return '';
      const seen = new Set();
      const lines = [];
      const files = [];
      result.chunks.forEach(chunk => {
        if (seen.has(chunk.libraryId)) return;
        seen.add(chunk.libraryId);
        files.push(chunk.name);
      });
      if (!files.length) return '';
      lines.push('\n\nTài liệu tham khảo từ thư viện của học sinh (chỉ dùng để trả lời nếu liên quan):');
      result.chunks.forEach(chunk => {
        lines.push('\n[' + chunk.name + '] ' + chunk.text.slice(0, 1400));
      });
      return lines.join('\n');
    } catch (error) {
      console.warn('RAG buildContext failed:', error);
      return '';
    }
  }

  async function syncFromLibrary() {
    const bridge = window.EDUPULSE_APP;
    if (!bridge || typeof bridge.getLibrary !== 'function') return { ok: false };
    const library = bridge.getLibrary();
    let indexed = 0;
    let failed = 0;
    for (const item of library) {
      const existing = await dbGet(item.libraryId);
      if (existing && existing.indexedAt && existing.indexedAt >= (item.savedAt ? new Date(item.savedAt).getTime() : 0)) {
        indexed++;
        continue;
      }
      const result = await indexLibraryItem(item);
      if (result.ok) indexed++;
      else failed++;
    }
    return { ok: true, indexed, failed };
  }

  async function removeIndex(libraryId) {
    if (!libraryId) return;
    try { await dbDelete(libraryId); } catch (error) { console.warn('Remove RAG index failed:', error); }
  }

  window.AiRag = {
    indexLibraryItem,
    ensureIndexed,
    searchLibrary,
    buildContext,
    syncFromLibrary,
    removeIndex,
    extractText,
    chunkText,
    loadMammothLib,
    loadPdfLib
  };
}());