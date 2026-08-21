(function () {
  'use strict';
  let deferredPrompt = null;
  const installKey = 'edupulse_install_banner_dismissed';
  const iosHintKey = 'edupulse_ios_install_hint_dismissed';
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

  function createInstallPrompt() {
    if (document.getElementById('pwa-install-prompt') || isStandalone) return;
    const prompt = document.createElement('aside');
    prompt.id = 'pwa-install-prompt';
    prompt.className = 'pwa-install-prompt';
    prompt.innerHTML = '<div class="pwa-install-icon"><i class="fa-solid fa-hourglass-half"></i></div><div><strong>Cài EduPulse</strong><p>Mở nhanh hơn, dùng như một ứng dụng riêng.</p></div><button class="pwa-install-button">Cài đặt</button><button class="pwa-dismiss-button" aria-label="Đóng">×</button>';
    document.body.appendChild(prompt);
    prompt.querySelector('.pwa-install-button').addEventListener('click', installApp);
    prompt.querySelector('.pwa-dismiss-button').addEventListener('click', () => {
      localStorage.setItem(installKey, '1');
      prompt.remove();
    });
  }

  async function installApp() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    deferredPrompt = null;
    if (outcome === 'accepted') document.getElementById('pwa-install-prompt')?.remove();
  }

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredPrompt = event;
    if (!localStorage.getItem(installKey)) createInstallPrompt();
  });

  window.addEventListener('appinstalled', () => {
    document.getElementById('pwa-install-prompt')?.remove();
    localStorage.removeItem(installKey);
  });

  function showIosInstallHint() {
    if (!isIos || isStandalone || localStorage.getItem(iosHintKey) || document.getElementById('ios-install-hint')) return;
    const hint = document.createElement('aside');
    hint.id = 'ios-install-hint';
    hint.className = 'ios-install-hint';
    hint.setAttribute('role', 'dialog');
    hint.setAttribute('aria-label', 'Hướng dẫn cài EduPulse trên iPhone');
    hint.innerHTML = '<button class="ios-hint-close" aria-label="Đóng">×</button><div class="ios-hint-icon"><i class="fa-solid fa-mobile-screen-button"></i></div><strong>Cài EduPulse trên iPhone</strong><p>Trong Safari, chạm <span class="ios-share-icon"><i class="fa-solid fa-arrow-up-from-bracket"></i></span> <b>Chia sẻ</b> rồi chọn <b>Thêm vào Màn hình chính</b>.</p><button class="ios-hint-done">Đã hiểu</button>';
    document.body.appendChild(hint);
    const dismiss = () => { localStorage.setItem(iosHintKey, '1'); hint.remove(); };
    hint.querySelector('.ios-hint-close').addEventListener('click', dismiss);
    hint.querySelector('.ios-hint-done').addEventListener('click', dismiss);
  }

  const isIosPwa = isIos && isStandalone;
  if (isIosPwa && window.visualViewport) {
    const visualViewport = window.visualViewport;
    const updateKeyboardState = () => {
      const active = document.activeElement;
      const isTyping = !!active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
      const keyboardShown = isTyping && visualViewport.height < window.innerHeight - 120;
      document.body.classList.toggle('ios-keyboard-open', keyboardShown);
      document.body.style.setProperty('--ios-vv-height', `${Math.round(visualViewport.height)}px`);
    };
    visualViewport.addEventListener('resize', updateKeyboardState);
    window.addEventListener('focusin', updateKeyboardState);
    window.addEventListener('focusout', updateKeyboardState);
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./service-worker.js').then(registration => registration.update()).catch(error => console.warn('PWA registration failed:', error));
    });
  }
  window.addEventListener('load', () => window.setTimeout(showIosInstallHint, 900));

  /* ---- Haptic Feedback (Android progressive enhancement) ---- */
  if (navigator.vibrate) {
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('button, [role="button"], .mobile-nav-btn, .filter-pill-btn, .exam-mini-item, .community-widget-item');
      if (btn) navigator.vibrate(8);
    }, { passive: true });
  }

  /* ==========================================================================
     LOCKED UI (PWA) — chặn zoom, chống overscroll, khóa xoay dọc.
     ========================================================================== */

  // Khóa xoay màn hình theo chiều dọc (Android/Chrome hỗ trợ; iOS chỉ qua
  // manifest "orientation: portrait-primary" khi cài làm PWA).
  function lockOrientation() {
    if (screen.orientation && typeof screen.orientation.lock === 'function') {
      screen.orientation.lock('portrait').catch(() => {});
    }
  }
  if (isStandalone) lockOrientation();

  // Chặn pinch-zoom (2+ ngón tay) — iOS Safari bỏ qua user-scalable=no.
  document.addEventListener('touchmove', (e) => {
    if (e.touches && e.touches.length > 1) e.preventDefault();
  }, { passive: false });
  document.addEventListener('gesturestart', (e) => e.preventDefault(), { passive: false });

  // Chống overscroll/rubber-band: ngăn kéo lộ khoảng trống ở mép trên/dưới
  // bằng overscroll-behavior (CSS) + giữ nội dung không chảy khỏi khung.
  const lockBounce = () => {
    document.documentElement.classList.add('ui-locked');
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', lockBounce);
  } else {
    lockBounce();
  }
}());
