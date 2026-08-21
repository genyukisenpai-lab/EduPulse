/**
 * EduPulse — Mobile + PWA (iOS) full-feature test suite.
 * Targets: https://tsa1-69053.web.app (production)
 * Engines : Chromium (iPhone 13 emulation) + WebKit (Safari engine, iPhone 13)
 *
 * Run: node test_mobile_pwa.js
 */
const { chromium, webkit, devices } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE_URL = process.env.EDUPULSE_TEST_URL || 'https://tsa1-69053.web.app';
const SHOTS_DIR = path.join(__dirname, 'screenshots', 'mobile-test');
if (!fs.existsSync(SHOTS_DIR)) fs.mkdirSync(SHOTS_DIR, { recursive: true });

const results = [];
let section = '';
function group(name) { section = name; console.log(`\n=== ${name} ===`); }
function check(name, ok, detail = '') {
  results.push({ section, name, ok, detail });
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
  return ok;
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const iPhone = devices['iPhone 13'];

async function capture(page, name) {
  await page.screenshot({ path: path.join(SHOTS_DIR, name + '.png'), fullPage: false });
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION A — PWA static configuration (manifest + iOS meta tags)
// ─────────────────────────────────────────────────────────────────────────────
async function testStaticPwa(browser) {
  group('A. PWA static config (manifest + iOS meta)');
  const page = await browser.newPage();
  const resp = await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  check('A1. Page loads (HTTP 200)', resp && resp.ok(), resp ? String(resp.status()) : 'no response');

  const manifestResp = await page.request.get(BASE_URL + '/manifest.webmanifest');
  let manifest = null;
  try { manifest = JSON.parse(await manifestResp.text()); } catch (e) { /* ignore */ }
  check('A2. Manifest valid JSON', !!manifest, manifest ? '' : 'parse failed');
  if (manifest) {
    check('A3. Manifest name/short_name', !!manifest.name && !!manifest.short_name, `${manifest.short_name}`);
    check('A4. display=standalone', manifest.display === 'standalone', String(manifest.display));
    check('A5. start_url + scope', !!manifest.start_url && !!manifest.scope, `${manifest.start_url} / ${manifest.scope}`);
    check('A6. theme_color + background_color', !!manifest.theme_color && !!manifest.background_color, `${manifest.theme_color} / ${manifest.background_color}`);
    check('A7. lang=vi', manifest.lang === 'vi', String(manifest.lang));
    const icons = manifest.icons || [];
    check('A8. Manifest has 192+512 icons', icons.some(i => i.sizes === '192x192') && icons.some(i => i.sizes === '512x512'), icons.map(i => i.sizes).join(', '));
    check('A9. 512 icon maskable', (icons.find(i => i.sizes === '512x512')?.purpose || '').includes('maskable'), icons.find(i => i.sizes === '512x512')?.purpose || '');
  }

  const meta = await page.evaluate(() => {
    const g = n => document.querySelector(`meta[name="${n}"]`)?.content || '';
    const appleIcon = document.querySelector('link[rel="apple-touch-icon"]');
    return {
      viewport: g('viewport'),
      capable: g('mobile-web-app-capable'),
      iosCapable: g('apple-mobile-web-app-capable'),
      iosStatusBar: g('apple-mobile-web-app-status-bar-style'),
      iosTitle: g('apple-mobile-web-app-title'),
      themeColor: g('theme-color'),
      appleTouchHref: appleIcon?.getAttribute('href') || '',
      appleTouchSizes: appleIcon?.getAttribute('sizes') || '',
    };
  });
  check('A10. viewport viewport-fit=cover', /viewport-fit=cover/.test(meta.viewport), meta.viewport);
  check('A11. apple-mobile-web-app-capable=yes', meta.iosCapable === 'yes', meta.iosCapable);
  check('A12. apple-mobile-web-app-status-bar-style', meta.iosStatusBar === 'black-translucent', meta.iosStatusBar);
  check('A13. apple-mobile-web-app-title', meta.iosTitle === 'EduPulse', meta.iosTitle);
  check('A14. apple-touch-icon 180x180 exists', meta.appleTouchSizes === '180x180' && /180\.png/.test(meta.appleTouchHref), `${meta.appleTouchSizes} ${meta.appleTouchHref}`);
  check('A15. theme-color meta', !!meta.themeColor, meta.themeColor);

  const icon180 = await page.request.get(BASE_URL + '/icons/app-icon-180.png');
  const icon192 = await page.request.get(BASE_URL + '/icons/app-icon-192.png');
  const icon512 = await page.request.get(BASE_URL + '/icons/app-icon-512.png');
  check('A16. app-icon-180.png OK (PNG)', icon180.ok() && (icon180.headers()['content-type'] || '').includes('image/png'), `${icon180.status()}`);
  check('A17. app-icon-192.png OK (PNG)', icon192.ok() && (icon192.headers()['content-type'] || '').includes('image/png'), `${icon192.status()}`);
  check('A18. app-icon-512.png OK (PNG)', icon512.ok() && (icon512.headers()['content-type'] || '').includes('image/png'), `${icon512.status()}`);

  const swResp = await page.request.get(BASE_URL + '/service-worker.js');
  check('A19. service-worker.js served', swResp.ok() && (swResp.headers()['cache-control'] || '').includes('no-cache'), `${swResp.status()} / ${swResp.headers()['cache-control']}`);
  await page.close();
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION B — PWA runtime (Chromium, iPhone emulation)
// ─────────────────────────────────────────────────────────────────────────────
async function testPwaRuntime() {
  group('B. PWA runtime (Chromium iPhone)');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ...iPhone });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(1500);

  const sw = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return { supported: false };
    await navigator.serviceWorker.ready;
    const reg = await navigator.serviceWorker.getRegistration();
    return {
      supported: true,
      scope: reg?.scope || null,
      active: !!reg?.active,
      activeState: reg?.active?.state,
    };
  });
  check('B1. Service worker registered', sw.supported && sw.active, JSON.stringify(sw));

  let shellCached = false;
  let cacheNames = [];
  try {
    const cacheInfo = await page.evaluate(async () => {
      const names = await caches.keys();
      const shell = names.find(n => n.includes('edupulse-shell'));
      if (!shell) return { names };
      const c = await caches.open(shell);
      const keys = await c.keys();
      return { names, cached: keys.map(k => new URL(k.url).pathname) };
    });
    cacheNames = cacheInfo.names;
    shellCached = (cacheInfo.cached || []).length >= 5;
    check('B2. App shell cached in SW cache', shellCached, JSON.stringify(cacheNames) + ' → ' + JSON.stringify(cacheInfo.cached?.slice(0, 6)));
  } catch (e) {
    check('B2. App shell cached in SW cache', false, 'caches API error: ' + e.message);
  }

  // iOS hint (iPhone UA → isIos true) — test TRƯỚC khi đóng để không che banner
  await sleep(1200);
  const iosHint = await page.locator('#ios-install-hint').count();
  check('B6. iOS install hint hiện trên iPhone UA', iosHint > 0, `count=${iosHint}`);
  if (iosHint) {
    await page.click('#ios-install-hint .ios-hint-done');
    await sleep(300);
    const flag = await page.evaluate(() => localStorage.getItem('edupulse_ios_install_hint_dismissed'));
    check('B7. iOS hint dismiss lưu flag', flag === '1', String(flag));
  }

  // beforeinstallprompt không bắn natively trong headless → dispatch thủ công
  // để test handler của pwa.js (banner + dismiss + flag).
  let promptShown = false;
  await page.evaluate(() => window.dispatchEvent(new Event('beforeinstallprompt')));
  await sleep(500);
  promptShown = await page.locator('#pwa-install-prompt').count() > 0;
  check('B3. Install banner (#pwa-install-prompt) hiện khi beforeinstallprompt', promptShown, promptShown ? '' : 'không hiện sau khi dispatch');
  if (promptShown) {
    await page.click('#pwa-install-prompt .pwa-dismiss-button');
    await sleep(300);
    const dismissed = await page.evaluate(() => localStorage.getItem('edupulse_install_banner_dismissed'));
    check('B4. Dismiss lưu flag localStorage', dismissed === '1', String(dismissed));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await sleep(1500);
    await page.evaluate(() => window.dispatchEvent(new Event('beforeinstallprompt')));
    await sleep(500);
    const reappeared = await page.locator('#pwa-install-prompt').count();
    check('B5. Banner không hiện lại sau dismiss', reappeared === 0, `count=${reappeared}`);
  }

  // Offline reload → app shell từ cache (các lỗi mạng trong phase offline là dự kiến)
  const offlinePhaseErrors = [];
  page.on('console', m => { if (m.type() === 'error' && m.text().includes('ERR_INTERNET') || (m.type() === 'error' && m.text().includes('ERR_FAILED'))) offlinePhaseErrors.push(m.text()); });
  await context.setOffline(true);
  const offlineOk = await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 }).then(() => true).catch(() => false);
  await sleep(1200);
  const offlineRendered = await page.evaluate(() => ({
    hasGreeting: !!document.getElementById('mobile-greeting-name'),
    bodyText: document.body.innerText.slice(0, 60),
  }));
  await context.setOffline(false);
  check('B8. Reload offline → app shell vẫn hiển thị', offlineOk && offlineRendered.hasGreeting, JSON.stringify(offlineRendered));

  // Offline navigate to random path → index.html (rewrite) via SW
  await context.setOffline(true);
  const navMiss = await page.goto(BASE_URL + '/some-random-page', { waitUntil: 'domcontentloaded', timeout: 20000 }).then(() => true).catch(() => false);
  const missRendered = await page.evaluate(() => !!document.getElementById('mobile-greeting-name')).catch(() => false);
  await context.setOffline(false);
  check('B9. Offline điều hướng path lạ → index.html', navMiss && missRendered, `nav=${navMiss}, rendered=${missRendered}`);

  const onlineErrors = consoleErrors.filter(e =>
    !offlinePhaseErrors.includes(e) &&
    !e.includes('Could not reach Cloud Firestore') &&
    !e.includes('Firestore backend')
  );
  check('B10. Không có console.error ngoài phase offline', onlineErrors.length === 0, onlineErrors.slice(0, 3).join(' | ') || '(chỉ lỗi Firestore offline dự kiến)');
  await capture(page, 'B_pwa_runtime');
  await browser.close();
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION C — iOS PWA (WebKit / Safari engine)
// ─────────────────────────────────────────────────────────────────────────────
async function testIosWebkit() {
  group('C. iOS PWA (WebKit — Safari engine)');
  const browser = await webkit.launch({ headless: true });
  const context = await browser.newContext({ ...iPhone });
  const page = await context.newPage();
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(1500);

  const sw = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return { supported: false };
    try {
      const reg = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise(r => setTimeout(() => r(null), 20000))
      ]);
      if (!reg) return { supported: true, active: false, note: 'ready timeout 20s' };
      return { supported: true, active: !!reg.active, state: reg.active?.state };
    } catch (e) { return { supported: true, active: false, err: String(e) }; }
  });
  check('C1. Service worker active trên WebKit', sw.active, JSON.stringify(sw));

  await sleep(1200);
  const iosHint = await page.locator('#ios-install-hint').count();
  check('C2. iOS install hint hiện (Safari UA)', iosHint > 0, `count=${iosHint}`);
  if (iosHint) {
    const hintText = await page.locator('#ios-install-hint').innerText();
    check('C3. Hint hướng dẫn "Thêm vào Màn hình chính"', /Màn hình chính/.test(hintText), hintText.slice(0, 80));
    await page.click('#ios-install-hint .ios-hint-close');
    await sleep(300);
    const flag = await page.evaluate(() => localStorage.getItem('edupulse_ios_install_hint_dismissed'));
    check('C4. Dismiss lưu flag', flag === '1', String(flag));
  }

  // Safari engine smoke: tabs + modal + AI composer
  await page.locator('.mobile-nav-btn[data-tab="tab-exams"]').tap();
  await sleep(400);
  check('C5. Tab Kỳ thi mở (WebKit)', await page.locator('#tab-exams.active').count() > 0);
  await page.locator('#btn-add-exam-page').tap();
  await sleep(300);
  check('C6. Modal thêm kỳ thi mở (WebKit)', await page.locator('#modal-exam.active').count() > 0);
  await page.locator('#modal-exam .btn-close-modal').tap();
  await sleep(200);
  check('C7. Modal đóng được (WebKit)', await page.locator('#modal-exam.active').count() === 0);

  await page.locator('.mobile-nav-btn[data-tab="tab-ai"]').tap();
  await sleep(500);
  check('C8. AI tab + composer (WebKit)', await page.locator('#ai-input').isVisible());
  const overflowW = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  check('C9. Không tràn ngang (WebKit)', !overflowW);
  await capture(page, 'C_ios_webkit');
  await browser.close();
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION D — Mobile full feature tests (Chromium iPhone)
// ─────────────────────────────────────────────────────────────────────────────
async function testMobileFeatures() {
  group('D. Mobile feature tests (Chromium iPhone)');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ...iPhone });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('dialog', d => d.accept());
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(2000);

  // D1. Mobile layout
  check('D1. Bottom nav có 6 nút', await page.locator('.mobile-bottom-nav').isVisible() && await page.locator('.mobile-nav-btn:visible').count() === 6, `count=${await page.locator('.mobile-nav-btn:visible').count()}`);
  check('D2. Sidebar desktop ẩn', !(await page.locator('.app-sidebar').isVisible()));
  check('D3. Mobile header hiện', await page.locator('.mobile-app-header').isVisible());

  // D2. Theme toggle
  await page.locator('#btn-mobile-theme').tap();
  await sleep(300);
  const theme = await page.evaluate(() => ({ attr: document.body.getAttribute('data-theme'), stored: localStorage.getItem('edupulse_theme') }));
  check('D4. Dark mode bật + lưu', theme.attr === 'dark' && theme.stored === 'dark', JSON.stringify(theme));
  const toastShown = await page.locator('.app-toast.show').count() > 0;
  check('D5. Toast hiện khi đổi theme', toastShown);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await sleep(1500);
  check('D6. Dark mode giữ sau reload', await page.evaluate(() => document.body.getAttribute('data-theme')) === 'dark');
  await page.locator('#btn-mobile-theme').tap();
  await sleep(200);

  // D3. Home hero + greeting (đóng hint iOS nếu đang che nội dung)
  const hint = page.locator('#ios-install-hint');
  if (await hint.count() > 0) {
    await page.locator('#ios-install-hint .ios-hint-done').tap().catch(() => page.locator('#ios-install-hint .ios-hint-close').tap());
    await sleep(300);
  }
  check('D7. Greeting hiển thị', /Xin chào/.test(await page.locator('#mobile-greeting-name').innerText()));

  // D4. Add exam (from Home)
  await page.locator('#btn-home-add-exam').tap();
  await sleep(400);
  await page.fill('#exam-name', 'Thi HSA Đợt 1 - 2027');
  await page.selectOption('#exam-category', 'hsa');
  await page.selectOption('#exam-priority', 'high');
  await page.fill('#exam-date', '2027-06-25');
  await page.fill('#exam-time', '07:30');
  await page.fill('#exam-notes', 'Mục tiêu 110/150');
  await page.locator('#form-exam button[type="submit"]').tap();
  await sleep(600);
  check('D9. Thêm kỳ thi thành công (toast)', /Đã thêm/.test(await page.locator('.app-toast').innerText().catch(() => '')));
  check('D10. Kỳ thi hiện trên Home mini list', (await page.locator('#home-exam-list .exam-mini-item').count()) === 1);
  check('D11. Hero cập nhật tên kỳ thi', (await page.locator('#hero-exam-title').innerText()).includes('HSA'));
  const nearest = await page.locator('#home-stat-nearest').innerText();
  check('D12. Stat "Kỳ thi gần nhất" cập nhật', /ngày/.test(nearest), nearest);

  // Đồng hồ hero tick (cần có kỳ thi trước)
  const t0 = await page.locator('#hero-seconds').innerText();
  await sleep(2100);
  const t1 = await page.locator('#hero-seconds').innerText();
  check('D8. Đồng hồ hero tick mỗi giây', t0 !== t1, `${t0} → ${t1}`);

  // D5. Persistence
  await page.reload({ waitUntil: 'domcontentloaded' });
  await sleep(1500);
  check('D13. Kỳ thi còn lại sau reload (localStorage)', (await page.locator('#home-exam-list .exam-mini-item').count()) === 1);

  // D6. Add more exams + filters
  await page.locator('.mobile-nav-btn[data-tab="tab-exams"]').tap();
  await sleep(400);
  for (const [name, cat] of [['THPT Quốc Gia 2027', 'thpt'], ['HSG Toán 2027', 'hsg']]) {
    await page.locator('#btn-add-exam-page').tap();
    await sleep(300);
    await page.fill('#exam-name', name);
    await page.selectOption('#exam-category', cat);
    await page.fill('#exam-date', '2027-03-15');
    await page.locator('#form-exam button[type="submit"]').tap();
    await sleep(400);
  }
  check('D14. Có 3 card kỳ thi', (await page.locator('#exam-grid .exam-full-card').count()) === 3, `count=${await page.locator('#exam-grid .exam-full-card').count()}`);
  await page.locator('[data-exam-filter="thpt"]').tap();
  await sleep(300);
  check('D15. Filter THPT → 1 card', (await page.locator('#exam-grid .exam-full-card').count()) === 1);
  await page.locator('[data-exam-filter="hsa"]').tap();
  await sleep(300);
  check('D16. Filter HSA/TSA → 1 card', (await page.locator('#exam-grid .exam-full-card').count()) === 1);
  await page.locator('[data-exam-filter="all"]').tap();
  await sleep(300);

  // D7. Set hero
  await page.locator('#exam-grid .exam-full-card').first().locator('[data-hero-exam]').tap();
  await sleep(500);
  const heroTitle = await page.locator('#hero-exam-title').innerText();
  check('D17. Đặt kỳ thi trọng tâm (hero)', (await page.locator('.app-toast').innerText()).includes('trọng tâm') || heroTitle.includes('HSA'), heroTitle);

  // D8. Edit exam
  await page.locator('#exam-grid .exam-full-card').first().locator('[data-edit-exam]').tap();
  await sleep(400);
  const prefilled = await page.inputValue('#exam-name');
  await page.fill('#exam-name', 'Thi HSA Đợt 1 - 2027 (Đã sửa)');
  await page.locator('#form-exam button[type="submit"]').tap();
  await sleep(500);
  const editedVisible = await page.locator('#exam-grid .exam-full-card').first().innerText();
  check('D18. Sửa kỳ thi (form prefill + lưu)', /Đã sửa/.test(editedVisible) && prefilled.includes('HSA'), prefilled);

  // D9. Hero card → exams tab (nút chi tiết ẩn trên mobile, bấm cả thẻ hero)
  await page.locator('.mobile-nav-btn[data-tab="tab-home"]').tap();
  await sleep(300);
  await page.locator('.hero-countdown-card').tap();
  await sleep(300);
  check('D19. Bấm thẻ hero mở tab Kỳ thi', await page.locator('#tab-exams.active').count() > 0);

  // D10. Delete exam (modal xác nhận)
  await page.locator('#exam-grid .exam-full-card').first().locator('[data-delete-exam]').tap();
  await sleep(400);
  await page.locator('#btn-confirm-ok').tap();
  await sleep(500);
  check('D20. Xóa kỳ thi (confirm) → còn 2 card', (await page.locator('#exam-grid .exam-full-card').count()) === 2, `count=${await page.locator('#exam-grid .exam-full-card').count()}`);

  // D11. AI tab — subject chips (gợi ý nhanh trên mobile)
  await page.locator('.mobile-nav-btn[data-tab="tab-ai"]').tap();
  await sleep(500);
  const composerVisible = await page.locator('#ai-form input').isVisible();
  check('D21. Composer AI hiển thị', composerVisible, await page.locator('#ai-form input').getAttribute('placeholder').catch(() => ''));
  const chipCount = await page.locator('#ai-subject-chips button').count();
  check('D22. Có 9 chip môn học', chipCount === 9, `count=${chipCount}`);
  const aiBefore = await page.locator('#ai-messages .ai-message.assistant').count();
  await page.locator('#ai-subject-chips button').first().tap();
  await sleep(500);
  check('D23. Bấm chip môn → gửi câu hỏi + có reply', await page.locator('#ai-messages .ai-message.user').count() > 0, `user msgs=${await page.locator('#ai-messages .ai-message.user').count()}`);
  // Wait for streaming/offline reply to finish
  let aiDone = false;
  for (let i = 0; i < 60; i++) {
    await sleep(2000);
    const now = await page.locator('#ai-messages .ai-message.assistant').count();
    const thinking = await page.locator('.ai-thinking, [id^="ai-thinking-"]').count();
    if (now > aiBefore && !thinking) { aiDone = true; break; }
  }
  check('D24. AI trả lời hoàn tất (online/offline)', aiDone);
  await capture(page, 'D_ai_chat');

  // D12. Community chat
  await page.locator('.mobile-nav-btn[data-tab="tab-chat"]').tap();
  await sleep(500);
  check('D25. Tab Cộng đồng mở', await page.locator('#tab-chat.active').count() > 0);
  await page.fill('#chat-message', 'Xin chào mọi người!');
  await page.locator('#chat-form button[type="submit"]').tap();
  await sleep(600);
  const redirectedToAccount = await page.locator('#tab-account.active').count() > 0;
  check('D26. Chat khi chưa đăng nhập → cảnh báo + về tab Tài khoản', redirectedToAccount);

  // D13. Account tab — guest views & auth form behaviors
  await sleep(300);
  check('D27. Guest view hiển thị (form đăng nhập)', await page.locator('#account-guest-view').isVisible());
  await page.locator('#btn-tab-register').tap();
  await sleep(300);
  check('D28. Chuyển sang Đăng ký → hiện ô tên', await page.locator('#auth-name-group').isVisible());
  await page.locator('#btn-tab-login').tap();
  await sleep(200);
  check('D29. Trở về Đăng nhập → ẩn ô tên', !(await page.locator('#auth-name-group').isVisible()));
  await page.locator('#btn-toggle-password').tap();
  await sleep(200);
  const pwdType = await page.inputValue('#auth-password') === undefined ? '?' : await page.evaluate(() => document.getElementById('auth-password').type);
  check('D30. Nút mắt đổi type password ↔ text', pwdType === 'text', `type=${pwdType}`);
  await page.locator('#btn-forgot-password').tap();
  await sleep(300);
  check('D31. Modal quên mật khẩu mở', await page.locator('#modal-forgot-password.active').count() > 0);
  await page.locator('#modal-forgot-password .btn-close-modal').tap();
  await sleep(200);
  check('D32. Modal quên mật khẩu đóng', await page.locator('#modal-forgot-password.active').count() === 0);
  await page.fill('#auth-email', 'not-an-email');
  await page.fill('#auth-password', '123456');
  await page.locator('#auth-form button[type="submit"]').tap();
  await sleep(1500);
  const errorToast = await page.locator('.app-toast').innerText().catch(() => '');
  check('D33. Email sai → toast lỗi, không crash', /[@]/.test(errorToast) || /mail/i.test(errorToast) || /không hợp lệ/i.test(errorToast), errorToast.slice(0, 60));

  // D14. Library empty state (vào qua Tài khoản — nút nav Tài liệu ẩn trên iOS)
  await page.locator('.mobile-nav-btn[data-tab="tab-account"]').tap();
  await sleep(400);
  await page.locator('#btn-open-library-account').tap();
  await sleep(400);
  const libEmpty = await page.locator('.library-empty').count() > 0;
  check('D34. Thư viện rỗng hiện hướng dẫn', libEmpty);

  // D15. Horizontal overflow on all tabs
  const tabs = ['tab-home', 'tab-exams', 'tab-ai', 'tab-chat', 'tab-library', 'tab-account'];
  const overflow = [];
  for (const t of tabs) {
    if (t === 'tab-library') {
      await page.locator('.mobile-nav-btn[data-tab="tab-account"]').tap();
      await sleep(350);
      await page.locator('#btn-open-library-account').tap();
    } else {
      await page.locator(`.mobile-nav-btn[data-tab="${t}"]`).tap();
    }
    await sleep(350);
    const w = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    if (w) overflow.push(t);
  }
  check('D35. Không tab nào tràn ngang', overflow.length === 0, overflow.join(', '));

  // D16. Chat composer not covered by bottom nav
  await page.locator('.mobile-nav-btn[data-tab="tab-chat"]').tap();
  await sleep(400);
  const composerRect = await page.locator('#chat-form').boundingBox();
  const navRect = await page.locator('.mobile-bottom-nav').boundingBox();
  const notCovered = composerRect && navRect && composerRect.y + composerRect.height <= navRect.y + 4;
  check('D36. Composer chat không bị bottom nav che', !!notCovered, JSON.stringify({ c: composerRect?.y, n: navRect?.y }));

  const relevantErrors = consoleErrors.filter(e => !e.includes('429') && !e.includes('Firebase') && !e.includes('MISSING_ENTITLEMENTS') && !e.includes('status of 400'));
  check('D37. Không console.error bất thường', relevantErrors.length === 0, relevantErrors.slice(0, 3).join(' | ') || '(400 từ test email sai là dự kiến)');
  await capture(page, 'D_final');
  await browser.close();
}

// ─────────────────────────────────────────────────────────────────────────────
(async () => {
  console.log('EduPulse Mobile + PWA test suite');
  console.log('Target:', BASE_URL);
  const started = Date.now();
  const browser = await chromium.launch({ headless: true });

  try { await testStaticPwa(browser); } catch (e) { check('A (suite)', false, e.message); }
  await browser.close();

  try { await testPwaRuntime(); } catch (e) { check('B (suite)', false, e.message); }
  try { await testIosWebkit(); } catch (e) { check('C (suite)', false, e.message); }
  try { await testMobileFeatures(); } catch (e) { check('D (suite)', false, e.message); }

  const passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;
  console.log('\n════════════════════════════════════════════');
  console.log(`KẾT QUẢ: ${passed} PASS / ${failed} FAIL (${results.length} total) — ${Math.round((Date.now() - started) / 1000)}s`);
  if (failed > 0) {
    console.log('\nDanh sách FAIL:');
    results.filter(r => !r.ok).forEach(r => console.log(`  ❌ [${r.section}] ${r.name} ${r.detail ? '— ' + r.detail : ''}`));
  }
  process.exit(failed > 0 ? 1 : 0);
})();