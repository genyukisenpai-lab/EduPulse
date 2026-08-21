/**
 * Lightweight API and static-file server for EduPulse.
 * Run with: node server.js
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'edupulse.json');
const GEMINI_API_KEYS = process.env.GEMINI_API_KEYS ? process.env.GEMINI_API_KEYS.split(',') : [''];
const GEMINI_API_KEY_INDEX = 0;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.pdf': 'application/pdf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

function sendJson(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(body));
}

function readState() {
  if (!fs.existsSync(DATA_FILE)) return null;
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function isValidState(value) {
  return value && Array.isArray(value.exams);
}

function readJsonBody(req, maxBytes = 50_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', chunk => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error('Request too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function sanitizeHistory(history) {
  if (!Array.isArray(history)) return [];
  return history.slice(-8).map(item => {
    const role = item?.role === 'model' ? 'model' : 'user';
    const text = String(item?.parts?.[0]?.text || '').slice(0, 800);
    return text ? { role, parts: [{ text }] } : null;
  }).filter(Boolean);
}

async function generateAiReply(history, studyContext) {
  let lastError = null;
  for (let keyIndex = 0; keyIndex < GEMINI_API_KEYS.length; keyIndex++) {
    const apiKey = GEMINI_API_KEYS[keyIndex] || '';
    if (!apiKey) continue;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        signal: controller.signal,
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: `Bạn là trợ lý ôn thi EduPulse. Luôn trả lời bằng tiếng Việt thân thiện, ngắn gọn, thực tế. Không bịa dữ kiện, không làm hộ bài thi; hãy giải thích cách làm và khuyến khích học sinh tự suy luận. Kỳ thi được lưu: ${String(studyContext || 'Chưa có kỳ thi nào').slice(0, 500)}` }]
          },
          contents: sanitizeHistory(history),
          generationConfig: { temperature: 0.7, maxOutputTokens: 500 }
        })
      });
      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Gemini HTTP ${response.status}: ${errText}`);
      }
      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('').trim();
      if (!text) throw new Error('Gemini returned no text');
      return text;
    } catch (error) {
      lastError = error;
      // Try next key
      console.warn(`Server Gemini key index ${keyIndex} failed, trying next...`);
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error(`All Gemini API keys exhausted. Last error: ${lastError?.message}`);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  if (url.pathname === '/api/health' && req.method === 'GET') {
    return sendJson(res, 200, { ok: true, status: 'EduPulse backend is running smoothly' });
  }

  if (url.pathname === '/api/ai') {
    if (req.method === 'GET') return sendJson(res, 200, { available: GEMINI_API_KEYS.some(k => k) });
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'Phương thức không được hỗ trợ.' });
    if (GEMINI_API_KEYS.length === 0 || GEMINI_API_KEYS.every(k => !k)) return sendJson(res, 503, { error: 'AI chưa được cấu hình trên máy chủ.' });
    readJsonBody(req).then(async body => {
      const history = sanitizeHistory(body.history);
      if (!history.length || history[history.length - 1].role !== 'user') {
        return sendJson(res, 400, { error: 'Câu hỏi không hợp lệ.' });
      }
      const text = await generateAiReply(history, body.studyContext);
      return sendJson(res, 200, { text });
    }).catch(error => {
      console.error('AI request failed:', error.message);
      return sendJson(res, 502, { error: 'Không thể nhận phản hồi AI lúc này.' });
    });
    return;
  }

  if (url.pathname === '/api/state') {
    if (req.method === 'GET') {
      try { return sendJson(res, 200, readState()); }
      catch { return sendJson(res, 500, { error: 'Không thể đọc dữ liệu.' }); }
    }
    if (req.method === 'PUT') {
      readJsonBody(req, 2_000_000).then(state => {
        if (!isValidState(state)) return sendJson(res, 400, { error: 'Dữ liệu không hợp lệ.' });
        fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2), 'utf8');
        return sendJson(res, 200, { ok: true, savedAt: new Date().toISOString() });
      }).catch(() => sendJson(res, 400, { error: 'Không thể lưu dữ liệu.' }));
      return;
    }
    return sendJson(res, 405, { error: 'Phương thức không được hỗ trợ.' });
  }

  const requested = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const filePath = path.resolve(ROOT, `.${requested}`);
  if (!filePath.startsWith(ROOT + path.sep) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Không tìm thấy trang.');
  }
  const headers = { 'Content-Type': MIME_TYPES[path.extname(filePath)] || 'application/octet-stream' };
  if (path.basename(filePath) === 'service-worker.js' || path.basename(filePath) === 'index.html') {
    headers['Cache-Control'] = 'no-cache';
  }
  res.writeHead(200, headers);
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, () => console.log(`EduPulse đang chạy tại http://localhost:${PORT}`));
