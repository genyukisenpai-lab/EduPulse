/* EduPulse AI Profile — lịch sử hội thoại bền, nhận diện môn học, nhắc học, báo cáo (free, on-device) */
(function () {
  'use strict';

  const DB_NAME = 'edupulse-ai-profile';
  const HISTORY_KEY = 'ai_history';
  const PROFILE_KEY = 'ai_profile';
  const GREETING_KEY = 'edupulse_ai_greeting_';
  const MAX_HISTORY = 12;

  const SUBJECT_PHRASES = {
    'Toán': ['toán', 'đại số', 'hình học', 'giải tích', 'hàm số', 'logarit', 'tích phân', 'phương trình', 'bất đẳng thức', 'xác suất', 'số phức', 'hệ phương trình', 'lượng giác', 'mũ và logarit', 'khảo sát'],
    'Lý': ['vật lý', 'vật lí', 'vật li', 'cơ học', 'dao động', 'sóng', 'điện xoay chiều', 'quang học', 'lượng tử', 'hạt nhân', 'nhiệt học', 'điện từ', 'từ trường', 'công suất', 'con lắc'],
    'Hóa': ['hóa học', 'hoá học', 'hoá', 'phản ứng', 'axit', 'bazơ', 'mol', 'nguyên tử', 'bảng tuần hoàn', 'hữu cơ', 'vô cơ', 'kim loại', 'este', 'peptit', 'điện phân', 'nồng độ'],
    'Sinh': ['sinh học', 'di truyền', 'tế bào', 'adn', 'gen', 'quần thể', 'tiến hóa', 'sinh thái', 'nhiễm sắc thể', 'nguyên phân', 'giảm phân', 'đột biến'],
    'Văn': ['văn học', 'ngữ văn', 'thơ', 'truyện', 'đoạn văn', 'nghị luận', 'phân tích tác phẩm', 'tác phẩm', 'chi tiết', 'hình tượng', 'bài văn', 'làm văn'],
    'Sử': ['lịch sử', 'sử học', 'chiến tranh', 'kháng chiến', 'triều đại', 'phong trào', 'cách mạng', 'văn minh', 'kinh tế lịch sử', 'lịch sử thế giới'],
    'Địa': ['địa lý', 'địa lí', 'bản đồ', 'khí hậu', 'địa hình', 'dân cư', 'vùng kinh tế', 'đất nước', 'atlat', 'biển đảo'],
    'Anh': ['tiếng anh', 'anh văn', 'english', 'ielts', 'toeic', 'từ vựng', 'ngữ pháp', 'đọc hiểu', 'phát âm', 'viết câu', 'bài anh'],
    'Tin': ['tin học', 'lập trình', 'thuật toán', 'python', 'c++', 'code', 'dữ liệu', 'mạng máy tính', 'hệ điều hành', 'giải thuật']
  };

  function openDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'key' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function kvSet(key, value) {
    return openDb().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put({ key, value, updatedAt: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }

  function kvGet(key) {
    return openDb().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readonly');
      const request = tx.objectStore('kv').get(key);
      request.onsuccess = () => resolve(request.result ? request.result.value : null);
      request.onerror = () => reject(request.error);
    }));
  }

  function kvDelete(key) {
    return openDb().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }

  function getFirestore() {
    const bridge = window.EDUPULSE_APP;
    if (!bridge || typeof bridge.getDb !== 'function' || typeof bridge.getAuthUser !== 'function') return null;
    const user = bridge.getAuthUser();
    if (!user || user.isAnonymous || !user.emailVerified) return null;
    const db = bridge.getDb();
    if (!db) return null;
    return { db, uid: user.uid };
  }

  function profileDoc() {
    const fs = getFirestore();
    return fs ? fs.db.collection('users').doc(fs.uid).collection('settings').doc('ai_profile') : null;
  }

  function historyDoc() {
    const fs = getFirestore();
    return fs ? fs.db.collection('users').doc(fs.uid).collection('settings').doc('ai_history') : null;
  }

  function detectSubjects(text) {
    const normalized = String(text || '').toLocaleLowerCase('vi-VN');
    const found = [];
    Object.keys(SUBJECT_PHRASES).forEach(subject => {
      if (SUBJECT_PHRASES[subject].some(phrase => normalized.includes(phrase))) {
        found.push(subject);
      }
    });
    return found;
  }

  async function loadProfile() {
    const local = await kvGet(PROFILE_KEY);
    const doc = profileDoc();
    if (!doc) return local || { counts: {}, questions: 0, updatedAt: null };
    try {
      const snapshot = await doc.get();
      const remote = snapshot.exists ? snapshot.data() : null;
      if (!remote) return local || { counts: {}, questions: 0, updatedAt: null };
      if (local && local.updatedAt && local.updatedAt > (remote.updatedAt || 0)) {
        return local;
      }
      return remote;
    } catch (error) {
      return local || { counts: {}, questions: 0, updatedAt: null };
    }
  }

  async function recordQuestion(text) {
    try {
      const subjects = detectSubjects(text);
      if (!subjects.length) return;
      const profile = await loadProfile();
      if (!profile.counts) profile.counts = {};
      subjects.forEach(subject => {
        profile.counts[subject] = (profile.counts[subject] || 0) + 1;
      });
      profile.questions = (profile.questions || 0) + 1;
      profile.updatedAt = Date.now();
      await kvSet(PROFILE_KEY, profile);
      const doc = profileDoc();
      if (doc) {
        try {
          await doc.set({
            counts: profile.counts,
            questions: profile.questions,
            updatedAt: new Date(profile.updatedAt).toISOString()
          }, { merge: true });
        } catch (error) { /* offline — giữ bản local */ }
      }
    } catch (error) { /* best-effort */ }
  }

  async function getWeakSubjects(limit = 2) {
    const profile = await loadProfile();
    const counts = profile.counts || {};
    return Object.keys(counts)
      .sort((a, b) => (counts[b] || 0) - (counts[a] || 0))
      .slice(0, limit);
  }

  async function loadHistory() {
    const doc = historyDoc();
    if (doc) {
      try {
        const snapshot = await doc.get();
        if (snapshot.exists) {
          const data = snapshot.data();
          const messages = Array.isArray(data.messages) ? data.messages : [];
          if (messages.length) {
            await kvSet(HISTORY_KEY, messages);
            return messages.slice(-MAX_HISTORY);
          }
        }
      } catch (error) { /* offline — dùng local */ }
    }
    const local = await kvGet(HISTORY_KEY);
    return Array.isArray(local) ? local.slice(-MAX_HISTORY) : [];
  }

  async function saveHistory(messages) {
    try {
      const trimmed = Array.isArray(messages) ? messages.slice(-MAX_HISTORY) : [];
      await kvSet(HISTORY_KEY, trimmed);
      const doc = historyDoc();
      if (doc) {
        try {
          await doc.set({ messages: trimmed, updatedAt: new Date().toISOString() }, { merge: true });
        } catch (error) { /* offline — giữ bản local */ }
      }
    } catch (error) { /* best-effort */ }
  }

  async function clearHistory() {
    await kvDelete(HISTORY_KEY);
    const doc = historyDoc();
    if (doc) {
      try { await doc.delete(); } catch (error) { /* offline */ }
    }
  }

  function todayStr() {
    const now = new Date();
    return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
  }

  function buildDailyGreeting() {
    const bridge = window.EDUPULSE_APP;
    if (!bridge) return 'Chào bạn! Mình là trợ lý ôn thi EduPulse — hỏi mình bất cứ điều gì về việc học nhé.';
    const stats = bridge.getStudyStats();
    if (!stats.nearestExam) {
      return 'Chào bạn! Hãy thêm kỳ thi đầu tiên để mình đồng hành lập kế hoạch ôn thi nhé.';
    }
    const days = stats.nearestExam.daysLeft;
    const title = stats.nearestExam.title;
    const streak = stats.streak;
    if (days === 0) {
      return `Hôm nay là ngày thi ${title}! Mình tin bạn đã chuẩn bị đủ. Hãy giữ bình tĩnh, đọc kỹ đề và phân bổ thời gian. Chúc bạn thi tốt!`;
    }
    if (days <= 7) {
      return `Còn ${days} ngày nữa tới ${title} — nước rút! Hôm nay ưu tiên: chữa lỗi sai, làm 1 đề và nghỉ ngơi đủ. Bạn đang có chuỗi ${streak} ngày học — giữ nhịp nhé!`;
    }
    if (days <= 30) {
      return `Còn ${days} ngày tới ${title}. Bạn có chuỗi ${streak} ngày học — hôm nay muốn lập kế hoạch, hỏi bài hay tìm cách tập trung?`;
    }
    return `Chào bạn! Còn ${days} ngày tới ${title}. Bạn có thể hỏi mình lập kế hoạch ôn, chữa đề hoặc cách học tập trung.`;
  }

  async function getDailyGreeting() {
    const key = GREETING_KEY + todayStr();
    const cached = await kvGet(key);
    if (cached) return cached;
    const greeting = buildDailyGreeting();
    await kvSet(key, greeting);
    return greeting;
  }

  function buildWeeklyReport() {
    const bridge = window.EDUPULSE_APP;
    if (!bridge) return 'Chưa có dữ liệu để báo cáo.';
    const stats = bridge.getStudyStats();
    const library = bridge.getLibrary();
    const lines = [];
    lines.push('BÁO CÁO ÔN THI CỦA BẠN');
    lines.push('');
    lines.push(`• Chuỗi học: ${stats.streak} ngày liên tiếp (kỷ lục: ${stats.record} ngày)`);
    lines.push(`• Kỳ thi: ${stats.totalExams} kỳ thi (${stats.upcomingExams} còn hạn)`);
    if (stats.nearestExam) {
      lines.push(`• Gần nhất: ${stats.nearestExam.title} — còn ${stats.nearestExam.daysLeft} ngày`);
    }
    if (stats.weeklyTargetPct !== null) {
      lines.push(`• Mục tiêu tuần: ${stats.weeklyTargetPct}% kỳ thi còn hạn`);
    }
    lines.push(`• Thư viện: ${library.length} tài liệu`);
    return lines.join('\n');
  }

  async function buildWeakSubjectsText() {
    const weak = await getWeakSubjects();
    if (!weak.length) return '';
    return 'Môn cần ôn: ' + weak.join(', ');
  }

  window.AiProfile = {
    detectSubjects,
    recordQuestion,
    getWeakSubjects,
    loadHistory,
    saveHistory,
    clearHistory,
    getDailyGreeting,
    buildWeeklyReport,
    buildWeakSubjectsText
  };
}());