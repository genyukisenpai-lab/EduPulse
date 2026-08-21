/* Reproducer cho BUG-17 (BUG_REPORT.md):
   Sau cuộc gọi video 1-1, cả 2 vào phòng study → presence của bên bị gọi
   bị kẹt queue Firestore ~10-30s (waitForPendingWrites=STILL_PENDING), chỉ
   hết sau heartbeat 30s. Kết quả đúng: A=1 B=2 trong ~20s đầu, rồi 2/2.
   Usage: node debug-room3.js local|deploy  (cần USER1_* / USER2_* env)
*/
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
  console.log('logged in (' + BASE + ')');

  const marker = 'E2E-call-' + Date.now();
  await B.fill('#chat-message', marker); await B.click('#btn-chat-send');
  await A.locator('.chat-msg-card', { hasText: marker }).first().waitFor({ state: 'visible', timeout: 30000 });
  await A.locator('.chat-msg-card', { hasText: marker }).first().locator('[data-call-type="video"]').click();
  await B.waitForTimeout(2500);
  const inc = await B.locator('#call-overlay:not([hidden]) #btn-call-accept-video').isVisible().catch(() => false);
  console.log('B accept button visible:', inc);
  if (inc) { await B.click('#btn-call-accept-video'); await B.waitForTimeout(3000); }
  await A.waitForTimeout(6000);
  console.log('call active A:', await A.locator('#call-overlay:not([hidden]) #call-timer').count(), 'B:', await B.locator('#call-overlay:not([hidden]) #call-timer').count());
  await A.click('#btn-call-end');
  await A.waitForTimeout(2500);
  console.log('call ended A:', await A.locator('#call-overlay:not([hidden])').count(), 'B:', await B.locator('#call-overlay:not([hidden])').count());

  // ---- ROOM after call ----
  await A.click('#btn-room-join-video').catch(e => console.log('A join err', e.message));
  await B.click('#btn-room-join-video').catch(e => console.log('B join err', e.message));
  // DIAG: đo xem client có pending write kẹt không
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
  for (const t of [4, 12, 22, 32, 42]) {
    await A.waitForTimeout(t === 4 ? 4000 : 10000);
    const sample = async (page, label) => {
      const n = await page.locator('#room-member-list .chat-room-member').count().catch(() => -1);
      const names = await page.locator('#room-member-list .chat-room-member').allTextContents().catch(() => []);
      console.log(label, 'count=' + n, JSON.stringify(names));
    };
    await sample(A, 't=' + t + 's A:');
    await sample(B, 't=' + t + 's B:');
  }
  const docs = await A.evaluate(async () => {
    const db = firebase.firestore();
    const snap = await db.collection('rooms').doc('study').collection('members').get();
    return snap.docs.map(d => ({ uid: d.id.slice(0, 8), name: d.data().name, fresh: (Date.now() - (d.data().lastSeen ? d.data().lastSeen.toMillis() : 0)) }));
  }).catch(e => ({ err: String(e) }));
  console.log('presence docs (uid8, name, ageMs):', JSON.stringify(docs));
  await A.click('#btn-room-leave').catch(() => {});
  await B.click('#btn-room-leave').catch(() => {});
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });