const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(1800);
  const info = await page.evaluate(() => {
    const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), display: getComputedStyle(el).display }; };
    const grid = document.getElementById('home-stats-grid');
    const units = Array.from(document.querySelectorAll('.timer-unit-item')).map(u => rect(u));
    const statBoxes = Array.from(document.querySelectorAll('.stat-box-card')).map(c => rect(c));
    const heroCard = rect(document.querySelector('.hero-countdown-card'));
    const timerDisplay = rect(document.querySelector('.hero-timer-display'));
    return {
      homeActive: document.querySelector('#tab-home').classList.contains('active'),
      heroCard, timerDisplay,
      units, statBoxes,
      statsGrid: rect(grid),
      statsGridDisplay: grid ? getComputedStyle(grid).display : null,
      statsGridInline: grid ? grid.style.display : null,
    };
  });
  console.log(JSON.stringify(info, null, 2));
  console.log('JS errors:', errors.length ? errors : 'none');
  await browser.close();
})();