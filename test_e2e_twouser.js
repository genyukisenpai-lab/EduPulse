/* ==========================================================================
   EduPulse — Two-user E2E (Playwright)
   Requires 2 distinct email-verified accounts:
     $env:USER1_EMAIL / $env:USER1_PASSWORD
     $env:USER2_EMAIL / $env:USER2_PASSWORD
   Usage: node test_e2e_twouser.js deploy|local
   Covers: cross-user chat, Firestore sync, 1-1 video call, study room (2 members)
   ========================================================================== */
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const TARGET = process.argv[2] || 'deploy';
const BASE = TARGET === 'local' ? 'http://localhost:3000' : 'https://tsa1-69053.web.app';
const OUT_DIR = path.join(__dirname, 'screenshots', 'test-report');
const U1 = { email: process.env.USER1_EMAIL || '', pass: process.env.USER1_PASSWORD || '' };
const U2 = { email: process.env.USER2_EMAIL || '', pass: process.env.USER2_PASSWORD || '' };

const results = [];
function rec(suite, name, ok, detail) {
  results.push({ suite, name, status: ok === 'BLOCKED' ? 'BLOCKED' : ok ? 'PASS' : 'FAIL', detail });
  console.log(`  [${ok === 'BLOCKED' ? 'BLOCKED' : ok ? 'PASS' : 'FAIL'}] ${suite} :: ${name}${detail ? ' — ' + detail : ''}`);
}
async function shot(page, suite, name) {
  const dir = path.join(OUT_DIR, suite);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, name + '.png') }).catch(() => {});
}

async function newCtx(browser) {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: 'vi-VN',
    permissions: ['camera', 'microphone', 'notifications'],
    ignoreHTTPSErrors: true
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('  [PAGEERR] ' + String(e).slice(0, 200)));
  return { ctx, page };
}

async function login(page, email, pass) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3000);
  await page.click('#btn-sidebar-account');
  await page.waitForTimeout(800);
  await page.fill('#auth-email', email);
  await page.fill('#auth-password', pass);
  await page.click('#auth-submit');
  await page.waitForTimeout(8000);
  return await page.locator('#account-user-view').isVisible().catch(() => false);
}

async function openChat(page) {
  await page.click('.nav-item[data-tab="tab-chat"]');
  await page.waitForTimeout(2500);
}

async function waitForMsg(page, text, timeout) {
  const loc = page.locator('.chat-msg-card', { hasText: text });
  await loc.first().waitFor({ state: 'visible', timeout: timeout || 20000 });
  return loc.first();
}

(async () => {
  if (!U1.email || !U1.pass || !U2.email || !U2.pass) {
    console.log('Cần USER1_EMAIL/USER1_PASSWORD và USER2_EMAIL/USER2_PASSWORD');
    rec('16-twouser', 'Điều kiện tiên quyết (2 tài khoản)', 'BLOCKED', 'Set USER1_* và USER2_*');
    process.exit(0);
  }
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
      '--no-sandbox', '--autoplay-policy=no-user-gesture-required'
    ]
  });
  const suite = '16-twouser';
  console.log('Target: ' + BASE);

  const { ctx: ctxA, page: A } = await newCtx(browser);
  const { ctx: ctxB, page: B } = await newCtx(browser);
  try {
    const loginA = await login(A, U1.email, U1.pass);
    const loginB = await login(B, U2.email, U2.pass);
    rec(suite, 'Đăng nhập người dùng A', loginA, loginA ? '' : 'userView không hiện');
    rec(suite, 'Đăng nhập người dùng B', loginB, loginB ? '' : 'userView không hiện');
    if (!loginA || !loginB) return;

    // ---------- SYNC: A thêm exam -> Firestore users/{uid}/settings/app ----------
    const uidA = await A.evaluate(() => firebase.auth().currentUser.uid);
    await A.click('.nav-item[data-tab="tab-exams"]');
    await A.waitForTimeout(400);
    await A.click('#btn-add-exam-page');
    await A.fill('#exam-name', 'E2E Sync ' + Date.now());
    await A.fill('#exam-date', '2027-12-31');
    await A.click('#form-exam button[type="submit"]');
    await A.waitForTimeout(4000);
    const synced = await A.evaluate(async (uid) => {
      const db = firebase.firestore();
      const snap = await db.doc(`users/${uid}/settings/app`).get();
      if (!snap.exists) return null;
      const s = snap.data().state || {};
      const hit = (s.exams || []).find(e => (e.title || '').indexOf('E2E Sync') !== -1);
      return hit ? { title: hit.title, date: hit.date } : null;
    }, uidA).catch(e => ({ err: String(e) }));
    rec(suite, 'Đồng bộ exam lên Firestore (A)', !!synced && synced.title, synced ? JSON.stringify(synced) : 'doc không tồn tại');
    // cleanup
    await A.evaluate(async (uid) => {
      const db = firebase.firestore();
      const snap = await db.doc(`users/${uid}/settings/app`).get();
      if (snap.exists) {
        const s = snap.data().state || {};
        s.exams = (s.exams || []).filter(e => (e.title || '').indexOf('E2E Sync') === -1);
        await db.doc(`users/${uid}/settings/app`).update({ state: s, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
      }
    }, uidA).catch(() => {});
    await A.evaluate(() => window.EDUPULSE_APP && window.EDUPULSE_APP.saveState());
    await A.waitForTimeout(1500);

    // ---------- CHAT CROSS-USER ----------
    await openChat(A);
    await openChat(B);
    const marker = 'E2E-2U-' + Date.now();
    await A.fill('#chat-message', marker + ' từ A');
    await A.click('#btn-chat-send');
    const msgB = await waitForMsg(B, marker + ' từ A', 30000).catch(() => null);
    rec(suite, 'B nhận được tin A gửi (realtime)', !!msgB, msgB ? '' : 'timeout 30s');
    if (msgB) {
      const authorB = await msgB.locator('.chat-msg-author').textContent().catch(() => '');
      rec(suite, 'B thấy tên tác giả A', authorB.trim().length > 0 && authorB.trim() !== 'Sĩ tử EduPulse', 'author=' + JSON.stringify(authorB.trim()));
      await shot(B, suite, 'B-sees-A-msg');
    }
    const reply = marker + ' từ B';
    await B.fill('#chat-message', reply);
    await B.click('#btn-chat-send');
    const msgA = await waitForMsg(A, reply, 30000).catch(() => null);
    rec(suite, 'A nhận được tin B trả lời (realtime)', !!msgA, msgA ? '' : 'timeout 30s');
    await shot(A, suite, 'A-sees-B-reply');

    // ---------- 1-1 VIDEO CALL ----------
    await A.evaluate(() => window.EDUPULSE_APP && window.EDUPULSE_APP.openTab('tab-chat'));
    await B.evaluate(() => window.EDUPULSE_APP && window.EDUPULSE_APP.openTab('tab-chat'));
    await A.waitForTimeout(1000);
    const bMsgCard = A.locator('.chat-msg-card', { hasText: reply });
    await bMsgCard.first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
    await bMsgCard.first().locator('[data-call-type="video"]').click().catch(e => rec(suite, 'A bấm gọi video', 'BLOCKED', String(e).slice(0, 120)));
    await A.waitForTimeout(2500);
    const incomingVisible = await B.locator('#call-overlay:not([hidden])').isVisible().catch(() => false);
    rec(suite, 'B nhận thông báo cuộc gọi đến', incomingVisible, incomingVisible ? '' : 'không thấy overlay incoming');
    if (incomingVisible) {
      await shot(B, suite, 'B-incoming-call');
      await B.click('#btn-call-accept-video').catch(e => rec(suite, 'B nhấn nghe video', 'FAIL', String(e).slice(0, 120)));
      await A.waitForTimeout(6000);
      const activeA = await A.locator('#call-overlay:not([hidden]) #call-timer').count();
      const activeB = await B.locator('#call-overlay:not([hidden]) #call-timer').count();
      rec(suite, 'Cuộc gọi video ACTIVE (2 đầu)', activeA === 1 && activeB === 1, 'A=' + activeA + ' B=' + activeB);
      if (activeA === 1 && activeB === 1) await shot(A, suite, 'A-call-active');
      await A.click('#btn-call-end').catch(() => {});
      await A.waitForTimeout(2000);
      const endedA = await A.locator('#call-overlay:not([hidden])').count();
      const endedB = await B.locator('#call-overlay:not([hidden])').count();
      rec(suite, 'Kết thúc cuộc gọi (cả 2 đầu ẩn overlay)', endedA === 0 && endedB === 0, 'A=' + endedA + ' B=' + endedB);
    }

    // ---------- STUDY ROOM (2 members) ----------
    await A.click('#btn-room-join-video').catch(e => rec(suite, 'A vào phòng video', 'FAIL', String(e).slice(0, 120)));
    await B.click('#btn-room-join-video').catch(e => rec(suite, 'B vào phòng video', 'FAIL', String(e).slice(0, 120)));
    const roomA = await A.locator('#room-overlay:not([hidden])').isVisible().catch(() => false);
    const roomB = await B.locator('#room-overlay:not([hidden])').isVisible().catch(() => false);
    rec(suite, 'Phòng study hiển thị cho cả 2', roomA && roomB, 'A=' + roomA + ' B=' + roomB);
    // poll until both see 2 members (avoid Firestore snapshot race)
    // NOTE: ngay sau cuộc gọi 1-1, presence của bên bị gọi bị kẹt queue Firestore
    // (BUG-17, BUG_REPORT.md) nên test này THƯỜNG FAIL với A=1 B=2 trong ~20s,
    // chỉ tự hết sau heartbeat 30s. Giữ assertion để bắt bug.
    let membersA = 0, membersB = 0;
    for (let i = 0; i < 10; i++) {
      membersA = await A.locator('#room-member-list .chat-room-member').count().catch(() => 0);
      membersB = await B.locator('#room-member-list .chat-room-member').count().catch(() => 0);
      if (membersA >= 2 && membersB >= 2) break;
      await A.waitForTimeout(2000);
    }
    rec(suite, 'Phòng study đếm 2 thành viên', membersA >= 2 && membersB >= 2, 'A=' + membersA + ' B=' + membersB + (membersA >= 2 && membersB >= 2 ? '' : ' (BUG-17: presence bên bị gọi bị kẹt queue ~30s)'));
    if (roomA && roomB) await shot(A, suite, 'room-2members');
    await A.click('#btn-room-leave').catch(() => {});
    await B.click('#btn-room-leave').catch(() => {});
    await A.waitForTimeout(2000);
    const roomA2 = await A.locator('#room-overlay:not([hidden])').count();
    const roomB2 = await B.locator('#room-overlay:not([hidden])').count();
    rec(suite, 'Rời phòng (cả 2 đầu ẩn overlay)', roomA2 === 0 && roomB2 === 0, 'A=' + roomA2 + ' B=' + roomB2);
  } finally {
    await ctxA.close();
    await ctxB.close();
    await browser.close();
    const pass = results.filter(r => r.status === 'PASS').length;
    const fail = results.filter(r => r.status === 'FAIL').length;
    const blocked = results.filter(r => r.status === 'BLOCKED').length;
    console.log('===== 2-NGƯỜI: PASS=' + pass + ' FAIL=' + fail + ' BLOCKED=' + blocked + ' =====');
    fs.writeFileSync(path.join(OUT_DIR, 'report-twouser.json'), JSON.stringify({ target: BASE, results }, null, 2), 'utf8');
  }
})().catch(e => { console.error('FATAL', e); process.exit(1); });