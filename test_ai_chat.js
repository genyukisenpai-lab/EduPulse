const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const SCREENSHOTS_DIR = path.join(__dirname, 'screenshots');
if (!fs.existsSync(SCREENSHOTS_DIR)) fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });

  console.log('Navigating to app...');
  await page.goto('https://tsa1-69053.web.app', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(3000);
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '01_initial.png') });
  console.log('Screenshot 01: Initial page saved.');

  // Find and click the AI tab
  console.log('Looking for AI tab...');
  const aiTab = await page.locator('[data-tab="tab-ai"], .nav-item[data-tab="tab-ai"], button:has-text("AI"), a:has-text("AI")').first();
  if (await aiTab.count() > 0) {
    await aiTab.click();
    console.log('Clicked AI tab');
  } else {
    // Try clicking any tab that might be AI
    const allTabs = await page.locator('.nav-item, .tab-btn, [role="tab"]').all();
    console.log(`Found ${allTabs.length} tabs. Trying each...`);
    for (const tab of allTabs) {
      const text = await tab.textContent();
      console.log('  Tab:', text?.trim());
    }
    // Try by aria or title
    await page.locator('.nav-item').nth(2).click(); // AI is 3rd nav item (index 2)
  }
  await sleep(1000);
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '02_ai_tab.png') });
  console.log('Screenshot 02: After clicking AI tab saved.');

  // Find the chat input
  const input = page.locator('.ai-composer input, #ai-input, input[placeholder*="Ví dụ"]').first();
  await input.fill('diễn giải thật chi tiết định lý pytago');
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '03_typed_message.png') });
  console.log('Screenshot 03: After typing message saved.');

  // Send the message
  await input.press('Enter');
  console.log('Message sent. Waiting for response...');
  await sleep(20000);
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '04_after_first_response.png') });
  console.log('Screenshot 04: After first AI response saved.');

  // Check page scroll height vs viewport height
  const scrollInfo1 = await page.evaluate(() => ({
    scrollHeight: document.documentElement.scrollHeight,
    clientHeight: document.documentElement.clientHeight,
    bodyScrollHeight: document.body.scrollHeight,
    hasVerticalScroll: document.documentElement.scrollHeight > document.documentElement.clientHeight,
  }));
  console.log('SCROLL INFO after 1st message:', JSON.stringify(scrollInfo1, null, 2));

  // Deep CSS debugging
  const cssDebug1 = await page.evaluate(() => {
    const appLayout = document.querySelector('.app-layout');
    const appMain = document.querySelector('.app-main-viewport');
    const tabContent = document.querySelector('.tab-content.active');
    const aiPage = document.querySelector('.ai-page');
    const aiWorkspace = document.querySelector('.ai-workspace');
    const aiChat = document.querySelector('.ai-chat');
    const getInfo = (el) => el ? {
      overflow: getComputedStyle(el).overflow,
      overflowY: getComputedStyle(el).overflowY,
      height: getComputedStyle(el).height,
      minHeight: getComputedStyle(el).minHeight,
      flexShrink: getComputedStyle(el).flexShrink,
      rect: Math.round(el.getBoundingClientRect().height),
      scrollHeight: el.scrollHeight,
    } : null;
    return {
      appLayout: getInfo(appLayout),
      appMain: getInfo(appMain),
      tabContent: getInfo(tabContent),
      aiPage: getInfo(aiPage),
      aiWorkspace: getInfo(aiWorkspace),
      aiChat: getInfo(aiChat),
    };
  });
  console.log('CSS DEBUG after 1st message:', JSON.stringify(cssDebug1, null, 2));

  // Find element with highest scrollHeight
  const tallestEl = await page.evaluate(() => {
    const all = document.querySelectorAll('*');
    let max = 0; let tag = '';
    all.forEach(el => {
      if (el.scrollHeight > max) { max = el.scrollHeight; tag = el.tagName + '.' + el.className.slice(0,40); }
    });
    return { tag, scrollHeight: max };
  });
  console.log('TALLEST ELEMENT:', JSON.stringify(tallestEl));

  // Check sidebar and main content heights
  const layoutInfo1 = await page.evaluate(() => {
    const sidebar = document.querySelector('.app-sidebar, .sidebar');
    const main = document.querySelector('.app-main, .main-content, main');
    const aiPage = document.querySelector('.ai-page');
    const aiChat = document.querySelector('.ai-chat');
    return {
      sidebar: sidebar ? { height: sidebar.getBoundingClientRect().height, scrollHeight: sidebar.scrollHeight } : null,
      main: main ? { height: main.getBoundingClientRect().height, scrollHeight: main.scrollHeight } : null,
      aiPage: aiPage ? { height: aiPage.getBoundingClientRect().height, scrollHeight: aiPage.scrollHeight } : null,
      aiChat: aiChat ? { height: aiChat.getBoundingClientRect().height, scrollHeight: aiChat.scrollHeight } : null,
    };
  });
  console.log('LAYOUT INFO after 1st message:', JSON.stringify(layoutInfo1, null, 2));

  // Send second message
  const input2 = page.locator('.ai-composer input, #ai-input, input[placeholder*="Ví dụ"]').first();
  await input2.fill('chứng minh chi tiết hơn với nhiều bước hơn');
  await input2.press('Enter');
  console.log('Second message sent. Waiting for response...');
  await sleep(20000);
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '05_after_second_response.png') });
  console.log('Screenshot 05: After second AI response saved.');

  const scrollInfo2 = await page.evaluate(() => ({
    scrollHeight: document.documentElement.scrollHeight,
    clientHeight: document.documentElement.clientHeight,
    bodyScrollHeight: document.body.scrollHeight,
    hasVerticalScroll: document.documentElement.scrollHeight > document.documentElement.clientHeight,
    scrollTop: window.scrollY,
  }));
  console.log('SCROLL INFO after 2nd message:', JSON.stringify(scrollInfo2, null, 2));

  const layoutInfo2 = await page.evaluate(() => {
    const sidebar = document.querySelector('.app-sidebar, .sidebar');
    const main = document.querySelector('.app-main, .main-content, main');
    const aiPage = document.querySelector('.ai-page');
    const aiChat = document.querySelector('.ai-chat');
    const aiMessages = document.querySelectorAll('.ai-message');
    return {
      sidebar: sidebar ? { height: sidebar.getBoundingClientRect().height, scrollHeight: sidebar.scrollHeight } : null,
      main: main ? { height: main.getBoundingClientRect().height, scrollHeight: main.scrollHeight } : null,
      aiPage: aiPage ? { height: aiPage.getBoundingClientRect().height, scrollHeight: aiPage.scrollHeight } : null,
      aiChat: aiChat ? { height: aiChat.getBoundingClientRect().height, scrollHeight: aiChat.scrollHeight } : null,
      messageCount: aiMessages.length,
    };
  });
  console.log('LAYOUT INFO after 2nd message:', JSON.stringify(layoutInfo2, null, 2));

  // Scroll page to bottom to see if there's blank space
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await sleep(500);
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '06_scrolled_to_bottom.png') });
  console.log('Screenshot 06: Page scrolled to bottom saved.');

  await browser.close();
  console.log('\n=== TEST COMPLETE ===');
  console.log(`Screenshots saved in: ${SCREENSHOTS_DIR}`);
  
  // Summary
  if (scrollInfo2.hasVerticalScroll) {
    console.log('\n🐛 BUG FOUND: Page has vertical scroll after 2 messages!');
    console.log(`   Page scroll height: ${scrollInfo2.scrollHeight}px, Viewport: ${scrollInfo2.clientHeight}px`);
    console.log(`   Excess: ${scrollInfo2.scrollHeight - scrollInfo2.clientHeight}px`);
  } else {
    console.log('\n✅ No page-level vertical scroll detected. Bug may be fixed!');
  }
})();
