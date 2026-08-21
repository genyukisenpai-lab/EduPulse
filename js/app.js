/* ==========================================================================
   EDUPULSE MAIN APPLICATION JAVASCRIPT (FIGMA REMAKE)
   Exam Countdown, Modern Dashboard, Firebase Real-time Sync & Community Chat
   ========================================================================== */

(function () {
  'use strict';

  // iOS PWA: hard-lock zoom (pinch, double-tap, multi-touch).
  document.addEventListener('gesturestart', function (e) { e.preventDefault(); });
  document.addEventListener('gesturechange', function (e) { e.preventDefault(); });
  document.addEventListener('touchmove', function (e) {
    if (e.touches.length > 1) e.preventDefault();
  }, { passive: false });
  document.addEventListener('dblclick', function (e) { e.preventDefault(); });

  // Start empty: dashboard values always come from saved learner data.
  const DEFAULT_DATA = {
    exams: [],
    library: [],
    studyLog: [],
    goals: { score: null, subject: '', weeklyMinutes: 300 },
    pushSettings: { times: ['18:00'], quote: true }
  };

  // Tùy chỉnh nội dung mọi widget trên trang chủ (lưu trong appState.widgets)
  const DEFAULT_WIDGETS = {
    greetingTitle: 'Xin chào, Sĩ tử 👋',
    greetingSub: 'Hôm nay bạn muốn chinh phục mục tiêu nào?',
    showHero: true,
    showStats: true,
    statLabels: { target: 'Mục tiêu tuần', nearest: 'Kỳ thi gần nhất', streak: 'Chuỗi học' },
    showExamsPanel: true,
    examsPanelTitle: 'Kỳ thi của bạn',
    showSchedule: true,
    showCommunity: true,
    communityTitle: 'Cộng đồng',
    communitySubtext: 'Hỏi bài, chia sẻ tài liệu và động lực cùng sĩ tử toàn quốc.',
    communityItems: [
      { icon: 'fa-regular fa-comments', text: '{n} tin nhắn mới trong 24 giờ', tab: 'tab-chat', enabled: true },
      { icon: 'fa-solid fa-book-bookmark', text: '{n} tin nhắn gần nhất trong phòng', tab: 'tab-chat', enabled: true },
      { icon: 'fa-solid fa-fire', text: '{n} sĩ tử đã chat trong 24 giờ', tab: 'tab-chat', enabled: true }
    ]
  };

  function ensureValidState(state) {
    if (!state || typeof state !== 'object') {
      return { ...JSON.parse(JSON.stringify(DEFAULT_DATA)), widgets: JSON.parse(JSON.stringify(DEFAULT_WIDGETS)) };
    }
    const validated = { ...state };
    if (!Array.isArray(validated.exams)) {
      validated.exams = [];
    }
    if (!Array.isArray(validated.library)) validated.library = [];
    if (!Array.isArray(validated.studyLog)) validated.studyLog = [];
    if (!validated.goals || typeof validated.goals !== 'object') {
      validated.goals = { score: null, subject: '', weeklyMinutes: 300 };
    } else {
      if (!('score' in validated.goals)) validated.goals.score = null;
      if (!('subject' in validated.goals)) validated.goals.subject = '';
      if (!('weeklyMinutes' in validated.goals)) validated.goals.weeklyMinutes = 300;
    }
    if (!validated.pushSettings || typeof validated.pushSettings !== 'object') {
      validated.pushSettings = { times: ['18:00'], quote: true };
    } else {
      if (!Array.isArray(validated.pushSettings.times)) validated.pushSettings.times = ['18:00'];
      if (typeof validated.pushSettings.quote !== 'boolean') validated.pushSettings.quote = true;
    }
    validated.widgets = {
      ...JSON.parse(JSON.stringify(DEFAULT_WIDGETS)),
      ...(validated.widgets || {}),
      statLabels: { ...DEFAULT_WIDGETS.statLabels, ...((validated.widgets || {}).statLabels || {}) }
    };
    if (!Array.isArray(validated.widgets.communityItems) || validated.widgets.communityItems.length !== DEFAULT_WIDGETS.communityItems.length) {
      validated.widgets.communityItems = JSON.parse(JSON.stringify(DEFAULT_WIDGETS.communityItems));
    }
    return validated;
  }

  // --- APP STATE ---
  const STORAGE_KEY = 'edupulse_data';
  const THEME_KEY = 'edupulse_theme';
  const STREAK_KEY = 'edupulse_streak';
// API keys rotation
const GEMINI_API_KEYS = Array.isArray(window.EDUPULSE_GEMINI_API_KEYS) ? window.EDUPULSE_GEMINI_API_KEYS : [];
const API_URL = '/api/state';
  let appState;
  try {
    appState = ensureValidState(JSON.parse(localStorage.getItem(STORAGE_KEY)));
  } catch (e) {
    console.warn('Dữ liệu localStorage bị hỏng, dùng trạng thái mặc định:', e);
    appState = ensureValidState(null);
  }
  let isDarkMode = localStorage.getItem(THEME_KEY) === 'dark';
let saveTimer;
let pushSnapshotTimer;
let isRegisterMode = false;

  let firebaseDb = null;
  let firebaseUser = null;
  let unsubscribeChat = null;
  let unsubscribeCommStats = null;
  let unsubscribeAccountSync = null;
  let lastSyncTimestamp = null;
  let currentExamFilter = 'all';
  let communityStats = { todayMsgs: 0, onlineUsers: 0, totalMsgs: 0 };
  let chatImageCache = new Map(); // fileId → objectURL (tránh tải lại ảnh chat)
  let chatImagePromises = new Map(); // fileId → Promise (tránh tải song song trùng file)
  let optimisticMessages = new Map(); // id → msg (tin vừa gửi, hiển thị ngay không chờ snapshot)
  let aiProviderAvailable = Boolean(GEMINI_API_KEYS.some(k => k));
  let aiConversation = [];

  // --- DOM ELEMENTS ---
  const elements = {
    // Navigations
    navItems: document.querySelectorAll('[data-tab]'),
    tabContents: document.querySelectorAll('.tab-content'),

    // Top User Greetings & Avatar
    homeGreetingTitle: document.getElementById('home-greeting-title'),
    mobileGreetingName: document.getElementById('mobile-greeting-name'),
    sidebarUserAvatar: document.getElementById('sidebar-user-avatar'),
    sidebarUserName: document.getElementById('sidebar-user-name'),
    sidebarUserStatus: document.getElementById('sidebar-user-status'),
    mobileUserAvatar: document.getElementById('mobile-user-avatar'),

    // Hero Countdown (Midnight Card)
    heroExamTitle: document.getElementById('hero-exam-title'),
    heroExamDate: document.getElementById('hero-exam-date'),
    heroDays: document.getElementById('hero-days'),
    heroHours: document.getElementById('hero-hours'),
    heroMinutes: document.getElementById('hero-minutes'),
    heroSeconds: document.getElementById('hero-seconds'),
    btnHeroDetail: document.getElementById('btn-hero-detail'),

    // Home Stats
    homeStatTarget: document.getElementById('home-stat-target'),
    homeStatNearest: document.getElementById('home-stat-nearest'),
    homeStatNearestSub: document.getElementById('home-stat-nearest-sub'),
    homeStatStreak: document.getElementById('home-stat-streak'),
    homeStreakValue: document.getElementById('home-streak-value'),
    homeStreakRecord: document.getElementById('home-streak-record'),
    homeExamList: document.getElementById('home-exam-list'),
    btnHomeAddExam: document.getElementById('btn-home-add-exam'),

    // Full Exams Tab
    examGrid: document.getElementById('exam-grid'),
    btnAddExamPage: document.getElementById('btn-add-exam-page'),
    examFilterBtns: document.querySelectorAll('[data-exam-filter]'),

    // Offline AI study assistant
    aiForm: document.getElementById('ai-form'),
    aiInput: document.getElementById('ai-input'),
    aiMessages: document.getElementById('ai-messages'),
    aiProviderStatus: document.getElementById('ai-provider-status'),

    // Community Chat
    chatForm: document.getElementById('chat-form'),
    chatMessages: document.getElementById('chat-messages'),
    chatMessage: document.getElementById('chat-message'),
    chatFileInput: document.getElementById('chat-file-input'),
    btnChatAttach: document.getElementById('btn-chat-attach'),
    chatDisplayName: document.getElementById('chat-display-name'),
    chatConnection: document.getElementById('chat-connection'),
    libraryList: document.getElementById('library-list'),
    modalDocumentViewer: document.getElementById('modal-document-viewer'),
    documentViewerTitle: document.getElementById('document-viewer-title'),
    documentViewerContent: document.getElementById('document-viewer-content'),

    // Account Tab
    accountGuestView: document.getElementById('account-guest-view'),
    accountUserView: document.getElementById('account-user-view'),
    btnTabLogin: document.getElementById('btn-tab-login'),
    btnTabRegister: document.getElementById('btn-tab-register'),
    authForm: document.getElementById('auth-form'),
    authNameGroup: document.getElementById('auth-name-group'),
    authName: document.getElementById('auth-name'),
    authEmail: document.getElementById('auth-email'),
    authPassword: document.getElementById('auth-password'),
    btnTogglePassword: document.getElementById('btn-toggle-password'),
    btnForgotPassword: document.getElementById('btn-forgot-password'),
    authFormTitle: document.getElementById('auth-form-title'),
    authFormSubtitle: document.getElementById('auth-form-subtitle'),
    authSubmit: document.getElementById('auth-submit'),
    btnGoogleAuth: document.getElementById('btn-google-auth'),
    btnAccountLogout: document.getElementById('btn-account-logout'),
    btnForceSync: document.getElementById('btn-force-sync'),
    accountUserName: document.getElementById('account-user-name'),
    accountUserEmail: document.getElementById('account-user-email'),
    accountAvatarUser: document.getElementById('account-avatar-user'),
    badgeEmailVerified: document.getElementById('badge-email-verified'),
    btnSendVerification: document.getElementById('btn-send-verification'),
    accStatExams: document.getElementById('acc-stat-exams'),
    accStatHigh: document.getElementById('acc-stat-high'),
    accStatNearest: document.getElementById('acc-stat-nearest'),
    accLastSyncTime: document.getElementById('acc-last-sync-time'),
    btnOpenEditProfile: document.getElementById('btn-open-edit-profile'),
    btnOpenChangePassword: document.getElementById('btn-open-change-password'),
    accStreakValue: document.getElementById('acc-streak-value'),
    accStreakRecord: document.getElementById('acc-streak-record'),
    accCountdownCard: document.getElementById('acc-countdown-card'),
    accCountdownEmpty: document.getElementById('acc-countdown-empty'),
    accCountdownTitle: document.getElementById('acc-countdown-title'),
    accCountdownDate: document.getElementById('acc-countdown-date'),
    accCountdownDays: document.getElementById('acc-cd-days'),
    accCountdownHours: document.getElementById('acc-cd-hours'),
    accCountdownMinutes: document.getElementById('acc-cd-minutes'),
    accCountdownSeconds: document.getElementById('acc-cd-seconds'),
    accCountdownTimer: document.getElementById('acc-countdown-timer'),

    // Modals
    modalExam: document.getElementById('modal-exam'),
    formExam: document.getElementById('form-exam'),
    modalForgotPassword: document.getElementById('modal-forgot-password'),
    formForgotPassword: document.getElementById('form-forgot-password'),
    modalEditProfile: document.getElementById('modal-edit-profile'),
    formEditProfile: document.getElementById('form-edit-profile'),
    modalChangePassword: document.getElementById('modal-change-password'),
    formChangePassword: document.getElementById('form-change-password')
  };

  // --- LAZY LIBRARIES (KaTeX/mammoth/pdf.js/SheetJS): chỉ tải khi cần để mở app nhanh ---
  const KATEX_CSS = 'https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/katex.min.css';
  const KATEX_JS = 'https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/katex.min.js';
  const XLSX_JS = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
  const lazyScripts = {};

  function loadScriptOnce(src) {
    if (lazyScripts[src]) return lazyScripts[src];
    lazyScripts[src] = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = () => resolve();
      script.onerror = () => { delete lazyScripts[src]; reject(new Error('Không tải được script: ' + src)); };
      document.head.appendChild(script);
    });
    return lazyScripts[src];
  }

  async function ensureKatex() {
    if (window.katex) return true;
    const cssReady = new Promise(resolve => {
      if (document.querySelector('link[data-katex-css]')) { resolve(); return; }
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = KATEX_CSS;
      link.setAttribute('data-katex-css', '1');
      link.onload = () => resolve();
      link.onerror = () => resolve();
      document.head.appendChild(link);
    });
    try {
      await Promise.all([cssReady, loadScriptOnce(KATEX_JS)]);
      return !!window.katex;
    } catch (error) {
      console.warn('KaTeX lazy load failed:', error);
      return false;
    }
  }

  // --- INITIALIZATION ---
  async function init() {
    document.body.classList.add('js-running');
    initTheme();
    initStreak();
    setupTabNavigation();
    setupEventListeners();
setupSheetDismiss();
    updateAiProviderStatus();
    navigator.serviceWorker?.addEventListener('message', event => {
      if (event.data && event.data.type === 'OPEN_CHAT') {
        openTab('tab-chat');
      } else if (event.data && event.data.type === 'OPEN_CALL') {
        openTab('tab-chat');
        if (window.EduPulseCalls && typeof window.EduPulseCalls.openCall === 'function') {
          window.EduPulseCalls.openCall(event.data.data || {});
        }
      }
    });
    await connectFirebase();
await loadState();
renderAll();
    updateChatBadge(0); // Initialize badge
    checkServerAi();
    restoreAiHistory();

    // Mở tab chat nếu app được khởi động từ notification tin nhắn (?tab=chat)
    if (new URLSearchParams(window.location.search).get('tab') === 'chat') {
      openTab('tab-chat');
    }

    // Khởi động từ notification cuộc gọi (?call=...): hiện màn hình cuộc gọi đến ngay.
    const callParam = new URLSearchParams(window.location.search).get('call');
    if (callParam && window.EduPulseCalls && typeof window.EduPulseCalls.openCall === 'function') {
      const q = new URLSearchParams(window.location.search);
      window.EduPulseCalls.openCall({
        callId: callParam,
        callerUid: q.get('caller') || '',
        callerName: q.get('name') || '',
        callType: q.get('type') || 'voice'
      });
    }

    // Start timer loops
    setInterval(updateTimers, 1000);
  }

function getCurrentGeminiKey() {
    if (typeof window.getCurrentApiKey === 'function') return window.getCurrentApiKey() || '';
    const keys = window.EDUPULSE_GEMINI_API_KEYS || [];
    const index = Number(window.EDUPULSE_GEMINI_API_KEY_INDEX) || 0;
    return keys.length ? (keys[index % keys.length] || '') : '';
  }

  function getCurrentGroqKey() {
    if (typeof window.getCurrentGroqKey === 'function') return window.getCurrentGroqKey() || '';
    const keys = window.EDUPULSE_GROQ_API_KEYS || [];
    const index = Number(window.EDUPULSE_GROQ_API_KEY_INDEX) || 0;
    return keys.length ? (keys[index % keys.length] || '') : '';
  }

  // --- STUDY STREAK TRACKING ---
  function getLocalDateString(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

function initStreak() {
    const today = getLocalDateString();
    let streakData = (appState && appState.streak && typeof appState.streak.streak === 'number') ? appState.streak : null;
    if (!streakData) {
      const legacy = localStorage.getItem(STREAK_KEY);
      try { streakData = legacy ? JSON.parse(legacy) : null; } catch (e) { streakData = null; }
    }
    if (!streakData || typeof streakData.streak !== 'number') {
      streakData = { streak: 0, lastVisit: null, record: 0 };
    }

    if (streakData.lastVisit === today) {
      // Already visited today — no change
    } else if (streakData.lastVisit) {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yStr = getLocalDateString(yesterday);
      if (streakData.lastVisit === yStr) {
        // Visited yesterday — continue streak
        streakData.streak += 1;
      } else {
        // Missed a day — reset
        streakData.streak = 1;
      }
    } else {
      streakData.streak = 1;
    }
    streakData.lastVisit = today;
    streakData.record = Math.max(streakData.record || 0, streakData.streak);
    // Lưu vào appState (đồng bộ lên Firestore) + localStorage legacy (tương thích cũ)
    appState.streak = streakData;
    localStorage.setItem(STREAK_KEY, JSON.stringify(streakData));
    persistLocalState();
  }

  function getStreakData() {
    if (appState && appState.streak && typeof appState.streak.streak === 'number') return appState.streak;
    const legacy = localStorage.getItem(STREAK_KEY);
    try { if (legacy) return JSON.parse(legacy); } catch (e) { /* bỏ qua */ }
    return { streak: 1, record: 1 };
  }

// --- DARK MODE (auto/system/light/dark) ---
  let themePref = localStorage.getItem(THEME_KEY) || 'auto';

  function currentDarkFromPref() {
    if (themePref === 'dark') return true;
    if (themePref === 'light') return false;
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  function initTheme() {
    if (themePref !== 'auto' && themePref !== 'light' && themePref !== 'dark') themePref = 'auto';
    applyTheme();
  }

  function applyTheme() {
    isDarkMode = currentDarkFromPref();
    document.body.setAttribute('data-theme', isDarkMode ? 'dark' : 'light');
    localStorage.setItem(THEME_KEY, themePref);

    // Update sidebar toggle
    const sidebarIcon = document.getElementById('sidebar-theme-icon');
    const sidebarLabel = document.getElementById('sidebar-theme-label');
    if (sidebarIcon) {
      sidebarIcon.className = isDarkMode ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
    }
    if (sidebarLabel) {
      sidebarLabel.textContent = themePref === 'auto'
        ? 'Giao diện tự động'
        : (isDarkMode ? 'Giao diện sáng' : 'Giao diện tối');
    }

    // Update mobile toggle icon
    const mobileIcon = document.getElementById('mobile-theme-icon');
    if (mobileIcon) {
      mobileIcon.className = isDarkMode ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
    }

    // Update segmented control in account tab
    const seg = document.querySelectorAll('[data-theme-pref]');
    seg.forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-theme-pref') === themePref);
    });
  }

  function setThemePref(pref) {
    themePref = pref === 'dark' || pref === 'light' ? pref : 'auto';
    applyTheme();
    showToast(themePref === 'auto'
      ? '🌓 Giao diện tự động theo hệ thống'
      : (isDarkMode ? '🌙 Đã bật giao diện tối' : '☀️ Đã bật giao diện sáng'));
  }

  function toggleTheme() {
    // Vòng lặp: auto → dark → light → auto (dựa trên giao diện đang hiển thị)
    if (themePref === 'auto') {
      setThemePref(isDarkMode ? 'light' : 'dark');
    } else if (themePref === 'dark') {
      setThemePref('light');
    } else {
      setThemePref('auto');
    }
  }

// --- NAVIGATION & TABS ---
  function setupTabNavigation() {
    document.addEventListener('click', (e) => {
      const targetBtn = e.target.closest('[data-tab]');
      if (!targetBtn) return;
      const targetTab = targetBtn.getAttribute('data-tab');
      if (!targetTab) return;
      openTab(targetTab);
    });

    // LOCKED UI: mọi link ngoài mở ngay trong cùng cửa sổ PWA, không nhảy
    // sang Safari/tab mới. Link tải file (có `download`) được giữ nguyên.
    document.addEventListener('click', (e) => {
      const a = e.target.closest('a');
      if (!a || a.hasAttribute('download')) return;
      const href = a.getAttribute('href') || '';
      if (!href || href.startsWith('blob:') || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
      if (a.target === '_blank' || /^https?:/i.test(href)) {
        e.preventDefault();
        window.location.href = href;
      }
    });
  }

function openTab(targetTab) {
    elements.tabContents.forEach(tc => {
      if (tc.id === targetTab) {
        tc.classList.add('active');
        tc.scrollTop = 0;
      } else {
        tc.classList.remove('active');
      }
    });

    document.querySelectorAll('[data-tab]').forEach(btn => {
      if (btn.getAttribute('data-tab') === targetTab) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

if (targetTab === 'tab-account') {
      refreshUserVerification();
      renderAccount();
      if (window.EduPulseStudy && typeof window.EduPulseStudy.renderPushSettings === 'function') {
        window.EduPulseStudy.renderPushSettings();
      }
    } else if (targetTab === 'tab-chat') {
      markChatReadOnOpen();
    } else if (targetTab === 'tab-stats') {
      if (window.EduPulseStudy && typeof window.EduPulseStudy.renderStudyUI === 'function') {
        window.EduPulseStudy.renderStudyUI();
      }
    }
  }

  async function refreshUserVerification() {
    try {
      const currentUser = firebase.auth().currentUser;
      if (currentUser && !currentUser.isAnonymous) {
        await currentUser.reload();
        firebaseUser = currentUser;
      }
    } catch (err) {
      console.warn('Reload user failed:', err);
    }
  }

  // --- STATE MANAGEMENT & SYNC ---
  async function loadState() {
try {
      const localData = localStorage.getItem(STORAGE_KEY);
      if (localData) {
        const parsed = JSON.parse(localData);
        if (parsed && Array.isArray(parsed.exams)) {
          appState = ensureValidState(parsed);
          return;
        }
      }
    } catch (e) {
      console.warn('Lỗi đọc localStorage:', e);
    }
    // Không fallback sang /api/state (dữ liệu chung của server) — tránh rò rỉ dữ liệu
    // giữa các người dùng/khách (BUG-6). Dữ liệu chỉ đến từ localStorage hoặc Firestore
    // của chính người dùng (xem applyRemoteState).
    appState = ensureValidState(appState);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
  }

function slimAppState(state) {
    const slim = JSON.parse(JSON.stringify(state));
    if (Array.isArray(slim.library)) {
      slim.library = slim.library.map(it => {
        const copy = { ...it };
        ['data', 'dataUrl', 'dataURL', 'base64', 'blob', 'content'].forEach(k => {
          if (typeof copy[k] === 'string' && copy[k].length > 10000) delete copy[k];
        });
        return copy;
      });
    }
    if (Array.isArray(slim.exams)) {
      slim.exams = slim.exams.map(it => {
        const copy = { ...it };
        ['data', 'dataUrl', 'dataURL', 'base64', 'content'].forEach(k => {
          if (typeof copy[k] === 'string' && copy[k].length > 200000) delete copy[k];
        });
        return copy;
      });
    }
    return slim;
  }

  function persistLocalState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
      return;
    } catch (err) { /* quota: thử bản thu gọn */ }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(slimAppState(appState)));
      return;
    } catch (err2) {
      try {
        const minimal = JSON.parse(JSON.stringify(appState));
        minimal.library = [];
        minimal.exams = (minimal.exams || []).map(e => ({ id: e.id, title: e.title, date: e.date, note: e.note || '', targetScore: e.targetScore || '' }));
        localStorage.setItem(STORAGE_KEY, JSON.stringify(minimal));
      } catch (err3) { /* không thể lưu offline */ }
    }
  }

  function saveState() {
    persistLocalState();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(syncState, 250);
    if (window.EduPulsePush && !pushSnapshotTimer) {
      pushSnapshotTimer = setTimeout(() => {
        pushSnapshotTimer = null;
        window.EduPulsePush.updateSnapshot();
      }, 3000);
    }
  }

  async function syncState() {
    persistLocalState();
    lastSyncTimestamp = new Date();
    updateAccountSyncDisplay();

try {
      if (firebaseDb && firebaseUser && !firebaseUser.isAnonymous) {
        const userAppRef = firebaseDb.doc(`users/${firebaseUser.uid}/settings/app`);
        if (userAppRef) {
          await userAppRef.set({
            state: appState,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          });
          return;
        }
      }
      // Không đẩy dữ liệu của khách lên /api/state chung — tránh rò rỉ/trộn dữ liệu
      // giữa các người dùng (BUG-6). Guest chỉ lưu localStorage.
    } catch (error) {
      console.warn('Sync error:', error);
    }
  }

  function updateAccountSyncDisplay() {
    if (!elements.accLastSyncTime) return;
    if (lastSyncTimestamp) {
      const timeStr = lastSyncTimestamp.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      elements.accLastSyncTime.textContent = `Đã đồng bộ: ${timeStr}`;
    }
  }

  // --- FIREBASE INITIALIZATION & AUTH ---
  async function connectFirebase() {
    const config = window.EDUPULSE_FIREBASE_CONFIG;
    if (!config || !config.apiKey || !config.projectId || !window.firebase) {
      console.warn('Firebase config chưa sẵn sàng.');
      return;
    }
    try {
      if (!firebase.apps.length) {
        firebase.initializeApp(config);
      }
      const auth = firebase.auth();
      firebaseDb = firebase.firestore();

auth.onAuthStateChanged(async (user) => {
        firebaseUser = user;
        if (user && !user.isAnonymous) {
          // Refresh user để lấy emailVerified mới nhất từ Firebase trước khi chặn
          try {
            await user.reload();
            firebaseUser = firebase.auth().currentUser;
          } catch (reloadErr) {
            console.warn('Reload user failed:', reloadErr);
          }
        }
        // Chặn tài khoản email chưa xác thực (session cũ hoặc chưa bấm link xác thực)
        const freshUser = firebaseUser;
        if (freshUser && !freshUser.isAnonymous && !freshUser.emailVerified && freshUser.providerData?.some(p => p.providerId === 'password')) {
          await firebase.auth().signOut();
          firebaseUser = null;
          renderAccount();
          showToast('Email chưa được xác thực. Vui lòng bấm link trong email.', 'warning');
          return;
        }
        renderAccount();
        if (user && !user.isAnonymous) {
          subscribeToAccountSync();
        } else if (unsubscribeAccountSync) {
          unsubscribeAccountSync();
          unsubscribeAccountSync = null;
        }
subscribeToChat();
        subscribeToCommStats();
        if (window.EduPulseCalls && typeof window.EduPulseCalls.onAuthChange === 'function') {
          window.EduPulseCalls.onAuthChange((user && !user.isAnonymous) ? user : null);
        }
        if (window.EduPulseStudyGroups && typeof window.EduPulseStudyGroups.onAuthChange === 'function') {
          window.EduPulseStudyGroups.onAuthChange((user && !user.isAnonymous) ? user : null);
        }
      });
    } catch (error) {
      console.error('Firebase connect failed:', error);
    }
  }

  function subscribeToAccountSync() {
    if (unsubscribeAccountSync) {
      unsubscribeAccountSync();
      unsubscribeAccountSync = null;
    }
    if (!firebaseDb || !firebaseUser || firebaseUser.isAnonymous) return;
    const userAppRef = firebaseDb.doc(`users/${firebaseUser.uid}/settings/app`);
    unsubscribeAccountSync = userAppRef.onSnapshot(snapshot => {
      if (snapshot.exists && snapshot.data()?.state) {
        const remoteData = ensureValidState(snapshot.data().state);
        const merged = mergeStates(appState, remoteData);
        if (JSON.stringify(merged) !== JSON.stringify(appState)) {
          appState = merged;
          localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
          renderAll();
        }
        lastSyncTimestamp = snapshot.data().updatedAt?.toDate ? snapshot.data().updatedAt.toDate() : new Date();
        updateAccountSyncDisplay();
      }
    }, err => console.warn('Account sync error:', err));
  }

  // Merge local and remote state (by id, remote wins for same id) to avoid data loss.
function mergeStates(local, remote) {
    const l = ensureValidState(local || {});
    const r = ensureValidState(remote || {});
    const exams = new Map();
    [...l.exams, ...r.exams].forEach(exam => {
      if (exam && exam.id) exams.set(exam.id, exam);
    });
    const library = new Map();
    [...l.library, ...r.library].forEach(item => {
      if (item && item.id) library.set(item.id, item);
    });
    const studyLog = mergeStudyLog(l.studyLog, r.studyLog);
    return ensureValidState({
      exams: [...exams.values()],
      library: [...library.values()],
      studyLog,
      goals: Object.assign({}, l.goals || {}, r.goals || {}),
      pushSettings: Object.assign({}, l.pushSettings || {}, r.pushSettings || {}),
      widgets: r.widgets || l.widgets || {},
      streak: r.streak || l.streak || null
    });
  }

  function mergeStudyLog(a, b) {
    const byKey = new Map();
    [...(a || []), ...(b || [])].forEach(e => {
      if (!e || typeof e.minutes !== 'number' || !e.subject) return;
      const key = e.id ? 'id:' + e.id : ('ds:' + (e.date || '') + '|' + e.subject);
      const existing = byKey.get(key);
      if (existing) {
        existing.minutes = key.indexOf('ds:') === 0 ? (existing.minutes + e.minutes) : Math.max(existing.minutes, e.minutes);
        if (e.note) existing.note = e.note;
      } else {
        byKey.set(key, Object.assign({}, e));
      }
    });
    return [...byKey.values()];
  }

  // --- COMMUNITY CHAT & STATS ---
  function subscribeToChat() {
    if (!elements.chatConnection && !elements.chatMessages) return;
    if (!firebaseDb) {
      if (elements.chatConnection) elements.chatConnection.textContent = 'Chưa cấu hình Firebase';
      return;
    }
    if (unsubscribeChat) unsubscribeChat();

    if (elements.chatConnection) elements.chatConnection.textContent = 'Đang kết nối phòng chat…';

unsubscribeChat = firebaseDb.collection('rooms').doc('general').collection('messages')
      .orderBy('createdAt', 'desc')
      .limit(60)
      .onSnapshot(snapshot => {
        if (elements.chatConnection) elements.chatConnection.textContent = 'Trực tuyến';
        const messages = [];
        snapshot.forEach(doc => messages.push({ id: doc.id, ...doc.data() }));
        messages.reverse();
        // Xóa tin optimistic đã được server xác nhận (tránh trùng lặp)
        messages.forEach(m => optimisticMessages.delete(m.id));
        const displayed = getDisplayedMessages(messages);
        renderChatMessages(displayed);
        preloadChatImages(displayed);
        notifyNewChatMessage(displayed);
        
        // Update chat nav badge with unread count
        updateChatBadge(displayed);
      }, error => {
        console.warn('Chat snapshot error:', error);
        if (elements.chatConnection) elements.chatConnection.textContent = 'Mất kết nối phòng chat';
      });
  }

  function subscribeToCommStats() {
    if (!firebaseDb) return;
    if (unsubscribeCommStats) { unsubscribeCommStats(); unsubscribeCommStats = null; }

    // Get messages from the last 24h for "today's activity"
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    unsubscribeCommStats = firebaseDb.collection('rooms').doc('general').collection('messages')
      .orderBy('createdAt', 'desc')
      .limit(200)
      .onSnapshot(snapshot => {
        let todayCount = 0;
        const uniqueAuthors = new Set();
        let totalCount = snapshot.size;

        snapshot.forEach(doc => {
          const data = doc.data();
          const msgDate = data.createdAt?.toDate ? data.createdAt.toDate() : null;
          if (msgDate && msgDate >= oneDayAgo) {
            todayCount++;
            if (data.authorId) uniqueAuthors.add(data.authorId);
          }
        });

        communityStats = {
          todayMsgs: todayCount,
          onlineUsers: uniqueAuthors.size,
          totalMsgs: totalCount
        };
        renderCommunityStats();
      }, err => console.warn('Comm stats error:', err));
  }

  function renderCommunityStats() {
    renderCommunityWidgetItems();
  }

  // --- TÙY CHỈNH NỘI DUNG WIDGET (trang chủ) ---
  function getWidgets() {
    return appState.widgets || DEFAULT_WIDGETS;
  }

  function renderCommunityWidgetItems() {
    const list = document.getElementById('community-widget-list');
    if (!list) return;
    const items = getWidgets().communityItems;
    const liveNumbers = [communityStats.todayMsgs, communityStats.totalMsgs, communityStats.onlineUsers];
    list.innerHTML = items.map((item, index) => {
      if (!item.enabled) return '';
      let text = String(item.text ?? '');
      if (text.includes('{n}')) {
        text = text.replace(/\{n\}/g, String(liveNumbers[index] ?? 0));
      }
      const tab = item.tab || 'tab-chat';
      return `<div class="community-widget-item" data-tab="${escapeHtml(tab)}">
        <i class="${escapeHtml(item.icon || 'fa-regular fa-comments')}"></i>
        <span>${escapeHtml(text)}</span>
      </div>`;
    }).join('');
  }

  function applyWidgetConfig() {
    const w = getWidgets();
    const setText = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    };
    const setVisible = (id, visible) => {
      const el = document.getElementById(id);
      if (el) el.style.display = visible ? '' : 'none';
    };

    setText('home-greeting-title', w.greetingTitle);
    setText('mobile-greeting-name', w.greetingTitle);
    setText('home-greeting-sub', w.greetingSub);
    setText('home-stat-target-label', w.statLabels.target);
    setText('home-stat-nearest-label', w.statLabels.nearest);
    setText('home-stat-streak-label', w.statLabels.streak);
    setText('home-panel-exams-title', w.examsPanelTitle);
    setText('home-panel-community-title', w.communityTitle);
    setText('community-subtext', w.communitySubtext);

    setVisible('hero-countdown-box', w.showHero);
    setVisible('home-stats-grid', w.showStats);
    setVisible('home-exams-panel', w.showExamsPanel);
    setVisible('home-schedule-card', w.showSchedule);
  }

  function renderChatMessages(messages) {
    if (!elements.chatMessages) return;
    const shouldStick = elements.chatMessages.scrollHeight - elements.chatMessages.scrollTop <= elements.chatMessages.clientHeight + 60;
    
    if (messages.length === 0) {
      elements.chatMessages.innerHTML = `
        <div style="text-align: center; color: var(--text-dim); padding: 40px 0;">
          <i class="fa-regular fa-comments" style="font-size: 2rem; margin-bottom: 8px;"></i>
          <p>Chưa có tin nhắn nào. Hãy là người đầu tiên gửi lời chào sĩ tử!</p>
        </div>`;
      return;
    }

    elements.chatMessages.innerHTML = messages.map(msg => {
      const isMine = firebaseUser && msg.authorId === firebaseUser.uid;
      const initial = (msg.authorName || 'S').slice(0, 1).toUpperCase();
      const time = msg.createdAt?.toDate ? msg.createdAt.toDate().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : 'Vừa xong';

      const attachment = msg.attachment;
      const callActions = (!isMine && msg.authorId) ? `
        <span class="chat-msg-call-actions">
          <button type="button" class="btn-call-msg" data-call-user="${escapeHtml(msg.authorId)}" data-call-name="${escapeHtml(msg.authorName || '')}" data-call-type="voice" title="Gọi thoại"><i class="fa-solid fa-phone"></i></button>
          <button type="button" class="btn-call-msg" data-call-user="${escapeHtml(msg.authorId)}" data-call-name="${escapeHtml(msg.authorName || '')}" data-call-type="video" title="Gọi video"><i class="fa-solid fa-video"></i></button>
        </span>` : '';
      const saveButton = attachment?.name ? `<button class="chat-attachment-save" type="button" title="Lưu vào tài liệu của tôi" data-attachment="${escapeHtml(JSON.stringify(attachment))}"><i class="fa-solid fa-bookmark"></i></button>` : '';
const attachmentHtml = attachment?.storage === 'firestore' && attachment?.fileId && attachment?.name && attachment.type?.startsWith('image/') ? `
        <img class="chat-attachment-image" data-file-id="${escapeHtml(attachment.fileId)}" alt="${escapeHtml(attachment.name)}" ${chatImageCache.has(attachment.fileId) ? `src="${chatImageCache.get(attachment.fileId)}"` : ''}>
        ${saveButton}` : attachment?.storage === 'firestore' && attachment?.fileId && attachment?.name ? `
        <button class="chat-attachment-link chat-attachment-download" type="button" data-file-id="${escapeHtml(attachment.fileId)}" data-file-name="${escapeHtml(attachment.name)}">
          <i class="fa-solid fa-file-arrow-down"></i>${escapeHtml(attachment.name)}
        </button>${saveButton}` : attachment?.url && attachment?.name ? `
        <a class="chat-attachment-link" href="${escapeHtml(attachment.url)}" target="_blank" rel="noopener noreferrer" download="${escapeHtml(attachment.name)}">
          <i class="fa-solid fa-file-arrow-down"></i>${escapeHtml(attachment.name)}
        </a>${saveButton}` : '';

      return `
        <div class="chat-msg-card ${isMine ? 'mine' : ''}">
          <div class="chat-msg-avatar">${initial}</div>
          <div class="chat-msg-body">
<div class="chat-msg-header">
              <span class="chat-msg-author">${escapeHtml(msg.authorName || 'Sĩ tử EduPulse')}</span>
              <span class="chat-msg-time">${time}</span>
              ${callActions}
            </div>
            <div class="chat-msg-bubble">${msg.text ? escapeHtml(msg.text) : ''}${attachmentHtml}</div>
          </div>
        </div>`;
    }).join('');

    elements.chatMessages.querySelectorAll('.chat-attachment-download').forEach(button => {
      button.addEventListener('click', () => downloadFirestoreAttachment(button.dataset.fileId, button.dataset.fileName));
    });
    elements.chatMessages.querySelectorAll('.chat-attachment-image').forEach(image => {
      loadFirestoreImage(image, image.dataset.fileId);
    });
    elements.chatMessages.querySelectorAll('.chat-attachment-save').forEach(button => {
      button.addEventListener('click', () => saveAttachmentToLibrary(JSON.parse(button.dataset.attachment)));
    });

    if (shouldStick) {
      elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
    }
  }

async function sendChatMessage(e) {
    e.preventDefault();
    const text = elements.chatMessage.value.trim();
    if (!text) return;
    if (!firebaseDb) {
      showToast('Firebase chưa sẵn sàng.', 'warning');
      return;
    }
    if (!firebaseUser || firebaseUser.isAnonymous) {
      showToast('Vui lòng đăng nhập để tham gia chat cộng đồng.', 'warning');
      openTab('tab-account');
      return;
    }
    if (!firebaseUser.emailVerified) {
      showToast('Vui lòng xác thực email để gửi tin nhắn.', 'warning');
      openTab('tab-account');
      return;
    }

    const defaultName = firebaseUser.displayName || (firebaseUser.email ? firebaseUser.email.split('@')[0] : 'Sĩ tử');
    const authorName = truncateUtf8Bytes((elements.chatDisplayName?.value?.trim() || defaultName), 32);

    // Optimistic render: hiển thị tin ngay, không chờ snapshot (fix tin trễ 1 nhịp)
    const docRef = firebaseDb.collection('rooms').doc('general').collection('messages').doc();
    const optimisticMsg = {
      id: docRef.id,
      text,
      authorId: firebaseUser.uid,
      authorName,
      createdAt: new Date()
    };
    optimisticMessages.set(docRef.id, optimisticMsg);
    renderChatMessages(getDisplayedMessages());
    elements.chatMessage.value = '';
    updateChatSendState();
    markChatSeen(optimisticMsg);

    try {
      // Refresh the auth token so a newly verified email is reflected in Firestore Rules.
      await firebaseUser.getIdToken(true);
      await docRef.set({
        text,
        authorId: firebaseUser.uid,
        authorName,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      // Đẩy push tức thì tới các thiết bị khác (không chờ cron 1 phút)
      if (window.EduPulsePush) {
        window.EduPulsePush.notifyChat({ id: docRef.id, authorId: firebaseUser.uid, authorName, text }).catch(() => {});
      }
    } catch (err) {
      console.error('Send message failed:', err);
      optimisticMessages.delete(docRef.id);
      renderChatMessages(getDisplayedMessages());
      if (err?.code === 'permission-denied') {
        showToast('Tài khoản chưa đủ quyền gửi tin. Kiểm tra xác thực email và thử lại.', 'warning');
      } else {
        showToast('Không thể gửi tin nhắn. Kiểm tra kết nối mạng.', 'warning');
      }
    }
  }

  // Gom tin từ snapshot + tin optimistic, dedupe theo id, sắp theo thời gian
  function getDisplayedMessages(snapshotMessages = []) {
    const byId = new Map();
    snapshotMessages.forEach(m => byId.set(m.id, m));
    optimisticMessages.forEach((m, id) => {
      if (!byId.has(id)) byId.set(id, m);
    });
    const list = [...byId.values()];
    list.sort((a, b) => toMessageTime(a) - toMessageTime(b));
    return list;
  }

  function toMessageTime(msg) {
    const t = msg?.createdAt;
    if (!t) return 0;
    if (typeof t.toDate === 'function') return t.toDate().getTime();
    if (t instanceof Date) return t.getTime();
    return Number(t) || 0;
  }

  // Trạng thái đã đọc tin mới nhất, dùng để so sánh khi có tin mới
  let lastSeenChatKey = '';
  let chatInitialized = false;
  let unreadChatCount = 0;
  let lastSeenChatTime = 0;
  function markChatSeen(msg) {
    if (msg?.id) lastSeenChatKey = msg.id;
  }
  function isNewChatMessage(msg) {
    return msg?.id && msg.id !== lastSeenChatKey;
  }

  // Hiện notification khi có tin nhắn mới từ người khác (như app nhắn tin)
  function notifyNewChatMessage(messages) {
    if (!Array.isArray(messages) || !messages.length) return;
    // Lần đầu khởi động: chỉ ghi nhận tin mới nhất là đã đọc, không notify tin cũ
    if (!chatInitialized) {
      chatInitialized = true;
      markChatSeen(messages[messages.length - 1]);
      return;
    }
    const chatTabActive = document.getElementById('tab-chat')?.classList.contains('active');
    if (chatTabActive) {
      // Đang mở tab chat → cập nhật tin đã đọc, không cần thông báo
      markChatSeen(messages[messages.length - 1]);
      return;
    }
    if (!firebaseUser || firebaseUser.isAnonymous) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    // Chỉ thông báo khi có tin mới chưa đọc từ người khác
    const last = messages[messages.length - 1];
    if (!last || !isNewChatMessage(last) || last.authorId === firebaseUser.uid) {
      markChatSeen(messages[messages.length - 1]);
      return;
    }
    markChatSeen(last);
    const authorName = last.authorName || 'Sĩ tử EduPulse';
    const body = last.text
      ? (last.text.length > 60 ? last.text.slice(0, 60) + '…' : last.text)
      : (last.attachment?.name ? `Đã gửi tài liệu: ${last.attachment.name}` : 'Có tin nhắn mới');
    try {
      const notification = new Notification('EduPulse', {
        body: `${authorName}: ${body}`,
        icon: 'icons/app-icon-192.png',
        tag: 'edupulse-chat',
        renotify: true
      });
      notification.onclick = () => {
        window.focus();
        openTab('tab-chat');
        notification.close();
      };
    } catch (err) {
      console.warn('Notification error:', err);
    }
  }

  // Cập nhật tin đã đọc khi mở tab chat
  function markChatReadOnOpen() {
    const messages = getDisplayedMessages();
    if (messages.length) {
      markChatSeen(messages[messages.length - 1]);
      lastSeenChatTime = toMessageTime(messages[messages.length - 1]);
    }
    unreadChatCount = 0;
    const badge = document.getElementById('chat-nav-badge');
    if (badge) {
      badge.textContent = '';
      badge.style.display = 'none';
    }
  }

  function updateChatSendState() {
    const btn = document.getElementById('btn-chat-send');
    if (btn && elements.chatMessage) btn.disabled = !elements.chatMessage.value.trim();
  }

  async function uploadChatAttachment(file) {
    const allowedTypes = new Set([
      'application/pdf', 'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain'
    ]);
const maxBytes = 2 * 1024 * 1024;
    if (!file) return;
    const effType = file.type || 'text/plain';
    if (file.size > maxBytes || (!allowedTypes.has(effType) && !effType.startsWith('image/'))) {
      showToast('Bản miễn phí hỗ trợ ảnh hoặc tài liệu dưới 2 MB (PDF, Word, PowerPoint, Excel, TXT).', 'warning');
      return;
    }
    if (!firebaseDb || !firebaseUser || firebaseUser.isAnonymous || !firebaseUser.emailVerified) {
      showToast('Vui lòng đăng nhập và xác thực email trước khi tải tài liệu.', 'warning');
      openTab('tab-account');
      return;
    }

    const originalIcon = elements.btnChatAttach?.innerHTML;
    if (elements.btnChatAttach) {
      elements.btnChatAttach.disabled = true;
      elements.btnChatAttach.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    }

    try {
      // Refresh the auth token so a newly verified email is reflected in Firestore Rules.
      await firebaseUser.getIdToken(true);
      const fileId = `file_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      const chunkSize = 180000;
      const bytes = new Uint8Array(await file.arrayBuffer());
      const chunkCount = Math.ceil(bytes.length / chunkSize);
      const batch = firebaseDb.batch();
      const fileRef = firebaseDb.collection('rooms').doc('general').collection('files').doc(fileId);
      batch.set(fileRef, {
        authorId: firebaseUser.uid,
        name: file.name.slice(0, 150),
        type: file.type || 'application/octet-stream',
        size: file.size,
        chunkCount,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      for (let index = 0; index < chunkCount; index++) {
        const chunk = bytes.slice(index * chunkSize, Math.min((index + 1) * chunkSize, bytes.length));
        batch.set(fileRef.collection('chunks').doc(String(index).padStart(4, '0')), {
          authorId: firebaseUser.uid,
          index,
          data: bytesToBase64(chunk)
        });
      }
      await batch.commit();
const defaultName = firebaseUser.displayName || (firebaseUser.email ? firebaseUser.email.split('@')[0] : 'Sĩ tử');
      const authorName = truncateUtf8Bytes((elements.chatDisplayName?.value?.trim() || defaultName), 32);
      await firebaseDb.collection('rooms').doc('general').collection('messages').add({
        text: elements.chatMessage.value.trim(),
        authorId: firebaseUser.uid,
        authorName,
        attachment: { name: file.name.slice(0, 150), fileId, storage: 'firestore', type: file.type, size: file.size },
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      elements.chatMessage.value = '';
      showToast('Đã gửi tài liệu vào phòng chat.', 'success');
    } catch (err) {
      console.error('Upload attachment failed:', err);
      const firestoreErrors = {
        'permission-denied': 'Firestore đang chặn upload. Vào Firestore > Rules, dán file firestore.rules mới rồi Publish.',
        'resource-exhausted': 'Đã vượt quota Firestore miễn phí hoặc tệp quá lớn. Hãy thử lại sau với tệp nhỏ hơn.',
        'unavailable': 'Firestore đang mất kết nối. Vui lòng thử lại.',
        'unauthenticated': 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'
      };
      showToast(firestoreErrors[err?.code] || `Không thể lưu tài liệu vào Firestore (${err?.code || 'lỗi không xác định'}).`, 'warning');
    } finally {
      if (elements.btnChatAttach) {
        elements.btnChatAttach.disabled = false;
        elements.btnChatAttach.innerHTML = originalIcon;
      }
      elements.chatFileInput.value = '';
    }
  }

  function bytesToBase64(bytes) {
    let binary = '';
    const blockSize = 8192;
    for (let start = 0; start < bytes.length; start += blockSize) {
      binary += String.fromCharCode(...bytes.subarray(start, start + blockSize));
    }
    return btoa(binary);
  }

  async function getFirestoreAttachmentBlob(fileId) {
    if (!firebaseDb || !fileId) return;
    let fileRef = firebaseDb.collection('rooms').doc('general').collection('files').doc(fileId);
    let [fileSnapshot, chunksSnapshot] = await Promise.all([
      fileRef.get(),
      fileRef.collection('chunks').orderBy('index').get()
    ]);
    if ((!fileSnapshot.exists || chunksSnapshot.empty) && firebaseUser && !firebaseUser.isAnonymous) {
      fileRef = firebaseDb.collection('users').doc(firebaseUser.uid).collection('files').doc(fileId);
      [fileSnapshot, chunksSnapshot] = await Promise.all([
        fileRef.get(),
        fileRef.collection('chunks').orderBy('index').get()
      ]);
    }
    if (!fileSnapshot.exists || chunksSnapshot.empty) throw new Error('File not found');
    const parts = [];
    chunksSnapshot.forEach(chunkDoc => {
      const binary = atob(chunkDoc.data().data);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
      parts.push(bytes);
    });
    return {
      blob: new Blob(parts, { type: fileSnapshot.data().type || 'application/octet-stream' }),
      name: fileSnapshot.data().name
    };
  }

  // --- BỘ NHỚ TÀI LIỆU OFFLINE (IndexedDB) — xem file không cần mạng ---
  let fileCacheDb = null;
  function openFileCache() {
    return new Promise((resolve) => {
      if (fileCacheDb) return resolve(fileCacheDb);
      if (!window.indexedDB) return resolve(null);
      const req = indexedDB.open('edupulse-offline-files', 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains('blobs')) req.result.createObjectStore('blobs');
      };
      req.onsuccess = () => { fileCacheDb = req.result; resolve(fileCacheDb); };
      req.onerror = () => resolve(null);
    });
  }
  async function cachePutFile(fileId, blob, name, type) {
    try {
      const db = await openFileCache();
      if (!db || !fileId || !blob) return;
      await new Promise((resolve, reject) => {
        const tx = db.transaction('blobs', 'readwrite');
        tx.objectStore('blobs').put({ blob, name: name || '', type: type || '', savedAt: Date.now() }, fileId);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    } catch (err) {
      console.warn('Cache file for offline failed:', err);
    }
  }
  async function cacheGetFile(fileId) {
    try {
      const db = await openFileCache();
      if (!db || !fileId) return null;
      return await new Promise((resolve) => {
        const req = db.transaction('blobs', 'readonly').objectStore('blobs').get(fileId);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    } catch (err) {
      return null;
    }
  }
  async function cacheDeleteFile(fileId) {
    try {
      const db = await openFileCache();
      if (!db || !fileId) return;
      const tx = db.transaction('blobs', 'readwrite');
      tx.objectStore('blobs').delete(fileId);
    } catch (err) { /* bỏ qua */ }
  }

  // Lưu bản sao file vào "Tài liệu của tôi": online (users/{uid}/files) + local (appState.library)
  async function saveBlobToMyLibrary(blob, name, type) {
    if (!firebaseDb || !firebaseUser || firebaseUser.isAnonymous) throw new Error('Cần đăng nhập tài khoản đã xác thực');
    const safeName = String(name || 'tai-lieu.pdf').slice(0, 150);
    const dup = appState.library.find(item => item.name === safeName && item.size === blob.size);
    if (dup) return { ok: true, duplicate: true };
    await firebaseUser.getIdToken(true);
    const fileId = `file_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const chunkSize = 700000;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const chunkCount = Math.ceil(bytes.length / chunkSize) || 1;
    if (chunkCount > 32) throw new Error('Tệp quá lớn để lưu vào thư viện');
    const fileRef = firebaseDb.collection('users').doc(firebaseUser.uid).collection('files').doc(fileId);
    for (let start = 0; start < chunkCount; start += 6) {
      const batch = firebaseDb.batch();
      for (let index = start; index < Math.min(start + 6, chunkCount); index++) {
        batch.set(fileRef.collection('chunks').doc(String(index).padStart(4, '0')), {
          authorId: firebaseUser.uid,
          index,
          data: bytesToBase64(bytes.slice(index * chunkSize, Math.min((index + 1) * chunkSize, bytes.length)))
        });
      }
      await batch.commit();
    }
    await firebaseDb.batch().set(fileRef, {
      authorId: firebaseUser.uid,
      name: safeName,
      type: type || 'application/octet-stream',
      size: bytes.length,
      chunkCount,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    }).commit();
    appState.library.unshift({
      id: `library_${Date.now()}`,
      name: safeName,
      type: type || 'application/octet-stream',
      size: bytes.length,
      fileId,
      storage: 'firestore',
      savedAt: new Date().toISOString()
    });
    saveState();
    renderLibrary();
    await cachePutFile(fileId, blob, safeName, type);
    return { ok: true };
  }

async function getChatImageUrl(fileId) {
    if (chatImageCache.has(fileId)) return chatImageCache.get(fileId);
    if (chatImagePromises.has(fileId)) return chatImagePromises.get(fileId);
    const promise = (async () => {
      const { blob } = await getFirestoreAttachmentBlob(fileId);
      const objectUrl = URL.createObjectURL(blob);
      chatImageCache.set(fileId, objectUrl);
      return objectUrl;
    })().catch(err => {
      chatImagePromises.delete(fileId);
      throw err;
    });
    chatImagePromises.set(fileId, promise);
    return promise;
  }

  async function loadFirestoreImage(image, fileId) {
    try {
      image.src = await getChatImageUrl(fileId);
    } catch (err) {
      console.error('Load chat image failed:', err);
      image.alt = 'Không thể tải ảnh';
      image.classList.add('failed');
    }
  }

  async function preloadChatImages(messages) {
    if (!firebaseDb) return;
    const fileIds = [...new Set(
      (messages || [])
        .filter(m => m.attachment?.storage === 'firestore' && m.attachment?.fileId && m.attachment.type?.startsWith('image/'))
        .map(m => m.attachment.fileId)
    )].filter(id => !chatImageCache.has(id));
    await Promise.allSettled(fileIds.map(fileId => getChatImageUrl(fileId)));
  }

  async function downloadFirestoreAttachment(fileId, fileName) {
    try {
      let blob = null;
      let name = null;
      const cached = await cacheGetFile(fileId);
      if (cached && cached.blob) {
        blob = cached.blob;
        name = cached.name;
      } else {
        const res = await getFirestoreAttachmentBlob(fileId);
        blob = res.blob;
        name = res.name;
        cachePutFile(fileId, blob, name, blob.type);
      }
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = fileName || name || 'tai-lieu';
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    } catch (err) {
      console.error('Download attachment failed:', err);
      showToast('Không thể tải tài liệu này.', 'warning');
    }
  }

  // --- RENDER ALL UI ---
function renderAll() {
    document.querySelectorAll('.skeleton').forEach(el => el.remove());
    applyWidgetConfig();
    renderHeroCountdown();
    renderHomeWidgets();
    renderExams();
    renderLibrary();
    renderAccount();
    if (window.EduPulseStudy && typeof window.EduPulseStudy.renderStudyUI === 'function') {
      window.EduPulseStudy.renderStudyUI();
    }
  }

  function saveAttachmentToLibrary(attachment) {
    if (!attachment?.name) return;
    if (appState.library.some(item => item.fileId && item.fileId === attachment.fileId)) {
      showToast('Tài liệu này đã có trong thư viện.', 'warning');
      return;
    }
appState.library.unshift({ id: `library_${Date.now()}`, ...attachment, savedAt: new Date().toISOString() });
    saveState();
    renderLibrary();
    showToast('Đã lưu vào thư viện.');
    if (window.AiRag && typeof window.AiRag.indexLibraryItem === 'function') {
      window.AiRag.indexLibraryItem({ libraryId: appState.library[0].id, fileId: attachment.fileId, name: attachment.name, type: attachment.type }).then(result => {
        if (result.ok) {
          showToast('AI đã đọc xong tài liệu để trả lời câu hỏi của bạn.');
        }
      }).catch(() => {});
    }
  }

  function renderLibrary() {
    if (!elements.libraryList) return;
    if (!appState.library.length) {
      elements.libraryList.innerHTML = '<div class="library-empty"><i class="fa-regular fa-folder-open"></i><p>Chưa có tài liệu nào. Trong chat, bấm biểu tượng đánh dấu để lưu tài liệu.</p></div>';
      return;
    }
    elements.libraryList.innerHTML = appState.library.map(item => `
      <article class="library-card">
        <div class="library-file-icon"><i class="fa-solid ${item.type?.startsWith('image/') ? 'fa-image' : item.type === 'application/pdf' ? 'fa-file-pdf' : 'fa-file-word'}"></i></div>
        <div class="library-file-info"><strong>${escapeHtml(item.name)}</strong><span>${formatFileSize(item.size)} · Đã lưu ${new Date(item.savedAt).toLocaleDateString('vi-VN')}</span></div>
        <div class="library-actions"><button class="btn-card-icon library-open" data-library-id="${escapeHtml(item.id)}" title="Mở"><i class="fa-solid fa-eye"></i></button><button class="btn-card-icon delete library-delete" data-library-id="${escapeHtml(item.id)}" title="Bỏ lưu"><i class="fa-solid fa-trash"></i></button></div>
      </article>`).join('');
    elements.libraryList.querySelectorAll('.library-open').forEach(button => button.addEventListener('click', () => openLibraryDocument(button.dataset.libraryId)));
    elements.libraryList.querySelectorAll('.library-delete').forEach(button => button.addEventListener('click', () => {
      const removed = appState.library.find(item => item.id === button.dataset.libraryId);
appState.library = appState.library.filter(item => item.id !== button.dataset.libraryId);
      if (removed && removed.fileId) cacheDeleteFile(removed.fileId);
      saveState(); renderLibrary();
      if (window.AiRag && typeof window.AiRag.removeIndex === 'function') {
        window.AiRag.removeIndex(button.dataset.libraryId);
      }
    }));
  }

  function formatFileSize(bytes = 0) { return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`; }

  async function openLibraryDocument(id) {
    const item = appState.library.find(entry => entry.id === id);
    if (!item) return;
    try {
      if (item.storage !== 'firestore') throw new Error('Unsupported source');
      // Ưu tiên bản local (xem offline không cần mạng)
      const cached = await cacheGetFile(item.fileId);
      let blob;
      if (cached && cached.blob) {
        blob = cached.blob;
      } else {
        const res = await getFirestoreAttachmentBlob(item.fileId);
        blob = res.blob;
        cachePutFile(item.fileId, blob, item.name, item.type);
      }
      // Mở thẳng blob URL — trình duyệt/HĐH tự dùng trình đọc gốc
      const url = URL.createObjectURL(blob);
      window.location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (error) {
      console.error('Open library document failed:', error);
      showToast('Không thể mở tài liệu. Có thể tệp gốc đã bị xóa hoặc bạn đang offline mà chưa có bản lưu máy.', 'warning');
    }
  }

  // Trình xem tài liệu dùng chung (ảnh/PDF/Word/Excel/CSV) — mở từ Blob bất kỳ nguồn
  async function openDocumentBlob(blob, name, type, downloadFn) {
    if (!elements.modalDocumentViewer) return;
    elements.documentViewerTitle.innerHTML = `<i class="fa-solid fa-file"></i> ${escapeHtml(name || 'Xem tài liệu')}`;
    elements.documentViewerContent.innerHTML = '<p class="document-loading"><i class="fa-solid fa-spinner fa-spin"></i> Đang mở tài liệu...</p>';
    elements.modalDocumentViewer.classList.add('active');
    const wireDownload = () => {
      const btn = document.getElementById('viewer-download');
      if (btn && downloadFn) btn.addEventListener('click', downloadFn);
    };
    const unsupported = (msg) => {
      elements.documentViewerContent.innerHTML = `<p class="document-unsupported">${msg} <button class="btn-primary-action" id="viewer-download">Tải tệp xuống</button></p>`;
      wireDownload();
    };
    const url = URL.createObjectURL(blob);
    const effType = type || blob.type || '';
    const lower = (name || '').toLowerCase();
    const isPdf = effType === 'application/pdf' || /\.pdf$/.test(lower);
    const isDocx = effType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || /\.docx$/.test(lower);
    const isExcel = /\.(xlsx?|csv)$/.test(lower)
      || ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel', 'text/csv'].includes(effType);
    try {
      if (effType.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp)$/.test(lower)) {
        elements.documentViewerContent.innerHTML = `<img class="document-viewer-image" src="${url}" alt="${escapeHtml(name || '')}">`;
        return;
      }
      if (isPdf) {
        elements.documentViewerContent.innerHTML = '<div class="document-pdf-preview"><p class="document-loading"><i class="fa-solid fa-spinner fa-spin"></i> Đang dựng trang đề thi...</p></div>';
        let rendered = false;
        try {
          if (window.AiRag && typeof window.AiRag.loadPdfLib === 'function') {
            await window.AiRag.loadPdfLib();
          }
          if (window.pdfjsLib) {
            const data = await blob.arrayBuffer();
            const pdf = await window.pdfjsLib.getDocument({ data }).promise;
            const wrap = elements.documentViewerContent.querySelector('.document-pdf-preview');
            const targetW = Math.max(280, Math.min((wrap.clientWidth || 340), 860));
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            const maxPages = Math.min(pdf.numPages, 60);
            for (let i = 1; i <= maxPages; i++) {
              const page = await pdf.getPage(i);
              const base = page.getViewport({ scale: 1 });
              const scale = targetW / base.width;
              const vp = page.getViewport({ scale: scale * dpr });
              const canvas = document.createElement('canvas');
              canvas.className = 'document-pdf-page';
              canvas.width = Math.floor(vp.width);
              canvas.height = Math.floor(vp.height);
              const ctx = canvas.getContext('2d');
              ctx.fillStyle = '#ffffff';
              ctx.fillRect(0, 0, canvas.width, canvas.height);
              await page.render({ canvasContext: ctx, viewport: vp }).promise;
              wrap.appendChild(canvas);
            }
            if (pdf.numPages > maxPages) {
              wrap.insertAdjacentHTML('beforeend', `<p class="document-unsupported">Tài liệu dài — đang hiển thị ${maxPages}/${pdf.numPages} trang đầu.</p>`);
            }
            rendered = true;
          }
        } catch (error) {
          console.warn('PDF fit-width render failed, fallback iframe:', error);
        }
        if (!rendered) {
          elements.documentViewerContent.innerHTML = `<iframe class="document-viewer-frame" src="${url}" title="${escapeHtml(name || '')}"></iframe>`;
          return;
        }
        URL.revokeObjectURL(url);
        return;
      }
      if (isExcel) {
        try {
          await loadScriptOnce(XLSX_JS);
        } catch (error) {
          console.warn('SheetJS lazy load failed:', error);
        }
        if (window.XLSX) {
          const wb = window.XLSX.read(await blob.arrayBuffer(), { type: 'array' });
          let html = '';
          wb.SheetNames.slice(0, 5).forEach(sheetName => {
            html += `<div class="sheet-title"><i class="fa-solid fa-table"></i> ${escapeHtml(sheetName)}</div>${window.XLSX.utils.sheet_to_html(wb.Sheets[sheetName])}`;
          });
          elements.documentViewerContent.innerHTML = `<article class="document-excel-preview">${html}</article>`;
        } else {
          unsupported('Không tải được bộ đọc Excel — hãy kiểm tra kết nối mạng.');
        }
        URL.revokeObjectURL(url);
        return;
      }
      if (isDocx) {
        try {
          if (window.AiRag && typeof window.AiRag.loadMammothLib === 'function') {
            await window.AiRag.loadMammothLib();
          }
        } catch (error) {
          console.warn('Mammoth lazy load failed:', error);
        }
        if (window.mammoth) {
          const result = await window.mammoth.convertToHtml({ arrayBuffer: await blob.arrayBuffer() });
          elements.documentViewerContent.innerHTML = `<article class="document-word-preview">${result.value}</article>`;
        } else {
          unsupported('Không tải được bộ đọc .docx — hãy kiểm tra kết nối mạng.');
        }
        URL.revokeObjectURL(url);
        return;
      }
      URL.revokeObjectURL(url);
      unsupported('Không thể xem trước định dạng này.');
    } catch (error) {
      console.error('Render document preview failed:', error);
      URL.revokeObjectURL(url);
      unsupported('Không hiển thị được nội dung tệp này.');
    }
  }

// --- 1. HERO COUNTDOWN (FIGMA MIDNIGHT CARD) ---
  function getHeroExam() {
    const upcoming = appState.exams.filter(isUpcomingExam);
    const heroUpcoming = upcoming.find(e => e.isHero);
    if (heroUpcoming) return heroUpcoming;
    if (upcoming.length) {
      return upcoming.slice().sort((a, b) => (a.date + 'T' + (a.time || '')) < (b.date + 'T' + (b.time || '')) ? -1 : 1)[0];
    }
    return appState.exams.find(e => e.isHero) || appState.exams[0] || null;
  }

function renderHeroCountdown() {
    const heroExam = getHeroExam();
    if (!heroExam) {
      if (elements.heroExamTitle) elements.heroExamTitle.textContent = 'Chưa chọn kỳ thi';
      if (elements.heroExamDate) elements.heroExamDate.textContent = 'Thêm kỳ thi để bắt đầu đếm ngược';
      if (elements.heroDays) elements.heroDays.textContent = '000';
      if (elements.heroHours) elements.heroHours.textContent = '00';
      if (elements.heroMinutes) elements.heroMinutes.textContent = '00';
      if (elements.heroSeconds) elements.heroSeconds.textContent = '00';
      return;
    }

    if (elements.heroExamTitle) elements.heroExamTitle.textContent = heroExam.title;
    if (elements.heroExamDate) {
      elements.heroExamDate.innerHTML = `<i class="fa-regular fa-calendar-days"></i> ${formatDateVi(heroExam.date)} • ${heroExam.time || '07:30'}`;
    }

    updateHeroTimerDisplay(heroExam);
  }

  function setTimerValue(el, value) {
    if (!el) return;
    if (el.textContent === value) return;
    el.textContent = value;
    el.classList.remove('tick');
    void el.offsetWidth;
    el.classList.add('tick');
  }

  function updateHeroTimerDisplay(heroExam) {
    const remaining = getTimeRemaining(heroExam.date, heroExam.time);
    setTimerValue(elements.heroDays, String(remaining.days).padStart(3, '0'));
    setTimerValue(elements.heroHours, String(remaining.hours).padStart(2, '0'));
    setTimerValue(elements.heroMinutes, String(remaining.minutes).padStart(2, '0'));
    setTimerValue(elements.heroSeconds, String(remaining.seconds).padStart(2, '0'));
  }

function updateTimers() {
    const heroExam = getHeroExam();
    if (heroExam) {
      updateHeroTimerDisplay(heroExam);
    }
    // Cập nhật countdown tab Tài khoản (chỉ khi tab đang mở)
    if (document.getElementById('tab-account')?.classList.contains('active')) {
      updateAccountCountdown();
    }
  }

  // --- 2. HOME WIDGETS & MINI EXAM LIST ---
  function renderHomeWidgets() {
    // --- Kỳ thi gần nhất ---
    const nearestDays = calculateNearestDays(appState.exams);
    const nearestExam = getNearestExam(appState.exams);
    if (elements.homeStatNearest) {
      elements.homeStatNearest.textContent = nearestDays !== null ? `${nearestDays} ngày` : '--';
    }
    const nearestSubEl = document.getElementById('home-stat-nearest-sub');
    if (nearestSubEl) {
      nearestSubEl.textContent = nearestExam ? nearestExam.title : 'Kỳ thi kế tiếp';
    }

    // --- Mục tiêu tuần: tính % kỳ thi còn hạn (có ngày thi trong tương lai) ---
    const targetEl = document.getElementById('home-stat-target');
    const targetSubEl = document.getElementById('home-stat-target-sub');
    const total = appState.exams.length;
    if (total > 0) {
      const upcoming = appState.exams.filter(isUpcomingExam).length;
      const highPriority = appState.exams.filter(e => e.priority === 'high' && isUpcomingExam(e)).length;
      const pct = Math.round((upcoming / total) * 100);
      if (targetEl) targetEl.textContent = `${pct}%`;
      if (targetSubEl) targetSubEl.innerHTML = `<span class="highlight-green">${upcoming}/${total}</span> kỳ thi còn lại (${highPriority} trọng điểm)`;
    } else {
      if (targetEl) targetEl.textContent = '--';
      if (targetSubEl) targetSubEl.textContent = 'Chưa có kỳ thi nào';
    }

// --- Chuỗi học: đọc từ localStorage ---
    const streakData = getStreakData();
    const streakEl = document.getElementById('home-stat-streak');
    const streakSubEl = document.getElementById('home-stat-streak-sub');
    if (streakEl) streakEl.textContent = `${streakData.streak} ngày`;
    if (streakSubEl) {
      const isRecord = streakData.streak >= streakData.record;
      streakSubEl.textContent = isRecord ? 'Kỷ lục cá nhân 🔥' : `Kỷ lục: ${streakData.record} ngày`;
    }
    // Streak card chính trên trang chủ
    if (elements.homeStreakValue) elements.homeStreakValue.textContent = `${streakData.streak}`;
    if (elements.homeStreakRecord) {
      const isRecord = streakData.streak >= streakData.record;
      elements.homeStreakRecord.textContent = isRecord ? 'Kỷ lục cá nhân 🔥' : `Kỷ lục: ${streakData.record} ngày`;
    }

    // --- Community stats (will be updated by subscribeToCommStats) ---
    renderCommunityStats();

    // --- Mini exam list on Home ---
    if (!elements.homeExamList) return;
    elements.homeExamList.innerHTML = '';

    if (appState.exams.length === 0) {
      elements.homeExamList.innerHTML = `<p style="color: var(--text-dim); font-size: 0.9rem; padding: 12px 0;">Chưa có kỳ thi nào. Bấm + Thêm để tạo kỳ thi mới.</p>`;
      return;
    }

    appState.exams.forEach(exam => {
      const card = document.createElement('div');
      card.className = 'exam-mini-item';
      card.innerHTML = `
        <div class="exam-mini-info">
          <span class="exam-mini-name">${escapeHtml(exam.title)}</span>
          <span class="exam-mini-date">${formatDateVi(exam.date)}</span>
        </div>
        <div style="display: flex; align-items: center; gap: 10px;">
          <span class="exam-mini-badge">${getExamStatusText(exam)}</span>
          <i class="fa-solid fa-chevron-right chevron-icon"></i>
        </div>
      `;

      card.addEventListener('click', () => {
        openExamEditModal(exam);
      });

      elements.homeExamList.appendChild(card);
    });
  }

// --- 3. FULL EXAM MANAGEMENT PAGE (iOS grouped list) ---
  const EXAM_MONTHS = ['TH1', 'TH2', 'TH3', 'TH4', 'TH5', 'TH6', 'TH7', 'TH8', 'TH9', 'TH10', 'TH11', 'TH12'];

  function renderExams() {
    if (!elements.examGrid) return;
    elements.examGrid.innerHTML = '';

    const filtered = appState.exams.filter(exam => {
      if (currentExamFilter === 'all') return true;
      if (currentExamFilter === 'hsa') return exam.category === 'hsa' || exam.category === 'tsa';
      return exam.category === currentExamFilter;
    });

    if (filtered.length === 0) {
      elements.examGrid.innerHTML = `
        <div class="exams-empty">
          <i class="fa-solid fa-bullseye"></i>
          <h4>${appState.exams.length ? 'Không có kỳ thi trong danh mục này' : 'Chưa có kỳ thi nào'}</h4>
          <p>${appState.exams.length ? 'Chọn danh mục khác để xem.' : 'Chạm "+ Thêm kỳ thi" để tạo kỳ thi đầu tiên.'}</p>
        </div>`;
      return;
    }

    const upcoming = filtered.filter(e => isUpcomingExam(e));
    const past = filtered.filter(e => !isUpcomingExam(e));
    const groups = [];
    if (upcoming.length) groups.push({ label: 'Sắp diễn ra', items: upcoming });
    if (past.length) groups.push({ label: 'Đã kết thúc', items: past });

    groups.forEach(group => {
      const section = document.createElement('div');
      section.className = 'exam-list-section';

      const head = document.createElement('div');
      head.className = 'exam-list-section-head';
      head.textContent = `${group.label} · ${group.items.length}`;
      section.appendChild(head);

      const list = document.createElement('div');
      list.className = 'exam-list';

      group.items.forEach(exam => {
        const row = document.createElement('article');
        row.className = 'exam-full-card' + (exam.isHero ? ' is-hero' : '');

        const [y, m, d] = exam.date.split('-').map(Number);
        const dd = String(d).padStart(2, '0');
        const mm = (EXAM_MONTHS[(m || 1) - 1] || '').toLowerCase();

        const rem = getTimeRemaining(exam.date, exam.time);
        let statusCls = 'past';
        let statusHtml = '';
        if (rem.total > 0) {
          if (exam.isHero) {
            statusHtml += '<span class="exam-hero-pill"><i class="fa-solid fa-star"></i> Trọng điểm</span>';
          }
          if (rem.days === 0) {
            statusCls = 'today';
            statusHtml += '<span class="exam-days-badge">Hôm nay</span>';
          } else if (rem.days <= 7) {
            statusCls = 'soon';
            statusHtml += `<span class="exam-days-badge">Còn ${rem.days} ngày</span>`;
          } else {
            statusCls = 'ok';
            statusHtml += `<span class="exam-days-badge">Còn ${rem.days} ngày</span>`;
          }
        } else {
          statusHtml += '<span class="exam-days-badge">Đã diễn ra</span>';
        }

        row.innerHTML = `
          <button type="button" class="exam-row-main" data-edit-exam="${escapeHtml(exam.id)}" aria-label="Xem chi tiết kỳ thi">
            <span class="exam-date-chip">
              <span class="exam-date-day">${dd}</span>
              <span class="exam-date-month">${mm}</span>
            </span>
            <span class="exam-row-info">
              <span class="exam-card-name">${escapeHtml(exam.title)}</span>
              <span class="exam-row-sub">
                <span class="exam-priority-dot ${escapeHtml(exam.priority)}"></span>
                ${escapeHtml(getCategoryName(exam.category))} · ${formatDateVi(exam.date)}${exam.time ? ' • ' + escapeHtml(exam.time) : ''}
              </span>
              <span class="exam-row-status ${statusCls}">${statusHtml}</span>
            </span>
            <i class="fa-solid fa-chevron-right exam-row-chevron"></i>
          </button>
          <div class="exam-row-actions">
            <button type="button" class="exam-action" data-hero-exam="${escapeHtml(exam.id)}" title="${exam.isHero ? 'Kỳ thi trọng tâm' : 'Đặt làm kỳ thi trọng tâm'}">
              <i class="fa-solid ${exam.isHero ? 'fa-star' : 'fa-regular fa-star'}"></i>
            </button>
            <button type="button" class="exam-action" data-edit-exam="${escapeHtml(exam.id)}" title="Chỉnh sửa">
              <i class="fa-solid fa-pen-to-square"></i>
            </button>
            <button type="button" class="exam-action danger" data-delete-exam="${escapeHtml(exam.id)}" title="Xóa">
              <i class="fa-solid fa-trash-can"></i>
            </button>
          </div>
        `;

        row.querySelectorAll('[data-edit-exam]').forEach(btn => btn.addEventListener('click', (e) => {
          e.stopPropagation();
          openExamEditModal(exam);
        }));

        row.querySelector('[data-hero-exam]').addEventListener('click', (e) => {
          e.stopPropagation();
          appState.exams.forEach(ex => ex.isHero = (ex.id === exam.id));
          saveState();
          renderAll();
          showToast(`Đã đặt "${exam.title}" làm kỳ thi trọng tâm.`);
        });

        row.querySelector('[data-delete-exam]').addEventListener('click', async (e) => {
          e.stopPropagation();
          const ok = await showConfirmDialog({
            title: '<i class="fa-solid fa-trash-can"></i> Xóa kỳ thi',
            message: `Bạn có chắc muốn xóa kỳ thi "${exam.title}"?`,
            confirmText: 'Xóa',
            danger: true
          });
          if (!ok) return;
          appState.exams = appState.exams.filter(ex => ex.id !== exam.id);
          if (exam.isHero && appState.exams.length > 0) {
            appState.exams[0].isHero = true;
          }
          saveState();
          renderAll();
          showToast('Đã xóa kỳ thi.');
        });

        list.appendChild(row);
      });

      section.appendChild(list);
      elements.examGrid.appendChild(section);
    });
  }

  // --- 4. ACCOUNT RENDERING & AUTH ---
  function renderAccount() {
    const user = firebaseUser;
    const isAuthenticated = user && !user.isAnonymous;
    const name = user?.displayName || (user?.email ? user.email.split('@')[0] : 'Sĩ tử EduPulse');
    const initial = (name || 'S').slice(0, 1).toUpperCase();

    // Update Greeting in Header & Sidebar
    if (elements.homeGreetingTitle) elements.homeGreetingTitle.textContent = `Xin chào, ${name} 👋`;
    if (elements.mobileGreetingName) elements.mobileGreetingName.textContent = `Xin chào, ${name} 👋`;
    if (elements.sidebarUserName) elements.sidebarUserName.textContent = name;
    if (elements.sidebarUserStatus) elements.sidebarUserStatus.textContent = isAuthenticated ? 'Đồng bộ Realtime' : 'Lưu trữ máy';

    // Avatars
    if (elements.sidebarUserAvatar) {
      elements.sidebarUserAvatar.innerHTML = user?.photoURL ? `<img src="${escapeHtml(user.photoURL)}" alt="Avatar">` : initial;
    }
    if (elements.mobileUserAvatar) {
      elements.mobileUserAvatar.innerHTML = user?.photoURL ? `<img src="${escapeHtml(user.photoURL)}" alt="Avatar">` : initial;
    }

    if (!elements.accountGuestView || !elements.accountUserView) return;

    if (!isAuthenticated) {
      elements.accountGuestView.hidden = false;
      elements.accountUserView.hidden = true;
    } else {
      elements.accountGuestView.hidden = true;
      elements.accountUserView.hidden = false;

      if (elements.accountUserName) elements.accountUserName.textContent = name;
      if (elements.accountUserEmail) elements.accountUserEmail.textContent = user.email || 'Tài khoản Google';
      if (elements.accountAvatarUser) {
        elements.accountAvatarUser.innerHTML = user.photoURL ? `<img src="${escapeHtml(user.photoURL)}" alt="Avatar">` : initial;
      }
if (elements.badgeEmailVerified) {
        elements.badgeEmailVerified.hidden = !user.emailVerified;
      }
      if (elements.btnSendVerification) {
        const isEmailUser = user.providerData?.some(p => p.providerId === 'password');
        elements.btnSendVerification.hidden = user.emailVerified || !isEmailUser;
      }

// Stats
      if (elements.accStatExams) elements.accStatExams.textContent = appState.exams.length;
      if (elements.accStatHigh) elements.accStatHigh.textContent = appState.exams.filter(e => e.priority === 'high').length;
      if (elements.accStatNearest) {
        const nearest = calculateNearestDays(appState.exams);
        elements.accStatNearest.textContent = nearest !== null ? `${nearest} ngày` : '--';
      }

      // Chuỗi học
      if (elements.accStreakValue || elements.accStreakRecord) {
        const streakData = getStreakData();
        if (elements.accStreakValue) elements.accStreakValue.textContent = `${streakData.streak}`;
        if (elements.accStreakRecord) {
          const isRecord = streakData.streak >= streakData.record;
          elements.accStreakRecord.textContent = isRecord ? 'Kỷ lục cá nhân 🔥' : `Kỷ lục: ${streakData.record} ngày`;
        }
      }

      updateAccountCountdown();
    }
  }

  // Cập nhật countdown kỳ thi gần nhất trong tab Tài khoản
  function updateAccountCountdown() {
    if (!elements.accCountdownTitle) return;
    const nearest = getNearestExam(appState.exams);
    if (!nearest) {
      if (elements.accCountdownTitle) elements.accCountdownTitle.textContent = 'Chưa có kỳ thi nào';
      if (elements.accCountdownDate) elements.accCountdownDate.textContent = '';
      if (elements.accCountdownTimer) elements.accCountdownTimer.hidden = true;
      if (elements.accCountdownEmpty) elements.accCountdownEmpty.hidden = false;
      return;
    }
    if (elements.accCountdownTimer) elements.accCountdownTimer.hidden = false;
    if (elements.accCountdownEmpty) elements.accCountdownEmpty.hidden = true;
    if (elements.accCountdownTitle) elements.accCountdownTitle.textContent = nearest.title;
    if (elements.accCountdownDate) {
      elements.accCountdownDate.innerHTML = `<i class="fa-regular fa-calendar-days"></i> ${formatDateVi(nearest.date)} • ${nearest.time || '07:30'}`;
    }
    const remaining = getTimeRemaining(nearest.date, nearest.time);
    const pad = n => String(n).padStart(2, '0');
    if (elements.accCountdownDays) elements.accCountdownDays.textContent = String(remaining.days).padStart(3, '0');
    if (elements.accCountdownHours) elements.accCountdownHours.textContent = pad(remaining.hours);
    if (elements.accCountdownMinutes) elements.accCountdownMinutes.textContent = pad(remaining.minutes);
    if (elements.accCountdownSeconds) elements.accCountdownSeconds.textContent = pad(remaining.seconds);
  }

  function setAuthMode(register) {
    isRegisterMode = register;
    elements.btnTabLogin.classList.toggle('active', !register);
    elements.btnTabRegister.classList.toggle('active', register);
    elements.authNameGroup.hidden = !register;
    elements.authFormTitle.textContent = register ? 'Đăng ký tài khoản' : 'Đăng nhập tài khoản';
    elements.authFormSubtitle.textContent = register ? 'Tạo tài khoản để đồng bộ mọi dữ liệu ôn thi.' : 'Đồng bộ dữ liệu đếm ngược trên mọi thiết bị.';
    elements.authSubmit.querySelector('span').textContent = register ? 'Đăng ký' : 'Đăng nhập';
  }

  function translateAuthError(err) {
    const code = err?.code || '';
    const map = {
      'auth/email-already-in-use': 'Email này đã được đăng ký. Hãy đăng nhập hoặc dùng email khác.',
      'auth/invalid-email': 'Địa chỉ email không hợp lệ.',
      'auth/weak-password': 'Mật khẩu quá yếu (tối thiểu 6 ký tự).',
      'auth/user-not-found': 'Không tìm thấy tài khoản với email này.',
      'auth/wrong-password': 'Mật khẩu không đúng.',
      'auth/invalid-credential': 'Email hoặc mật khẩu không đúng.',
      'auth/too-many-requests': 'Quá nhiều lần thử. Vui lòng thử lại sau vài phút.',
      'auth/network-request-failed': 'Mất kết nối mạng. Vui lòng kiểm tra Internet.',
      'auth/popup-blocked': 'Trình duyệt chặn cửa sổ đăng nhập. Đang chuyển sang trang đăng nhập Google…',
      'auth/popup-closed-by-user': 'Bạn đã đóng cửa sổ đăng nhập Google.',
      'auth/account-exists-with-different-credential': 'Email này đã dùng với một cách đăng nhập khác (Email hoặc Google).',
      'auth/requires-recent-login': 'Phiên đăng nhập đã cũ. Vui lòng đăng nhập lại rồi thử lại.',
      'auth/operation-not-allowed': 'Cách đăng nhập này chưa được bật trong Firebase Console.'
    };
    return map[code] || (err?.message || 'Đã xảy ra lỗi. Vui lòng thử lại.');
  }

  async function handleEmailAuth(e) {
    e.preventDefault();
    if (!window.firebase) {
      showToast('Firebase chưa sẵn sàng.', 'warning');
      return;
    }
    const email = elements.authEmail.value.trim();
    const password = elements.authPassword.value;
    const name = elements.authName.value.trim();

    if (!email || !password) return;

    elements.authSubmit.disabled = true;
    try {
if (isRegisterMode) {
        const userCred = await firebase.auth().createUserWithEmailAndPassword(email, password);
        if (name && userCred.user) {
          await userCred.user.updateProfile({ displayName: name });
        }
        try {
          await userCred.user.sendEmailVerification();
        } catch (verifyErr) {
          console.warn('Send verification email failed:', verifyErr);
        }
        // Tài khoản chưa xác thực → đăng xuất, chờ xác thực xong mới dùng được
        await firebase.auth().signOut();
        showToast('Đăng ký thành công! Vui lòng bấm link trong email để xác thực rồi đăng nhập.');
      } else {
        const userCred = await firebase.auth().signInWithEmailAndPassword(email, password);
        // Chưa xác thực email → không cho vào app
        if (userCred.user && !userCred.user.emailVerified) {
          try {
            await userCred.user.sendEmailVerification();
          } catch (verifyErr) {
            console.warn('Send verification email failed:', verifyErr);
          }
          await firebase.auth().signOut();
          showToast('Email chưa được xác thực. Đã gửi lại email xác thực — vui lòng kiểm tra hộp thư.', 'warning');
        } else {
          showToast('Đăng nhập thành công!');
        }
      }
    } catch (err) {
      console.error('Auth error:', err);
      showToast(translateAuthError(err), 'warning');
    } finally {
      elements.authSubmit.disabled = false;
    }
  }

  async function signInWithGoogle() {
    if (!window.firebase) {
      showToast('Firebase chưa sẵn sàng.', 'warning');
      return;
    }
    try {
      const provider = new firebase.auth.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await firebase.auth().signInWithPopup(provider);
      showToast('Đăng nhập Google thành công!');
    } catch (err) {
      console.error('Google sign-in error:', err);
      if (err?.code === 'auth/popup-blocked') {
        try {
          await firebase.auth().signInWithRedirect(provider);
          return;
        } catch (redirectErr) {
          console.error('Google redirect sign-in error:', redirectErr);
        }
      }
      showToast(translateAuthError(err), 'warning');
    }
  }

  async function signOut() {
    if (window.firebase) {
      await firebase.auth().signOut();
      showToast('Đã đăng xuất tài khoản.');
      renderAccount();
    }
  }

  // --- MODAL CONTROLS ---
  function openModal(modalId) {
    const el = document.getElementById(modalId);
    if (!el) return;
    el.classList.add('active');
  }

  function closeModal(modalId) {
    const el = document.getElementById(modalId);
    if (!el) return;
    el.classList.remove('active');
  }

  // Hộp thoại xác nhận tùy chỉnh (thay confirm() native — BUG-14). Trả về Promise<boolean>.
  function showConfirmDialog(options) {
    const { title, message, confirmText = 'Xác nhận', cancelText = 'Hủy', danger = false } = options || {};
    return new Promise((resolve) => {
      const modal = document.getElementById('modal-confirm');
      if (!modal) { resolve(window.confirm(message || '')); return; }
      const titleEl = document.getElementById('confirm-title');
      const msgEl = document.getElementById('confirm-message');
      const okBtn = document.getElementById('btn-confirm-ok');
      const cancelBtn = document.getElementById('btn-confirm-cancel');
      const closeBtn = document.getElementById('btn-confirm-close');
      let settled = false;
      const cleanup = () => {
        if (okBtn) okBtn.removeEventListener('click', onClickOk);
        if (cancelBtn) cancelBtn.removeEventListener('click', onClickCancel);
        if (closeBtn) closeBtn.removeEventListener('click', onClickClose);
        modal.removeEventListener('click', onClickBackdrop);
        document.removeEventListener('keydown', onKey);
      };
      const done = (val) => {
        if (settled) return;
        settled = true;
        closeModal('modal-confirm');
        cleanup();
        resolve(val);
      };
      function onClickOk() { done(true); }
      function onClickCancel() { done(false); }
      function onClickClose() { done(false); }
      function onClickBackdrop(e) { if (e.target === modal) done(false); }
      function onKey(e) {
        if (e.key === 'Escape') done(false);
        else if (e.key === 'Enter') done(true);
      }
      if (titleEl) titleEl.innerHTML = title || '<i class="fa-solid fa-triangle-exclamation"></i> Xác nhận';
      if (msgEl) msgEl.textContent = message || '';
      if (okBtn) {
        okBtn.textContent = confirmText;
        okBtn.classList.toggle('btn-danger-action', !!danger);
        okBtn.classList.toggle('btn-primary-action', !danger);
        okBtn.addEventListener('click', onClickOk);
      }
      if (cancelBtn) {
        cancelBtn.textContent = cancelText || 'Hủy';
        cancelBtn.addEventListener('click', onClickCancel);
      }
      if (closeBtn) closeBtn.addEventListener('click', onClickClose);
      modal.addEventListener('click', onClickBackdrop);
      document.addEventListener('keydown', onKey);
      openModal('modal-confirm');
    });
  }

  // --- iOS sheet: kéo xuống để đóng + tap ngoài để đóng (mobile) ---
  function setupSheetDismiss() {
    document.addEventListener('click', (e) => {
      if (!e.target.classList || !e.target.classList.contains('modal-backdrop')) return;
      if (e.target.classList.contains('active')) closeModal(e.target.id);
    });

    let sheetTouch = null;
    document.addEventListener('touchstart', (e) => {
      const card = e.target.closest && e.target.closest('.modal-card');
      const backdrop = card && card.closest('.modal-backdrop');
      if (!backdrop || !backdrop.classList.contains('active')) { sheetTouch = null; return; }
      sheetTouch = { card, y: e.touches[0].clientY, id: backdrop.id };
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
      if (!sheetTouch) return;
      const bodyEl = sheetTouch.card.querySelector('.modal-body-content');
      if (bodyEl && bodyEl.scrollTop > 0 && e.target.closest && e.target.closest('.modal-body-content')) return;
      const dy = e.touches[0].clientY - sheetTouch.y;
      if (dy <= 0) return;
      e.preventDefault();
      sheetTouch.card.style.transition = 'none';
      sheetTouch.card.style.transform = 'translateY(' + dy + 'px)';
      const backdrop = sheetTouch.card.closest('.modal-backdrop');
      if (backdrop) backdrop.style.opacity = String(Math.max(0.45, 1 - dy / 600));
    }, { passive: false });

    document.addEventListener('touchend', (e) => {
      if (!sheetTouch) return;
      const dy = e.changedTouches[0].clientY - sheetTouch.y;
      const touch = sheetTouch;
      sheetTouch = null;
      touch.card.style.transition = '';
      touch.card.style.transform = '';
      const backdrop = touch.card.closest('.modal-backdrop');
      if (backdrop) backdrop.style.opacity = '';
      if (dy > 90) closeModal(touch.id);
    }, { passive: true });
  }

  function openExamEditModal(exam) {
    openModal('modal-exam');
    document.getElementById('modal-exam-title').innerHTML = '<i class="fa-solid fa-pen-to-square"></i> Chỉnh Sửa Kỳ Thi';
    document.getElementById('exam-id').value = exam.id;
    document.getElementById('exam-name').value = exam.title;
    document.getElementById('exam-category').value = exam.category;
    document.getElementById('exam-priority').value = exam.priority;
document.getElementById('exam-date').value = exam.date;
    document.getElementById('exam-date').min = '';
    document.getElementById('exam-time').value = exam.time || '07:30';
    document.getElementById('exam-notes').value = exam.notes || '';
  }

  function handleExamSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('exam-id').value;
    const title = document.getElementById('exam-name').value.trim();
    const category = document.getElementById('exam-category').value;
    const priority = document.getElementById('exam-priority').value;
    const date = document.getElementById('exam-date').value;
    const time = document.getElementById('exam-time').value || '07:30';
    const notes = document.getElementById('exam-notes').value.trim();

    if (!title || !date) return;

    if (id) {
      const exam = appState.exams.find(ex => ex.id === id);
      if (exam) {
        exam.title = title;
        exam.category = category;
        exam.priority = priority;
        exam.date = date;
        exam.time = time;
        exam.notes = notes;
      }
    } else {
const newExam = {
        id: 'exam-' + Date.now(),
        title,
        category,
        priority,
        date,
        time,
        notes,
        isHero: appState.exams.length === 0
      };
      appState.exams.push(newExam);
    }

saveState();
    closeModal('modal-exam');
    renderAll();
    showToast(id ? 'Đã cập nhật kỳ thi.' : 'Đã thêm kỳ thi mới.');
  }

  // --- APP BRIDGE (cho ai-profile.js, ai-rag.js, push-client.js, calls.js) ---
  window.EDUPULSE_APP = {
    getUid: () => (firebaseUser && !firebaseUser.isAnonymous) ? firebaseUser.uid : '',
    getDb: () => firebaseDb,
    openTab: (tab) => openTab(tab),
    getExams: () => appState.exams.slice(),
    getLibrary: () => appState.library.slice(),
    getState: () => appState,
    saveState: () => saveState(),
    findExam: id => appState.exams.find(ex => ex.id === id) || null,
    daysLeft: exam => getDaysLeft(exam.date, exam.time),
    getAttachmentBlob: fileId => getFirestoreAttachmentBlob(fileId),
    formatAiText: (text, useMath) => formatAiText(text, useMath),
    getStudyStats: () => {
      const streakData = getStreakData();
      const total = appState.exams.length;
      const upcoming = appState.exams.filter(isUpcomingExam);
      const nearest = getNearestExam(appState.exams);
      const pct = total > 0 ? Math.round((upcoming.length / total) * 100) : null;
      const log = Array.isArray(appState.studyLog) ? appState.studyLog : [];
      const today = getLocalDateString();
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      const weekAgoStr = getLocalDateString(weekAgo);
      const todayMinutes = log.filter(e => e.date === today).reduce((s, e) => s + (e.minutes || 0), 0);
      const weekMinutes = log.filter(e => e.date >= weekAgoStr).reduce((s, e) => s + (e.minutes || 0), 0);
      const totalMinutes = log.reduce((s, e) => s + (e.minutes || 0), 0);
      return {
        streak: streakData.streak,
        record: streakData.record,
        totalExams: total,
        upcomingExams: upcoming.length,
        weeklyTargetPct: pct,
        nearestExam: nearest ? { title: nearest.title, date: nearest.date, daysLeft: getDaysLeft(nearest.date, nearest.time) } : null,
        study: {
          todayMinutes,
          weekMinutes,
          totalMinutes,
          goals: appState.goals || { score: null, subject: '', weeklyMinutes: 300 },
          push: appState.pushSettings || { times: ['18:00'], quote: true }
        }
      };
    },
    createExam: data => {
      const exam = {
        id: 'exam-' + Date.now(),
        title: data.title,
        category: data.category,
        priority: data.priority,
        date: data.date,
        time: data.time || '07:30',
        notes: data.notes || '',
        isHero: appState.exams.length === 0
      };
      appState.exams.push(exam);
      saveState();
      renderAll();
      showToast('Đã thêm kỳ thi mới.');
      return exam;
    },
    updateExam: (id, patch) => {
      const exam = appState.exams.find(ex => ex.id === id);
      if (!exam) return null;
      Object.assign(exam, patch);
      saveState();
      renderAll();
      showToast('Đã cập nhật kỳ thi.');
      return exam;
    },
    deleteExam: id => {
      appState.exams = appState.exams.filter(ex => ex.id !== id);
      saveState();
      renderAll();
      showToast('Đã xóa kỳ thi.');
    },
    restoreExam: exam => {
      if (!exam) return null;
      const restored = { ...exam, id: 'exam-' + Date.now() };
      appState.exams.push(restored);
      saveState();
      renderAll();
      showToast('Đã khôi phục kỳ thi.');
      return restored;
    },
    setHeroExam: id => {
      appState.exams.forEach(ex => { ex.isHero = (ex.id === id); });
      saveState();
      renderAll();
      showToast('Đã đặt kỳ thi trọng tâm.');
    },
    getDb: () => firebaseDb,
    getAuthUser: () => firebaseUser,
    showToast: (msg, type) => showToast(msg, type),
    mergeStates: (l, r) => mergeStates(l, r),
    mergeStudyLog: (a, b) => mergeStudyLog(a, b)
  };

  // --- EVENT LISTENERS SETUP ---
  function setupEventListeners() {
    // Add Exam Buttons
    function openAddExamModal() {
      openModal('modal-exam');
      document.getElementById('exam-id').value = '';
      document.getElementById('modal-exam-title').innerHTML = '<i class="fa-solid fa-calendar-plus"></i> Thêm Kỳ Thi Mới';
      elements.formExam.reset();
      document.getElementById('exam-date').min = getLocalDateString();
    }

    if (elements.btnHomeAddExam) {
      elements.btnHomeAddExam.addEventListener('click', openAddExamModal);
    }

    if (elements.btnAddExamPage) {
      elements.btnAddExamPage.addEventListener('click', openAddExamModal);
    }

if (elements.btnHeroDetail) {
      elements.btnHeroDetail.addEventListener('click', () => openTab('tab-exams'));
    }

    // Mobile: nút chi tiết ẩn → bấm cả thẻ hero để mở tab Kỳ thi
    const heroBox = document.getElementById('hero-countdown-box');
    if (heroBox) {
      heroBox.addEventListener('click', (e) => {
        const detailBtn = document.getElementById('btn-hero-detail');
        const hidden = !detailBtn || getComputedStyle(detailBtn).display === 'none';
        if (hidden && !e.target.closest('button') && !e.target.closest('a')) openTab('tab-exams');
      });
    }

    if (elements.formExam) {
      elements.formExam.addEventListener('submit', handleExamSubmit);
    }

    // Exam Filter Buttons
    elements.examFilterBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        elements.examFilterBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentExamFilter = btn.getAttribute('data-exam-filter');
        renderExams();
      });
    });

    // Dark Mode Toggle (Sidebar & Mobile)
const btnSidebarTheme = document.getElementById('btn-sidebar-theme');
    if (btnSidebarTheme) btnSidebarTheme.addEventListener('click', toggleTheme);

// Listen for system preference changes (only matters in 'auto' mode)
    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        if (themePref === 'auto') {
          isDarkMode = e.matches;
          applyTheme();
        }
      });
    }

    // Theme segmented control (System/Tối/Sáng) in account tab
    document.querySelectorAll('[data-theme-pref]').forEach(btn => {
      btn.addEventListener('click', () => setThemePref(btn.getAttribute('data-theme-pref')));
    });

    // Offline-first: hiện chỉ báo khi mất mạng
    function updateOnlineStatus() {
      const badge = document.getElementById('offline-banner');
      if (badge) badge.hidden = navigator.onLine;
    }
    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);
    updateOnlineStatus();

    // Fallback: nút "Ghi nhận" luôn phản hồi kể cả khi study.js chưa gắn listener
    document.addEventListener('click', function (e) {
      const hit = e.target && e.target.closest ? e.target.closest('#btn-log-study') : null;
      if (!hit) return;
      if (window.__studyLogDelegationActive) return;
      if (window.EduPulseStudy && typeof window.EduPulseStudy.handleLogButtonClick === 'function') {
        window.EduPulseStudy.handleLogButtonClick();
      } else {
        showToast('Mô-đun Thống kê chưa sẵn sàng. Đóng và mở lại app nhé!', 'warning');
      }
    });

    // Close Modals
    document.addEventListener('click', (e) => {
      const closeTarget = e.target.closest('[data-close]');
      if (closeTarget) {
        closeModal(closeTarget.getAttribute('data-close'));
      }
    });

    // Auth events
    if (elements.btnTabLogin) elements.btnTabLogin.addEventListener('click', () => setAuthMode(false));
    if (elements.btnTabRegister) elements.btnTabRegister.addEventListener('click', () => setAuthMode(true));
    if (elements.btnGoogleAuth) elements.btnGoogleAuth.addEventListener('click', signInWithGoogle);
if (elements.authForm) elements.authForm.addEventListener('submit', handleEmailAuth);
    if (elements.btnAccountLogout) elements.btnAccountLogout.addEventListener('click', signOut);

    if (elements.btnSendVerification) {
      elements.btnSendVerification.addEventListener('click', async () => {
        if (!firebaseUser || firebaseUser.isAnonymous) return;
        const originalHtml = elements.btnSendVerification.innerHTML;
        elements.btnSendVerification.disabled = true;
        elements.btnSendVerification.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang gửi…';
        try {
          await firebaseUser.sendEmailVerification();
          showToast('Email xác thực đã được gửi. Kiểm tra hộp thư của bạn.');
        } catch (err) {
          console.error('Send verification failed:', err);
          if (err?.code === 'auth/too-many-requests') {
            showToast('Bạn gửi quá nhiều lần. Vui lòng thử lại sau vài phút.', 'warning');
          } else {
            showToast('Không gửi được email xác thực. Vui lòng thử lại.', 'warning');
          }
        } finally {
          elements.btnSendVerification.disabled = false;
          elements.btnSendVerification.innerHTML = originalHtml;
        }
      });
    }

    if (elements.btnTogglePassword) {
      elements.btnTogglePassword.addEventListener('click', () => {
        const type = elements.authPassword.type === 'password' ? 'text' : 'password';
        elements.authPassword.type = type;
        elements.btnTogglePassword.innerHTML = type === 'password' ? '<i class="fa-solid fa-eye"></i>' : '<i class="fa-solid fa-eye-slash"></i>';
      });
    }

    if (elements.btnForgotPassword) {
      elements.btnForgotPassword.addEventListener('click', () => openModal('modal-forgot-password'));
    }

    if (elements.formForgotPassword) {
      elements.formForgotPassword.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('forgot-email').value.trim();
        if (!email || !window.firebase) return;
        try {
          await firebase.auth().sendPasswordResetEmail(email);
          closeModal('modal-forgot-password');
          showToast(`Đã gửi liên kết khôi phục tới ${email}.`);
        } catch (err) {
          showToast(translateAuthError(err), 'warning');
        }
      });
    }

    // Profile & Password Edit
    if (elements.btnOpenEditProfile) {
      elements.btnOpenEditProfile.addEventListener('click', () => {
        openModal('modal-edit-profile');
        if (firebaseUser) {
          document.getElementById('profile-display-name').value = firebaseUser.displayName || '';
          document.getElementById('profile-photo-url').value = firebaseUser.photoURL || '';
        }
      });
    }

    if (elements.formEditProfile) {
      elements.formEditProfile.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('profile-display-name').value.trim();
        const photoURL = document.getElementById('profile-photo-url').value.trim();
        if (firebaseUser) {
          await firebaseUser.updateProfile({ displayName: name, photoURL: photoURL || null });
          closeModal('modal-edit-profile');
          renderAccount();
          showToast('Đã cập nhật hồ sơ!');
        }
      });
    }

    if (elements.btnOpenChangePassword) {
      elements.btnOpenChangePassword.addEventListener('click', () => openModal('modal-change-password'));
    }

    if (elements.formChangePassword) {
      elements.formChangePassword.addEventListener('submit', async (e) => {
        e.preventDefault();
        const oldPwd = document.getElementById('change-old-password').value;
        const newPwd = document.getElementById('change-new-password').value;
        const confirmPwd = document.getElementById('change-confirm-password').value;
        if (!oldPwd || !newPwd || !confirmPwd) return;
        if (newPwd.length < 6) {
          showToast('Mật khẩu mới tối thiểu 6 ký tự.', 'warning');
          return;
        }
        if (newPwd !== confirmPwd) {
          showToast('Mật khẩu xác nhận không khớp.', 'warning');
          return;
        }
        if (!firebaseUser || firebaseUser.isAnonymous || !firebaseUser.email) {
          showToast('Vui lòng đăng nhập lại để đổi mật khẩu.', 'warning');
          return;
        }
        try {
          const credential = firebase.auth.EmailAuthProvider.credential(firebaseUser.email, oldPwd);
          await firebaseUser.reauthenticateWithCredential(credential);
          await firebaseUser.updatePassword(newPwd);
          elements.formChangePassword.reset();
          closeModal('modal-change-password');
          showToast('Đã đổi mật khẩu thành công.');
        } catch (err) {
          console.error('Change password failed:', err);
          showToast(translateAuthError(err), 'warning');
        }
      });
    }

    if (elements.btnForceSync) {
      elements.btnForceSync.addEventListener('click', async () => {
        await syncState();
        showToast('Đã đồng bộ dữ liệu thời gian thực!');
      });
    }

    // Chat Form Submit
    if (elements.chatForm) {
      elements.chatForm.addEventListener('submit', sendChatMessage);
    }
    if (elements.chatMessage) {
      elements.chatMessage.addEventListener('input', updateChatSendState);
      updateChatSendState();
    }
    if (elements.btnChatAttach && elements.chatFileInput) {
      elements.btnChatAttach.addEventListener('click', () => elements.chatFileInput.click());
      elements.chatFileInput.addEventListener('change', event => uploadChatAttachment(event.target.files[0]));
    }

if (elements.aiForm) elements.aiForm.addEventListener('submit', sendAiMessage);

// Nút tra cứu web theo thời gian thực (bật/tắt) — biến state nằm ở scope chung
  const aiWebToggleBtn = document.getElementById('ai-web-toggle');
  if (aiWebToggleBtn) {
    aiWebToggleBtn.addEventListener('click', () => {
      aiWebToggle = !aiWebToggle;
      aiWebToggleBtn.classList.toggle('on', aiWebToggle);
      aiWebToggleBtn.title = aiWebToggle ? 'Đang bật tra cứu web — câu hỏi tiếp theo sẽ tra cứu thời gian thực' : 'Tra cứu web khi trả lời (theo thời gian thực)';
    });
  }
  // Chọn model AI: auto (heuristic) / groq / gemini — lưu theo người dùng
  const aiModelSelect = document.getElementById('ai-model-select');
  if (aiModelSelect) {
    aiModelSelect.value = getAiModelPreference();
    aiModelSelect.addEventListener('change', () => setAiModelPreference(aiModelSelect.value));
  }
  }

  // --- FREE, ON-DEVICE STUDY ASSISTANT ---
  let aiBusy = false;
  let aiWebToggle = false;
  const AI_MODEL_PREF_KEY = 'edupulse_ai_model_pref';
  function getAiModelPreference() {
    try {
      const v = localStorage.getItem(AI_MODEL_PREF_KEY);
      return v === 'groq' || v === 'gemini' ? v : 'auto';
    } catch (error) { return 'auto'; }
  }
  function setAiModelPreference(value) {
    try { localStorage.setItem(AI_MODEL_PREF_KEY, value === 'groq' || value === 'gemini' ? value : 'auto'); } catch (error) { /* ignore */ }
  }
  function setAiComposerBusy(busy) {
    if (!elements.aiForm) return;
    const btn = elements.aiForm.querySelector('button[type="submit"]');
    if (btn) btn.disabled = busy;
  }
  function isDrawRequest(text) {
    if (!text) return false;
    const t = String(text).toLowerCase();
    if (/(vẽ hình|hình vẽ|sơ đồ|minh họa|vẽ tam giác|vẽ đường|hình học|vẽ giúp)/.test(t)) return true;
    if (/\bvẽ\b/.test(t) && /(tam giác|hình|đồ thị|biểu đồ|đường cao|trung điểm|góc|hình chóp|không gian)/.test(t)) return true;
    return false;
  }

  function stripSvgFromText(text) {
    if (!text) return text;
    const ex = extractSvgDiagrams(text);
    return ex.safeText.replace(/\[\[SVG:\d+\]\]/g, '');
  }

  // Sinh sơ đồ SVG riêng qua Groq (tạo SVG ổn định hơn) khi câu hỏi yêu cầu vẽ hình
  async function requestSvgDiagram(userText, onToken) {
    const systemPrompt = 'Chỉ trả về 1 khối fenced ```figure chứa JSON mô tả hình (không kèm chữ nào khác). Hình tam giác/đường cao/trung tuyến/góc vuông: {"kind":"triangle","altitude":"AH","median":"BM","rightAngle":"A","isosceles":true} (altitude "AH" = từ A hạ xuống cạnh BC, chân là H; median "BM" = từ B tới trung điểm AC; rightAngle "A" = góc vuông tại A). Đồ thị tọa độ: {"kind":"coords","points":[{"label":"A","x":1,"y":2},{"label":"B","x":3,"y":5}],"lines":[["A","B"]],"xLabel":"x","yLabel":"y","title":"..."}. Hình phức tạp ngoài 2 kiểu trên mới dùng ```svg vẽ tay theo tọa độ chính xác, width <= 380. App tự vẽ từ spec nên tọa độ chuẩn xác tuyệt đối.';
    return requestGroqReply(onToken, '', [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userText }
    ]);
  }

  async function appendSvgDiagram(el, question) {
    const contentEl = el && el.querySelector ? el.querySelector('.ai-message-content p') : null;
    if (!contentEl) return;
    const label = document.createElement('div');
    label.className = 'ai-diagram-label';
    label.innerHTML = '<i class="fa-solid fa-compass-drafting"></i> Sơ đồ minh họa:';
    const holder = document.createElement('div');
    holder.textContent = 'Đang vẽ sơ đồ…';
    contentEl.appendChild(label);
    contentEl.appendChild(holder);
    let svgText = '';
    try {
      await requestSvgDiagram(question, (tok) => { svgText += tok; });
      const html = formatAiText(svgText, false);
      if (/class="ai-diagram-wrap"|<svg/.test(html)) {
        holder.outerHTML = html;
      } else {
        holder.textContent = 'Mình chưa vẽ được sơ đồ cho bài này — mô tả thêm hình dạng để mình vẽ lại nhé.';
      }
    } catch (err) {
      console.warn('[EduPulse] SVG diagram request failed:', err && err.message);
      holder.textContent = 'Chưa vẽ được sơ đồ (lỗi kết nối hoặc hết lượt AI).';
    }
    elements.aiMessages.scrollTop = elements.aiMessages.scrollHeight;
  }

  async function sendAiMessage(event) {
    if (event) event.preventDefault();
    if (aiBusy) return;
    const question = elements.aiInput?.value.trim();
    if (!question || !elements.aiMessages) return;
    aiBusy = true;
    setAiComposerBusy(true);
    ensureKatex(); // nạp sẵn KaTeX phòng khi câu trả lời có công thức
    appendAiMessage(question, 'user');
    if (elements.aiInput) elements.aiInput.value = '';
aiConversation.push({ role: 'user', parts: [{ text: question }] });
    aiConversation = aiConversation.slice(-8);
    if (window.AiProfile && typeof window.AiProfile.recordQuestion === 'function') {
      window.AiProfile.recordQuestion(question);
    }
    if (!aiProviderAvailable) {
      deliverLocalReply('Mình chưa có kết nối Gemini. Kiểm tra API key hoặc server AI rồi thử lại nhé.');
      return;
    }

    const thinkingId = appendAiThinking();
    let replyEl = null;
    let replyText = '';
    try {
      const reply = await requestAiReply(chunk => {
        replyText += chunk;
        if (!replyEl) {
          document.getElementById(thinkingId)?.remove();
          replyEl = createAiMessageElement('assistant');
        }
        appendStreamChunk(replyEl, chunk);
      });
      if (!replyEl) {
        document.getElementById(thinkingId)?.remove();
        replyEl = appendAiMessage(reply, 'assistant');
      } else {
        setAiMessageContent(replyEl, reply, true);
      }
      const drawRequest = isDrawRequest(question);
      if (drawRequest && replyEl) {
        setAiMessageContent(replyEl, stripSvgFromText(reply), true);
        await appendSvgDiagram(replyEl, question);
      }
      aiConversation.push({ role: 'model', parts: [{ text: reply }] });
      aiConversation = aiConversation.slice(-8);
    } catch (error) {
      console.warn('Gemini request failed:', error);
      document.getElementById(thinkingId)?.remove();
      if (replyEl) replyEl.remove();
      const isQuota = /AI_(DAILY_LIMIT|QUOTA_COOLDOWN)/.test(String(error?.message));
      const errorReply = isQuota
        ? 'AI đã dùng hết lượt gọi trong ngày — thử lại sau vài phút nhé.'
        : 'Mình không gọi được Gemini (kiểm tra key hoặc kết nối mạng), thử lại nhé.';
      appendAiMessage(errorReply, 'assistant');
      aiConversation.push({ role: 'model', parts: [{ text: errorReply }] });
      aiConversation = aiConversation.slice(-8);
      updateAiProviderStatus(isQuota ? 'Gemini hết lượt gọi trong ngày (quota).' : 'Không gọi được Gemini — kiểm tra key hoặc kết nối mạng.');
} finally {
      aiBusy = false;
      setAiComposerBusy(false);
      renderAiWeakSubjects();
      if (window.AiProfile && typeof window.AiProfile.saveHistory === 'function') {
        window.AiProfile.saveHistory(aiConversation);
      }
    }
  }

function updateAiProviderStatus(errorMessage = '') {
    const statusLine = document.getElementById('ai-status-line');
    if (elements.aiProviderStatus) elements.aiProviderStatus.textContent = errorMessage || '';
    if (statusLine) statusLine.hidden = !errorMessage;
  }

  // --- TIẾT KIỆM LƯỢNG GỌI AI: ngân sách ngày ---
  // Xóa sạch cache trả lời cũ (không còn lưu câu trả lời lưu trước)
  try { localStorage.removeItem('edupulse_ai_reply_cache'); } catch (error) { /* ignore */ }
  const AI_DAILY_BUDGET_KEY = 'edupulse_ai_daily_usage';
  const AI_DAILY_BUDGET = 60;
  let aiQuotaCooldownUntil = 0;

  function getAiDailyUsage() {
    try {
      const data = JSON.parse(localStorage.getItem(AI_DAILY_BUDGET_KEY)) || {};
      const today = getLocalDateString();
      if (data.date !== today) return { date: today, count: 0 };
      return data;
    } catch (error) {
      return { date: getLocalDateString(), count: 0 };
    }
  }

  function incrementAiUsage() {
    const usage = getAiDailyUsage();
    usage.count += 1;
    localStorage.setItem(AI_DAILY_BUDGET_KEY, JSON.stringify(usage));
  }

  function isAiBudgetExhausted() {
    return getAiDailyUsage().count >= AI_DAILY_BUDGET;
  }

  function deliverLocalReply(text) {
    aiConversation.push({ role: 'model', parts: [{ text }] });
    aiConversation = aiConversation.slice(-8);
    window.setTimeout(() => {
      appendAiMessage(text, 'assistant');
      aiBusy = false;
      setAiComposerBusy(false);
      renderAiWeakSubjects();
      if (window.AiProfile && typeof window.AiProfile.saveHistory === 'function') {
        window.AiProfile.saveHistory(aiConversation);
      }
    }, 180);
  }

  async function checkServerAi() {
    if (aiProviderAvailable) return;
    try {
      const res = await fetch('/api/ai', { cache: 'no-store' });
      const data = await res.json();
      if (data?.available) {
        aiProviderAvailable = true;
        updateAiProviderStatus();
      }
    } catch (e) {
      /* no local API server available */
    }
  }

  function buildStudyContext() {
    return appState.exams.filter(isUpcomingExam).slice(0, 3)
      .map(exam => `${exam.title}: ${getDaysLeft(exam.date, exam.time)} ngày`).join('; ') || 'Chưa có kỳ thi nào được lưu.';
  }

async function requestAiReply(onToken) {
    const lastQuestion = aiConversation.filter(m => m.role === 'user').slice(-1)[0]?.parts?.[0]?.text || '';
    let studyContext = buildStudyContext();
    let hasRagContext = false;
    if (window.AiRag && typeof window.AiRag.buildContext === 'function') {
      try {
        const ragText = await window.AiRag.buildContext(lastQuestion);
        if (ragText) { studyContext += ragText; hasRagContext = true; }
      } catch (error) {
        console.warn('RAG context failed:', error);
      }
    }
    // Luôn bơm giờ Việt Nam hiện tại vào ngữ cảnh — AI biết ngày giờ để trả lời chính xác
    studyContext = getVietnamNow() + '\n' + studyContext;
    // Tra cứu web thời gian thực khi cần (nút 🌐 bật hoặc câu hỏi mang tính tra cứu)
    if (needsWebSearch(lastQuestion) && window.AiWeb && typeof window.AiWeb.search === 'function') {
      try {
        const web = await window.AiWeb.search(lastQuestion);
        if (web && web.found && web.text) {
          studyContext += '\n\n[THÔNG TIN TRA CỨU WEB — thời điểm: ' + new Date().toLocaleString('vi-VN') + ', nguồn: ' + web.source + ']\n' + web.text;
          console.info('[EduPulse] Web search:', web.source);
        }
      } catch (error) {
        console.warn('Web search failed:', error);
      }
    }
    // Model theo lựa chọn của người dùng: auto (heuristic) / groq / gemini
    const modelPref = getAiModelPreference();
    const tryGroq = modelPref === 'groq'
      ? Boolean(getCurrentGroqKey())
      : modelPref === 'gemini'
        ? false
        : !isComplexRequest(lastQuestion, hasRagContext) && Boolean(getCurrentGroqKey());
    console.info('[EduPulse] AI preference:', modelPref);
    if (tryGroq) {
      console.info('[EduPulse] AI provider:', 'groq');
      try {
        const text = await requestGroqReply(onToken, studyContext);
        if (text) return text;
        console.warn('[EduPulse] Groq trả về rỗng — fallback Gemini');
      } catch (error) {
        console.warn('[EduPulse] Groq fail:', error && error.message, '— fallback Gemini');
      }
    }
    console.info('[EduPulse] AI provider:', 'gemini');
    if (getCurrentGeminiKey()) {
      return requestGeminiReply(onToken, studyContext);
    }
    const response = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ history: aiConversation, studyContext })
    });
    if (!response.ok) throw new Error(`Server AI HTTP ${response.status}`);
    const data = await response.json();
    if (!data?.text) throw new Error('Server AI trả về nội dung rỗng.');
    return data.text;
  }

  // Giờ Việt Nam hiện tại (UTC+7) — bơm vào ngữ cảnh để AI trả lời đúng câu hỏi về giờ/ngày
  function getVietnamNow() {
    try {
      const now = new Date();
      return 'Giờ Việt Nam hiện tại: ' + now.toLocaleString('vi-VN', {
        weekday: 'long', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
        timeZone: 'Asia/Ho_Chi_Minh'
      });
    } catch (error) {
      return 'Giờ Việt Nam hiện tại: ' + new Date().toLocaleString('vi-VN');
    }
  }

  // Câu hỏi thuần về giờ/ngày — có sẵn trong context, không cần tra cứu web
  function isTimeQuestion(question) {
    const lower = (question || '').toLocaleLowerCase('vi-VN').trim();
    return /mấy giờ|\bgiờ\b|thứ mấy|ngày mấy|bây giờ|giờ hiện tại|thời gian hiện tại|hôm nay là|hôm nay ngày|hôm nay thứ|ngày hôm nay|mấy ngày nữa|hôm nay|hôm qua|ngày mai/.test(lower);
  }

  // Phát hiện câu hỏi cần tra cứu web thời gian thực (hoặc nút 🌐 đang bật)
  function needsWebSearch(question) {
    if (aiWebToggle) return true;
    const q = (question || '').trim();
    if (!q) return false;
    if (isTimeQuestion(q)) return false;
    const lower = q.toLocaleLowerCase('vi-VN');
    const liveKeywords = /hôm nay|mới nhất|gần đây|tin tức|thời sự|tin mới|hiện tại|hiện nay|thời tiết|nhiệt độ|giá vàng|tỷ giá|giá xăng|ai là|ai đang|tổng thống|thủ tướng|chủ tịch|bộ trưởng|vô địch|champion|sự kiện|diễn ra|bầu cử|world cup|olympic|kết quả|tỉ số|chung kết|thành lập|sinh năm|mất năm|ca sĩ|diễn viên|cầu thủ|tuyển thủ|nhà khoa học|được biết đến/.test(lower);
    if (liveKeywords) return true;
    if (/\b(19|20)\d{2}\b/.test(q)) return true;
    return /^(ai|gì|ở đâu|khi nào|bao nhiêu|mấy|nào|vì sao|tại sao|như thế nào)\b/.test(lower.trim());
  }

  // Phát hiện yêu cầu PHỨC TẠP → chuyển cho Gemini. Đơn giản → Groq cho nhanh.
  function isComplexRequest(question, hasRagContext) {
    const q = (question || '').trim();
    if (!q) return true;
    const lower = q.toLocaleLowerCase('vi-VN');
    if (hasRagContext) return true;
    if (q.length > 150) return true;
    // Môn cần suy luận (chip "Ôn giúp mình môn X")
    if (/môn (toán|ly|hoá|hóa)/i.test(lower)) return true;
    // Toán học / công thức
    if (/\$|\$\$/.test(q)) return true;
    if (/giải (phương trình|bài toán|bài tập)|phương trình|bất phương trình|đạo hàm|tích phân|nguyên hàm|công thức|chứng minh|hình học|tam giác|hệ phương trình|số học|đại số|giải thích (chi tiết|kỹ|cụ thể)/.test(lower)) return true;
    // Lập kế hoạch / mục tiêu / chi tiết
    if (/lập kế hoạch|kế hoạch ôn|lịch ôn|mục tiêu|tuần này|tuần tới|soạn|hướng dẫn từng bước|phân tích|tổng hợp|viết (bài|đoạn|luận)/.test(lower)) return true;
    return false;
  }

  async function requestGroqReply(onToken, studyContext, overrideMessages) {
    if (isAiBudgetExhausted()) {
      updateAiProviderStatus('Đã đạt giới hạn gọi AI hôm nay — thử lại sau vài phút.');
      throw new Error('AI_DAILY_LIMIT');
    }
    const controller = new AbortController();
    let idleTimer = null;
    const armIdleTimeout = () => {
      window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => controller.abort(), 30_000);
    };
    armIdleTimeout();
    const systemPrompt = `Bạn là trợ lý ôn thi EduPulse. Trả lời tiếng Việt ngắn gọn (100-150 từ), thực tế; không bịa dữ kiện; hướng dẫn cách làm, không làm hộ bài. Kỳ thi của học sinh: ${studyContext}. Khi được hỏi về giờ/ngày tháng, hãy dùng "Giờ Việt Nam hiện tại" trong ngữ cảnh — đừng nói "không truy cập được thời gian thực" vì bạn đã có sẵn ngày giờ. Khi bài cần hình vẽ (tam giác, đường cao, trung tuyến, trung điểm, góc vuông, đồ thị tọa độ...), KHÔNG tự vẽ SVG bằng tọa độ tự đặt (dễ sai hình học). Hãy thêm khối fenced gồm 3 backtick + chữ figure chứa JSON, app tự vẽ chính xác: {"kind":"triangle","altitude":"AH","median":"BM","rightAngle":"A","isosceles":true} hoặc {"kind":"coords","points":[{"label":"A","x":1,"y":2},{"label":"B","x":3,"y":5}],"lines":[["A","B"]]}. Chỉ khi hình phức tạp ngoài 2 kiểu trên mới xuất khối fenced 3 backtick + chữ svg vẽ tay.`;
    const messages = (Array.isArray(overrideMessages) && overrideMessages.length)
      ? overrideMessages
      : [
          { role: 'system', content: systemPrompt },
          ...aiConversation
            .map(m => ({ role: m.role === 'model' ? 'assistant' : 'user', content: (m.parts?.[0]?.text || '').trim() }))
            .filter(m => m.content)
        ];
    const maxRetries = 3;
    let retryCount = 0;
    let quotaHits = 0;
    try {
      while (retryCount < maxRetries) {
        const currentKey = getCurrentGroqKey();
        if (!currentKey) {
          retryCount++;
          await new Promise(resolve => setTimeout(resolve, 400 + retryCount * 400));
          continue;
        }
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentKey}` },
          body: JSON.stringify({
            model: 'openai/gpt-oss-20b',
            messages,
            temperature: 0.5,
            max_tokens: 2048,
            stream: true
          })
        });
        if (response.ok) {
          window.markGroqKeySuccess?.();
          incrementAiUsage();
          if (!response.body || typeof response.body.getReader !== 'function') throw new Error('Streaming not supported');
          const reader = response.body.getReader();
          const decoder = new TextDecoder('utf-8');
          let buffer = '';
          let full = '';
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            armIdleTimeout();
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed.startsWith('data:')) continue;
              const payload = trimmed.slice(5).trim();
              if (!payload || payload === '[DONE]') continue;
              try {
                const chunk = JSON.parse(payload);
                const delta = chunk.choices?.[0]?.delta?.content || '';
                if (delta) {
                  full += delta;
                  if (typeof onToken === 'function') onToken(delta);
                  armIdleTimeout();
                }
              } catch { /* ignore partial SSE frames */ }
            }
          }
          if (!full.trim()) throw new Error('Groq returned no text');
          return full;
        }
        console.warn(`Groq key failed with status ${response.status}, trying next key...`);
        window.markGroqKeyFailed?.(response.status);
        window.rotateGroqKey?.();
        if (response.status === 429) {
          quotaHits++;
          if (quotaHits >= 2) break;
        }
        await new Promise(resolve => setTimeout(resolve, 500 + retryCount * 500));
        retryCount++;
      }
    } catch (error) {
      throw error;
    }
    throw new Error('All Groq API keys exhausted');
  }

  function appendAiThinking() {
    const id = `ai-thinking-${Date.now()}`;
    elements.aiMessages.insertAdjacentHTML('beforeend', `<article class="ai-message assistant" id="${id}"><div class="ai-message-avatar"><i class="fa-solid fa-wand-magic-sparkles"></i></div><div class="ai-message-content ai-thinking"><i class="fa-solid fa-circle-notch fa-spin"></i> AI đang suy nghĩ…</div></article>`);
    elements.aiMessages.scrollTop = elements.aiMessages.scrollHeight;
    return id;
  }

async function requestGeminiReply(onToken, studyContext, overrideContents, overrideSystem) {
    if (isAiBudgetExhausted()) {
      updateAiProviderStatus('Đã đạt giới hạn gọi Gemini hôm nay — thử lại sau vài phút.');
      throw new Error('AI_DAILY_LIMIT');
    }
    if (Date.now() < aiQuotaCooldownUntil) {
      throw new Error('AI_QUOTA_COOLDOWN');
    }
    const controller = new AbortController();
    let idleTimer = null;
    const armIdleTimeout = () => {
      window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => controller.abort(), 30_000);
    };
    armIdleTimeout();
    // Giới hạn số lần thử để tránh đốt quota khi lỗi diện rộng
    const maxRetries = 3;
    let retryCount = 0;
    let quotaHits = 0;
    try {
      while (retryCount < maxRetries) {
      const currentKey = getCurrentGeminiKey();
      if (!currentKey) {
        // Tất cả key đang trong cooldown — chờ rồi thử lại, không gọi bừa
        retryCount++;
        await new Promise(resolve => setTimeout(resolve, 400 + retryCount * 400));
        continue;
      }
      const payload = {
        systemInstruction: { parts: [{ text: overrideSystem || `Bạn là trợ lý ôn thi EduPulse. Trả lời tiếng Việt ngắn gọn (100-150 từ), thực tế; không bịa dữ kiện; hướng dẫn cách làm, không làm hộ bài. Kỳ thi của học sinh: ${studyContext}. Công thức toán phải bọc trong $...$ (trong dòng) hoặc $$...$$ (riêng dòng); tuyệt đối không viết LaTeX trần ngoài cặp dấu $. Khi được hỏi về giờ/ngày tháng, hãy dùng "Giờ Việt Nam hiện tại" trong ngữ cảnh — đừng nói "không truy cập được thời gian thực" vì bạn đã có sẵn ngày giờ. Khi bài cần hình vẽ (tam giác, đường cao, trung tuyến, trung điểm, góc vuông, đồ thị tọa độ...), KHÔNG tự vẽ SVG bằng tọa độ tự đặt (dễ sai hình học). Hãy thêm khối fenced gồm 3 backtick + chữ figure chứa JSON, app tự vẽ chính xác: {"kind":"triangle","altitude":"AH","median":"BM","rightAngle":"A","isosceles":true} hoặc {"kind":"coords","points":[{"label":"A","x":1,"y":2},{"label":"B","x":3,"y":5}],"lines":[["A","B"]]}. Chỉ khi hình phức tạp ngoài 2 kiểu trên mới xuất khối fenced 3 backtick + chữ svg vẽ tay.` }] },
        contents: (Array.isArray(overrideContents) && overrideContents.length) ? overrideContents : aiConversation,
        generationConfig: {
          temperature: 0.5,
          maxOutputTokens: 2048
        }
      };
      const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:streamGenerateContent?alt=sse', {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': currentKey },
        body: JSON.stringify(payload)
      });
      if (response.ok) {
        updateAiProviderStatus();
        window.markApiKeySuccess?.();
        incrementAiUsage();
        if (!response.body || typeof response.body.getReader !== 'function') throw new Error('Streaming not supported');
        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';
        let full = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          armIdleTimeout();
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop();
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const payload = trimmed.slice(5).trim();
            if (!payload || payload === '[DONE]') continue;
            try {
              const chunk = JSON.parse(payload);
              const parts = chunk.candidates?.[0]?.content?.parts || [];
              for (const part of parts) {
                if (part.text) {
                  full += part.text;
                  if (typeof onToken === 'function') onToken(part.text);
                  armIdleTimeout();
                }
              }
            } catch { /* ignore partial SSE frames */ }
          }
        }
        if (buffer.trim()) {
          const payload = buffer.trim().slice(5).trim();
          if (payload && payload !== '[DONE]') {
            try {
              const chunk = JSON.parse(payload);
              const parts = chunk.candidates?.[0]?.content?.parts || [];
              for (const part of parts) {
                if (part.text) full += part.text;
              }
            } catch { /* ignore */ }
          }
        }
        if (!full.trim()) throw new Error('Gemini returned no text');
        return full;
      }
      // Key failed, try next one
      console.warn(`Gemini key failed with status ${response.status}, trying next key...`);
      window.markApiKeyFailed?.(response.status);
      window.rotateApiKey?.();
      if (response.status === 429) {
        // Quota chung cho cả project — nếu 429 liên tiếp thì dừng hẳn, không đốt thêm lượt gọi
        quotaHits++;
        if (quotaHits >= 2) {
          aiQuotaCooldownUntil = Date.now() + 60_000;
          break;
        }
      }
      await new Promise(resolve => setTimeout(resolve, 500 + retryCount * 500));
      retryCount++;
      }
    } catch (error) {
      throw error;
    }
    throw new Error('All Gemini API keys exhausted');
  }

  function createAiMessageElement(role) {
    const icon = role === 'assistant' ? '<i class="fa-solid fa-wand-magic-sparkles"></i>' : '<i class="fa-solid fa-user"></i>';
    const el = document.createElement('article');
    el.className = `ai-message ${role}`;
    el.innerHTML = `<div class="ai-message-avatar">${icon}</div><div class="ai-message-content"><p></p></div>`;
    elements.aiMessages.appendChild(el);
    elements.aiMessages.scrollTop = elements.aiMessages.scrollHeight;
    return el;
  }

  async function setAiMessageContent(el, text, useMath) {
    const contentEl = el.querySelector('.ai-message-content p');
    if (contentEl) {
      if (useMath && text && /[\\$]/.test(text) && !window.katex) {
        await ensureKatex();
      }
      contentEl.innerHTML = formatAiText(text, useMath);
    }
    elements.aiMessages.scrollTop = elements.aiMessages.scrollHeight;
  }

  function appendStreamChunk(el, chunk) {
    const contentEl = el.querySelector('.ai-message-content p');
    if (!contentEl) return;
    const safe = chunk.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
    contentEl.insertAdjacentHTML('beforeend', safe);
    elements.aiMessages.scrollTop = elements.aiMessages.scrollHeight;
  }

function appendAiMessage(text, role) {
    const el = createAiMessageElement(role);
    setAiMessageContent(el, text);
    return el;
  }

  // --- AI PROFILE (lịch sử, môn học, greeting, báo cáo) ---
  async function renderAiWeakSubjects() {
    const container = document.getElementById('ai-weak-subjects');
    if (!container) return;
    if (!window.AiProfile) { container.hidden = true; return; }
    try {
      const weak = await window.AiProfile.getWeakSubjects(2);
      if (!weak.length) { container.hidden = true; return; }
      container.innerHTML = '<span class="ai-weak-label">Môn cần ôn:</span>' + weak.map(subject =>
        `<button type="button">${escapeHtml(subject)}</button>`
      ).join('');
      container.hidden = false;
      container.querySelectorAll('button').forEach(button => {
        button.addEventListener('click', () => {
          openTab('tab-ai');
          if (elements.aiInput) elements.aiInput.value = `Ôn giúp mình môn ${button.textContent} hôm nay`;
        });
      });
    } catch (error) {
      container.hidden = true;
    }
  }

  async function restoreAiHistory() {
    if (!window.AiProfile) return;
    try {
      const history = await window.AiProfile.loadHistory();
      if (history.length) {
        elements.aiMessages.innerHTML = '';
        history.forEach(msg => {
          const text = msg.parts?.[0]?.text || '';
          if (!text) return;
          appendAiMessage(text, msg.role === 'user' ? 'user' : 'assistant');
        });
      } else {
        const greeting = await window.AiProfile.getDailyGreeting();
        const welcome = elements.aiMessages.querySelector('.ai-message.assistant .ai-message-content p');
        if (welcome) welcome.textContent = greeting;
      }
    } catch (error) {
      console.warn('Restore AI history failed:', error);
    }
    renderAiWeakSubjects();
  }

  const aiClearHistoryBtn = document.getElementById('ai-clear-history');
  if (aiClearHistoryBtn) {
    aiClearHistoryBtn.addEventListener('click', async () => {
      if (!window.AiProfile) return;
      const ok = await showConfirmDialog({
        title: '<i class="fa-solid fa-eraser"></i> Xóa lịch sử AI',
        message: 'Xóa toàn bộ lịch sử trò chuyện với AI?',
        confirmText: 'Xóa',
        danger: true
      });
      if (!ok) return;
      aiConversation = [];
      await window.AiProfile.clearHistory();
      elements.aiMessages.innerHTML = '';
      const greeting = await window.AiProfile.getDailyGreeting();
      appendAiMessage(greeting, 'assistant');
    });
  }

  // ---------- AI DIAGNOSTIC: PHÂN TÍCH ĐIỂM YẾU ----------
  async function buildDiagnosticContext() {
    const lines = [];
    const study = window.EduPulseStudy;
    const stats = (window.EDUPULSE_APP && typeof window.EDUPULSE_APP.getStudyStats === 'function')
      ? window.EDUPULSE_APP.getStudyStats()
      : null;
    const fmt = (obj) => {
      const entries = Object.entries(obj || {}).sort((a, b) => b[1] - a[1]);
      return entries.length ? entries.map(([s, m]) => `${s} ${m} phút`).join(', ') : '(chưa có dữ liệu)';
    };
    const subj7 = study ? study.getSubjectMinutes(7) : {};
    const subj14 = study ? study.getSubjectMinutes(14) : {};
    lines.push('Phút học mỗi môn 7 ngày qua: ' + fmt(subj7));
    lines.push('Phút học mỗi môn 14 ngày qua: ' + fmt(subj14));
    const weekTotal = Object.values(subj7).reduce((s, m) => s + m, 0);
    lines.push('Tổng thời gian học 7 ngày: ' + weekTotal + ' phút' + (weekTotal ? ('; trung bình ' + Math.round(weekTotal / 7) + ' phút/ngày') : ''));
    if (stats) lines.push('Chuỗi ngày học liên tiếp: ' + stats.streak + ' ngày (kỷ lục ' + stats.record + ')');
    let weak = [];
    if (window.AiProfile && typeof window.AiProfile.getWeakSubjects === 'function') {
      try { weak = (await window.AiProfile.getWeakSubjects(3)) || []; } catch (e) { weak = []; }
    }
    lines.push('Môn học yếu (hay sai câu hỏi AI): ' + (weak.length ? weak.join(', ') : 'chưa xác định'));
    const exams = appState.exams
      .filter(isUpcomingExam)
      .sort((a, b) => (a.date + ' ' + (a.time || '')) < (b.date + ' ' + (b.time || '')) ? -1 : 1)
      .slice(0, 3);
    lines.push('Kỳ thi sắp tới: ' + (exams.length
      ? exams.map(e => `${e.title} — còn ${getDaysLeft(e.date, e.time)} ngày`).join('; ')
      : 'chưa có'));
    if (study) {
      const goals = study.getGoals();
      lines.push('Mục tiêu ôn tập: ' + (goals.weeklyMinutes || 300) + ' phút/tuần; môn trọng tâm: ' + (goals.subject || 'chưa đặt'));
    }
    return lines.join('\n');
  }

  async function buildLocalDiagnostic() {
    const study = window.EduPulseStudy;
    const subj7 = study ? study.getSubjectMinutes(7) : {};
    const entries = Object.entries(subj7).sort((a, b) => b[1] - a[1]);
    const lines = [];
    lines.push('Phân tích nhanh (chưa gọi được AI):');
    lines.push('');
    if (!entries.length) {
      lines.push('Bạn chưa có nhật ký học tập. Hãy dùng "Ghi nhận" trong tab Học để tạo dữ liệu — AI sẽ phân tích chính xác hơn.');
    } else {
      const weekTotal = entries.reduce((s, [, m]) => s + m, 0);
      lines.push('• Môn tốn thời gian nhất: ' + entries[0][0] + ' (' + entries[0][1] + ' phút / ' + weekTotal + ' phút trong 7 ngày).');
      let weak = [];
      if (window.AiProfile && typeof window.AiProfile.getWeakSubjects === 'function') {
        try { weak = (await window.AiProfile.getWeakSubjects(3)) || []; } catch (e) { weak = []; }
      }
      const weakSet = new Set(weak);
      const overlap = entries.filter(([s]) => weakSet.has(s));
      const neglect = entries.slice().reverse().find(([s]) => s && !weakSet.has(s));
      if (weak.length) lines.push('• Môn yếu cần tăng thời gian: ' + weak.join(', ') + '.');
      if (overlap.length) lines.push('  → Môn "' + overlap[0][0] + '" vừa tốn thời gian vừa chưa hiệu quả — hãy đổi phương pháp thay vì tăng giờ.');
      if (neglect) lines.push('• Đang bỏ bê: ' + neglect[0] + ' (' + (neglect[1] || 0) + ' phút) — nếu là môn thi, nên bổ sung ít nhất 30 phút/ngày.');
      lines.push('• Gợi ý chung: dành ~60% thời gian cho môn yếu + môn thi gần nhất, 40% còn lại cho các môn khác; ưu tiên ôn sớm để không dồn vào tuần cuối.');
    }
    lines.push('');
    lines.push('Mẹo: bấm lại để thử bản phân tích chi tiết từ AI.');
    return lines.join('\n');
  }

  async function requestAiDiagnostic(onToken) {
    if (isAiBudgetExhausted()) throw new Error('AI_DAILY_LIMIT');
    const context = await buildDiagnosticContext();
    const systemPrompt = 'Bạn là chuyên gia phân tích học tập của EduPulse. Dựa vào nhật ký học tập (phút/môn), môn yếu và lịch thi của học sinh, hãy: 1) Nhận xét ngắn về cách phân bổ thời gian hiện tại (môn nào chiếm quá nhiều/ít, có khớp với môn yếu và môn thi không); 2) Đề xuất phân bổ lại thời gian hợp lý (nêu phút cụ thể mỗi môn/ngày); 3) 1-2 mẹo tăng hiệu quả ôn. Trả lời tiếng Việt, có cấu trúc (tiêu đề nhỏ dùng **kép**, gạch đầu dòng •), khoảng 180-260 từ, thực tế, chỉ dựa vào dữ liệu được cung cấp — không bịa số liệu.';
    const userText = 'Đây là dữ liệu học tập của tôi:\n' + context;
    const pref = getAiModelPreference();
    const useGroq = pref === 'groq' && getCurrentGroqKey();
    console.info('[EduPulse] AI diagnostic provider:', useGroq ? 'groq' : 'gemini');
    if (useGroq) {
      try {
        return await requestGroqReply(onToken, '', [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userText }
        ]);
      } catch (err) {
        console.warn('[EduPulse] Groq diagnostic failed, trying Gemini:', err && err.message);
      }
    }
    if (getCurrentGeminiKey()) {
      return requestGeminiReply(onToken, '', [{ role: 'user', parts: [{ text: userText }] }], systemPrompt);
    }
    throw new Error('NO_AI_KEY');
  }

  const diagnosticButtons = ['btn-ai-diagnostic', 'btn-open-ai-report'];
  diagnosticButtons.forEach((btnId) => {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.addEventListener('click', () => {
      const contentEl = document.getElementById('ai-report-content');
      openModal('modal-ai-report');
      if (!contentEl) return;
      contentEl.textContent = '🧠 AI đang phân tích nhật ký học tập và kỳ thi của bạn…';
      let acc = '';
      requestAiDiagnostic((tok) => {
        acc += tok;
        contentEl.textContent = acc;
      }).then(() => {
        if (!acc.trim()) contentEl.textContent = window.AiProfile && typeof window.AiProfile.buildWeeklyReport === 'function'
          ? window.AiProfile.buildWeeklyReport()
          : 'Chưa có dữ liệu để báo cáo.';
      }).catch((err) => {
        console.warn('[EduPulse] Diagnostic failed, fallback local:', err && err.message);
        buildLocalDiagnostic().then((t) => { contentEl.textContent = t; }).catch(() => {
          contentEl.textContent = window.AiProfile && typeof window.AiProfile.buildWeeklyReport === 'function'
            ? window.AiProfile.buildWeeklyReport()
            : 'Chưa có dữ liệu để báo cáo.';
        });
      });
    });
  });

  // ---------- TÙY CHỈNH NỘI DUNG WIDGET ----------
  const WIDGET_ICON_OPTIONS = [
    { value: 'fa-regular fa-comments', label: 'Hội thoại' },
    { value: 'fa-solid fa-book-bookmark', label: 'Tài liệu' },
    { value: 'fa-solid fa-fire', label: 'Động lực' },
    { value: 'fa-solid fa-users', label: 'Nhóm bạn' },
    { value: 'fa-solid fa-bullhorn', label: 'Thông báo' },
    { value: 'fa-solid fa-star', label: 'Nổi bật' },
    { value: 'fa-solid fa-graduation-cap', label: 'Tốt nghiệp' },
    { value: 'fa-solid fa-pen', label: 'Ôn luyện' },
    { value: 'fa-solid fa-calendar-check', label: 'Lịch học' }
  ];
  const WIDGET_TAB_OPTIONS = [
    { value: 'tab-chat', label: 'Phòng chat' },
    { value: 'tab-ai', label: 'Trợ lý AI' },
    { value: 'tab-exams', label: 'Kỳ thi' },
    { value: 'tab-library', label: 'Tài liệu' },
    { value: 'tab-account', label: 'Tài khoản' }
  ];

  function renderWidgetSettingsItems(items) {
    const container = document.getElementById('ws-community-items');
    if (!container) return;
    const iconOptions = WIDGET_ICON_OPTIONS.map(o => `<option value="${o.value}">${o.label}</option>`).join('');
    const tabOptions = WIDGET_TAB_OPTIONS.map(o => `<option value="${o.value}">${o.label}</option>`).join('');
    container.innerHTML = items.map((item, index) => `
      <div class="ws-item-row">
        <label class="ws-field ws-toggle">
          <input type="checkbox" class="ws-item-enabled" data-i="${index}" ${item.enabled ? 'checked' : ''}>
          <span>Widget con ${index + 1} — hiển thị</span>
        </label>
        <label class="ws-field"><span>Biểu tượng</span>
          <select class="form-input-control ws-item-icon" data-i="${index}">
            ${iconOptions.replace(`value="${escapeHtml(item.icon || 'fa-regular fa-comments')}"`, `value="${escapeHtml(item.icon || 'fa-regular fa-comments')}" selected`)}
          </select>
        </label>
        <label class="ws-field"><span>Nội dung ({n} = số liệu thực, hoặc viết chữ cố định)</span>
          <input type="text" class="form-input-control ws-item-text" data-i="${index}" value="${escapeHtml(item.text || '')}" maxlength="80">
        </label>
        <label class="ws-field"><span>Chạm để mở</span>
          <select class="form-input-control ws-item-tab" data-i="${index}">
            ${tabOptions.replace(`value="${escapeHtml(item.tab || 'tab-chat')}"`, `value="${escapeHtml(item.tab || 'tab-chat')}" selected`)}
          </select>
        </label>
      </div>`).join('');
  }

  function openWidgetSettings() {
    const w = getWidgets();
    const setVal = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.value = value;
    };
    setVal('ws-greeting-title', w.greetingTitle);
    setVal('ws-greeting-sub', w.greetingSub);
    setVal('ws-exams-title', w.examsPanelTitle);
    const checkVal = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.checked = !!value;
    };
    checkVal('ws-hero-enabled', w.showHero);
    checkVal('ws-exams-enabled', w.showExamsPanel);
    checkVal('ws-schedule-enabled', w.showSchedule);
    openModal('modal-widget-settings');
  }

  function saveWidgetSettings() {
    const val = id => (document.getElementById(id) || {}).value ?? '';
    const checked = id => !!(document.getElementById(id) || {}).checked;
    appState.widgets = {
      ...getWidgets(),
      greetingTitle: val('ws-greeting-title') || DEFAULT_WIDGETS.greetingTitle,
      greetingSub: val('ws-greeting-sub') || DEFAULT_WIDGETS.greetingSub,
      showHero: checked('ws-hero-enabled'),
      showExamsPanel: checked('ws-exams-enabled'),
      examsPanelTitle: val('ws-exams-title') || DEFAULT_WIDGETS.examsPanelTitle,
      showSchedule: checked('ws-schedule-enabled')
    };
    saveState();
    applyWidgetConfig();
    closeModal('modal-widget-settings');
    showToast('Đã lưu tùy chỉnh trang chủ.');
  }

  function resetWidgetSettings() {
    appState.widgets = JSON.parse(JSON.stringify(DEFAULT_WIDGETS));
    saveState();
    applyWidgetConfig();
    closeModal('modal-widget-settings');
    showToast('Đã khôi phục trang chủ mặc định.');
  }

  const widgetOpenBtns = document.querySelectorAll('#btn-open-widget-settings, #btn-mobile-widget-settings, #btn-open-widget-settings-account');
  widgetOpenBtns.forEach(btn => btn.addEventListener('click', openWidgetSettings));
  const widgetSaveBtn = document.getElementById('btn-widget-save');
  if (widgetSaveBtn) widgetSaveBtn.addEventListener('click', saveWidgetSettings);
  const widgetResetBtn = document.getElementById('btn-widget-reset');
  if (widgetResetBtn) widgetResetBtn.addEventListener('click', resetWidgetSettings);

// Trích xuất sơ đồ SVG mà AI kèm trong khối ```svg (hoặc thẻ <svg> trần) →
// thay bằng placeholder, render lại sau qua <img data:image/svg+xml> (an toàn, không chạy script).
  function extractSvgDiagrams(text) {
    const diagrams = [];
    if (!text) return { safeText: text, diagrams };
    const sanitizeSvg = (svg) => {
      if (!svg) return '';
      let s = svg
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
        .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
        .replace(/<object[\s\S]*?<\/object>/gi, '')
        .replace(/<embed[\s\S]*?\/?>/gi, '')
        .replace(/\son\w+\s*=\s*(['"])[\s\S]*?\1/gi, '')
        .replace(/\s(xlink:)?href\s*=\s*(['"])[\s\S]*?\2/gi, '')
        .replace(/\ssrc\s*=\s*(['"])[\s\S]*?\1/gi, '');
      const tagRe = /<\s*svg([^>]*)>/i;
      const tagM = tagRe.exec(s);
      if (tagM) {
        const vb = /viewBox\s*=\s*["']\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)["']/i.exec(tagM[1]);
        const vbW = vb ? parseFloat(vb[3]) : 0;
        const vbH = vb ? parseFloat(vb[4]) : 0;
        const hasW = /\swidth=/i.test(tagM[1]);
        const hasH = /\sheight=/i.test(tagM[1]);
        if (!vb) {
          s = s.replace(tagRe, '<svg$1 viewBox="0 0 360 240" width="360" height="240">');
        } else {
          const wm = /\swidth=["']([\d.]+)["']/i.exec(tagM[1]);
          const curW = wm ? parseFloat(wm[1]) : Math.min(400, Math.max(120, Math.round(vbW)));
          if (!hasW) s = s.replace(tagRe, '<svg$1 width="' + curW + '">');
          if (!hasH) {
            const h = Math.max(60, Math.round(curW * (vbH / vbW)));
            s = s.replace(tagRe, '<svg$1 height="' + h + '">');
          }
        }
      }
      return s;
    };
    let safe = text.replace(/```figure\s*\n?([\s\S]*?)```/gi, (match, jsonBody) => {
      let svg = '';
      try {
        const spec = JSON.parse((jsonBody || '').trim());
        svg = renderFigureSpec(spec);
      } catch (error) { svg = ''; }
      if (!svg) return match;
      const cleaned = sanitizeSvg(svg);
      if (!cleaned) return match;
      const id = diagrams.length;
      diagrams.push({ id, svg: cleaned });
      return '[[SVG:' + id + ']]';
    });
    safe = safe.replace(/<\s*svg[\s\S]*?<\/svg>/gi, (match) => {
      const svg = sanitizeSvg(match);
      if (!svg) return match;
      const id = diagrams.length;
      diagrams.push({ id, svg });
      return '[[SVG:' + id + ']]';
    });
    safe = safe.replace(/```(svg|html|xml|figure)?\s*/gi, '').replace(/```/g, '');
    safe = safe.replace(/\n?<svg[^>]*>\s*\n?[\s\S]*?(?=\n\s*\n|$)/gi, '').replace(/<\/svg>/gi, '');
    return { safeText: safe, diagrams };
  }

  function svgToDataUri(svg) {
    return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
  }

  function renderFigureSpec(spec) {
    if (!spec || typeof spec !== 'object') return '';
    if (spec.kind === 'triangle') return renderTriangleFigure(spec);
    if (spec.kind === 'coords') return renderCoordsFigure(spec);
    return '';
  }

  function labelAt(p, text, color, dx, dy) {
    return '<text x="' + (p[0] + (dx == null ? 7 : dx)) + '" y="' + (p[1] + (dy == null ? -8 : dy)) + '" font-size="14" font-weight="bold" fill="' + color + '" font-family="sans-serif">' + escapeHtml(String(text)) + '</text>';
  }

  function projectPointOnSegment(P, A, B) {
    const dx = B[0] - A[0], dy = B[1] - A[1];
    const len2 = dx * dx + dy * dy;
    if (!len2) return A;
    const t = ((P[0] - A[0]) * dx + (P[1] - A[1]) * dy) / len2;
    return [Math.round(A[0] + t * dx), Math.round(A[1] + t * dy)];
  }

  function rightAngleMark(V, P, Q) {
    const s = 11;
    const u = (v) => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };
    const u1 = u([P[0] - V[0], P[1] - V[1]]);
    const u2 = u([Q[0] - V[0], Q[1] - V[1]]);
    const p1 = [V[0] + u1[0] * s, V[1] + u1[1] * s];
    const p2 = [V[0] + u2[0] * s, V[1] + u2[1] * s];
    const corner = [V[0] + (u1[0] + u2[0]) * s, V[1] + (u1[1] + u2[1]) * s];
    return '<path d="M ' + p1[0] + ' ' + p1[1] + ' L ' + corner[0] + ' ' + corner[1] + ' L ' + p2[0] + ' ' + p2[1] + '" fill="none" stroke="#1e293b" stroke-width="1.4"/>';
  }

  function renderTriangleFigure(spec) {
    const W = 320, H = 240;
    const baseY = 188;
    const rightAngle = String(spec.rightAngle || '').toUpperCase();
    let A, B, C;
    if (rightAngle === 'A') { A = [72, 48]; B = [72, baseY]; C = [268, 48]; }
    else if (rightAngle === 'B') { A = [72, baseY]; B = [72, 48]; C = [268, baseY]; }
    else if (rightAngle === 'C') { A = [72, 48]; B = [268, baseY]; C = [268, 48]; }
    else if (spec.equilateral) {
      const half = 92, cx = 160;
      A = [cx, Math.round(baseY - half * Math.sqrt(3))];
      B = [cx - half, baseY]; C = [cx + half, baseY];
    } else {
      A = [160, 42]; B = [55, baseY]; C = [265, baseY];
    }
    const pt = (p) => p[0] + ',' + p[1];
    const els = [];
    els.push('<polygon points="' + pt(A) + ' ' + pt(B) + ' ' + pt(C) + '" fill="#eef3ff" stroke="#1e293b" stroke-width="2"/>');
    const vMap = { A: A, B: B, C: C };
    const side = { A: [B, C], B: [A, C], C: [A, B] };
    const alt = String(spec.altitude || '');
    if (alt && vMap[alt[0]] && side[alt[0]]) {
      const V = vMap[alt[0]];
      const sidePt = side[alt[0]];
      const foot = projectPointOnSegment(V, sidePt[0], sidePt[1]);
      els.push('<line x1="' + V[0] + '" y1="' + V[1] + '" x2="' + foot[0] + '" y2="' + foot[1] + '" stroke="#dc2626" stroke-width="1.8" stroke-dasharray="5,4"/>');
      els.push(rightAngleMark(foot, V, sidePt[0]));
      els.push(labelAt(foot, alt[1], '#dc2626', 9, 16));
    }
    const med = String(spec.median || '');
    if (med && vMap[med[0]] && side[med[0]]) {
      const V = vMap[med[0]];
      const sidePt = side[med[0]];
      const M = [(sidePt[0][0] + sidePt[1][0]) / 2, (sidePt[0][1] + sidePt[1][1]) / 2];
      els.push('<line x1="' + V[0] + '" y1="' + V[1] + '" x2="' + M[0] + '" y2="' + M[1] + '" stroke="#2563eb" stroke-width="1.8" stroke-dasharray="2,3"/>');
      els.push(labelAt(M, med[1], '#2563eb', 7, -8));
    }
    if (rightAngle && vMap[rightAngle]) {
      const V = vMap[rightAngle];
      els.push(rightAngleMark(V, side[rightAngle][0], side[rightAngle][1]));
    }
    els.push(labelAt(A, 'A', '#1e293b', 6, -10));
    els.push(labelAt(B, 'B', '#1e293b', -14, 18));
    els.push(labelAt(C, 'C', '#1e293b', 8, 18));
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '"><g>' + els.join('') + '</g></svg>';
  }

  function niceStep(range) {
    if (!range || range <= 0) return 1;
    const pow = Math.pow(10, Math.floor(Math.log10(range)));
    const d = range / pow;
    let step;
    if (d <= 1) step = 1; else if (d <= 2) step = 2; else if (d <= 5) step = 5; else step = 10;
    return step * pow;
  }

  function renderCoordsFigure(spec) {
    const W = 320, H = 240, m = 46;
    const points = (Array.isArray(spec.points) ? spec.points : []).filter(p => p && typeof p.x === 'number' && typeof p.y === 'number');
    if (!points.length) return '';
    const byLabel = {};
    points.forEach(p => { byLabel[p.label] = [p.x, p.y]; });
    let xs = points.map(p => p.x).concat([0]);
    let ys = points.map(p => p.y).concat([0]);
    let xmin = Math.min.apply(null, xs), xmax = Math.max.apply(null, xs);
    let ymin = Math.min.apply(null, ys), ymax = Math.max.apply(null, ys);
    if (xmin === xmax) { xmin -= 1; xmax += 1; }
    if (ymin === ymax) { ymin -= 1; ymax += 1; }
    const pad = (xmax - xmin) * 0.12;
    xmin -= pad; xmax += pad; ymin -= pad; ymax += pad;
    const sx = (x) => m + (x - xmin) * (W - 2 * m) / (xmax - xmin);
    const sy = (y) => H - m - (y - ymin) * (H - 2 * m) / (ymax - ymin);
    const els = [];
    const step = niceStep((xmax - xmin) / 5);
    for (let gx = Math.ceil(xmin / step) * step; gx <= xmax; gx += step) {
      els.push('<line x1="' + sx(gx).toFixed(1) + '" y1="' + sy(ymin).toFixed(1) + '" x2="' + sx(gx).toFixed(1) + '" y2="' + sy(ymax).toFixed(1) + '" stroke="#e2e8f0" stroke-width="1"/>');
    }
    for (let gy = Math.ceil(ymin / step) * step; gy <= ymax; gy += step) {
      els.push('<line x1="' + sx(xmin).toFixed(1) + '" y1="' + sy(gy).toFixed(1) + '" x2="' + sx(xmax).toFixed(1) + '" y2="' + sy(gy).toFixed(1) + '" stroke="#e2e8f0" stroke-width="1"/>');
    }
    const originX = sx(0), originY = sy(0);
    els.push('<line x1="' + m + '" y1="' + originY.toFixed(1) + '" x2="' + (W - m) + '" y2="' + originY.toFixed(1) + '" stroke="#475569" stroke-width="1.6"/>');
    els.push('<line x1="' + originX.toFixed(1) + '" y1="' + m + '" x2="' + originX.toFixed(1) + '" y2="' + (H - m) + '" stroke="#475569" stroke-width="1.6"/>');
    els.push('<polygon points="' + (W - m - 9) + ',' + (originY - 5) + ' ' + (W - m - 9) + ',' + (originY + 5) + ' ' + (W - m) + ',' + originY + '" fill="#475569"/>');
    els.push('<polygon points="' + (originX - 5) + ',' + (m + 9) + ' ' + (originX + 5) + ',' + (m + 9) + ' ' + originX + ',' + m + '" fill="#475569"/>');
    if (spec.xLabel) els.push('<text x="' + (W - m - 4) + '" y="' + (originY - 9) + '" font-size="13" font-style="italic" fill="#475569">' + escapeHtml(spec.xLabel) + '</text>');
    if (spec.yLabel) els.push('<text x="' + (originX + 9) + '" y="' + (m + 14) + '" font-size="13" font-style="italic" fill="#475569">' + escapeHtml(spec.yLabel) + '</text>');
    const lines = Array.isArray(spec.lines) ? spec.lines : [];
    for (const l of lines) {
      if (l && l.length >= 2 && byLabel[l[0]] && byLabel[l[1]]) {
        const p1 = byLabel[l[0]], p2 = byLabel[l[1]];
        els.push('<line x1="' + sx(p1[0]).toFixed(1) + '" y1="' + sy(p1[1]).toFixed(1) + '" x2="' + sx(p2[0]).toFixed(1) + '" y2="' + sy(p2[1]).toFixed(1) + '" stroke="#2563eb" stroke-width="2"/>');
      }
    }
    points.forEach(p => {
      const x = sx(p.x), y = sy(p.y);
      els.push('<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="3.4" fill="#dc2626" stroke="#fff" stroke-width="1"/>');
      els.push('<text x="' + (x + 7).toFixed(1) + '" y="' + (y - 7).toFixed(1) + '" font-size="14" font-weight="bold" fill="#1e293b" font-family="sans-serif">' + escapeHtml(String(p.label)) + '</text>');
    });
    if (spec.title) els.push('<text x="' + (W / 2) + '" y="' + (H - 8) + '" text-anchor="middle" font-size="13" fill="#334155">' + escapeHtml(spec.title) + '</text>');
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '"><g>' + els.join('') + '</g></svg>';
  }

function formatAiText(text, useMath) {
    if (!text) return '';
    const svgExtract = extractSvgDiagrams(text);
    const body = svgExtract.safeText;
    let out;
    if (useMath && window.katex && /[\\$]/.test(body)) {
        out = renderMathText(body);
    } else {
        let safe = fixLatex(body);
        safe = escapeHtml(safe);
        // Render the small Markdown subset commonly returned by Gemini while keeping all AI text escaped.
        safe = safe.replace(/`([^`\n]+)`/g, '<code>$1</code>');
        safe = safe.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
        safe = safe.replace(/\*\*/g, '');
        safe = safe.replace(/\n/g, '<br>');
        out = safe;
    }
    if (svgExtract.diagrams.length) {
      for (const d of svgExtract.diagrams) {
        const tag = '<span class="ai-diagram-wrap">' + d.svg + '</span>';
        out = out.replace('[[SVG:' + d.id + ']]', tag);
      }
    }
    return out;
}

  function renderMathText(text) {
    let out = '';
    const segments = text.split(/(\$\$[\s\S]+?\$\$|\$[^$\n]+\$|\\\[[\s\S]+?\\\]|\\\([^\\]+?\\\))/g);
    for (const segment of segments) {
      if (!segment) continue;
      const isBlock = /^\$\$[\s\S]+\$\$$/.test(segment);
      const isInline = /^\$[^$\n]+\$$/.test(segment) || /^\\\(.+\\\)$/.test(segment);
      if (isBlock || isInline) {
        const latex = segment
          .replace(/^\$\$/, '').replace(/\$\$$/, '')
          .replace(/^\$/, '').replace(/\$$/, '')
          .replace(/^\\\[/, '').replace(/\\\]$/, '')
          .replace(/^\\\(/, '').replace(/\\\)$/, '')
          .trim();
        try {
          out += window.katex.renderToString(latex, { throwOnError: true, displayMode: isBlock, output: 'html' });
          continue;
        } catch {
          /* fall through to escaped literal */
        }
      }
      out += formatPlainLatex(segment);
    }
    return out;
  }

  // Convert bare LaTeX fragments (written WITHOUT $...$ by the model) to KaTeX too.
  function formatPlainLatex(segment) {
    if (!window.katex) return formatAiText(segment, false);
    const frags = scanLatexFragments(segment);
    if (!frags.length) return formatAiText(segment, false);
    let result = '';
    let cursor = 0;
    for (const f of frags) {
      result += formatAiText(segment.slice(cursor, f.start), false);
      try {
        result += window.katex.renderToString(f.latex, { throwOnError: true, displayMode: false, output: 'html' });
      } catch {
        result += formatAiText(f.latex, false);
      }
      cursor = f.end;
    }
    result += formatAiText(segment.slice(cursor), false);
    return result;
  }

  // Find \command{...} groups (nested braces OK) and \begin{...}...\end{...} environments.
  function scanLatexFragments(text) {
    const frags = [];
    const re = /\\([a-zA-Z]+)(\*)?/g;
    let m;
    while ((m = re.exec(text))) {
      const name = m[1];
      let i = re.lastIndex;
      let end;
      if (name === 'begin' || name === 'end') {
        const envM = /^\{([^{}]*)\}/.exec(text.slice(i));
        if (!envM) continue;
        const env = envM[1];
        i += envM[0].length;
        const endTag = '\\end{' + env + '}';
        if (name === 'begin') {
          const eIdx = text.indexOf(endTag, i);
          if (eIdx === -1) continue;
          end = eIdx + endTag.length;
        } else {
          continue;
        }
      } else {
        if (text[i] === '[') {
          const e = text.indexOf(']', i);
          if (e === -1) continue;
          i = e + 1;
        }
        let groups = 0;
        while (text[i] === '{') {
          let depth = 0;
          let j = i;
          while (j < text.length) {
            if (text[j] === '{') depth++;
            else if (text[j] === '}') { depth--; if (depth === 0) { j++; break; } }
            j++;
          }
          if (depth !== 0) break;
          i = j;
          groups++;
        }
        if (!groups) continue;
        end = i;
      }
      const latex = text.slice(m.index, end);
      if (latex.length > 1 && latex.length <= 300) frags.push({ start: m.index, end, latex });
      re.lastIndex = end;
    }
    return frags;
  }

  // Returns content of the balanced brace group starting at s[i] === '{'.
  function matchBraced(s, i) {
    let depth = 0;
    const start = i + 1;
    while (i < s.length) {
      if (s[i] === '{') depth++;
      else if (s[i] === '}') { depth--; if (depth === 0) return { inner: s.slice(start, i), end: i + 1 }; }
      i++;
    }
    return { inner: s.slice(start), end: s.length };
  }

  // Resolve \frac{a}{b} with arbitrarily nested braces (a/b where each group is brace-balanced).
  function resolveFracs(s) {
    let out = '';
    let i = 0;
    const re = /\\(?:frac|dfrac|tfrac)\s*/g;
    let m;
    while ((m = re.exec(s))) {
      out += s.slice(i, m.index);
      i = m.index + m[0].length;
      let k = i;
      while (s[k] === ' ') k++;
      if (s[k] !== '{') { out += m[0]; re.lastIndex = i; continue; }
      const g1 = matchBraced(s, k);
      if (g1.end >= s.length) { out += s.slice(m.index, i); re.lastIndex = i; continue; }
      let j2 = g1.end;
      while (s[j2] === ' ') j2++;
      if (s[j2] !== '{') { out += s.slice(m.index, i); re.lastIndex = i; continue; }
      const g2 = matchBraced(s, j2);
      const a = g1.inner.trim();
      const b = g2.inner.trim();
      const simple = v => /^[0-9A-Za-zα-ωΑ-Ω√π°x.,+\-*]+$/.test(v) && v.length <= 6;
      out += simple(a) && simple(b) ? `${a}/${b}` : `(${a})/(${b})`;
      i = g2.end;
      re.lastIndex = i;
    }
    out += s.slice(i);
    return out;
  }

  // Resolve \sqrt{...} / \sqrt[n]{...}, consuming the braced group.
  function resolveSqrts(s) {
    let out = '';
    let i = 0;
    const re = /\\sqrt\s*/g;
    let m;
    while ((m = re.exec(s))) {
      out += s.slice(i, m.index);
      i = m.index + m[0].length;
      let k = i;
      if (s[k] === '[') {
        const e = s.indexOf(']', k);
        if (e === -1) { out += s.slice(m.index, i); re.lastIndex = i; continue; }
        k = e + 1;
      }
      while (s[k] === ' ') k++;
      if (s[k] !== '{') { out += s.slice(m.index, i); re.lastIndex = i; continue; }
      const g = matchBraced(s, k);
      const b = g.inner.trim();
      out += b.length <= 3 && !/[+\-=\s]/.test(b) ? `√${b}` : `√(${b})`;
      i = g.end;
      re.lastIndex = i;
    }
    out += s.slice(i);
    return out;
  }

  function fixLatex(text) {
    if (!text || !/[\\$]/.test(text)) return text;
    let out = text;
    // Strip LaTeX math delimiters, keep content inside.
    out = out.replace(/\$\$([\s\S]+?)\$\$/g, '$1');
    out = out.replace(/\$([^$]+)\$/g, '$1');
    // Structured commands with braces (nested-safe).
    let prevOut;
    do {
      prevOut = out;
      out = resolveFracs(out);
    } while (out !== prevOut);
    out = resolveSqrts(out);
    out = out.replace(/\\text\s*\{([^{}]*)\}/g, '$1');
    out = out.replace(/\\operatorname\s*\{([^{}]*)\}/g, '$1');
    out = out.replace(/\\(?:over(?:left|right)?arrow|overline|underline|hat|vec|bar)\s*\{([^{}]*)\}/g, '$1');
    // Sizing wrappers.
    out = out.replace(/\\left|\\right|\\big|\\Big|\\bigg|\\Bigg/g, '');
    // Line breaks & spacing.
    out = out.replace(/\\\\\s*/g, '\n');
    out = out.replace(/\\[,;:!]|\\quad|\\qquad/g, ' ');
    // Superscripts & subscripts.
    const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
    const SUB = '₀₁₂₃₄₅₆₇₈₉';
    out = out.replace(/\^\{([^{}]*)\}/g, (m, n) => (/^\d$/.test(n) ? SUP[+n] : `^(${n})`));
    out = out.replace(/\^(\d)/g, (m, n) => SUP[+n]);
    out = out.replace(/_\{([^{}]*)\}/g, (m, n) => (/^\d$/.test(n) ? SUB[+n] : `_(${n})`));
    out = out.replace(/_(\d)/g, (m, n) => SUB[+n]);
    // Common LaTeX commands → Unicode symbols.
    const sym = {
      le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠', approx: '≈',
      times: '×', div: '÷', pm: '±', cdot: '·', ldots: '…', cdots: '…', dots: '…',
      infty: '∞', to: '→', rightarrow: '→', leftarrow: '←', Rightarrow: '⇒',
      Leftarrow: '⇐', in: '∈', notin: '∉', subset: '⊂', supset: '⊃',
      subseteq: '⊆', supseteq: '⊇', cup: '∪', cap: '∩', sum: '∑',
      int: '∫', prod: '∏', emptyset: '∅', forall: '∀', exists: '∃',
      alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', zeta: 'ζ',
      eta: 'η', theta: 'θ', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ',
      pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'φ', chi: 'χ',
      psi: 'ψ', omega: 'ω', Delta: 'Δ', Sigma: 'Σ', Pi: 'Π', Omega: 'Ω',
      Phi: 'Φ', Gamma: 'Γ', Lambda: 'Λ', degree: '°', circ: '°', prime: '′',
      lim: 'lim', sin: 'sin', cos: 'cos', tan: 'tan', cot: 'cot', sec: 'sec',
      csc: 'csc', arcsin: 'arcsin', arccos: 'arccos', arctan: 'arctan',
      log: 'log', ln: 'ln', lg: 'lg', exp: 'exp', max: 'max', min: 'min',
      gcd: 'gcd', det: 'det', mod: 'mod'
    };
    out = out.replace(/\\([a-zA-Z]+)/g, (m, name) => sym[name] || m);
    // Remove ^ left in front of symbol characters (e.g. 45^\circ → 45°).
    out = out.replace(/\^([^0-9A-Za-z{(])/g, '$1');
    // Remove leftover lone backslashes (except double backslash handled above).
    out = out.replace(/\\([^a-zA-Z\\])/g, '$1');
    return out;
  }

// --- HELPER UTILITIES ---
  function getTimeRemaining(targetDateStr, timeStr = '07:30') {
    const target = new Date(`${targetDateStr}T${timeStr}:00`);
    const now = new Date();
    const total = target - now;

    if (total <= 0) {
      return { total: 0, days: 0, hours: 0, minutes: 0, seconds: 0 };
    }

    const seconds = Math.floor((total / 1000) % 60);
    const minutes = Math.floor((total / 1000 / 60) % 60);
    const hours = Math.floor((total / (1000 * 60 * 60)) % 24);
    const days = Math.floor(total / (1000 * 60 * 60 * 24));

    return { total, days, hours, minutes, seconds };
  }

  function getDaysLeft(dateStr, timeStr = '07:30') {
    const diff = getTimeRemaining(dateStr, timeStr);
    return diff.days;
  }

  function getExamStatusText(exam) {
    const remaining = getTimeRemaining(exam.date, exam.time);
    if (remaining.total <= 0) return 'Đã diễn ra';
    if (remaining.days === 0) return 'Hôm nay';
    return `Còn ${remaining.days} ngày`;
  }

  function isUpcomingExam(exam) {
    return new Date(`${exam.date}T${exam.time || '07:30'}:00`).getTime() > Date.now();
  }

  function calculateNearestDays(exams) {
    if (!exams || exams.length === 0) return null;
    const now = new Date().getTime();
    let minDiff = Infinity;
    exams.forEach(exam => {
      const target = new Date(`${exam.date}T${exam.time || '07:30'}:00`).getTime();
      const diff = target - now;
      if (diff > 0 && diff < minDiff) {
        minDiff = diff;
      }
    });
    if (minDiff === Infinity) return null;
    return Math.floor(minDiff / (1000 * 60 * 60 * 24));
  }

  function getNearestExam(exams) {
    if (!exams || exams.length === 0) return null;
    const now = new Date().getTime();
    let nearest = null;
    let minDiff = Infinity;
    exams.forEach(exam => {
      const target = new Date(`${exam.date}T${exam.time || '07:30'}:00`).getTime();
      const diff = target - now;
      if (diff > 0 && diff < minDiff) {
        minDiff = diff;
        nearest = exam;
      }
    });
    return nearest;
  }

  function formatDateVi(dateStr) {
    if (!dateStr) return '';
    const [y, m, d] = dateStr.split('-');
    return `${d}.${m}.${y}`;
  }

  function getCategoryName(cat) {
    const map = {
      thpt: 'THPT Quốc Gia',
      hsa: 'ĐGNL HSA (ĐHQGHN)',
      tsa: 'ĐGTD TSA (ĐH Bách Khoa)',
      hsg: 'Học Sinh Giỏi',
      school: 'Giữa Kỳ / Cuối Kỳ',
      other: 'Kỳ thi khác'
    };
    return map[cat] || 'Kỳ thi';
  }

  function showToast(message, type = 'info') {
    let toast = document.getElementById('app-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'app-toast';
      toast.className = 'app-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
toast.dataset.type = type;
    toast.classList.add('show');
    clearTimeout(toast.dismissTimer);
    toast.dismissTimer = setTimeout(() => toast.classList.remove('show'), 3000);
  }

  function updateChatBadge(messages) {
    const badge = document.getElementById('chat-nav-badge');
    if (!badge) return;
    const list = Array.isArray(messages) ? messages : [];
    const latest = list.length ? list[list.length - 1] : null;
    const latestTime = latest ? toMessageTime(latest) : 0;
    const meId = (firebaseUser && !firebaseUser.isAnonymous) ? firebaseUser.uid : null;
    const chatActive = document.getElementById('tab-chat')?.classList.contains('active');
    if (chatActive || !lastSeenChatTime) {
      lastSeenChatTime = latestTime;
      unreadChatCount = 0;
    } else {
      unreadChatCount = list.filter(m => toMessageTime(m) > lastSeenChatTime && m.authorId !== meId).length;
    }
    badge.textContent = unreadChatCount > 0 ? String(unreadChatCount) : '';
    badge.style.display = unreadChatCount > 0 ? 'block' : 'none';
  }

// Cắt chuỗi theo số BYTE UTF-8 (khớp quy tắc Firestore `.size()`), không theo ký tự JS.
  function truncateUtf8Bytes(str, maxBytes) {
    if (!str) return '';
    let bytes = 0;
    for (let i = 0; i < str.length; i++) {
      const code = str.codePointAt(i);
      let b = 1;
      if (code > 0xffff) { b = 4; i++; }
      else if (code > 0x7ff) b = 3;
      else if (code > 0x7f) b = 2;
      if (bytes + b > maxBytes) return str.slice(0, i);
      bytes += b;
    }
    return str;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // Trình xem tài liệu dùng chung cho các module khác (study-groups...)
  window.EduPulseDocs = { openBlob: openDocumentBlob };

  // Lưu file vào "Tài liệu của tôi" (online + local) cho các module khác
  window.EduPulseLibrary = { saveBlob: saveBlobToMyLibrary };

  // Run on DOM load
  document.addEventListener('DOMContentLoaded', init);

})();

