// Test tích hợp Web Push phía PWA:
//  A) Service worker: handler 'push' + 'notificationclick' (VM trong Node)
//  B) Trình duyệt (Playwright): nút "Nhắc ôn hằng ngày" — bật/tắt, gửi subscribe/snapshot tới worker
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = __dirname;
const PORT = 3100;
const PUSH_STUB_PORT = 3101;
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + detail : ''));
}

// ================= A) Service Worker handlers (VM) =================
async function testSwHandlers() {
  const code = fs.readFileSync(path.join(ROOT, 'service-worker.js'), 'utf8');
  const handlers = {};
  const notifications = [];
  let openedWindow = null;
  let focused = false;
  const fakeSelf = {
    addEventListener: (type, fn) => { handlers[type] = fn; },
    registration: {
      showNotification: async (title, options) => { notifications.push({ title, options }); }
    },
    clients: {
      matchAll: async () => [{ focus: async () => { focused = true; } }],
      openWindow: async url => { openedWindow = url; }
    },
    skipWaiting: async () => {},
    claim: async () => {}
  };
  const fakeCaches = { open: async () => ({ addAll: async () => {} }), keys: async () => [], delete: async () => true, match: async () => undefined };
  vm.runInNewContext(code, {
    self: fakeSelf,
    caches: fakeCaches,
    URL,
    fetch: async () => ({ ok: true, status: 200 }),
    console,
    navigator: {},
    Notification: {},
    Response: class {},
    Request: class {},
    crypto
  });

  check('SW đăng ký handler push', typeof handlers.push === 'function', '');
  check('SW đăng ký handler notificationclick', typeof handlers.notificationclick === 'function', '');

  await handlers.push({
    data: { json: () => ({ title: 'Còn 5 ngày tới ĐGNL', body: 'Ôn thôi!' }) },
    waitUntil: async p => p
  });
  check('push → showNotification với title/body', notifications.length === 1 && notifications[0].title === 'Còn 5 ngày tới ĐGNL' && notifications[0].options.body === 'Ôn thôi!', JSON.stringify(notifications[0]?.title));
  check('notification có tag + icon', notifications[0]?.options?.tag === 'edupulse-countdown' && !!notifications[0]?.options?.icon, '');

  let closed = false;
  await handlers.notificationclick({ notification: { close: () => { closed = true; } }, waitUntil: async p => p });
  check('click → close + focus client', closed === true && focused === true && openedWindow === null, 'focused=' + focused);

  // push không có data (fallback)
  await handlers.push({ data: null, waitUntil: async p => p });
  check('push không payload → title mặc định EduPulse', notifications.length === 2 && notifications[1].title === 'EduPulse', notifications[1]?.title);
}

// ================= B) Playwright UI test =================
function startStaticServer() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://localhost:' + PORT);
      let filePath = url.pathname === '/' ? path.join(ROOT, 'index.html') : path.join(ROOT, url.pathname);
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        res.writeHead(404); return res.end();
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      fs.createReadStream(filePath).pipe(res);
    });
    server.listen(PORT, () => resolve(server));
  });
}

async function testBrowser() {
  const server = await startStaticServer();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();

  const pushRequests = [];
  const examDate = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);

  await context.addInitScript(({ date, pushPort }) => {
    window.localStorage.setItem('edupulse_data', JSON.stringify({
      exams: [{ id: 'e1', title: 'Đánh giá năng lực', category: 'Đánh giá năng lực', priority: 'high', date, time: '23:59', notes: '', isHero: true }],
      library: []
    }));
    // Giả lập pushManager + Notification để không đụng push service thật
    const fakeSub = { endpoint: 'https://push.example.com/v1/sub-ui-test', toJSON: () => ({ endpoint: 'https://push.example.com/v1/sub-ui-test', keys: { p256dh: 'YmFzZTY0cDUyNWRo', auth: 'YXV0aHNlY3JldA' } }), unsubscribe: async () => { window.__fakeSub = null; return true; } };
    const fakePushManager = {
      getSubscription: async () => window.__fakeSub || null,
      subscribe: async () => { window.__fakeSub = fakeSub; return fakeSub; }
    };
    Object.defineProperty(ServiceWorkerRegistration.prototype, 'pushManager', { get: () => fakePushManager, configurable: true });
    Object.defineProperty(Notification, 'requestPermission', { value: async () => 'granted', configurable: true });
    Object.defineProperty(Notification, 'permission', { get: () => 'granted', configurable: true });
  }, { date: examDate, pushPort: PUSH_STUB_PORT });

  // Chặn push-config.js → gắn worker URL giả (cổng stub)
  await context.route('**/js/push-config.js*', route => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: `window.EDUPULSE_PUSH_WORKER_URL = 'http://localhost:${PUSH_STUB_PORT}'; window.EDUPULSE_VAPID_PUBLIC_KEY = 'dGVzdC1wdWJsaWMta2V5';`
  }));
  // Chặn request tới worker giả
  await context.route('http://localhost:' + PUSH_STUB_PORT + '/**', route => {
    const body = route.request().postData();
    pushRequests.push({ path: new URL(route.request().url()).pathname, body: body ? JSON.parse(body) : null });
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  });

  const page = await context.newPage();
  await page.goto('http://localhost:' + PORT + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.EduPulsePush, null, { timeout: 15000 });
  await page.waitForTimeout(1500);

  // 0) Mở tab Tài khoản
  await page.click('[data-tab="tab-account"]');
  await page.waitForTimeout(600);

  // 1) Khu vực bật/tắt hiển thị (worker URL đã cấu hình)
  check('Section bật/tắt hiển thị khi có worker URL', await page.locator('#push-toggle-section').isVisible(), '');
  const label0 = await page.locator('#push-status-label').textContent();
  check('Trạng thái ban đầu = Đang tắt', label0.includes('Đang tắt'), label0);

  // 2) Bật nhắc
  await page.click('#btn-toggle-push');
  await page.waitForFunction(() => {
    const el = document.getElementById('push-status-label');
    return el && el.textContent.includes('Đang bật');
  }, null, { timeout: 10000 });
  const subReq = pushRequests.find(r => r.path === '/subscribe');
  check('Đã POST /subscribe với endpoint+keys', !!subReq && !!subReq.body.endpoint && !!subReq.body.keys?.p256dh && !!subReq.body.keys?.auth, JSON.stringify(subReq?.body)?.slice(0, 120));
  check('Subscribe kèm snapshot kỳ thi gần nhất', subReq?.body?.snapshot?.title === 'Đánh giá năng lực' && subReq?.body?.snapshot?.days === 5, JSON.stringify(subReq?.body?.snapshot));
  const toast1 = await page.locator('#app-toast').textContent().catch(() => '');
  check('Toast thông báo đã bật', toast1.includes('thông báo thử'), toast1);
  const testReq = pushRequests.find(r => r.path === '/send-test');
  check('Tự gửi /send-test sau khi bật (thông báo thử)', !!testReq && testReq.body.endpoint === 'https://push.example.com/v1/sub-ui-test', JSON.stringify(testReq?.body));

  // 3) Cập nhật snapshot khi đổi kỳ thi
  await page.evaluate(() => window.EduPulsePush.updateSnapshot());
  await page.waitForFunction(() => true, null, { timeout: 500 });
  await page.waitForTimeout(500);
  const snapReq = pushRequests.find(r => r.path === '/update-snapshot');
  check('POST /update-snapshot với snapshot mới', !!snapReq && snapReq.body.snapshot?.days === 5, JSON.stringify(snapReq?.body?.snapshot));

  // 4) Đổi ngày thi → snapshot cập nhật qua saveState (throttle 3s)
  await page.evaluate(date => {
    window.EDUPULSE_APP.updateExam('e1', { date });
  }, new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10));
  await page.waitForTimeout(4000);
  const latestSnap = pushRequests.filter(r => r.path === '/update-snapshot').pop();
  check('saveState → snapshot days cập nhật = 2', latestSnap?.body?.snapshot?.days === 2, JSON.stringify(latestSnap?.body?.snapshot));

  // 5) Tắt nhắc
  await page.click('#btn-toggle-push');
  await page.waitForFunction(() => {
    const el = document.getElementById('push-status-label');
    return el && el.textContent.includes('Đang tắt');
  }, null, { timeout: 10000 });
  const unsubReq = pushRequests.find(r => r.path === '/unsubscribe');
  check('Đã POST /unsubscribe', !!unsubReq && !!unsubReq.body.endpoint, JSON.stringify(unsubReq?.body));
  check('Hủy đăng ký push trong trình duyệt', await page.evaluate(() => window.__fakeSub === null), '');

  await browser.close();

  // 6) Không cấu hình worker URL → tính năng ẩn
  const context2 = await browser2Check();
  check('Không cấu hình worker → section ẩn', context2 === true, '');
  server.close();
}

async function browser2Check() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.route('**/js/push-config.js*', route => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: 'window.EDUPULSE_PUSH_WORKER_URL = \'\'; window.EDUPULSE_VAPID_PUBLIC_KEY = \'\';'
  }));
  const page = await context.newPage();
  await page.goto('http://localhost:' + PORT + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.EduPulsePush, null, { timeout: 15000 });
  await page.waitForTimeout(800);
  const visible = await page.locator('#push-toggle-section').isVisible().catch(() => false);
  const supported = await page.evaluate(() => window.EduPulsePush.status().then(s => s.supported));
  await browser.close();
  return !visible && !supported;
}

(async () => {
  await testSwHandlers();
  await testBrowser();
  const failed = results.filter(r => !r.ok);
  console.log('\n===== ' + (failed.length === 0 ? 'TẤT CẢ ' + results.length + ' TEST PASS' : failed.length + '/' + results.length + ' TEST FAIL') + ' =====');
  process.exit(failed.length === 0 ? 0 : 1);
})().catch(err => { console.error('FATAL:', err); process.exit(1); });