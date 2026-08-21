/* Room ONLY (no prior call) — xem B's presence write có bị kẹt không */
const { chromium } = require('playwright');
const BASE = process.argv[2] === 'local' ? 'http://localhost:3000' : 'https://tsa1-69053.web.app';
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--no-sandbox'] });
  async function mk() {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'vi-VN', permissions: ['camera', 'microphone'] });
    const page = await ctx.newPage();
    return { ctx, page };
  }
  const { ctx: cA, page: A } = await mk();
  const { ctx: cB, page: B } = await mk();
  async function login(page, e, p) {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    await page.click('#btn-sidebar-account');
    await page.waitForTimeout(800);
    await page.fill('#auth-email', e); await page.fill('#auth-password', p);
    await page.click('#auth-submit'); await page.waitForTimeout(8000);
    await page.click('.nav-item[data-tab="tab-chat"]'); await page.waitForTimeout(2000);
  }
  await login(A, process.env.USER1_EMAIL, process.env.USER1_PASSWORD);
  await login(B, process.env.USER2_EMAIL, process.env.USER2_PASSWORD);
  console.log('logged in (' + BASE + ') — NO prior call');

  await A.click('#btn-room-join-video').catch(e => console.log('A join err', e.message));
  await B.click('#btn-room-join-video').catch(e => console.log('B join err', e.message));
  for (const [page, label] of [[A, 'A'], [B, 'B']]) {
    const ms = await page.evaluate(() => {
      const db = firebase.firestore();
      return new Promise(resolve => {
        const t0 = Date.now();
        const to = setTimeout(() => resolve('TIMEOUT >8000ms'), 8000);
        db.waitForPendingWrites().then(() => { clearTimeout(to); resolve(Date.now() - t0 + 'ms'); });
      });
    }).catch(e => 'ERR ' + e.message);
    console.log('waitForPendingWrites ' + label + ':', ms);
  }
  for (const t of [4, 12]) {
    await A.waitForTimeout(t === 4 ? 4000 : 8000);
    const nA = await A.locator('#room-member-list .chat-room-member').count().catch(() => -1);
    const nB = await B.locator('#room-member-list .chat-room-member').count().catch(() => -1);
    console.log('t=' + t + 's A: ' + nA + '  B: ' + nB);
  }
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });