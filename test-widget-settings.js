// Test "Tùy chỉnh trang chủ" — toàn bộ nội dung widget:
//  A) Mở modal từ 3 điểm (home, mobile, account), dữ liệu form khớp cấu hình
//  B) Sửa nội dung + lưu → áp dụng ngay trên trang (tiêu đề, nhãn, bật/tắt, icon, chữ widget con)
//  C) Khôi phục mặc định
//  D) Widget con: text cố định (không có {n}) + {n} thay số liệu thực
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = 3200;
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + detail : ''));
}

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

(async () => {
  const server = await startStaticServer();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));

  await page.goto('http://localhost:' + PORT + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.EDUPULSE_APP, null, { timeout: 15000 });
  await page.waitForTimeout(1000);

  // A1) Nút mở trên trang chủ (desktop)
  const homeBtn = page.locator('#btn-open-widget-settings');
  check('Nút "Tùy chỉnh" trên trang chủ tồn tại', (await homeBtn.count()) === 1, '');
  await homeBtn.click();
  await page.waitForFunction(() => document.getElementById('modal-widget-settings').classList.contains('active'), null, { timeout: 5000 });
  check('Modal tùy chỉnh mở được từ trang chủ', true, '');

  // A2) Form điền đúng cấu hình mặc định
  const greetingTitle = await page.inputValue('#ws-greeting-title');
  check('Form lời chào khớp mặc định', greetingTitle === 'Xin chào, Sĩ tử 👋', greetingTitle);
  check('3 widget con được render', (await page.locator('#ws-community-items .ws-item-row').count()) === 3, '');

  // B1) Sửa nội dung và lưu
  await page.fill('#ws-greeting-title', 'Chào sĩ tử 2k9 👋');
  await page.fill('#ws-greeting-sub', 'Chinh phục từng mục tiêu hôm nay!');
  await page.fill('#ws-hero-kicker', 'KỲ THI QUAN TRỌNG NHẤT');
  await page.fill('#ws-stat-target', 'Tiến độ tuần');
  await page.fill('#ws-stat-nearest', 'Ngày thi sắp tới');
  await page.fill('#ws-stat-streak', 'Ngày học liên tục');
  await page.fill('#ws-exams-title', 'Mục tiêu của tôi');
  await page.fill('#ws-community-title', 'Hội học hành');
  await page.fill('#ws-community-subtext', 'Chia sẻ bí kíp ôn thi.');
  // Widget con 1: text cố định (bỏ {n})
  await page.fill('.ws-item-text[data-i="0"]', 'Truy cập phòng chat ngay');
  await page.selectOption('.ws-item-icon[data-i="1"]', 'fa-solid fa-users');
  await page.selectOption('.ws-item-tab[data-i="1"]', 'tab-ai');
  // Ẩn hero
  await page.uncheck('#ws-hero-enabled');
  await page.click('#btn-widget-save');
  await page.waitForTimeout(800);

  // B2) Áp dụng ngay trên trang
  const appliedTitle = await page.textContent('#home-greeting-title');
  check('Lời chào đã áp dụng', appliedTitle === 'Chào sĩ tử 2k9 👋', appliedTitle);
  const heroHidden = await page.evaluate(() => document.getElementById('hero-countdown-box').style.display === 'none');
  check('Ẩn hero theo cấu hình', heroHidden, '');
  check('Nhãn thẻ thống kê đổi', (await page.textContent('#home-stat-target-label')) === 'Tiến độ tuần', '');
  check('Tiêu đề bảng kỳ thi đổi', (await page.textContent('#home-panel-exams-title')) === 'Mục tiêu của tôi', '');
  check('Tiêu đề bảng cộng đồng đổi', (await page.textContent('#home-panel-community-title')) === 'Hội học hành', '');

  // B3) Widget con: chữ cố định + icon/tab đổi
  const item1 = page.locator('#community-widget-list .community-widget-item').nth(0);
  check('Widget con 1: chữ cố định', (await item1.textContent()).trim() === 'Truy cập phòng chat ngay', await item1.textContent());
  check('Widget con 1 vẫn mở chat', (await item1.getAttribute('data-tab')) === 'tab-chat', '');
  const item2 = page.locator('#community-widget-list .community-widget-item').nth(1);
  check('Widget con 2: icon đổi', (await item2.locator('i').getAttribute('class')).includes('fa-users'), '');
  check('Widget con 2 mở AI tab', (await item2.getAttribute('data-tab')) === 'tab-ai', '');

  // B4) Lưu vào localStorage (đồng bộ qua tài khoản)
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('edupulse_data')).widgets);
  check('Cấu hình đã lưu vào state (widgets.greetingTitle)', saved.greetingTitle === 'Chào sĩ tử 2k9 👋' && saved.communityItems[0].text === 'Truy cập phòng chat ngay', JSON.stringify(saved).slice(0, 150));

  // B5) {n} thay số liệu thực — widget con 2 giữ mặc định template
  await page.click('[data-tab="tab-account"]');
  await page.waitForTimeout(400);
  await page.click('#btn-open-widget-settings-account');
  await page.waitForTimeout(400);
  await page.fill('.ws-item-text[data-i="1"]', '{n} bạn học thân thiết');
  await page.click('#btn-widget-save');
  await page.waitForTimeout(500);
  const item2Text = await page.locator('#community-widget-list .community-widget-item').nth(1).textContent();
  check('{n} thay bằng số liệu thực', /^\d+ bạn học thân thiết$/.test(item2Text.trim()), item2Text.trim());

  // C) Khôi phục mặc định
  await page.click('[data-tab="tab-home"]');
  await page.waitForTimeout(400);
  await page.click('#btn-open-widget-settings');
  await page.waitForTimeout(400);
  await page.click('#btn-widget-reset');
  await page.waitForTimeout(500);
  check('Khôi phục mặc định: lời chào gốc', (await page.textContent('#home-greeting-title')) === 'Xin chào, Sĩ tử 👋', '');
  check('Khôi phục mặc định: hero hiện lại', await page.evaluate(() => document.getElementById('hero-countdown-box').style.display === ''), '');
  check('Khôi phục mặc định: 3 widget con gốc', (await page.locator('#community-widget-list .community-widget-item').count()) === 3, '');

  check('Không có lỗi JS', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 200));

  await browser.close();
  server.close();
  const failed = results.filter(r => !r.ok);
  console.log('\n===== ' + (failed.length === 0 ? 'TẤT CẢ ' + results.length + ' TEST PASS' : failed.length + '/' + results.length + ' TEST FAIL') + ' =====');
  process.exit(failed.length === 0 ? 0 : 1);
})().catch(err => { console.error('FATAL:', err); process.exit(1); });