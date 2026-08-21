const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = 3111;
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml' };

const server = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];
  let filePath = path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath);
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', err => errors.push(String(err)));
  await page.goto('http://localhost:' + PORT + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.EDUPULSE_APP, null, { timeout: 20000 });
  await page.waitForTimeout(1500);
  const checks = [];
  const report = (name, ok, detail) => { checks.push({ name, ok, detail }); console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + detail : '')); };

  report('mobile nav có 5 nút', await page.locator('.mobile-bottom-nav .mobile-nav-btn').count() === 5, String(await page.locator('.mobile-bottom-nav .mobile-nav-btn').count()));
  report('nav không còn nút Tài liệu', await page.locator('.mobile-bottom-nav [data-tab="tab-library"]').count() === 0, '');
  report('skeleton đã gỡ sau renderAll', await page.locator('.skeleton').count() === 0, String(await page.locator('.skeleton').count()));
  report('KaTeX chưa tải lúc khởi động', await page.evaluate(() => !window.katex), '');
  const cssLoaded = await page.evaluate(() => [...document.styleSheets].some(s => (s.href || '').includes('ios-pwa.css')));
  report('ios-pwa.css được nạp', cssLoaded, '');

  await page.click('.mobile-bottom-nav [data-tab="tab-account"]');
  await page.waitForTimeout(300);
  report('Account có hàng "Tài liệu của tôi"', await page.locator('#btn-open-library-account').count() === 1, '');

  await page.click('.mobile-bottom-nav [data-tab="tab-exams"]');
  await page.waitForTimeout(300);
  await page.click('#btn-add-exam-page');
  await page.waitForTimeout(400);
  const sheetActive = await page.evaluate(() => {
    const bd = document.getElementById('modal-exam');
    const card = bd.querySelector('.modal-card');
    return bd.classList.contains('active') && getComputedStyle(card).borderRadius === '22px 22px 0px 0px';
  });
  report('Modal exam là bottom sheet (active + bo góc trên)', sheetActive, '');
  await page.fill('#exam-name', 'Thi thử HSA');
  await page.fill('#exam-date', '2027-06-25');
  await page.click('#form-exam button[type="submit"]');
  await page.waitForTimeout(500);
  report('Sheet đóng sau khi lưu exam', await page.evaluate(() => !document.getElementById('modal-exam').classList.contains('active')), '');

  await page.click('#btn-add-exam-page');
  await page.waitForTimeout(400);
  await page.click('#modal-exam');
  await page.waitForTimeout(350);
  report('Tap backdrop đóng sheet', await page.evaluate(() => !document.getElementById('modal-exam').classList.contains('active')), '');
  await page.click('[data-close="modal-exam"]').catch(() => {});
  await page.waitForTimeout(100);

  const tickWorks = await page.evaluate(() => new Promise(resolve => {
    const el = document.getElementById('hero-seconds');
    setTimeout(() => resolve(el.classList.contains('tick')), 1400);
  }));
  report('Timer giây chạy + có class tick', tickWorks, '');

  const heroFlat = await page.evaluate(() => getComputedStyle(document.getElementById('hero-countdown-box')).boxShadow === 'none');
  report('Hero phẳng (box-shadow none)', heroFlat, '');

  const tabBar = await page.evaluate(() => {
    const nav = document.querySelector('.mobile-bottom-nav');
    return getComputedStyle(nav).borderRadius === '26px';
  });
  report('Tab bar floating pill (radius 26px)', tabBar, '');

  report('Không lỗi JS', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  server.close();
  const failed = checks.filter(c => !c.ok).length;
  console.log(failed === 0 ? '===== TẤT CẢ OK =====' : '===== ' + failed + ' FAIL =====');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });