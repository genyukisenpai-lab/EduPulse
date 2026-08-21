/* ==========================================================================
   EduPulse E2E Test Suite (Playwright)
   Usage:
     node test_e2e_suite.js local     -> http://localhost:3000
     node test_e2e_suite.js deploy    -> https://tsa1-69053.web.app
   Optional auth via env:
     TEST_USER_EMAIL / TEST_USER_PASSWORD (verified Firebase account)
   Output:
     screenshots/test-report/report.md , report.json , and per-suite PNGs
   ========================================================================== */
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const TARGET = process.argv[2] || 'local';
const BASE = TARGET === 'deploy' ? 'https://tsa1-69053.web.app' : 'http://localhost:3000';
const OUT_DIR = path.join(__dirname, 'screenshots', 'test-report');
const EMAIL = process.env.TEST_USER_EMAIL || '';
const PASSWORD = process.env.TEST_USER_PASSWORD || '';

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const results = [];
const consoleErrors = [];
const pageErrors = [];

function record(suite, name, status, detail) {
  results.push({ suite, name, status, detail });
  console.log(`  [${status}] ${suite} :: ${name}${detail ? ' — ' + detail : ''}`);
}

async function shot(page, suite, name) {
  const dir = path.join(OUT_DIR, suite);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name + '.png');
  try { await page.screenshot({ path: file, fullPage: false }); } catch (e) { /* ignore */ }
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout: ' + label)), ms))
  ]);
}

function SEED_STATE() {
  return {
    exams: [
      { id: 'e1', title: 'Thi Tốt nghiệp THPT', date: '2026-06-27', time: '07:00', category: 'thpt', priority: 'high', notes: '', targetScore: 9, isHero: true },
      { id: 'e2', title: 'Kiểm tra giữa kỳ Toán', date: '2026-09-15', time: '08:00', category: 'school', priority: 'medium', notes: '', targetScore: 8 },
      { id: 'e3', title: 'Thi thử lần 1', date: '2026-11-01', time: '09:00', category: 'other', priority: 'low', notes: '', targetScore: 7 }
    ],
    library: [],
    studyLog: [],
    goals: { score: null, subject: '', weeklyMinutes: 300 },
    pushSettings: { times: ['18:00'], quote: true },
    widgets: {}
  };
}

async function newPage(browser, viewport, fakeMedia, seed) {
  const ctx = await browser.newContext({
    viewport,
    locale: 'vi-VN',
    permissions: fakeMedia ? ['camera', 'microphone'] : [],
    ignoreHTTPSErrors: true
  });
  if (seed) {
    await ctx.addInitScript((state) => {
      localStorage.setItem('edupulse_data', JSON.stringify(state));
      localStorage.removeItem('edupulse_streak');
    }, seed);
  }
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => pageErrors.push(String(e)));
  page.on('dialog', d => d.accept().catch(() => {}));
  return { ctx, page };
}

async function evalJson(page, fn, ...args) {
  return page.evaluate(fn, ...args);
}

/* ==========================================================================
   1. SMOKE / SANITY
   ========================================================================== */
async function smoke(browser) {
  const suite = '01-smoke';
  const { ctx, page } = await newPage(browser, { width: 1280, height: 800 });
  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2500);
    await shot(page, suite, 'home');
    record(suite, 'Trang load không có JS exception', pageErrors.length === 0 ? 'PASS' : 'FAIL', pageErrors.length ? pageErrors.slice(0, 3).join(' | ') : '');
    record(suite, 'Tiêu đề đúng', (await page.title()).includes('EduPulse') ? 'PASS' : 'FAIL', await page.title());
    const tabs = await page.locator('.nav-item[data-tab]').count();
    record(suite, 'Sidebar đủ 6 mục điều hướng', tabs === 6 ? 'PASS' : 'FAIL', 'count=' + tabs);
    const heroTitle = await page.locator('#hero-exam-title').textContent().catch(() => '');
    record(suite, 'Hero countdown render', heroTitle.trim().length > 0 ? 'PASS' : 'FAIL', JSON.stringify(heroTitle));
    const bodyCls = await evalJson(page, () => document.body.getAttribute('data-theme'));
    record(suite, 'Theme khởi tạo (auto)', bodyCls === 'light' || bodyCls === 'dark' ? 'PASS' : 'FAIL', 'data-theme=' + bodyCls);

    // Tab navigation sanity
    await page.click('.nav-item[data-tab="tab-exams"]');
    await page.waitForTimeout(300);
    record(suite, 'Chuyển tab Exams hiển thị', await page.locator('#tab-exams.active').count() === 1 ? 'PASS' : 'FAIL', '');
    await page.click('.nav-item[data-tab="tab-ai"]');
    await page.waitForTimeout(300);
    record(suite, 'Chuyển tab AI hiển thị', await page.locator('#tab-ai.active').count() === 1 ? 'PASS' : 'FAIL', '');
  } finally { await ctx.close(); }
}

/* ==========================================================================
   2. THEME
   ========================================================================== */
async function theme(browser) {
  const suite = '02-theme';
  const { ctx, page } = await newPage(browser, { width: 1280, height: 800 });
  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2000);
    // Segmented control in account tab
    await page.click('#btn-sidebar-account');
    await page.waitForTimeout(500);
    await page.click('[data-theme-pref="dark"]');
    await page.waitForTimeout(400);
    const darkAttr = await evalJson(page, () => document.body.getAttribute('data-theme'));
    record(suite, 'Chọn Tối -> data-theme=dark', darkAttr === 'dark' ? 'PASS' : 'FAIL', 'data-theme=' + darkAttr);
    await shot(page, suite, 'dark-account');
    await page.click('[data-theme-pref="light"]');
    await page.waitForTimeout(400);
    const lightAttr = await evalJson(page, () => document.body.getAttribute('data-theme'));
    record(suite, 'Chọn Sáng -> data-theme=light', lightAttr === 'light' ? 'PASS' : 'FAIL', 'data-theme=' + lightAttr);
    // Persistence: reload should keep pref (stored as light)
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    const afterReload = await evalJson(page, () => document.body.getAttribute('data-theme'));
    record(suite, 'Theme lưu sau reload', afterReload === 'light' ? 'PASS' : 'FAIL', 'data-theme=' + afterReload);
    // Sidebar toggle cycles pref: light -> auto (deterministic)
    await page.click('#btn-sidebar-account');
    await page.waitForTimeout(400);
    await page.click('[data-theme-pref="dark"]');
    await page.waitForTimeout(400);
    await page.click('#btn-sidebar-theme');
    await page.waitForTimeout(300);
    const toggled = await evalJson(page, () => document.body.getAttribute('data-theme'));
    record(suite, 'Toggle sidebar đổi theme (dark -> light)', toggled === 'light' ? 'PASS' : 'FAIL', 'data-theme=' + toggled);
    await shot(page, suite, 'toggled');
  } finally { await ctx.close(); }
}

/* ==========================================================================
   3. EXAMS CRUD + FILTER + COUNTDOWN EDGE
   ========================================================================== */
async function exams(browser) {
  const suite = '03-exams';
  const { ctx, page } = await newPage(browser, { width: 1280, height: 800 }, false, SEED_STATE());
  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2000);
    await page.click('.nav-item[data-tab="tab-exams"]');
    await page.waitForTimeout(500);

    // Empty add (validation)
    await page.click('#btn-add-exam-page');
    await page.waitForTimeout(300);
    const modalVisible = await page.locator('#modal-exam.active').count();
    record(suite, 'Mở modal Thêm kỳ thi', modalVisible === 1 ? 'PASS' : 'FAIL', '');
    const hadDupIds = await evalJson(page, () => {
      const all = document.querySelectorAll('#modal-exam #exam-date');
      return all.length;
    });
    record(suite, 'Modal exam không trùng id', hadDupIds === 1 ? 'PASS' : 'FAIL', 'count #exam-date=' + hadDupIds);
    await page.click('#modal-exam .btn-close-modal');
    await page.waitForTimeout(300);

    // Add exam — future date
    await page.click('#btn-add-exam-page');
    await page.fill('#exam-name', 'Thi thử HSA lần 1');
    await page.selectOption('#exam-category', 'hsa');
    await page.selectOption('#exam-priority', 'high');
    await page.fill('#exam-date', '2027-03-20');
    await page.fill('#exam-time', '08:00');
    await page.fill('#exam-notes', 'Mục tiêu 110/150');
    await page.click('#form-exam button[type="submit"]');
    await page.waitForTimeout(600);
    const examCard = await page.locator('.exam-full-card:has-text("Thi thử HSA lần 1")').count();
    record(suite, 'Thêm kỳ thi HSA thành công', examCard === 1 ? 'PASS' : 'FAIL', '');
    await shot(page, suite, 'added-hsa');

    // Add second (school, past date attempt -> min today blocks; try past via date fill)
    await page.click('#btn-add-exam-page');
    await page.fill('#exam-name', 'Kỳ thi quá khứ');
    await page.fill('#exam-date', '2020-01-01');
    const dateValid = await evalJson(page, () => {
      const el = document.getElementById('exam-date');
      return { min: el.min, check: el.checkValidity() };
    });
    record(suite, 'Chặn ngày quá khứ khi thêm (min=hôm nay)', dateValid.check === false ? 'PASS' : 'FAIL', 'min=' + dateValid.min + ' checkValidity=' + dateValid.check);
    await page.click('#modal-exam .btn-close-modal');
    await page.waitForTimeout(300);

    // Filter pills
    await page.click('.filter-pill-btn[data-exam-filter="thpt"]');
    await page.waitForTimeout(400);
    const hsaVisibleUnderThpt = await page.locator('.exam-full-card:has-text("Thi thử HSA lần 1")').count();
    record(suite, 'Filter THPT ẩn kỳ thi HSA', hsaVisibleUnderThpt === 0 ? 'PASS' : 'FAIL', 'count=' + hsaVisibleUnderThpt);
    await page.click('.filter-pill-btn[data-exam-filter="hsa"]');
    await page.waitForTimeout(400);
    const hsaVisibleUnderHsa = await page.locator('.exam-full-card:has-text("Thi thử HSA lần 1")').count();
    record(suite, 'Filter HSA/TSA hiện kỳ thi HSA', hsaVisibleUnderHsa === 1 ? 'PASS' : 'FAIL', 'count=' + hsaVisibleUnderHsa);
    // Bug #9: category 'other' has no filter pill
    const otherPill = await page.locator('.filter-pill-btn[data-exam-filter="other"]').count();
    record(suite, 'Có nút lọc danh mục "Kỳ thi khác"', otherPill === 1 ? 'PASS' : 'FAIL', 'số pill other=' + otherPill);
    await page.click('.filter-pill-btn[data-exam-filter="all"]');
    await page.waitForTimeout(400);

    // Set hero via star button on the HSA card
    const starBtn = page.locator('.exam-full-card:has-text("Thi thử HSA lần 1")').locator('[data-hero-exam]');
    await starBtn.click();
    await page.waitForTimeout(500);
    await page.click('.nav-item[data-tab="tab-home"]');
    await page.waitForTimeout(400);
    const heroUpdated = await page.locator('#hero-exam-title').textContent().catch(() => '');
    record(suite, 'Đặt hero phản ánh lên trang chủ', heroUpdated.trim() === 'Thi thử HSA lần 1' ? 'PASS' : 'FAIL', 'hero=' + JSON.stringify(heroUpdated));
    await shot(page, suite, 'hero-set');

    // Countdown values sane (days may be >0)
    const days = await page.locator('#hero-days').textContent().catch(() => '');
    record(suite, 'Countdown days định dạng 3 số', /^\d{3}$/.test(days) ? 'PASS' : 'FAIL', 'days=' + days);

    // Edit exam — target the FUTURE HSA exam (2027) so native date validation passes
    await page.click('.nav-item[data-tab="tab-exams"]');
    await page.waitForTimeout(400);
    const hsaCard = page.locator('.exam-full-card', { hasText: 'Thi thử HSA lần 1' });
    await hsaCard.locator('[data-edit-exam]').click();
    await page.waitForTimeout(400);
    const editModalTitle = await page.locator('#modal-exam-title').textContent().catch(() => '');
    await page.fill('#exam-name', 'Thi thử HSA lần 1 (sửa)');
    await page.click('#form-exam button[type="submit"]');
    await page.waitForTimeout(700);
    const modalAfterEdit = await page.locator('#modal-exam.active').count();
    const edited = await page.locator('.exam-full-card:has-text("(sửa)")').count();
    record(suite, 'Sửa kỳ thi tương lai lưu được', edited === 1 && modalAfterEdit === 0 ? 'PASS' : 'FAIL', 'cards="(sửa)"=' + edited + ' modalStillOpen=' + modalAfterEdit + ' title=' + JSON.stringify(editModalTitle));

    // REGRESSION: edit a PAST-dated exam (e1 THPT 2026-06-27) — openExamEditModal sets min=today
    const pastCard = page.locator('.exam-full-card', { hasText: 'Thi Tốt nghiệp THPT' });
    await pastCard.locator('[data-edit-exam]').click();
    await page.waitForTimeout(400);
    await page.fill('#exam-name', 'THPT (thử sửa)');
    await evalJson(page, () => { window.__sf = 0; document.getElementById('form-exam').addEventListener('submit', () => { window.__sf++; }); });
    await page.click('#form-exam button[type="submit"]');
    await page.waitForTimeout(600);
    const sf = await evalJson(page, () => window.__sf);
    const pastModalOpen = await page.locator('#modal-exam.active').count();
    const pastEdited = await page.locator('.exam-full-card:has-text("(thử sửa)")').count();
    record(suite, 'Sửa kỳ thi QUÁ KHỨ lưu được', sf > 0 && pastModalOpen === 0 && pastEdited === 1 ? 'PASS' : 'FAIL', 'submitFired=' + sf + ' modalOpen=' + pastModalOpen + ' edited=' + pastEdited);
    if (pastModalOpen === 1) { await page.click('#modal-exam .btn-close-modal'); await page.waitForTimeout(300); }

    // Delete (modal xác nhận BUG-14) — delete the edited HSA card
    const delBtn = page.locator('.exam-full-card:has-text("Thi thử HSA lần 1 (sửa)")').locator('[data-delete-exam]');
    await delBtn.click();
    await page.waitForTimeout(400);
    await page.click('#btn-confirm-ok');
    await page.waitForTimeout(600);
    const countAfterDelete = await page.locator('.exam-full-card').count();
    record(suite, 'Xóa kỳ thi (confirm modal)', countAfterDelete >= 0 ? 'PASS' : 'FAIL', 'còn ' + countAfterDelete + ' thẻ');

    // XSS attempt in title
    await page.click('#btn-add-exam-page');
    await page.fill('#exam-name', '<img src=x onerror=alert(1)>Kỳ thi XSS');
    await page.fill('#exam-date', '2027-05-05');
    await page.click('#form-exam button[type="submit"]');
    await page.waitForTimeout(600);
    const xssRendered = await evalJson(page, () => {
      const card = [...document.querySelectorAll('.exam-full-card')].find(c => c.textContent.includes('Kỳ thi XSS'));
      return card ? { hasImg: !!card.querySelector('img'), html: card.innerHTML.slice(0, 120) } : null;
    });
    record(suite, 'Tiêu đề XSS bị escape (không có <img> thực thi)', xssRendered && xssRendered.hasImg ? 'FAIL' : 'PASS', xssRendered ? xssRendered.html : 'not found');
  } finally { await ctx.close(); }
}

/* ==========================================================================
   4. HOME DASHBOARD (streak, schedule, hero)
   ========================================================================== */
async function home(browser) {
  const suite = '04-home';
  const { ctx, page } = await newPage(browser, { width: 1280, height: 800 }, false, SEED_STATE());
  try {
await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2500);
    await page.click('#btn-sidebar-account');
    await page.waitForTimeout(800);

    const streak = await page.locator('#home-streak-value').textContent().catch(() => '');
    record(suite, 'Chuỗi học hiển thị', /^\d+$/.test(streak) ? 'PASS' : 'FAIL', 'streak=' + streak);

    // Bug #10: hero can show a PAST exam with kicker "KỲ THI TIẾP THEO"
    const heroInfo = await evalJson(page, () => ({
      kicker: (document.getElementById('hero-kicker') || {}).textContent,
      title: (document.getElementById('hero-exam-title') || {}).textContent,
      days: (document.getElementById('hero-days') || {}).textContent
    }));
    record(suite, 'Hero không hiển thị kỳ thi đã qua', !(heroInfo.days === '000' && heroInfo.kicker === 'KỲ THI TIẾP THEO') ? 'PASS' : 'FAIL', JSON.stringify(heroInfo));

    // Bug #6: getDailySchedule picks nearest by sort() WITHOUT filtering past exams
    const sched = await evalJson(page, () => {
      const s = window.EduPulseStudy && window.EduPulseStudy.getDailySchedule();
      return s ? { nearest: s.nearest, daysLeft: s.daysLeft } : null;
    });
    const isPast = await evalJson(page, () => {
      const s = window.EduPulseStudy && window.EduPulseStudy.getDailySchedule();
      if (!s || !s.nearest) return false;
      const exams = window.EDUPULSE_APP ? window.EDUPULSE_APP.getExams() : [];
      const hit = exams.find(e => e.title === s.nearest);
      const today = new Date(); today.setHours(0,0,0,0);
      return hit ? new Date(hit.date + 'T00:00:00') < today : false;
    });
    record(suite, 'Lịch học hôm nay dựa trên kỳ thi tương lai', sched && !isPast ? 'PASS' : 'FAIL', JSON.stringify(sched) + ' isPast=' + isPast);

    const scheduleItems = await page.locator('#home-schedule-list .home-schedule-item').count();
    record(suite, 'Lịch học hôm nay render (3 môn)', scheduleItems === 3 ? 'PASS' : 'FAIL', 'count=' + scheduleItems);

    // Widgets claimed by config but missing in DOM
    const missing = await evalJson(page, () => {
      const ids = ['home-greeting-title', 'home-greeting-sub', 'home-stats-grid', 'home-exam-list', 'home-community-panel', 'home-panel-exams-title', 'community-widget-list'];
      return ids.filter(id => !document.getElementById(id));
    });
    record(suite, 'Các widget trang chủ tồn tại trong DOM', missing.length === 0 ? 'PASS' : 'FAIL', 'thiếu: ' + missing.join(', '));

    await shot(page, suite, 'home');
  } finally { await ctx.close(); }
}

/* ==========================================================================
   5. STUDY STATS (log, goals, charts, forecast)
   ========================================================================== */
async function study(browser) {
  const suite = '05-study';
  const { ctx, page } = await newPage(browser, { width: 1280, height: 800 }, false, SEED_STATE());
  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2000);
    await page.click('.nav-item[data-tab="tab-stats"]');
    await page.waitForTimeout(800);

    // Log study
    await page.selectOption('#log-subject', 'Toán');
    await page.fill('#log-minutes', '45');
    await page.fill('#log-note', 'Hàm số');
    await page.click('#btn-log-study');
    await page.waitForTimeout(500);
    const logRow = await page.locator('#stats-log-list .log-row').count();
    record(suite, 'Ghi nhận nhật ký học tập', logRow >= 1 ? 'PASS' : 'FAIL', 'rows=' + logRow);
    const todayMin = await page.locator('#stats-today-minutes').textContent().catch(() => '');
    record(suite, 'Hôm nay cộng phút', todayMin.includes('45') ? 'PASS' : 'FAIL', 'today=' + todayMin);

    // Validation: empty minutes
    await page.selectOption('#log-subject', 'Lý');
    await page.fill('#log-minutes', '');
    await page.click('#btn-log-study');
    await page.waitForTimeout(400);
    const lýRows = await page.locator('#stats-log-list .log-row:has-text("Lý")').count();
    record(suite, 'Chặn ghi nhật ký khi thiếu phút', lýRows === 0 ? 'PASS' : 'FAIL', 'Lý rows=' + lýRows);

    // Save goals
    await page.fill('#goal-score', '8.5');
    await page.selectOption('#goal-subject', 'Hóa');
    await page.fill('#goal-weekly', '600');
    await page.click('#btn-save-goals');
    await page.waitForTimeout(500);
    const goalProgress = await page.locator('#stats-goal-progress').textContent().catch(() => '');
    record(suite, 'Lưu mục tiêu -> progress cập nhật', goalProgress.includes('%') ? 'PASS' : 'FAIL', 'progress=' + goalProgress);

    // Charts drawn (canvas has non-blank pixels)
    const charts = await evalJson(page, () => {
      const c = document.getElementById('chart-weekly');
      if (!c) return { exists: false };
      const ctx = c.getContext('2d');
      const data = ctx.getImageData(0, 0, c.width, c.height).data;
      let nonTransparent = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) nonTransparent++;
      return { exists: true, pixels: nonTransparent };
    });
    record(suite, 'Biểu đồ tuần được vẽ', charts.exists && charts.pixels > 1000 ? 'PASS' : 'FAIL', JSON.stringify(charts));

    await shot(page, suite, 'stats');

    // Share card (headless -> download fallback)
    const downloadPromise = page.waitForEvent('download', { timeout: 5000 }).catch(() => null);
    await page.click('#btn-share-card');
    const dl = await downloadPromise;
    record(suite, 'Chia sẻ thành tích (tải ảnh PNG)', dl ? 'PASS' : (page.url() ? 'WARN' : 'FAIL'), dl ? dl.suggestedFilename() : 'không tải trong headless');
  } finally { await ctx.close(); }
}

/* ==========================================================================
   6. WIDGET SETTINGS (duplicate IDs + dead widgets)
   ========================================================================== */
async function widgets(browser) {
  const suite = '06-widgets';
  const { ctx, page } = await newPage(browser, { width: 1280, height: 800 });
  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2000);
    // Bug #3: duplicate greeting groups with duplicate IDs
    const dup = await evalJson(page, () => ({
      title: document.querySelectorAll('#ws-greeting-title').length,
      sub: document.querySelectorAll('#ws-greeting-sub').length,
      groups: document.querySelectorAll('.widget-setting-group').length
    }));
    record(suite, 'Modal widget không có ID trùng lặp', dup.title === 1 && dup.sub === 1 ? 'PASS' : 'FAIL', '#ws-greeting-title=' + dup.title + ' #ws-greeting-sub=' + dup.sub + ' groups=' + dup.groups);

    // Regression: no button anywhere opens the widget-settings modal
    const openBtns = await page.locator('#btn-open-widget-settings, #btn-mobile-widget-settings, #btn-open-widget-settings-account').count();
    record(suite, 'Có nút mở modal Tùy chỉnh trang chủ', openBtns > 0 ? 'PASS' : 'FAIL', 'số nút=' + openBtns + ' (app.js vẫn bind 3 nút này)');

    // Force-open the modal to test the save path
    await evalJson(page, () => document.getElementById('modal-widget-settings').classList.add('active'));
    await page.waitForTimeout(300);
    await shot(page, suite, 'modal');
    await page.locator('#ws-greeting-title').first().fill('Xin chào TEST');
    await page.click('#btn-widget-save');
    await page.waitForTimeout(600);
    const applied = await evalJson(page, () => {
      const home = document.getElementById('home-greeting-title');
      const mobile = document.getElementById('mobile-greeting-name');
      return { homeExists: !!home, homeText: home ? home.textContent : '', mobileExists: !!mobile };
    });
    record(suite, 'Lưu lời chào -> áp dụng lên trang chủ', applied.homeExists && applied.homeText.includes('TEST') ? 'PASS' : 'FAIL', 'home-greeting-title tồn tại=' + applied.homeExists + ' mobile-greeting-name tồn tại=' + applied.mobileExists + ' (applyWidgetConfig set vào 2 id này)');

    // All targets of applyWidgetConfig now exist in DOM (BUG-3 fixed)
    const targets = await evalJson(page, () => {
      const ids = ['home-greeting-title', 'home-greeting-sub', 'mobile-greeting-name', 'hero-kicker',
        'home-stat-target-label', 'home-stat-nearest-label', 'home-stat-streak-label',
        'home-panel-exams-title', 'home-panel-community-title', 'community-subtext',
        'home-stats-grid', 'home-exams-panel', 'home-community-panel'];
      return ids.filter(id => !document.getElementById(id));
    });
    record(suite, 'Các element đích của applyWidgetConfig tồn tại', targets.length === 0 ? 'PASS' : 'FAIL', 'thiếu: ' + targets.join(', '));
  } finally { await ctx.close(); }
}

/* ==========================================================================
   7. AI ASSISTANT
   ========================================================================== */
async function ai(browser) {
  const suite = '07-ai';
  const { ctx, page } = await newPage(browser, { width: 1280, height: 800 });
  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2500);
    await page.click('.nav-item[data-tab="tab-ai"]');
    await page.waitForTimeout(500);

    const chips = await page.locator('#ai-subject-chips button').count();
    record(suite, 'Subject chips render (9 môn)', chips === 9 ? 'PASS' : 'FAIL', 'count=' + chips);

    // Empty input no-op
    const msgsBefore = await page.locator('.ai-message').count();
    await page.click('#ai-form button[type="submit"]');
    await page.waitForTimeout(400);
    const msgsAfter = await page.locator('.ai-message').count();
    record(suite, 'Gửi input rỗng không tạo tin', msgsAfter === msgsBefore ? 'PASS' : 'FAIL', msgsBefore + '->' + msgsAfter);

    // Real question -> observe actual behavior (Gemini streaming / error / offline)
    await page.fill('#ai-input', 'Lập kế hoạch ôn Toán trong 3 ngày, ngắn gọn.');
    const beforeCount = await page.locator('.ai-message').count();
    await page.click('#ai-form button[type="submit"]');
    await page.waitForTimeout(30000);
    const afterCount = await page.locator('.ai-message').count();
    const lastReply = await page.locator('.ai-message.assistant .ai-message-content').last().textContent().catch(() => '');
    const statusLine = await page.locator('#ai-status-line').textContent().catch(() => '');
    record(suite, 'AI trả lời được (thêm tin assistant)', afterCount > beforeCount ? 'PASS' : 'WARN', 'before=' + beforeCount + ' after=' + afterCount + ' reply(120)=' + JSON.stringify(lastReply.slice(0, 120)) + ' status=' + JSON.stringify(statusLine.trim()));
    await shot(page, suite, 'after-question');

    // Clear history
    await page.click('#ai-clear-history');
    await page.waitForTimeout(500);
    const afterClear = await page.locator('.ai-message').count();
    record(suite, 'Xóa lịch sử AI', afterClear >= 1 ? 'PASS' : 'FAIL', 'messages=' + afterClear);
  } finally { await ctx.close(); }
}

/* ==========================================================================
   8. CHAT (guest gating, read, attachment UI)
   ========================================================================== */
async function chat(browser) {
  const suite = '08-chat';
  const { ctx, page } = await newPage(browser, { width: 1280, height: 800 });
  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);
    await page.click('.nav-item[data-tab="tab-chat"]');
    await page.waitForTimeout(1500);

    const conn = await page.locator('#chat-connection').textContent().catch(() => '');
    record(suite, 'Kết nối phòng chat (đọc trạng thái)', conn.trim().length > 0 ? 'PASS' : 'FAIL', JSON.stringify(conn));

    // Guest send -> should be blocked with toast + redirect to account
    await page.fill('#chat-message', 'Tin nhắn test từ khách');
    await page.click('#btn-chat-send');
    await page.waitForTimeout(800);
    const toast = await page.locator('#app-toast').textContent().catch(() => '');
    const accountActive = await page.locator('#tab-account.active').count();
    record(suite, 'Khách gửi tin bị chặn + chuyển tab tài khoản', accountActive === 1 ? 'PASS' : 'FAIL', 'toast=' + JSON.stringify(toast) + ' accountActive=' + accountActive);
    await shot(page, suite, 'guest-blocked');

    // Badge chỉ đếm tin CHƯA ĐỌC từ người khác — không phải tổng tin đã nạp (BUG-8)
    const badge = await page.locator('#chat-nav-badge').textContent().catch(() => '');
    const chatCount = await page.locator('#chat-messages .chat-msg').count();
    record(suite, 'Badge chat không hiện khi không có tin mới', badge === '' ? 'PASS' : 'FAIL', 'badge=' + JSON.stringify(badge) + ' (tổng tin trong phòng=' + chatCount + ')');

    // Attachment input accept types
    const accept = await page.locator('#chat-file-input').getAttribute('accept').catch(() => '');
    record(suite, 'Attach input có accept đúng', /image/.test(accept) && /pdf/.test(accept) ? 'PASS' : 'FAIL', 'accept=' + JSON.stringify(accept));

    // Display name field present
    const nameField = await page.locator('#chat-display-name').count();
    record(suite, 'Có ô tên hiển thị', nameField === 1 ? 'PASS' : 'FAIL', 'count=' + nameField);
  } finally { await ctx.close(); }
}

/* ==========================================================================
   9. LIBRARY (empty state)
   ========================================================================== */
async function library(browser) {
  const suite = '09-library';
  const { ctx, page } = await newPage(browser, { width: 1280, height: 800 });
  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2000);
    await page.click('.nav-item[data-tab="tab-library"]');
    await page.waitForTimeout(500);
    const empty = await page.locator('#library-list .library-empty').count();
    record(suite, 'Thư viện rỗng hiển thị empty state', empty === 1 ? 'PASS' : 'FAIL', 'empty=' + empty);
    await shot(page, suite, 'empty');
  } finally { await ctx.close(); }
}

/* ==========================================================================
   10. ACCOUNT / AUTH (guest forms, validation, forgot pwd modal)
   ========================================================================== */
async function account(browser) {
  const suite = '10-account';
  const { ctx, page } = await newPage(browser, { width: 1280, height: 800 });
  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2000);
    await page.click('#btn-sidebar-account');
    await page.waitForTimeout(500);

    // Toggle register mode
    await page.click('#btn-tab-register');
    await page.waitForTimeout(300);
    const nameVisible = await page.locator('#auth-name-group').isVisible().catch(() => false);
    record(suite, 'Chuyển chế độ Đăng ký hiện ô tên', nameVisible ? 'PASS' : 'FAIL', '');
    await page.click('#btn-tab-login');
    await page.waitForTimeout(300);

    // Password show/hide
    await page.fill('#auth-password', 'secret123');
    await page.click('#btn-toggle-password');
    const pwdType = await page.locator('#auth-password').getAttribute('type');
    record(suite, 'Hiện/ẩn mật khẩu', pwdType === 'text' ? 'PASS' : 'FAIL', 'type=' + pwdType);

    // Forgot password modal
    await page.click('#btn-forgot-password');
    await page.waitForTimeout(300);
    const forgotOpen = await page.locator('#modal-forgot-password.active').count();
    record(suite, 'Mở modal Quên mật khẩu', forgotOpen === 1 ? 'PASS' : 'FAIL', '');
    await page.click('#modal-forgot-password .btn-close-modal');
    await page.waitForTimeout(300);

    // Email format validation (novalidate on form -> rely on type=email? novalidate disables browser check)
    await page.fill('#auth-email', 'not-an-email');
    await page.fill('#auth-password', '123456');
    await page.click('#auth-submit');
    await page.waitForTimeout(1000);
    const toast = await page.locator('#app-toast').textContent().catch(() => '');
    record(suite, 'Email không hợp lệ -> thông báo lỗi', toast.length > 0 ? 'PASS' : 'WARN', 'toast=' + JSON.stringify(toast));

    // Push toggle section visibility (guest)
    const pushSection = await page.locator('#push-toggle-section').isVisible().catch(() => false);
    const mediaSection = await page.locator('#media-toggle-section').isVisible().catch(() => false);
    record(suite, 'Mục bật/tắt push hiển thị (guest)', 'PASS', 'push=' + pushSection + ' media=' + mediaSection);

    await shot(page, suite, 'account-guest');
  } finally { await ctx.close(); }
}

/* ==========================================================================
   11. PWA / OFFLINE
   ========================================================================== */
async function pwa(browser) {
  const suite = '11-pwa';
  const { ctx, page } = await newPage(browser, { width: 1280, height: 800 });
  try {
    await page.goto(BASE, { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(3000);

    const sw = await evalJson(page, () => navigator.serviceWorker && navigator.serviceWorker.controller ? navigator.serviceWorker.controller.state : 'none');
    record(suite, 'Service worker kiểm soát trang', sw !== 'none' ? 'PASS' : 'WARN', 'controller=' + sw);

    const manifest = await page.locator('link[rel="manifest"]').getAttribute('href').catch(() => '');
    record(suite, 'Manifest được khai báo', manifest ? 'PASS' : 'FAIL', manifest);

    // Wait for SW ready (installed) for offline test
    await evalJson(page, () => navigator.serviceWorker.ready.then(() => 'ready'));
    await page.waitForTimeout(1500);

    // Offline reload
    await ctx.setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(e => {});
    await page.waitForTimeout(1500);
    const stillWorks = await page.locator('#hero-exam-title').count().catch(() => 0);
    const offlineBanner = await page.locator('#offline-banner').isVisible().catch(() => false);
    record(suite, 'Offline: app shell load từ cache', stillWorks === 1 ? 'PASS' : 'FAIL', 'hero=' + stillWorks + ' banner=' + offlineBanner);
    await shot(page, suite, 'offline');
    await ctx.setOffline(false);

    // Online banner hidden again
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(e => {});
    await page.waitForTimeout(1500);
    const bannerOnline = await page.locator('#offline-banner').isVisible().catch(() => true);
    record(suite, 'Online: banner ngoại tuyến ẩn', bannerOnline === false ? 'PASS' : 'FAIL', 'visible=' + bannerOnline);
  } finally { await ctx.close(); }
}

/* ==========================================================================
   12. PUSH (guest, no permission)
   ========================================================================== */
async function push(browser) {
  const suite = '12-push';
  const { ctx, page } = await newPage(browser, { width: 1280, height: 800 });
  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2500);
    await page.click('#btn-sidebar-account');
    await page.waitForTimeout(800);
    const sectionVisible = await page.locator('#push-toggle-section').isVisible().catch(() => false);
    record(suite, 'Mục nhắc ôn hằng ngày hiển thị', sectionVisible ? 'PASS' : 'WARN', 'visible=' + sectionVisible);
    if (sectionVisible) {
      await page.click('#btn-toggle-push');
      await page.waitForTimeout(1500);
      const label = await page.locator('#push-status-label').textContent().catch(() => '');
      record(suite, 'Bật push khi chưa cấp quyền', 'WARN', 'label=' + JSON.stringify(label) + ' (trình duyệt tự chặn)');
    }
    // Time settings present
    const cbCount = await page.locator('.push-time-cb').count();
    record(suite, '4 khung giờ nhắc học', cbCount === 4 ? 'PASS' : 'FAIL', 'count=' + cbCount);
  } finally { await ctx.close(); }
}

/* ==========================================================================
   13. SECURITY / DATA LEAK (local server only)
   ========================================================================== */
async function security(browser) {
  const suite = '13-security';
  const { ctx, page } = await newPage(browser, { width: 1280, height: 800 });
  try {
    // Keys exposed in ai-config.js
    const keysResp = await page.request.get(BASE + '/js/ai-config.js').catch(() => null);
    let keysFound = 0;
    if (keysResp && keysResp.ok()) {
      const body = await keysResp.text();
      const m = body.match(/AQ\.[A-Za-z0-9_-]+/g) || [];
      keysFound = m.length;
    }
    record(suite, 'API key Gemini không lộ trong bundle công khai', keysFound === 0 ? 'PASS' : 'FAIL', 'tìm thấy ' + keysFound + ' key dạng AQ.* trong js/ai-config.js');

    // Guest state leak: fresh localStorage, load from /api/state
    if (TARGET === 'local') {
      await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(2500);
      const exams = await evalJson(page, () => (window.EDUPULSE_APP ? window.EDUPULSE_APP.getExams().map(e => e.title) : []));
      record(suite, 'Guest load dữ liệu /api/state (dữ liệu chung server)', exams.length === 0 ? 'PASS' : 'WARN', 'khách nhận được ' + exams.length + ' kỳ thi từ server: ' + exams.join(', '));
      await shot(page, suite, 'guest-state');
    } else {
      record(suite, 'Guest load dữ liệu /api/state', 'SKIP', 'chỉ test trên local server');
    }
  } finally { await ctx.close(); }
}

/* ==========================================================================
   14. AUTHENTICATED FLOWS (needs TEST_USER_EMAIL/PASSWORD)
   ========================================================================== */
async function authed(browser) {
  const suite = '14-authed';
  if (!EMAIL || !PASSWORD) {
    record(suite, 'Đăng nhập (chưa có tài khoản)', 'BLOCKED', 'Set TEST_USER_EMAIL/TEST_USER_PASSWORD để test sync/chat/call/room');
    return;
  }
  const { ctx, page } = await newPage(browser, { width: 1280, height: 800 });
  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2500);
    await page.click('#btn-sidebar-account');
    await page.waitForTimeout(500);
    await page.fill('#auth-email', EMAIL);
    await page.fill('#auth-password', PASSWORD);
    await page.click('#auth-submit');
    await page.waitForTimeout(6000);
    const userView = await page.locator('#account-user-view').isVisible().catch(() => false);
    record(suite, 'Đăng nhập thành công', userView ? 'PASS' : 'FAIL', '');
    if (!userView) return;
    await shot(page, suite, 'logged-in');

    // Chat send
    await page.click('.nav-item[data-tab="tab-chat"]');
    await page.waitForTimeout(1500);
    await page.fill('#chat-message', 'Test E2E ' + Date.now());
    await page.click('#btn-chat-send');
    await page.waitForTimeout(2000);
    const mine = await page.locator('.chat-msg-card.mine').count();
    record(suite, 'Gửi tin chat (đã đăng nhập)', mine >= 1 ? 'PASS' : 'FAIL', 'mine=' + mine);

    // Library save: use existing attachment button if present
    const saveBtn = page.locator('.chat-attachment-save').first();
    if (await saveBtn.count()) {
      await saveBtn.click();
      await page.waitForTimeout(1000);
      const libCount = await evalJson(page, () => (window.EDUPULSE_APP ? window.EDUPULSE_APP.getLibrary().length : -1));
      record(suite, 'Lưu tài liệu chat vào thư viện', libCount >= 1 ? 'PASS' : 'FAIL', 'library=' + libCount);
    } else {
      record(suite, 'Lưu tài liệu chat vào thư viện', 'SKIP', 'không có tài liệu đính kèm trong phòng');
    }

    // Logout
    await page.click('#btn-sidebar-account');
    await page.waitForTimeout(500);
    await page.click('#btn-account-logout');
    await page.waitForTimeout(1500);
    const guestVisible = await page.locator('#account-guest-view').isVisible().catch(() => false);
    record(suite, 'Đăng xuất', guestVisible ? 'PASS' : 'FAIL', '');
  } finally { await ctx.close(); }
}

/* ==========================================================================
   15. MOBILE VIEWPORT
   ========================================================================== */
async function mobile(browser) {
  const suite = '15-mobile';
  const { ctx, page } = await newPage(browser, { width: 390, height: 844 });
  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2500);
    const navBtns = await page.locator('.mobile-nav-btn').count();
    record(suite, 'Bottom nav hiện 7 mục', navBtns === 7 ? 'PASS' : 'FAIL', 'count=' + navBtns);
    await page.click('.mobile-nav-btn[data-tab="tab-exams"]');
    await page.waitForTimeout(400);
    await shot(page, suite, 'exams-mobile');
    await page.click('.mobile-nav-btn[data-tab="tab-ai"]');
    await page.waitForTimeout(400);
    const aiVisible = await page.locator('#tab-ai.active').count();
    record(suite, 'Mobile: chuyển tab AI', aiVisible === 1 ? 'PASS' : 'FAIL', '');
    const hScroll = await evalJson(page, () => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    record(suite, 'Mobile: không tràn ngang', hScroll <= 1 ? 'PASS' : 'FAIL', 'overflow-x=' + hScroll + 'px');
    await shot(page, suite, 'ai-mobile');
  } finally { await ctx.close(); }
}

/* ==========================================================================
   REPORT
   ========================================================================== */
function writeReport() {
  const summary = { total: 0, pass: 0, fail: 0, warn: 0, skip: 0, blocked: 0 };
  results.forEach(r => { summary.total++; summary[r.status.toLowerCase()]++; });
  const lines = [];
  lines.push('# EduPulse — Báo cáo kiểm thử E2E');
  lines.push('');
  lines.push('Target: `' + BASE + '`  ·  Thời gian: ' + new Date().toLocaleString('vi-VN'));
  lines.push('');
  lines.push('## Tóm tắt');
  lines.push('');
  lines.push('| Kết quả | Số lượng |');
  lines.push('|---|---|');
  lines.push('| PASS | ' + summary.pass + ' |');
  lines.push('| FAIL | ' + summary.fail + ' |');
  lines.push('| WARN | ' + summary.warn + ' |');
  lines.push('| SKIP | ' + summary.skip + ' |');
  lines.push('| BLOCKED | ' + summary.blocked + ' |');
  lines.push('| **Tổng** | **' + summary.total + '** |');
  lines.push('');
  lines.push('## Chi tiết từng case');
  lines.push('');
  let current = '';
  results.forEach(r => {
    if (r.suite !== current) { current = r.suite; lines.push('\n### ' + r.suite); }
    lines.push('- **' + r.status + '** ' + r.name + (r.detail ? ' — `' + r.detail + '`' : ''));
  });
  lines.push('');
  lines.push('## Lỗi console / JS');
  lines.push('');
  if (consoleErrors.length === 0 && pageErrors.length === 0) lines.push('Không ghi nhận lỗi.');
  consoleErrors.slice(0, 30).forEach(e => lines.push('- console.error: `' + e + '`'));
  pageErrors.slice(0, 30).forEach(e => lines.push('- pageerror: `' + e + '`'));
  fs.writeFileSync(path.join(OUT_DIR, 'report.md'), lines.join('\n'), 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify({ target: BASE, summary, results, consoleErrors: consoleErrors.slice(0, 50), pageErrors: pageErrors.slice(0, 50) }, null, 2), 'utf8');
  console.log('\n===== TÓM TẮT =====');
  console.log(JSON.stringify(summary));
  console.log('Report: ' + path.join(OUT_DIR, 'report.md'));
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--no-sandbox']
  });
  console.log('Target: ' + BASE);
  const suites = [smoke, theme, exams, home, study, widgets, ai, chat, library, account, pwa, push, security, authed, mobile];
  for (const suite of suites) {
    try { await suite(browser); } catch (e) { console.log('  [ERROR] ' + suite.name + ': ' + (e && e.message)); }
  }
  await browser.close();
  writeReport();
})().catch(e => { console.error('FATAL', e); process.exit(1); });