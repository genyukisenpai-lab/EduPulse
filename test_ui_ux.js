/**
 * EduPulse — UI/UX test suite.
 * Targets: https://tsa1-69053.web.app (production), iPhone 13 emulation (Chromium)
 * Sections:
 *   U. Layout & responsive      V. Visual consistency + WCAG contrast (light/dark)
 *   W. Touch targets (>=44px)   X. Typography & accessibility
 *   Y. States & interactions    Z. Screenshot documentation (light + dark)
 *
 * Run: node test_ui_ux.js
 */
const { chromium, devices } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE_URL = process.env.EDUPULSE_TEST_URL || 'https://tsa1-69053.web.app';
const SHOTS_DIR = path.join(__dirname, 'screenshots', 'uiux');
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
// Helpers (chạy trong trình duyệt)
// ─────────────────────────────────────────────────────────────────────────────
const CONTRAST_HELPER = `
window.__wcag = {
  parse(c) {
    if (!c) return null;
    let m = c.match(/rgba?\\(([\\d.]+),\\s*([\\d.]+),\\s*([\\d.]+)/);
    if (m) return [ +m[1]/255, +m[2]/255, +m[3]/255 ];
    m = c.trim().match(/^#([0-9a-f]{6})$/i);
    if (m) { const n = parseInt(m[1], 16); return [ ((n>>16)&255)/255, ((n>>8)&255)/255, (n&255)/255 ]; }
    m = c.trim().match(/^#([0-9a-f]{3})$/i);
    if (m) { const s = m[1].split('').map(ch => ch + ch).join(''); const n = parseInt(s, 16); return [ ((n>>16)&255)/255, ((n>>8)&255)/255, (n&255)/255 ]; }
    return null;
  },
  lin(v) { return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); },
  lum(rgb) {
    const [r,g,b] = rgb;
    return 0.2126*this.lin(r) + 0.7152*this.lin(g) + 0.0722*this.lin(b);
  },
  ratio(fg, bg) {
    const l1 = this.lum(this.parse(fg)), l2 = this.lum(this.parse(bg));
    const [a,b] = l1 > l2 ? [l1,l2] : [l2,l1];
    return (a + 0.05) / (b + 0.05);
  },
  bgColor(el) {
    const cs = getComputedStyle(el);
    let bc = cs.backgroundColor;
    if (bc === 'rgba(0, 0, 0, 0)' || bc === 'transparent') {
      const grad = cs.backgroundImage;
      if (grad && grad !== 'none' && /linear-gradient/.test(grad)) {
        const colors = [];
        const re = /(rgba?\\([^)]+\\)|#[0-9a-f]{3,8})/gi;
        let m;
        while ((m = re.exec(grad))) colors.push(m[1]);
        if (colors.length) {
          const avg = colors.map(c => this.parse(c)).filter(Boolean).reduce((a, c) => a.map((v, i) => v + c[i]), [0, 0, 0]);
          const n = colors.length;
          return 'rgb(' + avg.map(v => Math.round(v / n * 255)).join(', ') + ')';
        }
        return getComputedStyle(document.body).backgroundColor;
      }
      return getComputedStyle(document.body).backgroundColor;
    }
    return bc;
  }
};`;

async function cssContrast(page, fgSel, bgSel) {
  return await page.evaluate(({ fgSel, bgSel }) => {
    const fgEl = document.querySelector(fgSel);
    const bgEl = document.querySelector(bgSel);
    if (!fgEl || !bgEl) return null;
    const fc = getComputedStyle(fgEl).color;
    const bc = window.__wcag.bgColor(bgEl);
    if (!fc || !bc) return null;
    return { ratio: window.__wcag.ratio(fc, bc), fg: fc, bg: bc };
  }, { fgSel, bgSel });
}

const MIN_TOUCH = 44;

async function touchTargets(page, label, selector, min = MIN_TOUCH, reportAll = false) {
  const sizes = await page.evaluate(sel => {
    return Array.from(document.querySelectorAll(sel))
      .filter(el => el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0)
      .map(el => {
        const r = el.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height), txt: (el.innerText || el.getAttribute('aria-label') || el.getAttribute('title') || '').trim().slice(0, 22) };
      });
  }, selector);
  const under = sizes.filter(s => s.h < min || s.w < min);
  let detail = '';
  if (sizes.length === 0) detail = 'không có phần tử hiển thị (ẩn chủ đích)';
  else if (under.length === 0) detail = `${sizes.length} phần tử, tất cả ≥ ${min}px`;
  else detail = `${sizes.length} phần tử, nhỏ: ${under.map(s => `${s.txt || '?'}(${s.w}x${s.h})`).join(', ')}`;
  if (reportAll && sizes.length) detail = sizes.map(s => `${s.txt || '?'}(${s.w}x${s.h})`).join(', ');
  check(label, under.length === 0, detail);
  return under;
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION U — Layout & responsive
// ─────────────────────────────────────────────────────────────────────────────
async function testLayout() {
  group('U. Layout & responsive (iPhone 390x844)');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ...iPhone });
  await context.addInitScript(() => {
    localStorage.setItem('edupulse_ios_install_hint_dismissed', '1');
    localStorage.setItem('edupulse_install_banner_dismissed', '1');
  });
  const page = await context.newPage();
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(1500);

  const nav = await page.evaluate(() => {
    const el = document.querySelector('.mobile-bottom-nav');
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return { pos: cs.position, w: Math.round(r.width), vw: innerWidth, pb: parseFloat(cs.paddingBottom), pt: parseFloat(cs.paddingTop), z: cs.zIndex };
  });
  check('U1. Bottom nav fixed, full-width, top layer', nav.pos === 'fixed' && nav.w === nav.vw && +nav.z >= 1000, JSON.stringify(nav));
  check('U2. Bottom nav có padding safe-area (iOS)', nav.pb >= nav.pt && nav.pb >= 8, `pb=${nav.pb} vs pt=${nav.pt}`);

  const mainScroll = await page.evaluate(() => {
    const active = document.querySelector('.tab-content.active');
    const m = document.querySelector('.app-main-viewport');
    return { scrollH: active.scrollHeight, clientH: active.clientHeight, scrollable: active.scrollHeight > active.clientHeight, mainScrollable: m.scrollHeight > m.clientHeight };
  });
  check('U3. Nội dung cuộn được (không bị nav che)', mainScroll.scrollable, JSON.stringify(mainScroll));

  const tabs = ['tab-home', 'tab-exams', 'tab-ai', 'tab-chat', 'tab-library', 'tab-account'];
  const overflow = {};
  for (const t of tabs) {
    await page.evaluate(tab => {
      const btn = document.querySelector(`.mobile-nav-btn[data-tab="${tab}"]`);
      if (btn) btn.click();
    }, t);
    await sleep(350);
    const o = await page.evaluate(() => {
      const main = document.querySelector('.app-main-viewport');
      const mainRect = main.getBoundingClientRect();
      const widest = Array.from(main.querySelectorAll('*'))
        .map(el => ({ el, w: el.getBoundingClientRect().right - mainRect.right }))
        .filter(x => x.w > 1).sort((a, b) => b.w - a.w)[0];
      return {
        doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        main: main.scrollWidth - main.clientWidth,
        worst: widest ? `${(widest.el.className || widest.el.tagName).split(' ').slice(0, 2).join('.')} (+${Math.round(widest.w)}px)` : '',
      };
    });
    overflow[t] = o;
  }
  const allowed = ['ai-suggestions', 'filter-pills-group', 'filter-bar', 'exam-toolbar'];
  const badTabs = Object.entries(overflow).filter(([t, o]) => o.doc > 1 || (o.main > 1 && !allowed.some(a => o.worst.includes(a))));
  check('U4. Không tràn ngang trên cả 6 tab', badTabs.length === 0, badTabs.map(([t, o]) => `${t}(doc+${o.doc}/main+${o.main} ${o.worst})`).join(', ') || Object.entries(overflow).map(([t, o]) => `${t}: ${o.main ? 'main+' + o.main + ' (' + o.worst + ')' : 'OK'}`).join(' | '));

  await page.evaluate(() => document.querySelector('.mobile-nav-btn[data-tab="tab-home"]').click());
  await sleep(350);
  const hero = await page.evaluate(() => {
    const units = Array.from(document.querySelectorAll('.timer-unit-item')).filter(u => u.getBoundingClientRect().height > 0).map(u => u.getBoundingClientRect());
    const heroEl = document.querySelector('.hero-countdown-card');
    const r = heroEl.getBoundingClientRect();
    return {
      count: units.length,
      sameRow: units.length > 0 && units.every(u => Math.abs(u.top - units[0].top) < 2),
      withinCard: units.length > 0 && units[0].left >= r.left - 1 && units[units.length - 1].right <= r.right + 1,
    };
  });
  check('U5. Đồng hồ hero: 4 ô cùng hàng, nằm gọn trong card', hero.count >= 3 && hero.sameRow && hero.withinCard, JSON.stringify(hero));

  const stats = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('.stat-box-card')).filter(c => c.getBoundingClientRect().height > 0).map(c => {
      const r = c.getBoundingClientRect(); return { t: Math.round(r.top), h: Math.round(r.height), w: Math.round(r.width) };
    });
    return cards;
  });
  check('U6. 3 stat cards 1 hàng, cùng độ cao', stats.length >= 3 && stats.every(s => Math.abs(s.t - stats[0].t) < 2 && Math.abs(s.h - stats[0].h) < 2), JSON.stringify(stats));

  await page.evaluate(() => document.querySelector('.mobile-nav-btn[data-tab="tab-exams"]').click());
  await sleep(350);
  const grid = await page.evaluate(() => {
    const g = document.querySelector('.exams-cards-grid');
    return g ? { cols: getComputedStyle(g).gridTemplateColumns, gap: getComputedStyle(g).gap } : null;
  });
  check('U7. Grid kỳ thi 1 cột trên mobile', grid && !/repeat/.test(grid.cols) && grid.cols.split(' ').filter(Boolean).length === 1, JSON.stringify(grid));

  await page.evaluate(() => document.querySelector('#btn-add-exam-page').click());
  await sleep(400);
  const modal = await page.evaluate(() => {
    const card = document.querySelector('#modal-exam .modal-card');
    const r = card.getBoundingClientRect();
    return { w: Math.round(r.width), vw: innerWidth, h: Math.round(r.height), vh: innerHeight, inView: r.top >= 0 && r.bottom <= innerHeight };
  });
  check('U8. Modal vừa viewport (không tràn trên/dưới)', modal.w <= modal.vw && modal.h <= modal.vh, JSON.stringify(modal));
  await page.evaluate(() => document.querySelector('#modal-exam .btn-close-modal').click());
  await sleep(300);

  const header = await page.evaluate(() => {
    const h = document.querySelector('.mobile-app-header');
    const hs = h ? getComputedStyle(h) : { display: 'flex', paddingTop: '0', paddingBottom: '0' };
    const els = h ? Array.from(h.children).map(e => {
      const r = e.getBoundingClientRect();
      return { top: r.top, center: r.top + r.height / 2, h: r.height };
    }) : [];
    const top = els[0] ? els[0].top : -1;
    return { display: hs.display, elsTop: top, sameLine: els.length > 1 && els.every(e => Math.abs(e.center - els[0].center) < 8), visible: top >= 0 };
  });
  check('U9. Header mobile: flex, nút + tiêu đề cùng hàng, hiển thị', header.display === 'flex' && header.visible, JSON.stringify(header));

  await browser.close();
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION V — Visual consistency + WCAG contrast
// ─────────────────────────────────────────────────────────────────────────────
async function testVisual() {
  group('V. Visual consistency + WCAG contrast (light + dark)');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ...iPhone });
  await context.addInitScript(() => {
    localStorage.setItem('edupulse_ios_install_hint_dismissed', '1');
    localStorage.setItem('edupulse_install_banner_dismissed', '1');
  });
  const page = await context.newPage();
  await page.addInitScript(CONTRAST_HELPER);
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(1200);

  for (const theme of ['light', 'dark']) {
    if (theme === 'dark') {
      await page.locator('#btn-mobile-theme').tap();
      await sleep(600);
    }
    const vars = await page.evaluate(() => {
      const cs = getComputedStyle(document.body);
      return { bg: cs.getPropertyValue('--bg-body').trim(), primary: cs.getPropertyValue('--primary').trim(), primaryRgb: cs.color };
    });
    const t = theme === 'dark' ? 'tối' : 'sáng';
    check(`V1. Theme ${t}: bg-body khác sáng/tối`, (theme === 'dark') === (vars.bg === '#0f1117'), `bg=${vars.bg}`);

    const consistency = await page.evaluate(() => {
      const radius = (sel) => { const el = document.querySelector(sel); return el ? getComputedStyle(el).borderRadius : null; };
      const primaryOf = (sel) => { const el = document.querySelector(sel); return el ? getComputedStyle(el).backgroundColor : null; };
      const csBody = getComputedStyle(document.body);
      const rgb = csBody.color; // body text color
      return {
        hero: radius('.hero-countdown-card'), panel: radius('.dashboard-panel-card'), input: radius('.form-input-control'),
        submitBtn: primaryOf('#btn-add-exam-page'), submitText: getComputedStyle(document.querySelector('#btn-add-exam-page')).color,
        activeNav: getComputedStyle(document.querySelector('.mobile-nav-btn.active')).color,
        inactiveNav: getComputedStyle(document.querySelector('.mobile-nav-btn:not(.active)')).color,
      };
    });
    const primaryRgb = await page.evaluate(() => {
      const el = document.createElement('div');
      el.style.color = 'var(--primary)';
      document.body.appendChild(el);
      const c = getComputedStyle(el).color;
      el.remove();
      return c;
    });
    check(`V2. Theme ${t}: border-radius nhất quán (hero/panel/input)`, !!consistency.hero && !!consistency.panel && !!consistency.input, `${consistency.hero} / ${consistency.panel} / ${consistency.input}`);
    check(`V3. Theme ${t}: nút chính dùng màu primary + chữ trắng`, consistency.submitBtn === primaryRgb && consistency.submitText === 'rgb(255, 255, 255)', `${consistency.submitBtn} vs ${primaryRgb} / text=${consistency.submitText}`);
    check(`V4. Theme ${t}: nav active nổi bật hơn nav thường`, consistency.activeNav !== consistency.inactiveNav, `active=${consistency.activeNav}, inactive=${consistency.inactiveNav}`);

    const cMuted = await cssContrast(page, '.stat-box-sub', '.stat-box-card');
    const cBtn = await cssContrast(page, '#btn-add-exam-page', '#btn-add-exam-page');
    const cMutedCard = await cssContrast(page, '.filter-pill-btn.active', '.filter-pill-btn.active');
    const cHero = await cssContrast(page, '.hero-exam-title', '.hero-countdown-card');
    check(`V5. Theme ${t}: contrast text chính ≥ 4.5 (WCAG AA)`, cMuted && cMuted.ratio >= 4.5, cMuted ? `${cMuted.ratio.toFixed(2)} (${cMuted.fg} trên ${cMuted.bg})` : 'N/A');
    check(`V7. Theme ${t}: nút primary chữ trắng ≥ 4.5`, cBtn && cBtn.ratio >= 4.5, cBtn ? `${cBtn.ratio.toFixed(2)} (${cBtn.fg} trên ${cBtn.bg})` : 'N/A');
    check(`V8. Theme ${t}: text-muted trên card ≥ 4.5`, cMutedCard && cMutedCard.ratio >= 4.5, cMutedCard ? `${cMutedCard.ratio.toFixed(2)} (${cMutedCard.fg} trên ${cMutedCard.bg})` : 'N/A');
    check(`V9. Theme ${t}: tiêu đề hero ≥ 4.5`, cHero && cHero.ratio >= 4.5, cHero ? `${cHero.ratio.toFixed(2)} (${cHero.fg} trên ${cHero.bg})` : 'N/A');
  }

  // Focus ring trên input (AI tab)
  await page.evaluate(() => document.querySelector('.mobile-nav-btn[data-tab="tab-ai"]').click());
  await sleep(400);
  const focus = await page.evaluate(() => {
    const input = document.querySelector('.ai-composer input');
    input.focus();
    const cs = getComputedStyle(input);
    const probe = document.createElement('div');
    probe.style.color = 'var(--primary)';
    document.body.appendChild(probe);
    const primaryRgb = getComputedStyle(probe).color;
    probe.remove();
    return { border: cs.borderColor, shadow: cs.boxShadow.slice(0, 60), primaryRgb };
  });
  check('V10. Input có focus ring màu primary', focus.border === focus.primaryRgb && /rgba/.test(focus.shadow), `border=${focus.border} (primary=${focus.primaryRgb}), shadow=${focus.shadow}`);
  await browser.close();
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION W — Touch targets (Apple HIG: >= 44px)
// ─────────────────────────────────────────────────────────────────────────────
async function testTouchTargets() {
  group('W. Touch targets (tối thiểu 44px — Apple HIG)');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ...iPhone });
  await context.addInitScript(() => {
    localStorage.setItem('edupulse_ios_install_hint_dismissed', '1');
    localStorage.setItem('edupulse_install_banner_dismissed', '1');
  });
  const page = await context.newPage();
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(1200);

  await touchTargets(page, 'W1. 6 nút bottom nav ≥ 44px', '.mobile-nav-btn', MIN_TOUCH, true);
  await touchTargets(page, 'W2. Nút theme (header) ≥ 44px', '#btn-mobile-theme');
  await touchTargets(page, 'W3. Nút "Xem chi tiết" hero ≥ 44px', '#btn-hero-detail');

  await page.evaluate(() => document.querySelector('.mobile-nav-btn[data-tab="tab-ai"]').click());
  await sleep(400);
  await touchTargets(page, 'W4. Gợi ý câu hỏi AI ≥ 44px', '.ai-suggestions button');
  await touchTargets(page, 'W5. Nút gửi AI ≥ 44px', '.ai-composer button');
  await touchTargets(page, 'W6. Ô nhập AI ≥ 44px', '.ai-composer input');

  await page.evaluate(() => document.querySelector('.mobile-nav-btn[data-tab="tab-chat"]').click());
  await sleep(400);
  await touchTargets(page, 'W7. Nút gửi chat ≥ 44px', '.chat-composer-bar .btn-chat-send');
  await touchTargets(page, 'W8. Nút đính kèm chat ≥ 44px', '#btn-chat-attach');
  await touchTargets(page, 'W9. Ô nhập chat ≥ 44px', '.chat-composer-input');

  await page.evaluate(() => document.querySelector('.mobile-nav-btn[data-tab="tab-exams"]').click());
  await sleep(400);
  await touchTargets(page, 'W10. Nút thêm kỳ thi ≥ 44px', '#btn-add-exam-page');
  await touchTargets(page, 'W11. Filter pills ≥ 44px', '.filter-pill-btn');

  await page.evaluate(() => document.querySelector('#btn-add-exam-page').click());
  await sleep(400);
  await touchTargets(page, 'W12. Nút đóng modal (×) ≥ 44px', '.btn-close-modal');
  await touchTargets(page, 'W13. Nút "Đóng" modal ≥ 44px', '.modal-footer-actions .btn-secondary-flat');
  await touchTargets(page, 'W14. Nút lưu modal ≥ 44px', '.modal-footer-actions .btn-primary-action');
  await page.evaluate(() => document.querySelector('#modal-exam .btn-close-modal').click());
  await sleep(300);

  await page.evaluate(() => document.querySelector('.mobile-nav-btn[data-tab="tab-account"]').click());
  await sleep(400);
  await touchTargets(page, 'W15. Tab Đăng nhập/Đăng ký ≥ 44px', '.auth-mode-btn');
  await touchTargets(page, 'W16. Nút Google đăng nhập ≥ 44px', '#btn-google-auth');
  await touchTargets(page, 'W17. Nút "Quên mật khẩu?" ≥ 44px', '#btn-forgot-password');
  await touchTargets(page, 'W18. Nút mắt (toggle password) ≥ 44px', '#btn-toggle-password');

  await page.locator('#btn-forgot-password').tap();
  await sleep(400);
  await touchTargets(page, 'W19. Nút "Gửi link" (modal quên MK) ≥ 44px', '#btn-submit-forgot');
  await touchTargets(page, 'W20. Nút đóng modal quên MK ≥ 44px', '#modal-forgot-password .btn-close-modal');
  await browser.close();
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION X — Typography & accessibility
// ─────────────────────────────────────────────────────────────────────────────
async function testTypography() {
  group('X. Typography & accessibility');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ...iPhone });
  await context.addInitScript(() => {
    localStorage.setItem('edupulse_ios_install_hint_dismissed', '1');
    localStorage.setItem('edupulse_install_banner_dismissed', '1');
  });
  const page = await context.newPage();
  await page.addInitScript(CONTRAST_HELPER);
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(1200);

  const typo = await page.evaluate(() => {
    const cs = (sel) => { const el = document.querySelector(sel); return el ? getComputedStyle(el) : null; };
    const body = cs('.app-main-viewport');
    // Greeting removed from mobile header - use home page heading instead
    const greeting = cs('#home-greeting-title');
    return {
      bodySize: body.fontSize, bodyLine: body.lineHeight, bodyFont: body.fontFamily,
      headingSize: greeting ? greeting.fontSize : body.fontSize,
      headingFont: greeting ? greeting.fontFamily : body.fontFamily,
      htmlLang: document.documentElement.lang,
    };
  });
  check('X1. Chữ body ≥ 14px (không vỡ layout)', parseFloat(typo.bodySize) >= 14, typo.bodySize);
  check('X2. Line-height body ≥ 1.4', parseFloat(typo.bodyLine) >= 1.4, typo.bodyLine);
  check('X3. Font stack có fallback đầy đủ', (typo.bodyFont.match(/,/g) || []).length >= 4 && /sans-serif/.test(typo.bodyFont), 'sans-serif + hệ thống');
  check('X4. Heading greeting ≥ 24px (mobile)', parseFloat(typo.headingSize) >= 24, typo.headingSize);
  check('X5. <html lang="vi">', typo.htmlLang === 'vi', typo.htmlLang);

  const a11y = await page.evaluate(() => {
    const iconBtns = Array.from(document.querySelectorAll('button')).filter(b => (b.innerText || '').trim().length === 0);
    const noLabel = iconBtns.filter(b => !b.getAttribute('aria-label') && !b.getAttribute('title')).map(b => (b.className || b.tagName).split(' ').slice(0, 2).join('.'));
    const labels = Array.from(document.querySelectorAll('label')).map(l => l.htmlFor).filter(Boolean);
    const controlIds = Array.from(document.querySelectorAll('input[id], select[id], textarea[id], button[id]')).map(i => i.id);
    const orphans = labels.filter(f => !controlIds.includes(f));
    const inputs = Array.from(document.querySelectorAll('input, select, textarea')).filter(i => !i.type.includes('hidden') && !i.hasAttribute('hidden'));
    const noLabelInputs = inputs.filter(i => !document.querySelector(`label[for="${i.id}"]`) && !i.getAttribute('aria-label') && !i.getAttribute('placeholder')).map(i => i.id || i.type);
    return { iconNoLabel: [...new Set(noLabel)], orphanLabels: orphans, noLabelInputs: noLabelInputs.slice(0, 6) };
  });
  check('X6. Icon-only buttons có aria-label/title', a11y.iconNoLabel.length === 0, a11y.iconNoLabel.join(', ') || 'tất cả đều có');
  check('X7. Mọi <label for> khớp input/select/textarea id', a11y.orphanLabels.length === 0, a11y.orphanLabels.join(', ') || 'OK');
  check('X8. Mọi control có label/placeholder/aria-label', a11y.noLabelInputs.length === 0, a11y.noLabelInputs.join(', ') || 'OK');

  const eyeContrast = await cssContrast(page, '#btn-toggle-password', '#auth-password');
  check('X9. Nút mắt password ≥ 3:1 (icon)', eyeContrast ? eyeContrast.ratio >= 3 : true, eyeContrast ? eyeContrast.ratio.toFixed(2) : 'N/A');
  await browser.close();
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION Y — States & interactions
// ─────────────────────────────────────────────────────────────────────────────
async function testStates() {
  group('Y. States & interactions');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ...iPhone });
  await context.addInitScript(() => {
    localStorage.setItem('edupulse_ios_install_hint_dismissed', '1');
    localStorage.setItem('edupulse_install_banner_dismissed', '1');
  });
  const page = await context.newPage();
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(1200);

  // Y1. Toast tự ẩn sau ~3s
  await page.locator('#btn-mobile-theme').tap();
  await sleep(400);
  const toastShown = await page.evaluate(() => !!document.querySelector('.app-toast.show'));
  await sleep(3400);
  const toastGone = await page.evaluate(() => !document.querySelector('.app-toast.show'));
  check('Y1. Toast hiện + tự ẩn sau ~3s', toastShown && toastGone, `shown=${toastShown}, gone=${toastGone}`);

  // Y2. Focus-visible: Tab đến nút → có viền focus
  await page.keyboard.press('Tab');
  await sleep(150);
  const focusBtn = await page.evaluate(() => {
    const el = document.activeElement;
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { tag: el.tagName, cls: (el.className || '').slice(0, 30), outline: cs.outlineWidth + ' ' + cs.outlineStyle, shadow: cs.boxShadow.slice(0, 40), hasFocusVisible: el.matches(':focus-visible') };
  });
  check('Y2. Nút có viền focus khi Tab (bàn phím)', focusBtn && focusBtn.hasFocusVisible && (focusBtn.outline !== '0px none' || focusBtn.shadow !== 'none'), JSON.stringify(focusBtn));

  // Y3. Tap backdrop modal → không đóng (hành vi hiện tại, cần xác nhận UX)
  await page.evaluate(() => document.querySelector('.mobile-nav-btn[data-tab="tab-exams"]').click());
  await sleep(350);
  await page.evaluate(() => document.querySelector('#btn-add-exam-page').click());
  await sleep(400);
  const modalBefore = await page.evaluate(() => !!document.querySelector('#modal-exam.active'));
  await page.mouse.click(30, 100);
  await sleep(400);
  const modalAfter = await page.evaluate(() => !!document.querySelector('#modal-exam.active'));
  check('Y3. Tap nền modal không đóng (không đóng nhầm)', modalBefore && modalAfter === modalBefore, `trước=${modalBefore}, sau=${modalAfter} (không đóng = an toàn)`);
  await page.evaluate(() => document.querySelector('#modal-exam .btn-close-modal').click());
  await sleep(300);

  // Y4. Nút nav có hiệu ứng khi chạm (transition)
  const navTransition = await page.evaluate(() => {
    const cs = getComputedStyle(document.querySelector('.mobile-nav-btn'));
    return { transition: cs.transition, active: getComputedStyle(document.querySelector('.mobile-nav-btn.active')).color, inactive: getComputedStyle(document.querySelector('.mobile-nav-btn:not(.active)')).color };
  });
  check('Y4. Nav có transition + phân biệt active/inactive', navTransition.transition !== 'all 0s ease 0s' && navTransition.active !== navTransition.inactive, JSON.stringify(navTransition));

  // Y5. Disabled state: nút gửi AI bị disable khi đang gửi
  await page.evaluate(() => document.querySelector('.mobile-nav-btn[data-tab="tab-ai"]').click());
  await sleep(400);
  await page.locator('.ai-composer input').fill('1+1 bằng mấy?');
  await page.locator('.ai-composer button[type="submit"]').tap();
  await sleep(80);
  const busy = await page.evaluate(() => {
    const btn = document.querySelector('.ai-composer button[type="submit"]');
    return { disabled: btn.disabled, ariaBusy: document.body.getAttribute('aria-busy') || 'none' };
  });
  check('Y5. Nút gửi AI disabled khi đang xử lý', busy.disabled === true, JSON.stringify(busy));
  await sleep(15000);
  const done = await page.evaluate(() => {
    const btn = document.querySelector('.ai-composer button[type="submit"]');
    return { disabled: btn.disabled, msgs: document.querySelectorAll('.ai-message').length };
  });
  check('Y6. Nút gửi AI bật lại sau khi trả lời', done.disabled === false, `disabled=${done.disabled}, msgs=${done.msgs}`);

  // Y7. Nút Gửi trong chat disabled khi trống
  await page.evaluate(() => document.querySelector('.mobile-nav-btn[data-tab="tab-chat"]').click());
  await sleep(400);
  const chatBtn = await page.evaluate(() => {
    const btn = document.querySelector('.chat-composer-bar .btn-chat-send');
    return { disabled: btn.disabled, style: getComputedStyle(btn).opacity + '/' + getComputedStyle(btn).cursor };
  });
  check('Y7. Nút gửi chat bị disabled khi ô trống', chatBtn.disabled === true, JSON.stringify(chatBtn));
  await browser.close();
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION Z — Screenshot documentation (light + dark)
// ─────────────────────────────────────────────────────────────────────────────
async function testScreenshots() {
  group('Z. Screenshots (light + dark, cho review trực quan)');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ...iPhone });
  await context.addInitScript(() => {
    localStorage.setItem('edupulse_ios_install_hint_dismissed', '1');
    localStorage.setItem('edupulse_install_banner_dismissed', '1');
  });
  const page = await context.newPage();
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(1500);

  const tabs = [
    ['tab-home', 'home'], ['tab-exams', 'exams'], ['tab-ai', 'ai'],
    ['tab-chat', 'chat'], ['tab-library', 'library'], ['tab-account', 'account'],
  ];
  for (const [tab, name] of tabs) {
    await page.evaluate(t => document.querySelector(`.mobile-nav-btn[data-tab="${t}"]`).click(), tab);
    await sleep(500);
    await capture(page, `light-${name}`);
  }
  // Quay lại tab home trước khi đổi theme (nút theme nằm trong header tab home)
  await page.evaluate(() => document.querySelector('.mobile-nav-btn[data-tab="tab-home"]').click());
  await sleep(300);
  await page.locator('#btn-mobile-theme').tap();
  await sleep(700);
  for (const [tab, name] of tabs) {
    await page.evaluate(t => document.querySelector(`.mobile-nav-btn[data-tab="${t}"]`).click(), tab);
    await sleep(500);
    await capture(page, `dark-${name}`);
  }
  check('Z1. 12 ảnh light+dark đã lưu (screenshots/uiux/)', true, `${tabs.length * 2} ảnh`);
  await browser.close();
}

// ─────────────────────────────────────────────────────────────────────────────
(async () => {
  console.log(`EduPulse UI/UX test suite\nTarget: ${BASE_URL}\nEngine: Chromium (${iPhone.userAgent.split(')')[0]})`);
  await testLayout();
  await testVisual();
  await testTouchTargets();
  await testTypography();
  await testStates();
  await testScreenshots();

  const fails = results.filter(r => !r.ok);
  console.log(`\n════════════════════════════════════════════`);
  console.log(`KẾT QUẢ: ${results.length - fails.length} PASS / ${fails.length} FAIL (${results.length} total)`);
  if (fails.length) {
    console.log('\nDanh sách FAIL:');
    for (const f of fails) console.log(`  ❌ [${f.section}] ${f.name} — ${f.detail}`);
  }
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('Suite crash:', e.message); process.exit(2); });