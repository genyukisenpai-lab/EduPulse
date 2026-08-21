/* EduPulse Web Push client — đăng ký / hủy / cập nhật nhắc ôn hằng ngày (free qua Cloudflare Worker) */
(function () {
  'use strict';

  const WORKER_URL = window.EDUPULSE_PUSH_WORKER_URL || '';
  const VAPID_PUBLIC = window.EDUPULSE_VAPID_PUBLIC_KEY || '';

  function supported() {
    return !!WORKER_URL && 'serviceWorker' in navigator && 'PushManager' in window;
  }

  function getSubscription() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return Promise.resolve(null);
    return navigator.serviceWorker.ready.then(registration => registration.pushManager.getSubscription());
  }

  function post(path, body) {
    return fetch(WORKER_URL + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  }

  function getUid() {
    try {
      const bridge = window.EDUPULSE_APP;
      if (bridge && typeof bridge.getUid === 'function') return bridge.getUid() || '';
    } catch (error) { /* bỏ qua */ }
    return '';
  }

  function buildSnapshot() {
    try {
      const bridge = window.EDUPULSE_APP;
      if (!bridge || typeof bridge.getStudyStats !== 'function') return null;
      const stats = bridge.getStudyStats();
      if (!stats.nearestExam) return null;
      const study = stats.study || {};
      const push = study.push || { times: ['18:00'], quote: true };
      return {
        title: stats.nearestExam.title,
        days: stats.nearestExam.daysLeft,
        push: {
          times: Array.isArray(push.times) ? push.times : ['18:00'],
          quote: push.quote !== false
        }
      };
    } catch (error) {
      return null;
    }
  }

  async function enable() {
    if (!supported()) return { ok: false, reason: 'Chưa cấu hình worker hoặc trình duyệt không hỗ trợ Web Push.' };
    try {
      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        if (!('Notification' in window) || typeof Notification.requestPermission !== 'function') {
          return { ok: false, reason: 'Trình duyệt không hỗ trợ thông báo.' };
        }
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          return { ok: false, reason: 'Bạn đã từ chối quyền thông báo.' };
        }
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: VAPID_PUBLIC
        });
      }
      const json = subscription.toJSON();
      await post('/subscribe', {
        endpoint: json.endpoint,
        keys: json.keys,
        uid: getUid(),
        snapshot: buildSnapshot()
      });
      post('/send-test', { endpoint: json.endpoint }).catch(() => {});
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: String(error?.message || error) };
    }
  }

  async function disable() {
    try {
      const subscription = await getSubscription();
      if (subscription) {
        await post('/unsubscribe', { endpoint: subscription.endpoint }).catch(() => {});
        await subscription.unsubscribe();
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: String(error?.message || error) };
    }
  }

  async function updateSnapshot() {
    if (!supported()) return;
    const subscription = await getSubscription();
    if (!subscription) return;
    const snapshot = buildSnapshot();
    if (!snapshot) return;
    post('/update-snapshot', { endpoint: subscription.endpoint, uid: getUid(), snapshot }).catch(() => {});
  }

  async function status() {
    const subscription = await getSubscription();
    return {
      supported: supported(),
      permission: ('Notification' in window) ? Notification.permission : 'unsupported',
      subscribed: !!subscription
    };
  }

  // Gọi worker để đẩy push tức thì khi có tin nhắn chat mới (không chờ cron 1 phút).
  // Không cần thiết bị đăng ký push: worker tự tìm trong KV và bỏ qua chính người gửi.
  async function notifyChat(msg) {
    if (!supported() || !msg || !msg.id) return;
    try {
      await post('/notify-chat', {
        id: msg.id,
        authorId: msg.authorId || '',
        authorName: msg.authorName || '',
        text: msg.text || '',
        hasAttachment: !!msg.hasAttachment
      });
    } catch (error) {
      // Không ảnh hưởng việc gửi tin — lần cron tới sẽ bù
    }
  }

  // ---------- UI: nút bật/tắt trong tab Tài khoản ----------
  let toastEl = null;
  function toast(message, type = 'info') {
    let el = document.getElementById('app-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'app-toast';
      el.className = 'app-toast';
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.dataset.type = type;
    el.classList.add('show');
    clearTimeout(el.dismissTimer);
    el.dismissTimer = setTimeout(() => el.classList.remove('show'), 3500);
  }

  async function refreshToggle() {
    const section = document.getElementById('push-toggle-section');
    const label = document.getElementById('push-status-label');
    const button = document.getElementById('btn-toggle-push');
    if (!section || !label || !button) return;
    if (!supported()) { section.hidden = true; return; }
    section.hidden = false;
    const s = await status();
    if (s.subscribed) {
      label.textContent = 'Đang bật · nhận nhắc lúc 18:00';
      label.style.color = 'var(--success)';
    } else {
      label.textContent = 'Đang tắt';
      label.style.color = 'var(--text-muted)';
    }
  }

  function initToggle() {
    const button = document.getElementById('btn-toggle-push');
    if (!button) return;
    button.addEventListener('click', async () => {
      const s = await status();
      button.disabled = true;
      try {
        if (s.subscribed) {
          const result = await disable();
          toast(result.ok ? 'Đã tắt nhắc ôn hằng ngày.' : 'Lỗi: ' + result.reason, result.ok ? 'info' : 'error');
        } else {
          const result = await enable();
          if (result.ok) {
            toast('Đã bật! Bạn sẽ nhận 1 thông báo thử ngay bây giờ.');
            updateSnapshot();
          } else {
            toast(result.reason, 'error');
          }
        }
      } finally {
        button.disabled = false;
        refreshToggle();
      }
    });
    refreshToggle();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initToggle);
  } else {
    initToggle();
  }

  window.EduPulsePush = { supported, enable, disable, updateSnapshot, status, getSubscription, buildSnapshot, refreshToggle, initToggle, notifyChat };
}());