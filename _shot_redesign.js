const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  for (const viewport of [{ name: 'desktop', width: 1280, height: 900 }, { name: 'mobile', width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: 2 });
    const errors = [];
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    await page.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1500);
    // Open AI tab
    await page.evaluate(() => {
      const nav = [...document.querySelectorAll('[data-tab]')].find(b => b.getAttribute('data-tab') === 'tab-ai');
      if (nav) nav.click();
    });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `C:/Users/Minh/AppData/Local/Temp/opencode/ai_${viewport.name}.png`, fullPage: false });
    const aiInfo = await page.evaluate(() => {
      const h = document.querySelector('#tab-ai .greeting-title');
      const composer = document.querySelector('#tab-ai .ai-composer');
      const sel = document.querySelector('#tab-ai select#ai-model-select');
      const msgs = document.querySelectorAll('#ai-messages .ai-message').length;
      return { title: h ? h.textContent.trim() : null, composer: !!composer, modelSel: sel ? sel.value : null, msgs };
    });
    // Open Groups tab
    await page.evaluate(() => {
      const nav = [...document.querySelectorAll('[data-tab]')].find(b => b.getAttribute('data-tab') === 'tab-groups');
      if (nav) nav.click();
    });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `C:/Users/Minh/AppData/Local/Temp/opencode/groups_${viewport.name}.png`, fullPage: false });
    const grInfo = await page.evaluate(() => {
      const root = document.querySelector('#groups-root');
      const header = root ? root.querySelector('.groups-header .greeting-title') : null;
      const cards = root ? root.querySelectorAll('.group-card').length : 0;
      const empty = root ? root.querySelector('.groups-empty') : null;
      return { header: header ? header.textContent.trim() : null, cards, empty: !!empty };
    });
    console.log(JSON.stringify({ viewport: viewport.name, aiInfo, grInfo, errors }));
    await page.close();
  }
  await browser.close();
})();