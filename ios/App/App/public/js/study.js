/* EduPulse Study — Nhật ký học tập, lịch học động, analytics & chia sẻ thành tích (on-device, offline-first) */
(function () {
  'use strict';

  const SUBJECTS = ['Toán', 'Lý', 'Hóa', 'Sinh', 'Văn', 'Sử', 'Địa', 'Anh', 'Tin'];
  const SUBJECT_COLORS = {
    'Toán': '#4f8cff', 'Lý': '#ff9f43', 'Hóa': '#00b894', 'Sinh': '#6c5ce7',
    'Văn': '#e17055', 'Sử': '#d63031', 'Địa': '#0984e3', 'Anh': '#fd79a8', 'Tin': '#00cec9'
  };

  function getState() {
    return (window.EDUPULSE_APP && typeof window.EDUPULSE_APP.getState === 'function')
      ? window.EDUPULSE_APP.getState()
      : { exams: [], studyLog: [], goals: {}, pushSettings: {} };
  }

  function save() {
    try {
      if (window.EDUPULSE_APP && typeof window.EDUPULSE_APP.saveState === 'function') window.EDUPULSE_APP.saveState();
    } catch (err) { /* không để lỗi lưu chặn cập nhật UI */ }
  }

  function getGoals() {
    const g = getState().goals || {};
    return {
      score: (typeof g.score === 'number' || g.score) ? g.score : null,
      subject: g.subject || '',
      weeklyMinutes: g.weeklyMinutes || 300
    };
  }

  function getPushSettings() {
    const p = getState().pushSettings || {};
    return { times: Array.isArray(p.times) ? p.times.slice() : ['18:00'], quote: p.quote !== false };
  }

  function todayStr(offsetDays) {
    const d = new Date();
    if (offsetDays) d.setDate(d.getDate() - offsetDays);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function getLog() {
    return Array.isArray(getState().studyLog) ? getState().studyLog : [];
  }

  function setLog(arr) {
    getState().studyLog = arr;
    save();
  }

  function logStudy(subject, minutes, note) {
    const m = Math.max(1, Math.round(minutes));
    const date = todayStr();
    const log = getLog().slice();
    const existing = log.find(e => e.date === date && e.subject === subject);
    if (existing) {
      existing.minutes += m;
      if (note) existing.note = note;
    } else {
      log.push({ id: 'sl-' + Date.now() + '-' + Math.floor(Math.random() * 1000), date, subject, minutes: m, note: note || '' });
    }
setLog(log);
    try { renderStudyUI(); } catch (err) { /* vẫn hiện toast xác nhận */ }
    if (window.EDUPULSE_APP && typeof window.EDUPULSE_APP.showToast === 'function') {
      window.EDUPULSE_APP.showToast('Đã ghi ' + m + ' phút môn ' + subject);
    }
  }

  function removeLog(id) {
    setLog(getLog().filter(e => e.id !== id));
    try { renderStudyUI(); } catch (err) { }
  }

  function getRangeLog(days) {
    const since = todayStr(days - 1);
    return getLog().filter(e => e.date >= since);
  }

  function getDayMinutes(date) {
    return getLog().filter(e => e.date === date).reduce((s, e) => s + (e.minutes || 0), 0);
  }

  function getSubjectMinutes(days) {
    const out = {};
    getRangeLog(days).forEach(e => { out[e.subject] = (out[e.subject] || 0) + (e.minutes || 0); });
    return out;
  }

  function getWeeklyDays() {
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const date = todayStr(i);
      days.push({ date, label: fmtDay(date), minutes: getDayMinutes(date), today: i === 0 });
    }
    return days;
  }

  function fmtDay(dateStr) {
    return new Date(dateStr + 'T00:00:00').toLocaleDateString('vi-VN', { weekday: 'short' });
  }

  // ---------- LỊCH TRÌNH HỌC ĐỘNG ----------
  function getDailySchedule() {
    const state = getState();
    const exams = Array.isArray(state.exams)
      ? state.exams.filter(ex => ex && ex.date && new Date(`${ex.date}T${ex.time || '07:30'}:00`).getTime() > Date.now())
      : [];
    let nearest = null;
    if (exams.length) {
      nearest = exams.slice().sort((a, b) => (a.date + ' ' + (a.time || '')) < (b.date + ' ' + (b.time || '')) ? -1 : 1)[0];
    }
    let daysLeft = null;
    if (nearest) {
      const diff = Math.round((new Date(nearest.date + 'T00:00:00') - new Date(todayStr() + 'T00:00:00')) / 86400000);
      daysLeft = Math.max(0, diff);
    }
    const goals = getGoals();
    const todayMin = getDayMinutes(todayStr());
    const weekMin = getRangeLog(7).reduce((s, e) => s + (e.minutes || 0), 0);
    const subjectMin = getSubjectMinutes(14);

    let target = Math.round((goals.weeklyMinutes || 300) / 7);
    if (daysLeft !== null && daysLeft <= 7) target += 40;
    else if (daysLeft !== null && daysLeft <= 14) target += 20;
    target = Math.min(240, Math.max(30, target));

    const todayDone = {};
    getLog().filter(e => e.date === todayStr()).forEach(e => { todayDone[e.subject] = (todayDone[e.subject] || 0) + (e.minutes || 0); });

    const weak = [];
    if (window.AiProfile && typeof window.AiProfile.getWeakSubjects === 'function') {
      try { weak.push.apply(weak, window.AiProfile.getWeakSubjects() || []); } catch (e) { /* bỏ qua */ }
    }
    const pick = [];
    if (goals.subject && SUBJECTS.indexOf(goals.subject) !== -1 && pick.indexOf(goals.subject) === -1) pick.push(goals.subject);
    weak.forEach(s => { if (pick.indexOf(s) === -1 && pick.length < 3) pick.push(s); });
    const sorted = SUBJECTS.slice().sort((a, b) => (subjectMin[a] || 0) - (subjectMin[b] || 0));
    sorted.forEach(s => { if (pick.indexOf(s) === -1 && pick.length < 3) pick.push(s); });

    const shares = [0.5, 0.3, 0.2];
    const blocks = pick.map((s, i) => {
      const suggested = Math.max(20, Math.round(target * shares[Math.min(i, shares.length - 1)]));
      const done = todayDone[s] || 0;
      return {
        subject: s,
        color: SUBJECT_COLORS[s] || '#95a5a6',
        suggested,
        done,
        minutes: Math.max(0, suggested - done),
        reason: reasonFor(s, goals, nearest, weak, i)
      };
    });

    return { blocks, target, todayMin, weekMin, daysLeft, nearest: nearest ? nearest.title : null, goals };
  }

  function reasonFor(subject, goals, nearest, weak, idx) {
    if (goals.subject === subject) return 'Môn trọng tâm mục tiêu';
    if (weak.indexOf(subject) !== -1) return 'Môn yếu của bạn';
    if (nearest && nearest.notes && nearest.notes.toLowerCase().indexOf(subject.toLowerCase()) !== -1) return 'Liên quan kỳ thi gần nhất';
    if (idx === 0) return 'Cần ưu tiên nhất';
    return 'Cân bằng ôn tập';
  }

  // ---------- DỰ BÁO ----------
  function getForecast() {
    const goals = getGoals();
    const weekMin = getRangeLog(7).reduce((s, e) => s + (e.minutes || 0), 0);
    const targetWeekly = goals.weeklyMinutes || 300;
    const pace = targetWeekly > 0 ? weekMin / targetWeekly : 0;
    const pct = Math.min(100, Math.round(pace * 100));
    let status;
    if (weekMin === 0) {
      status = 'Chưa có dữ liệu học 7 ngày qua — bắt đầu ghi nhận ngay hôm nay nhé!';
    } else if (pace >= 1) {
      status = 'Đang vượt mục tiêu tuần. Duy trì để về đích sớm!';
    } else if (pace >= 0.7) {
      status = 'Đang theo kịp mục tiêu tuần. Cố lên!';
    } else {
      status = 'Cần tăng tốc — nhịp học đang chậm so với mục tiêu tuần.';
    }
    return { pct, weekMin, targetWeekly, status, goals };
  }

  // ---------- VẼ BIỂU ĐỒ (canvas thuần, không thư viện) ----------
  function cssVar(name, fallback) {
    const v = getComputedStyle(document.body).getPropertyValue(name).trim();
    return v || fallback;
  }

  function prepCanvas(canvas, w, h) {
    if (!canvas) return null;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }

  function drawWeeklyBar(canvas) {
    const ctx = prepCanvas(canvas, 320, 160);
    if (!ctx) return;
    const days = getWeeklyDays();
    const max = Math.max(30, ...days.map(d => d.minutes));
    const textMain = cssVar('--text-main', '#1e293b');
    const textMuted = cssVar('--text-muted', '#64748b');
    const grid = cssVar('--border-card', '#e2e8f0');
    const primary = cssVar('--primary', '#4f46e5');
    const padL = 30, padB = 20, padT = 10, padR = 8;
    const chartW = 320 - padL - padR, chartH = 160 - padT - padB;
    const barW = chartW / days.length;

    ctx.clearRect(0, 0, 320, 160);
    // grid
    ctx.strokeStyle = grid;
    ctx.lineWidth = 1;
    [0, 0.5, 1].forEach(f => {
      const y = padT + chartH * (1 - f);
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(320 - padR, y);
      ctx.stroke();
      ctx.fillStyle = textMuted;
      ctx.font = '9px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(Math.round(max * f) + 'p', padL - 4, y + 3);
    });

    days.forEach((d, i) => {
      const x = padL + i * barW + barW * 0.18;
      const h = Math.max(2, (d.minutes / max) * chartH);
      const y = padT + chartH - h;
      ctx.fillStyle = d.today ? primary : (cssVar('--primary-light', '#c7d2fe'));
      roundRect(ctx, x, y, barW * 0.64, h, 4);
      ctx.fill();
      ctx.fillStyle = d.today ? textMain : textMuted;
      ctx.font = '9px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(d.label, x + barW * 0.32, 160 - padB + 10);
    });
  }

  function drawSubjectDonut(canvas) {
    const ctx = prepCanvas(canvas, 160, 160);
    if (!ctx) return;
    const subjectMin = getSubjectMinutes(7);
    const entries = Object.entries(subjectMin).filter(e => e[1] > 0).sort((a, b) => b[1] - a[1]);
    const textMain = cssVar('--text-main', '#1e293b');
    const textMuted = cssVar('--text-muted', '#64748b');
    ctx.clearRect(0, 0, 160, 160);
    if (!entries.length) {
      ctx.fillStyle = textMuted;
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Chưa có dữ liệu', 80, 82);
      return;
    }
    const total = entries.reduce((s, e) => s + e[1], 0);
    const cx = 80, cy = 80, r = 62, ir = 40;
    let start = -Math.PI / 2;
    entries.forEach(([subj, min]) => {
      const angle = (min / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(cx, cy, r, start, start + angle);
      ctx.arc(cx, cy, ir, start + angle, start, true);
      ctx.closePath();
      ctx.fillStyle = SUBJECT_COLORS[subj] || '#95a5a6';
      ctx.fill();
      start += angle;
    });
    ctx.fillStyle = textMain;
    ctx.font = 'bold 15px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(total + 'p', cx, cy + 1);
    ctx.fillStyle = textMuted;
    ctx.font = '9px sans-serif';
    ctx.fillText('7 ngày', cx, cy + 14);
  }

  function drawForecastChart(canvas) {
    const ctx = prepCanvas(canvas, 320, 140);
    if (!ctx) return;
    const days = getWeeklyDays();
    let cum = 0;
    const cumArr = days.map(d => { cum += d.minutes; return cum; });
    const target = getGoals().weeklyMinutes || 300;
    const max = Math.max(target * 1.2, ...cumArr, 60);
    const textMuted = cssVar('--text-muted', '#64748b');
    const grid = cssVar('--border-card', '#e2e8f0');
    const primary = cssVar('--primary', '#4f46e5');
    const success = cssVar('--success', '#22c55e');
    const padL = 8, padR = 8, padT = 8, padB = 20;
    const chartW = 320 - padL - padR, chartH = 140 - padT - padB;
    const x = i => padL + (chartW * i) / (Math.max(1, days.length - 1));
    const y = v => padT + chartH - (v / max) * chartH;

    ctx.clearRect(0, 0, 320, 140);
    // target line
    ctx.strokeStyle = success;
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL, y(target));
    ctx.lineTo(320 - padR, y(target));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = success;
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Mục tiêu tuần', 320 - padR - 58, y(target) - 3);

    // cum line
    ctx.strokeStyle = primary;
    ctx.lineWidth = 2;
    ctx.beginPath();
    cumArr.forEach((v, i) => { const px = x(i), py = y(v); if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); });
    ctx.stroke();

    // points
    cumArr.forEach((v, i) => {
      ctx.fillStyle = primary;
      ctx.beginPath();
      ctx.arc(x(i), y(v), 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = textMuted;
      ctx.font = '8px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(days[i].label, x(i), 140 - padB + 12);
    });
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ---------- CHIA SẺ THÀNH TÍCH ----------
  function buildShareCard() {
    return new Promise((resolve) => {
      const W = 1080, H = 1350;
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d');

      const stats = window.EDUPULSE_APP && typeof window.EDUPULSE_APP.getStudyStats === 'function'
        ? window.EDUPULSE_APP.getStudyStats()
        : { streak: 0, record: 0 };
      const s = stats.study || {};
      const goals = s.goals || {};
      const nearest = stats.nearestExam;
      const streak = stats.streak || 0;
      const weekMin = s.weekMinutes || 0;
      const todayMin = s.todayMinutes || 0;
      const subj = getSubjectMinutes(7);

      const grad = ctx.createLinearGradient(0, 0, W, H);
      grad.addColorStop(0, '#1e1b4b');
      grad.addColorStop(0.55, '#312e81');
      grad.addColorStop(1, '#4f46e5');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);

      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.beginPath();
      ctx.arc(W - 120, 140, 260, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(90, H - 200, 200, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 44px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('EduPulse', 72, 120);
      ctx.font = '30px sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillText('Study Smarter', 72, 168);

      ctx.fillStyle = '#ffffff';
      ctx.font = '900 150px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(streak, W / 2, 420);
      ctx.font = 'bold 40px sans-serif';
      ctx.fillStyle = '#fbbf24';
      ctx.fillText('NGÀY HỌC LIÊN TIẾP', W / 2, 480);
      ctx.font = '30px sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillText('Kỷ lục: ' + (stats.record || 0) + ' ngày', W / 2, 528);

      const rows = [
        { label: 'Học hôm nay', value: todayMin + ' phút' },
        { label: 'Học 7 ngày qua', value: weekMin + ' phút' },
        { label: 'Kỳ thi gần nhất', value: nearest ? nearest.title : '—' },
        { label: 'Còn lại', value: nearest && typeof nearest.daysLeft === 'number' ? nearest.daysLeft + ' ngày' : '—' }
      ];
      let yy = 640;
      rows.forEach(r => {
        ctx.fillStyle = 'rgba(255,255,255,0.14)';
        roundRect(ctx, 72, yy, W - 144, 104, 20);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.font = '28px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(r.label, 104, yy + 56);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 34px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(r.value, W - 104, yy + 60);
        yy += 136;
      });

      // mini subject bars
      const top = Object.entries(subj).sort((a, b) => b[1] - a[1]).slice(0, 3);
      if (top.length) {
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.font = 'bold 30px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('PHÂN BỐ HỌC TẬP', 104, yy + 10);
        const maxTop = Math.max(...top.map(t => t[1]), 1);
        let by = yy + 50;
        top.forEach(([subj2, min]) => {
          ctx.fillStyle = SUBJECT_COLORS[subj2] || '#a5b4fc';
          ctx.fillRect(104, by, (W - 208) * (min / maxTop), 28);
          ctx.fillStyle = '#ffffff';
          ctx.font = '26px sans-serif';
          ctx.fillText(subj2 + ' · ' + min + 'p', 120, by + 22);
          by += 54;
        });
      }

      ctx.fillStyle = 'rgba(255,255,255,0.65)';
      ctx.font = '28px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Chia sẻ thành tích của bạn cùng EduPulse', W / 2, H - 90);

      canvas.toBlob((blob) => resolve({ blob, canvas }), 'image/png');
    });
  }

  function shareCard() {
    buildShareCard().then(({ blob }) => {
      const file = new File([blob], 'edupulse-thanh-tich.png', { type: 'image/png' });
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file], title: 'Thành tích học tập của tôi — EduPulse' }).catch(() => {});
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'edupulse-thanh-tich.png';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
      }
    });
  }

  // ---------- RENDER UI ----------
  function el(id) { return document.getElementById(id); }

  function renderStudyUI() {
    const schedule = getDailySchedule();
    const forecast = getForecast();
    const subj7 = getSubjectMinutes(7);
    const log = getRangeLog(7);

    // Summary cards
    setText('stats-today-minutes', schedule.todayMin + 'p');
    setText('stats-week-minutes', schedule.weekMin + 'p');
    setText('stats-streak', (window.EDUPULSE_APP && window.EDUPULSE_APP.getStudyStats ? window.EDUPULSE_APP.getStudyStats().streak : 0));
    setText('stats-goal-progress', forecast.pct + '%');
    setText('stats-goal-status', forecast.status);

    // Goal form
    const goals = getGoals();
    const goalScore = el('goal-score');
    if (goalScore) goalScore.value = goals.score === null ? '' : goals.score;
    const goalSubject = el('goal-subject');
    if (goalSubject && goalSubject.options.length === 0) {
      goalSubject.innerHTML = '<option value="">—</option>' + SUBJECTS.map(s => '<option value="' + s + '">' + s + '</option>').join('');
      goalSubject.value = goals.subject;
    }
    const goalWeekly = el('goal-weekly');
    if (goalWeekly) goalWeekly.value = goals.weeklyMinutes || 300;

    // Schedule blocks
    const scheduleList = el('stats-schedule-list');
    if (scheduleList) {
      scheduleList.innerHTML = schedule.blocks.map(b => {
        const pct = b.suggested > 0 ? Math.min(100, Math.round((b.done / b.suggested) * 100)) : 0;
        return '<div class="schedule-block">' +
          '<div class="schedule-block-head"><span class="schedule-dot" style="background:' + b.color + '"></span>' +
          '<strong>' + b.subject + '</strong><span class="schedule-minutes">' + b.minutes + ' phút</span>' +
          (b.done > 0 ? '<span class="schedule-done">✓ ' + b.done + 'p đã học</span>' : '') + '</div>' +
          '<div class="schedule-reason">' + b.reason + '</div>' +
          '<div class="schedule-bar"><div class="schedule-bar-fill" style="width:' + pct + '%;background:' + b.color + '"></div></div>' +
          '</div>';
      }).join('') || '<div class="empty-note">Đang tính lịch học…</div>';
    }

    // Home widget
    const homeSchedule = el('home-schedule-list');
    if (homeSchedule) {
      homeSchedule.innerHTML = schedule.blocks.slice(0, 3).map(b =>
        '<div class="home-schedule-item"><span class="schedule-dot" style="background:' + b.color + '"></span>' +
        '<span class="home-schedule-subject">' + b.subject + '</span>' +
        '<span class="home-schedule-min">' + b.minutes + ' phút</span></div>'
      ).join('') || '<div class="empty-note">Hôm nay chưa có gợi ý.</div>';
    }

    // Study log list
    const logList = el('stats-log-list');
    if (logList) {
      if (!log.length) {
        logList.innerHTML = '<div class="empty-note">Chưa có buổi học nào. Ghi nhận ngay bên trên nhé!</div>';
      } else {
        logList.innerHTML = log.slice().sort((a, b) => b.date < a.date ? -1 : 1).map(e =>
          '<div class="log-row"><span class="schedule-dot" style="background:' + (SUBJECT_COLORS[e.subject] || '#95a5a6') + '"></span>' +
          '<span class="log-subject">' + e.subject + '</span>' +
          '<span class="log-date">' + fmtDay(e.date) + '</span>' +
          '<span class="log-minutes">' + e.minutes + ' phút</span>' +
          '<button class="btn-card-icon delete study-log-delete" data-id="' + e.id + '" title="Xóa"><i class="fa-solid fa-trash"></i></button>' +
          '</div>'
        ).join('');
        logList.querySelectorAll('.study-log-delete').forEach(b => b.addEventListener('click', () => removeLog(b.dataset.id)));
      }
    }

    // Charts
    drawWeeklyBar(el('chart-weekly'));
    drawSubjectDonut(el('chart-subjects'));
    drawForecastChart(el('chart-forecast'));
  }

  function setText(id, text) {
    const node = el(id);
    if (node) node.textContent = text;
  }

  function handleLogButtonClick() {
    const subj = el('log-subject');
    const min = el('log-minutes');
    if (!subj || !min) return;
    if (!subj.value) { if (window.EDUPULSE_APP && window.EDUPULSE_APP.showToast) window.EDUPULSE_APP.showToast('Chọn môn học.', 'warning'); return; }
    const m = parseInt(min.value, 10);
    if (!m || m < 1) { if (window.EDUPULSE_APP && window.EDUPULSE_APP.showToast) window.EDUPULSE_APP.showToast('Nhập số phút hợp lệ.', 'warning'); return; }
    const note = el('log-note');
    try {
      logStudy(subj.value, m, note ? note.value : '');
      min.value = '';
      if (note) note.value = '';
    } catch (err) {
      if (window.EDUPULSE_APP && window.EDUPULSE_APP.showToast) {
        window.EDUPULSE_APP.showToast('Lỗi khi ghi: ' + (err && err.message ? err.message : err), 'warning');
      }
    }
  }

  function setupEventListeners() {
    window.__studyLogDelegationActive = true;
    document.addEventListener('click', e => {
      const hit = e.target && e.target.closest ? e.target.closest('#btn-log-study') : null;
      if (hit) handleLogButtonClick();
    });

    const btnSaveGoals = el('btn-save-goals');
    if (btnSaveGoals) {
      btnSaveGoals.addEventListener('click', () => {
        const score = el('goal-score');
        const subject = el('goal-subject');
        const weekly = el('goal-weekly');
        const st = getState();
        st.goals = st.goals || {};
        st.goals.score = score && score.value ? parseFloat(score.value) : null;
        st.goals.subject = subject ? subject.value : '';
        st.goals.weeklyMinutes = weekly && parseInt(weekly.value, 10) >= 30 ? parseInt(weekly.value, 10) : 300;
        save();
        renderStudyUI();
        if (window.EDUPULSE_APP && typeof window.EDUPULSE_APP.showToast === 'function') window.EDUPULSE_APP.showToast('Đã lưu mục tiêu ôn tập.');
      });
    }

    const btnShare = el('btn-share-card');
    if (btnShare) btnShare.addEventListener('click', shareCard);

    // Push settings
    const btnSavePush = el('btn-save-push');
    if (btnSavePush) {
      btnSavePush.addEventListener('click', () => {
        const st = getState();
        st.pushSettings = st.pushSettings || {};
        st.pushSettings.times = Array.from(document.querySelectorAll('.push-time-cb:checked')).map(cb => cb.value);
        const quote = el('push-quote');
        if (quote) st.pushSettings.quote = quote.checked;
        if (!st.pushSettings.times.length) st.pushSettings.times = ['18:00'];
        save();
        renderPushSettings();
        if (window.EDUPULSE_APP && typeof window.EDUPULSE_APP.showToast === 'function') window.EDUPULSE_APP.showToast('Đã lưu cài đặt thông báo.');
      });
    }
  }

  function renderPushSettings() {
    const p = getPushSettings();
    document.querySelectorAll('.push-time-cb').forEach(cb => { cb.checked = p.times.indexOf(cb.value) !== -1; });
    const quote = el('push-quote');
    if (quote) quote.checked = p.quote;
  }

  function init() {
    setupEventListeners();
    const subjSel = el('log-subject');
    if (subjSel && !subjSel.options.length) {
      subjSel.innerHTML = '<option value="">Chọn môn…</option>' + SUBJECTS.map(s => '<option value="' + s + '">' + s + '</option>').join('');
    }
    renderPushSettings();
    renderStudyUI();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.EduPulseStudy = {
    SUBJECTS,
    SUBJECT_COLORS,
    logStudy,
    handleLogButtonClick,
    removeLog,
    getDailySchedule,
    getForecast,
    getGoals,
    getPushSettings,
    getSubjectMinutes,
    getRangeLog,
    getWeeklyDays,
    drawWeeklyBar,
    drawSubjectDonut,
    drawForecastChart,
    buildShareCard,
    shareCard,
    renderStudyUI,
    renderPushSettings,
    todayStr
  };
})();