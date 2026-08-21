/* EduPulse Calls — Gọi video & gọi thoại (WebRTC P2P, signaling qua Firestore, không tốn phí) */
(function () {
  'use strict';

  var ICE_SERVERS = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] },
    { urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turns:openrelay.metered.ca:443', 'turns:openrelay.metered.ca:80'], username: 'openrelayproject', credential: 'openrelayproject' }
  ];

  var RING_TIMEOUT_MS = 45000;
  var ROOM_STALE_MS = 90000;
  var ROOM_HEARTBEAT_MS = 30000;

  // Cắt chuỗi theo số BYTE UTF-8 (khớp quy tắc Firestore `.size()`), không theo ký tự JS.
  function truncateUtf8Bytes(str, maxBytes) {
    if (!str) return '';
    var bytes = 0;
    for (var i = 0; i < str.length; i++) {
      var code = str.codePointAt(i);
      var b = 1;
      if (code > 0xffff) { b = 4; i++; }
      else if (code > 0x7ff) b = 3;
      else if (code > 0x7f) b = 2;
      if (bytes + b > maxBytes) return str.slice(0, i);
      bytes += b;
    }
    return str;
  }

  var VIDEO_CONSTRAINTS = { width: { ideal: 1280 }, height: { ideal: 720 } };
  var ROOM_VIDEO_CONSTRAINTS = { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24, max: 30 } };

  var state = {
    user: null,
    db: null,
    myName: 'Sĩ tử EduPulse',

    callId: null,
    callType: 'voice',
    callStatus: 'idle',
    role: null,
    otherUid: null,
    peerName: '',
    callDocUnsub: null,
    callSignalUnsub: null,
    processedCallSignals: {},
    processedRoomSignals: {},
    incomingUnsub: null,
    callTimeout: null,
    callPollTimer: null,
    pc1: null,
    localStream1: null,
    remoteStream1: null,
    pendingCandidates: [],
    pendingOffer: null,
    remoteReady: false,
    offerSent: false,
    activeStarted: false,
    callTimer: null,

    roomActive: false,
    roomKind: 'voice',
    roomLocalStream: null,
    roomStart: 0,
    roomTimer: null,
    roomMembersUnsub: null,
    roomSignalsUnsub: null,
    roomHeartbeatTimer: null,
    roomHeartbeatWorker: null,
    roomVisibilityBound: false,
    roomCleanupTimer: null,
    presenceVerifyTimer: null,
    roomPeers: new Map()
  };

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function toast(message, type) {
    var t = document.getElementById('app-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'app-toast';
      t.className = 'app-toast';
      document.body.appendChild(t);
    }
    t.textContent = message;
    t.dataset.type = type || 'info';
    t.classList.add('show');
    clearTimeout(t.dismissTimer);
    t.dismissTimer = setTimeout(function () { t.classList.remove('show'); }, 3200);
  }

  function fs() {
    return window.firebase ? window.firebase.firestore : null;
  }

  function nowSec() {
    var s = fs();
    return s ? s.FieldValue.serverTimestamp() : null;
  }

  function docRef(col, id) {
    return state.db.collection(col).doc(id);
  }

  function requireReady(verbose) {
    if (!state.user || !state.db) {
      if (verbose) toast('Đăng nhập để gọi điện.', 'warning');
      return false;
    }
    return true;
  }

  // ---------- Ringtone (Web Audio, không cần file) ----------
  var Ringtone = {
    ctx: null,
    osc: null,
    gain: null,
    timer: null,
    toggling: false,
    unlock: function () {
      if (!this.ctx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (AC) this.ctx = new AC();
      }
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(function () {});
      }
    },
    start: function (kind) {
      this.stop();
      this.unlock();
      if (!this.ctx) return;
      var freq = kind === 'incoming' ? 880 : 440;
      this.osc = this.ctx.createOscillator();
      this.gain = this.ctx.createGain();
      this.osc.type = 'sine';
      this.osc.frequency.value = freq;
      this.gain.gain.value = 0;
      this.osc.connect(this.gain).connect(this.ctx.destination);
      this.osc.start();
      var ctx = this.ctx;
      var self = this;
      var on = function () { if (self.gain) self.gain.gain.setTargetAtTime(0.16, ctx.currentTime, 0.01); };
      var off = function () { if (self.gain) self.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.05); };
      on();
      this.timer = setInterval(function () {
        self.toggling = !self.toggling;
        if (self.toggling) off(); else on();
      }, 500);
      if (kind === 'incoming' && navigator.vibrate) {
        navigator.vibrate([250, 120, 250, 120, 250]);
      }
    },
    stop: function () {
      if (this.timer) { clearInterval(this.timer); this.timer = null; }
      if (this.osc) { try { this.osc.stop(); } catch (e) {} }
      this.osc = null;
      this.gain = null;
      this.toggling = false;
    }
  };

  document.addEventListener('pointerdown', function () { Ringtone.unlock(); });

  // ---------- Helpers UI ----------
  function showOverlay(id) {
    var el = document.getElementById(id);
    if (el) el.hidden = false;
  }

  function hideOverlay(id) {
    var el = document.getElementById(id);
    if (el) el.hidden = true;
  }

  function setBtnIcon(selector, onClass, offClass, enabled) {
    var btn = document.querySelector(selector);
    if (!btn) return;
    var i = btn.querySelector('i');
    if (i) {
      i.className = 'fa-solid ' + (enabled ? onClass : offClass);
    }
    btn.classList.toggle('call-ctl-off', !enabled);
  }

  function setText(id, value) {
    var el = document.getElementById(id);
    if (el) el.textContent = value || '';
  }

  // ---------- Overlay 1-1 ----------
  function renderCallOverlay(mode) {
    var statusEl = document.getElementById('call-status');
    var actions = document.getElementById('call-actions');
    var info = document.getElementById('call-info');
    var overlay = document.getElementById('call-overlay');
    if (!overlay || !actions || !statusEl || !info) return;

    overlay.classList.remove('call-video-mode', 'call-voice-mode');
    overlay.classList.add(state.callType === 'video' ? 'call-video-mode' : 'call-voice-mode');

    setText('call-name', state.peerName || 'Sĩ tử EduPulse');
    setText('call-avatar', escapeHtml((state.peerName || 'S').slice(0, 1).toUpperCase()));
    var iconEl = document.getElementById('call-avatar-icon');
    if (iconEl) iconEl.innerHTML = state.callType === 'video' ? '<i class="fa-solid fa-video"></i>' : '<i class="fa-solid fa-phone"></i>';

    var html = '';
    if (mode === 'outgoing') {
      setText('call-status', state.callType === 'video' ? 'Đang gọi video…' : 'Đang gọi thoại…');
      html = '<button type="button" class="call-ctl-btn call-end" id="btn-call-cancel" title="Hủy cuộc gọi"><i class="fa-solid fa-phone-slash"></i></button>';
    } else if (mode === 'incoming') {
      setText('call-status', 'Đang gọi bạn…');
      html =
        '<div class="call-incoming-btns">' +
        '<button type="button" class="call-ctl-btn call-decline" id="btn-call-decline" title="Từ chối"><i class="fa-solid fa-phone-slash"></i></button>' +
        '<button type="button" class="call-ctl-btn call-accept-video" id="btn-call-accept-video" title="Trả lời bằng video"><i class="fa-solid fa-video"></i></button>' +
        '<button type="button" class="call-ctl-btn call-accept" id="btn-call-accept" title="Trả lời thoại"><i class="fa-solid fa-phone"></i></button>' +
        '</div>';
    } else if (mode === 'active') {
      var statusEl = document.getElementById('call-status');
      if (statusEl) statusEl.innerHTML = '<span class="call-timer" id="call-timer">00:00</span>';
      html =
        '<button type="button" class="call-ctl-btn" id="btn-call-mic" title="Tắt/bật mic"><i class="fa-solid fa-microphone"></i></button>' +
        '<button type="button" class="call-ctl-btn" id="btn-call-cam" title="Tắt/bật camera"><i class="fa-solid fa-video"></i></button>' +
        (state.callType === 'video' ? '<button type="button" class="call-ctl-btn" id="btn-call-switch" title="Đổi camera"><i class="fa-solid fa-camera-rotate"></i></button>' : '') +
        '<button type="button" class="call-ctl-btn" id="btn-call-speaker" title="Loa ngoài"><i class="fa-solid fa-volume-high"></i></button>' +
        '<button type="button" class="call-ctl-btn call-end" id="btn-call-end" title="Kết thúc cuộc gọi"><i class="fa-solid fa-phone-slash"></i></button>';
    }
    actions.innerHTML = html;

    if (mode === 'active') {
      bindActiveControls();
      startCallTimer();
    } else {
      stopCallTimer();
    }
  }

  function bindCallOverlayButtons() {
    var overlay = document.getElementById('call-overlay');
    if (!overlay) return;
    overlay.addEventListener('click', function (e) {
      var btn = e.target.closest('button');
      if (!btn) return;
      var id = btn.id;
      if (id === 'btn-call-cancel') endCall1to1();
      else if (id === 'btn-call-decline') declineCall();
      else if (id === 'btn-call-accept') acceptCall('voice');
      else if (id === 'btn-call-accept-video') acceptCall('video');
      else if (id === 'btn-call-end') endCall1to1();
      else if (id === 'btn-call-mic') toggleMic();
      else if (id === 'btn-call-cam') toggleCam();
      else if (id === 'btn-call-switch') toggleCallCam();
      else if (id === 'btn-call-speaker') toggleSpeaker();
    });
  }

  function bindActiveControls() {
    var stateActive = state.callStatus === 'active';
    var micEnabled = state.localStream1 && state.localStream1.getAudioTracks()[0] ? state.localStream1.getAudioTracks()[0].enabled : true;
    var camEnabled = state.localStream1 && state.localStream1.getVideoTracks()[0] ? state.localStream1.getVideoTracks()[0].enabled : true;
    if (!stateActive) return;
    setBtnIcon('#btn-call-mic', 'fa-microphone', 'fa-microphone-slash', micEnabled);
    setBtnIcon('#btn-call-cam', 'fa-video', 'fa-video-slash', camEnabled);
    var speakerOn = state.speakerOn !== false;
    setBtnIcon('#btn-call-speaker', 'fa-volume-high', 'fa-volume-xmark', speakerOn);
  }

  function startCallTimer() {
    if (state.callTimer) return;
    var start = Date.now();
    state.callTimer = setInterval(function () {
      var el = document.getElementById('call-timer');
      if (el) el.textContent = formatDuration(Math.floor((Date.now() - start) / 1000));
    }, 1000);
  }

  function stopCallTimer() {
    if (state.callTimer) { clearInterval(state.callTimer); state.callTimer = null; }
  }

  function formatDuration(sec) {
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return (m < 10 ? '0' + m : m) + ':' + (s < 10 ? '0' + s : s);
  }

  function showCallActive() {
    renderCallOverlay('active');
    showOverlay('call-overlay');
    var local = document.getElementById('call-local-video');
    var remote = document.getElementById('call-remote-video');
    if (local && state.localStream1) local.srcObject = state.localStream1;
    if (remote && state.remoteStream1) remote.srcObject = state.remoteStream1;
  }

  // ---------- 1-1: khởi tạo cuộc gọi ----------
  function startCall(targetUid, targetName, type) {
    if (!requireReady(true)) {
      if (window.EDUPULSE_APP && typeof window.EDUPULSE_APP.openTab === 'function') window.EDUPULSE_APP.openTab('tab-account');
      return;
    }
    if (targetUid === state.user.uid) { toast('Không thể gọi chính mình.', 'warning'); return; }
    if (state.callStatus !== 'idle') { toast('Bạn đang có cuộc gọi khác.', 'warning'); return; }
    if (state.roomActive) { toast('Rời phòng ôn thi trước khi gọi.', 'warning'); return; }

    state.callType = type === 'video' ? 'video' : 'voice';
    state.otherUid = targetUid;
    state.peerName = targetName || 'Sĩ tử EduPulse';
    state.role = 'caller';
    state.callStatus = 'outgoing';

    var doc = state.db.collection('calls').doc();
    state.callId = doc.id;

    doc.set({
      callerUid: state.user.uid,
      callerName: state.myName,
      calleeUid: targetUid,
      calleeName: state.peerName,
      type: state.callType,
      status: 'ringing',
      createdAt: nowSec()
    }).catch(function (err) {
      console.warn('Create call failed:', err);
      toast(err && err.code === 'permission-denied' ? 'Không thể tạo cuộc gọi. Kiểm tra quyền đăng nhập.' : 'Không thể tạo cuộc gọi.', 'warning');
      teardownCall();
    });

    state.callDocUnsub = doc.onSnapshot(function (snap) {
      onCallDocChange(snap);
    }, function (err) { console.warn('Call doc error:', err); });
    subscribeCallSignals();
    notifyCallPush();
    startCallPoll();

    state.callTimeout = setTimeout(function () {
      if (state.callStatus === 'outgoing') {
        doc.get().then(function (snap) {
          if (snap.exists && snap.data().status === 'ringing') {
            snap.ref.update({ status: 'missed' }).then(function () {
              // Đóng UI ngay (không chờ snapshot/poll) để caller không bao giờ kẹt "Đang gọi…"
              if (state.callStatus === 'outgoing') teardownCall('Cuộc gọi đã hết hạn.');
            }).catch(function () {});
          }
        }).catch(function () {});
      }
    }, RING_TIMEOUT_MS);

    showCallOverlay();
    Ringtone.start('outgoing');

    // iOS: getUserMedia ngoài cử chỉ chạm sẽ bị chặn. Xin quyền mic/cam ngay trong cử chỉ,
    // lưu stream lại để startCallMedia dùng khi cuộc gọi được nghe máy.
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia && !state.localStream1) {
        navigator.mediaDevices.getUserMedia({
          audio: true,
          video: state.callType === 'video' ? VIDEO_CONSTRAINTS : false
        }).then(function (stream) {
          // Giữ stream nếu call còn đang chuông HOẶC đã active (callee nghe máy nhanh khi
          // getUserMedia chưa xong). Trước đây nếu callee accept sớm, stream bị vứt → phải xin lại → delay.
          if ((state.callStatus === 'outgoing' || state.callStatus === 'active') && state.callId) {
            state.localStream1 = stream;
            var lv = document.getElementById('call-local-video');
            if (lv) lv.srcObject = stream;
            // Gửi offer NGAY (không chờ snapshot 'active') để callee có sẵn offer khi nghe máy,
            // rút bớt 1 vòng Firestore khỏi đường tới, giảm delay lúc bắt đầu cuộc gọi.
            if (state.role === 'caller' && !state.offerSent) {
              state.offerSent = true;
              setupCallPeer();
              state.pc1.createOffer().then(function (offer) {
                return state.pc1.setLocalDescription(offer);
              }).then(function () {
                sendSignal('sdp', JSON.stringify(state.pc1.localDescription));
              }).catch(function (err) { console.warn('Early offer error:', err); });
            }
          } else {
            stream.getTracks().forEach(function (t) { t.stop(); });
          }
        }).catch(function (err) { console.warn('Pre-call getUserMedia:', err); });
      }
    } catch (e) { /* bỏ qua */ }
  }

  function showCallOverlay() {
    renderCallOverlay('outgoing');
    showOverlay('call-overlay');
    var local = document.getElementById('call-local-video');
    if (local && state.localStream1) local.srcObject = state.localStream1;
  }

  // Dự phòng cho onSnapshot: nếu listener Firestore bị chết (iOS hay đóng băng app ở nền),
  // poll định kỳ vẫn phát hiện status 'active'/'ended' để caller không kẹt ở "Đang gọi…".
  function startCallPoll() {
    stopCallPoll();
    state.callPollTimer = setInterval(function () {
      if (!state.db || !state.callId || state.callStatus === 'idle') return;
      state.db.collection('calls').doc(state.callId).get().then(function (snap) {
        if (snap.exists) onCallDocChange(snap);
      }).catch(function (err) { console.warn('Call poll error:', err); });
    }, 3000);
  }

  function stopCallPoll() {
    if (state.callPollTimer) { clearInterval(state.callPollTimer); state.callPollTimer = null; }
  }

  function onCallDocChange(snap) {
    var d = snap.data();
    if (!d) { teardownCall('Cuộc gọi đã kết thúc.'); return; }
    if (d.status === 'active') {
      if (state.activeStarted) return;
      state.activeStarted = true;
      state.callStatus = 'active';
      clearTimeout(state.callTimeout);
      state.callTimeout = null;
      Ringtone.stop();
      closeCallNotification();
      startCallMedia();
    } else if (d.status === 'ended') {
      closeCallNotification();
      teardownCall('Cuộc gọi đã kết thúc.');
    } else if (d.status === 'declined') {
      closeCallNotification();
      teardownCall('Cuộc gọi bị từ chối.');
    } else if (d.status === 'missed') {
      closeCallNotification();
      if (state.callStatus === 'incoming') teardownCall('Không ai trả lời.');
      else teardownCall('Cuộc gọi đã hết hạn.');
    } else if (d.status === 'busy') {
      closeCallNotification();
      teardownCall('Người nhận đang bận.');
    }
  }

  function subscribeCallSignals() {
    if (!state.db || !state.callId) return;
    if (state.callSignalUnsub) state.callSignalUnsub();
    state.callSignalUnsub = state.db.collection('calls').doc(state.callId).collection('signals')
      .where('to', '==', state.user.uid)
      .onSnapshot(function (snap) {
        snap.forEach(function (doc) {
          var s = doc.data();
          if (!s || s.from !== state.otherUid || s.to !== state.user.uid) return;
          var sigKey = state.callId + '/' + doc.id;
          if (state.processedCallSignals[sigKey]) return;
          state.processedCallSignals[sigKey] = true;
          if (s.kind === 'sdp') {
            var desc = JSON.parse(s.payload);
            if (!state.pc1) { state.pendingOffer = desc; return; }
            handleSdp(desc);
          } else if (s.kind === 'ice') {
            var cand = JSON.parse(s.payload);
            if (!state.pc1) { state.pendingCandidates.push(cand); return; }
            if (state.remoteReady) state.pc1.addIceCandidate(cand).catch(function () {});
            else state.pendingCandidates.push(cand);
          }
          doc.ref.delete().catch(function () {});
        });
      }, function (err) { console.warn('Call signals error:', err); });
  }

  function sendSignal(kind, payload) {
    if (!state.db || !state.callId) return;
    state.db.collection('calls').doc(state.callId).collection('signals').add({
      from: state.user.uid,
      to: state.otherUid,
      kind: kind,
      payload: payload,
      createdAt: nowSec()
    }).catch(function () {});
  }

  // Báo cho Cloudflare Worker push cuộc gọi đến đúng callee (kể cả khi app họ ở nền/đóng).
  function notifyCallPush() {
    var worker = window.EDUPULSE_PUSH_WORKER_URL;
    if (!worker || !state.callId || !state.user) return;
    var payload = {
      callId: state.callId,
      callerUid: state.user.uid,
      callerName: state.myName,
      calleeUid: state.otherUid,
      type: state.callType
    };
    var attempt = 0;
    function send() {
      attempt++;
      fetch(worker + '/notify-call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (!j.ok && attempt < 3) setTimeout(send, 1500);
        });
      }).catch(function () {
        if (attempt < 3) setTimeout(send, 1500);
      });
    }
    send();
  }

  // Đóng notification cuộc gọi trên thiết bị khi trạng thái thay đổi.
  function closeCallNotification() {
    if (state.callId && navigator.serviceWorker && navigator.serviceWorker.controller) {
      try {
        navigator.serviceWorker.controller.postMessage({ type: 'CLOSE_CALL', callId: state.callId });
      } catch (e) { /* bỏ qua */ }
    }
  }

  function handleSdp(desc) {
    var pc = state.pc1;
    if (!pc) return;
    pc.setRemoteDescription(desc).then(function () {
      state.remoteReady = true;
      state.pendingCandidates.forEach(function (c) { pc.addIceCandidate(c).catch(function () {}); });
      state.pendingCandidates = [];
      if (desc.type === 'offer') {
        return pc.createAnswer().then(function (ans) {
          return pc.setLocalDescription(ans);
        }).then(function () {
          sendSignal('sdp', JSON.stringify(pc.localDescription));
        });
      }
    }).catch(function (err) {
      console.warn('setRemoteDescription error:', err);
    });
  }

  function setupCallPeer() {
    if (state.pc1) return;
    var pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    state.pc1 = pc;
    state.localStream1.getTracks().forEach(function (t) { pc.addTrack(t, state.localStream1); });
    pc.onicecandidate = function (ev) {
      if (ev.candidate) sendSignal('ice', JSON.stringify(ev.candidate));
    };
    pc.ontrack = function (ev) {
      if (!state.remoteStream1) state.remoteStream1 = new MediaStream();
      state.remoteStream1.addTrack(ev.track);
      showCallActive();
    };
    pc.onconnectionstatechange = function () {
      if (['failed', 'disconnected'].indexOf(pc.connectionState) !== -1 && state.callStatus === 'active') {
        var statusEl = document.getElementById('call-status');
        if (statusEl) statusEl.textContent = 'Đang kết nối lại…';
      }
    };
  }

  async function startCallMedia() {
    Ringtone.stop();
    var wantVideo = state.callType === 'video';
    try {
      if (!state.localStream1) {
        state.localStream1 = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: wantVideo ? VIDEO_CONSTRAINTS : false
        });
      }
    } catch (err) {
      console.warn('getUserMedia error:', err);
      toast('Không thể truy cập camera/mic. Kiểm tra quyền trình duyệt.', 'warning');
      teardownCall('Không truy cập được thiết bị.');
      return;
    }
    setupCallPeer();
    showCallActive();
    if (state.role === 'caller') {
      if (!state.offerSent) {
        state.offerSent = true;
        try {
          var offer = await state.pc1.createOffer();
          await state.pc1.setLocalDescription(offer);
          sendSignal('sdp', JSON.stringify(offer));
        } catch (err) { console.warn('createOffer error:', err); }
      }
    } else if (state.pendingOffer) {
      handleSdp(state.pendingOffer);
      state.pendingOffer = null;
    }
  }

  function acceptCall(kind) {
    if (state.callStatus !== 'incoming') return;
    state.role = 'callee';
    state.callType = kind === 'video' ? 'video' : 'voice';
    state.callStatus = 'active';
    state.activeStarted = true;
    clearTimeout(state.callTimeout);
    state.callTimeout = null;
    Ringtone.stop();
    state.db.collection('calls').doc(state.callId).update({
      status: 'active',
      type: state.callType,
      answeredAt: nowSec()
    }).catch(function (err) {
      console.warn('Accept call update failed:', err);
      toast('Không thể xác nhận cuộc gọi. Thử lại.', 'warning');
    });
    closeCallNotification();
    // Đính doc listener + poll cho callee để phát hiện khi caller gác máy (status 'ended').
    // Query subscribeIncoming chỉ phản ứng lúc 'incoming', nên cuộc gọi active phải có kênh riêng.
    if (state.callDocUnsub) state.callDocUnsub();
    state.callDocUnsub = state.db.collection('calls').doc(state.callId).onSnapshot(function (snap) {
      onCallDocChange(snap);
    }, function (err) { console.warn('Call doc error (active):', err); });
    startCallPoll();
    subscribeCallSignals();
    startCallMedia();
  }

  function declineCall() {
    if (state.callId && state.db) {
      state.db.collection('calls').doc(state.callId).update({ status: 'declined' }).catch(function () {});
    }
    teardownCall('Đã từ chối cuộc gọi.');
  }

  function endCall1to1() {
    if (state.callStatus === 'idle') return;
    if (state.callId && state.db) {
      var status = state.callStatus === 'active' ? 'ended' : (state.callStatus === 'outgoing' ? 'missed' : 'declined');
      state.db.collection('calls').doc(state.callId).update({ status: status }).catch(function () {});
    }
    teardownCall();
  }

  // Cuộc gọi đến hết hạn (callee không trả lời): cập nhật doc sang 'missed' để không
  // để lại doc 'ringing' mồ côi → lần đăng nhập sau không bị overlay re-ring chặn UI (BUG-15).
  function expireIncomingCall() {
    if (state.callId && state.db) {
      state.db.collection('calls').doc(state.callId).update({ status: 'missed' }).catch(function () {});
    }
    teardownCall('Cuộc gọi đã hết hạn.');
  }

  function callAgeMs(d) {
    if (!d || !d.createdAt) return 0;
    if (typeof d.createdAt.toMillis === 'function') return Date.now() - d.createdAt.toMillis();
    if (typeof d.createdAt.toDate === 'function') return Date.now() - d.createdAt.toDate().getTime();
    return 0;
  }

  function teardownCall(message) {
    if (state.callDocUnsub) { state.callDocUnsub(); state.callDocUnsub = null; }
    if (state.callSignalUnsub) { state.callSignalUnsub(); state.callSignalUnsub = null; }
    state.processedCallSignals = {};
    if (state.callTimeout) { clearTimeout(state.callTimeout); state.callTimeout = null; }
    stopCallPoll();
    Ringtone.stop();
    if (state.pc1) { try { state.pc1.close(); } catch (e) {} state.pc1 = null; }
    if (state.localStream1) { state.localStream1.getTracks().forEach(function (t) { t.stop(); }); state.localStream1 = null; }
    state.remoteStream1 = null;
    state.pendingCandidates = [];
    state.pendingOffer = null;
    state.remoteReady = false;
    state.offerSent = false;
    state.activeStarted = false;
    state.speakerOn = undefined;
    state.callStatus = 'idle';
    state.callId = null;
    state.otherUid = null;
    state.peerName = '';
    state.role = null;
    stopCallTimer();
    hideOverlay('call-overlay');
    if (message) toast(message, 'info');
  }

  function toggleMic() {
    if (!state.localStream1) return;
    var t = state.localStream1.getAudioTracks()[0];
    if (!t) return;
    t.enabled = !t.enabled;
    setBtnIcon('#btn-call-mic', 'fa-microphone', 'fa-microphone-slash', t.enabled);
  }

  function toggleCam() {
    if (!state.localStream1) return;
    var t = state.localStream1.getVideoTracks()[0];
    if (!t) return;
    t.enabled = !t.enabled;
    setBtnIcon('#btn-call-cam', 'fa-video', 'fa-video-slash', t.enabled);
    showCallActive();
  }

  // Đổi camera trước/sau giữa cuộc gọi video (giống nút xoay camera trong phòng ôn thi).
  function toggleCallCam() {
    if (!state.localStream1 || state.callType !== 'video') return;
    var t = state.localStream1.getVideoTracks()[0];
    if (!t) return;
    var next = t.getSettings && t.getSettings().facingMode === 'user' ? 'environment' : 'user';
    t.applyConstraints({ facingMode: next }).catch(function () {});
  }

  function toggleSpeaker() {
    var v = document.getElementById('call-remote-video');
    if (!v) return;
    state.speakerOn = state.speakerOn === false;
    v.muted = !state.speakerOn;
    setBtnIcon('#btn-call-speaker', 'fa-volume-high', 'fa-volume-xmark', state.speakerOn);
  }

  // ---------- Cuộc gọi đến (callee listener) ----------
  // Đổ chuông từ PUSH: iOS ẩn notification khi app đang mở, nên service worker gửi thẳng
  // CALL_INCOMING về trang. Đây là đường dự phòng cho query Firestore (nếu listener lỗi/muộn).
  function showIncomingFromPush(data) {
    if (!data || !data.callId || !data.callerUid) return;
    if (state.callStatus === 'incoming' && state.callId === data.callId) return;
    if (state.callStatus !== 'idle') return;
    if (state.roomActive) {
      if (state.db) state.db.collection('calls').doc(data.callId).update({ status: 'busy' }).catch(function () {});
      return;
    }
    if (!state.user || !state.db) return;
    state.role = 'callee';
    state.callId = data.callId;
    state.callType = data.callType === 'video' ? 'video' : 'voice';
    state.otherUid = data.callerUid;
    state.peerName = data.callerName || 'Sĩ tử EduPulse';
    state.callStatus = 'incoming';
    state.callTimeout = setTimeout(function () {
      if (state.callStatus === 'incoming') expireIncomingCall();
    }, RING_TIMEOUT_MS);
    if (state.callDocUnsub) state.callDocUnsub();
    state.callDocUnsub = state.db.collection('calls').doc(state.callId).onSnapshot(function (snap) {
      onCallDocChange(snap);
    }, function (err) { console.warn('Call doc error (push):', err); });
    renderCallOverlay('incoming');
    showOverlay('call-overlay');
    Ringtone.start('incoming');
  }

  // Mở từ notification (giống app gọi điện khác): hiện ngay màn hình cuộc gọi đến + đổ chuông.
  // Verify doc còn ringing; nếu đã kết thúc thì báo cuộc gọi nhỡ.
  function openCall(data) {
    if (!data || !data.callId) return;
    if (state.callStatus === 'incoming' && state.callId === data.callId) {
      renderCallOverlay('incoming');
      showOverlay('call-overlay');
      Ringtone.start('incoming');
      return;
    }
    if (state.callStatus !== 'idle' || state.roomActive) return;
    var tries = 0;
    (function waitAuth() {
      if (!state.user || !state.db) {
        if (tries++ < 20) setTimeout(waitAuth, 500);
        return;
      }
      state.db.collection('calls').doc(data.callId).get().then(function (snap) {
        if (!snap.exists) {
          toast('Cuộc gọi nhỡ từ ' + (data.callerName || 'Sĩ tử EduPulse'), 'info');
          return;
        }
        var d = snap.data();
        if (d.status === 'ringing') {
          if (state.callStatus === 'idle') {
            showIncomingFromPush({
              callId: data.callId,
              callType: d.type || data.callType,
              callerUid: d.callerUid || data.callerUid,
              callerName: d.callerName || data.callerName
            });
          }
        } else if (d.status !== 'ringing') {
          toast('Cuộc gọi nhỡ từ ' + (d.callerName || data.callerName || 'Sĩ tử EduPulse'), 'info');
        }
      }).catch(function () {});
    })();
  }

  function subscribeIncoming() {
    if (!state.user || !state.db) return;
    if (state.incomingUnsub) state.incomingUnsub();
    state.incomingUnsub = state.db.collection('calls')
      .where('calleeUid', '==', state.user.uid)
      .onSnapshot(function (snap) {
        snap.forEach(function (doc) {
          var d = doc.data();
          if (!d || d.callerUid === state.user.uid) return;
          if (d.status === 'ringing') {
            // Bỏ qua/doc mồ côi đã ringing quá lâu (caller bỏ cuộc, app crash…) — không re-ring
            // mỗi lần đăng nhập (BUG-15).
            if (callAgeMs(d) > RING_TIMEOUT_MS) {
              doc.ref.update({ status: 'missed' }).catch(function () {});
              return;
            }
            if (state.callStatus === 'idle' && !state.roomActive) {
              state.role = 'callee';
              state.callId = doc.id;
              state.callType = d.type === 'video' ? 'video' : 'voice';
              state.otherUid = d.callerUid;
              state.peerName = d.callerName || 'Sĩ tử EduPulse';
              state.callStatus = 'incoming';
              state.callTimeout = setTimeout(function () {
                if (state.callStatus === 'incoming') expireIncomingCall();
              }, RING_TIMEOUT_MS);
              renderCallOverlay('incoming');
              showOverlay('call-overlay');
              Ringtone.start('incoming');
            } else if (state.callStatus === 'incoming' && state.otherUid === d.callerUid) {
              // đã hiển thị, bỏ qua
            } else {
              doc.ref.update({ status: 'busy' }).catch(function () {});
            }
          } else if (['ended', 'declined', 'missed', 'busy'].indexOf(d.status) !== -1) {
            // Chỉ xử lý cuộc gọi HIỆN TẠI. Query trả về cả các cuộc gọi cũ của cùng calleeUid;
            // nếu so theo callerUid sẽ giết nhầm màn hình cuộc gọi mới khi người gọi cũ trùng người.
            if (state.callStatus === 'incoming' || state.callStatus === 'active') {
              if (doc.id === state.callId) {
                closeCallNotification();
                var msg = d.status === 'declined' ? 'Cuộc gọi bị từ chối.' : d.status === 'missed' ? 'Không ai trả lời.' : d.status === 'busy' ? 'Người gọi đã hủy.' : 'Cuộc gọi đã kết thúc.';
                teardownCall(msg);
              }
            }
          }
        });
      }, function (err) {
        console.warn('Incoming calls error:', err);
        // Listener có thể bị chết (mạng, iOS…): đăng ký lại sau 3s để không mất cuộc gọi đến.
        state.incomingUnsub = null;
        setTimeout(function () {
          if (state.user && state.db) subscribeIncoming();
        }, 3000);
      });
  }

  // ---------- Phòng ôn thi trực tiếp (mesh) ----------
  function joinRoom(kind) {
    if (!requireReady(true)) {
      if (window.EDUPULSE_APP && typeof window.EDUPULSE_APP.openTab === 'function') window.EDUPULSE_APP.openTab('tab-account');
      return;
    }
    if (state.callStatus !== 'idle') { toast('Kết thúc cuộc gọi trước khi vào phòng.', 'warning'); return; }
    if (state.roomActive) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      toast('Trình duyệt không hỗ trợ gọi điện.', 'warning');
      return;
    }
    state.roomActive = true;
    state.roomKind = kind === 'video' ? 'video' : 'voice';
    state.roomStart = Date.now();
    renderRoomOverlay();
    showOverlay('room-overlay');
    startRoomTimer();
    // Ghi presence ngay khi vào phòng (trước getUserMedia) để write có thời gian xác nhận
    // sớm nhất (BUG-17: write đầu sau cuộc gọi hay bị kẹt queue).
    writeRoomPresence();
    schedulePresenceVerify();
    navigator.mediaDevices.getUserMedia({
      audio: true,
      video: state.roomKind === 'video' ? ROOM_VIDEO_CONSTRAINTS : false
    }).then(function (stream) {
      state.roomLocalStream = stream;
      writeRoomPresence();
      cleanupStaleRoomSignals();
      subscribeRoomSignals();
      renderRoomOverlay();
      startRoomHeartbeat();
      state.roomCleanupTimer = setInterval(cleanupStaleMembers, ROOM_HEARTBEAT_MS);
      refreshRoomMembers();
    }).catch(function (err) {
      console.warn('Room getUserMedia error:', err);
      toast('Không truy cập được mic/camera. Kiểm tra quyền trình duyệt.', 'warning');
      state.roomActive = false;
      stopRoomTimer();
      hideOverlay('room-overlay');
    });
  }

  function renderRoomOverlay() {
    var overlay = document.getElementById('room-overlay');
    if (!overlay) return;
    overlay.classList.remove('room-video-mode', 'room-voice-mode');
    overlay.classList.add(state.roomKind === 'video' ? 'room-video-mode' : 'room-voice-mode');
    setText('room-kicker', state.roomKind === 'video' ? 'PHÒNG VIDEO' : 'PHÒNG THOẠI');
    setText('room-name', state.myName + (state.roomKind === 'video' ? ' · video' : ' · thoại'));
    renderRoomTiles();
    var actions = document.getElementById('room-actions');
    if (actions && !actions.dataset.bound) {
      actions.dataset.bound = '1';
      actions.innerHTML =
        '<button type="button" class="call-ctl-btn" id="btn-room-mic" title="Tắt/bật mic"><i class="fa-solid fa-microphone"></i></button>' +
        '<button type="button" class="call-ctl-btn" id="btn-room-cam" title="Tắt/bật camera"><i class="fa-solid fa-video"></i></button>' +
        '<button type="button" class="call-ctl-btn" id="btn-room-switch" title="Đổi camera"><i class="fa-solid fa-camera-rotate"></i></button>' +
        '<button type="button" class="call-ctl-btn call-end" id="btn-room-leave" title="Rời phòng"><i class="fa-solid fa-phone-slash"></i></button>';
    }
    updateRoomControlState();
  }

  function renderRoomTiles() {
    var grid = document.getElementById('room-grid');
    if (!grid) return;
    var tiles = [];
    tiles.push(selfTileHtml());
    state.roomPeers.forEach(function (peer) {
      tiles.push(peerTileHtml(peer));
    });
    grid.innerHTML = tiles.join('');
    var selfV = document.getElementById('room-self-video');
    if (selfV && state.roomLocalStream) selfV.srcObject = state.roomLocalStream;
    state.roomPeers.forEach(function (peer) {
      var v = document.getElementById('room-peer-video-' + peer.uid);
      if (v && peer.stream) v.srcObject = peer.stream;
      var a = document.getElementById('room-peer-audio-' + peer.uid);
      if (a && peer.stream) a.srcObject = peer.stream;
    });
  }

  function selfTileHtml() {
    var camOn = state.roomLocalStream && state.roomLocalStream.getVideoTracks().some(function (t) { return t.enabled; });
    var videoHtml = camOn ? '<video id="room-self-video" class="room-tile-video" autoplay playsinline muted></video>' : '';
    var avatarHtml = !camOn ? '<div class="room-tile-avatar">' + escapeHtml((state.myName || 'B').slice(0, 1).toUpperCase()) + '</div>' : '';
    return '<div class="room-tile self">' + videoHtml + avatarHtml +
      '<div class="room-tile-label"><i class="fa-solid fa-user"></i> Bạn</div></div>';
  }

  function peerTileHtml(peer) {
    var showVideo = peer.hasVideo && peer.stream && peer.stream.getVideoTracks().some(function (t) { return t.enabled; });
    var mediaHtml = showVideo
      ? '<video id="room-peer-video-' + escapeHtml(peer.uid) + '" class="room-tile-video" autoplay playsinline></video>'
      : '<audio id="room-peer-audio-' + escapeHtml(peer.uid) + '" class="room-tile-audio" autoplay></audio>';
    var avatarHtml = !showVideo ? '<div class="room-tile-avatar">' + escapeHtml((peer.name || 'S').slice(0, 1).toUpperCase()) + '</div>' : '';
    var connected = peer.pc && (peer.pc.connectionState === 'connected' || peer.pc.connectionState === 'completed');
    var status = connected ? '<span class="room-tile-online">●</span>' : '<span class="room-tile-connecting">Đang kết nối…</span>';
    return '<div class="room-tile">' + mediaHtml + avatarHtml +
      '<div class="room-tile-label">' + escapeHtml(peer.name || 'Sĩ tử EduPulse') + ' ' + status + '</div></div>';
  }

  function writeRoomPresence() {
    if (!state.roomActive || !state.db || !state.user) return Promise.resolve();
    return state.db.collection('rooms').doc('study').collection('members').doc(state.user.uid).set({
      name: state.myName,
      kind: state.roomKind,
      micOn: true,
      camOn: state.roomKind === 'video',
      joinedAt: nowSec(),
      lastSeen: nowSec()
    }).catch(function (err) {
      // BUG-17: đừng nuốt lỗi im lặng — log để chẩn đoán khi write presence thất bại.
      console.warn('Presence write failed:', err);
    });
  }

  // BUG-17: sau cuộc gọi, write presence có thể bị kẹt trong hàng đợi Firestore ~10-30s,
  // khiến doc chỉ tồn tại ở cache local (phantom member) → phòng đếm sai người.
  // Kiểm tra trực tiếp nguồn SERVER; nếu doc chưa có trên server thì ghi lại để tự phục hồi
  // trong vài giây thay vì chờ heartbeat 30s.
  function verifyRoomPresence() {
    if (!state.roomActive || !state.db || !state.user) return;
    state.db.collection('rooms').doc('study').collection('members').doc(state.user.uid)
      .get({ source: 'server' })
      .then(function (snap) {
        if (!snap.exists && state.roomActive) {
          writeRoomPresence();
          schedulePresenceVerify();
        }
      }).catch(function () {});
  }

  function schedulePresenceVerify() {
    if (!state.roomActive) return;
    if (state.presenceVerifyTimer) clearTimeout(state.presenceVerifyTimer);
    state.presenceVerifyTimer = setTimeout(verifyRoomPresence, 2500);
  }

  function subscribeRoomMembers() {
    if (!state.db || !state.user) return;
    if (state.roomMembersUnsub) state.roomMembersUnsub();
    state.roomMembersUnsub = state.db.collection('rooms').doc('study').collection('members')
      .onSnapshot(function (snap) {
        var members = [];
        snap.forEach(function (doc) { members.push({ uid: doc.id, ref: doc.ref, data: doc.data() }); });
        renderRoomList(members);
        if (state.roomActive) {
          syncRoomPeers(members);
          cleanupStaleMembers();
        }
      }, function (err) { console.warn('Room members error:', err); });
  }

  function renderRoomList(members) {
    var el = document.getElementById('room-member-list');
    if (!el) return;
    var now = Date.now();
    var live = members.filter(function (m) {
      var last = m.data.lastSeen && typeof m.data.lastSeen.toDate === 'function' ? m.data.lastSeen.toDate().getTime() : now;
      return now - last <= ROOM_STALE_MS;
    });
    if (!live.length) {
      el.innerHTML = '<span class="chat-room-empty">Chưa có ai trong phòng.</span>';
    } else {
      el.innerHTML = live.map(function (m) {
        var name = m.data.name || 'Sĩ tử EduPulse';
        return '<span class="chat-room-member"><span class="chat-room-member-avatar">' + escapeHtml(name.slice(0, 1).toUpperCase()) + '</span>' +
          escapeHtml(name) + (m.data.kind === 'video' ? '<i class="fa-solid fa-video"></i>' : '') + '</span>';
      }).join('');
    }
    var countEl = document.getElementById('room-member-count-m');
    if (countEl) countEl.textContent = live.length ? (live.length + ' người đang online') : 'Chưa có ai trong phòng';
  }

  function refreshRoomMembers() {
    if (!state.db || !state.user) return;
    state.db.collection('rooms').doc('study').collection('members').get().then(function (snap) {
      var members = [];
      snap.forEach(function (doc) { members.push({ uid: doc.id, ref: doc.ref, data: doc.data() }); });
      syncRoomPeers(members);
    }).catch(function () {});
  }

  function syncRoomPeers(members) {
    if (!state.roomActive) return;
    var now = Date.now();
    var liveUids = new Set();
    members.forEach(function (m) {
      if (!m.data || m.uid === state.user.uid) return;
      var last = m.data.lastSeen && typeof m.data.lastSeen.toDate === 'function' ? m.data.lastSeen.toDate().getTime() : now;
      if (now - last > ROOM_STALE_MS) return;
      liveUids.add(m.uid);
      ensureRoomPeer(m.uid, m.data.name || 'Sĩ tử EduPulse');
    });
    state.roomPeers.forEach(function (peer, uid) {
      if (!liveUids.has(uid)) removeRoomPeer(uid);
    });
    renderRoomTiles();
  }

  function ensureRoomPeer(uid, name) {
    if (state.roomPeers.has(uid)) {
      var existing = state.roomPeers.get(uid);
      existing.name = name || existing.name;
      if (!existing.pc && state.roomLocalStream) createRoomPeerConnection(existing, uid);
      return existing;
    }
    var peer = { uid: uid, name: name || 'Sĩ tử EduPulse', pc: null, pending: [], remoteReady: false, hasVideo: false, stream: null, offered: false };
    state.roomPeers.set(uid, peer);
    if (state.roomLocalStream) createRoomPeerConnection(peer, uid);
    return peer;
  }

  async function createRoomPeerConnection(peer, targetUid) {
    if (peer.pc || !state.roomLocalStream) return;
    var pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    peer.pc = pc;
    state.roomLocalStream.getTracks().forEach(function (t) { pc.addTrack(t, state.roomLocalStream); });
    pc.onicecandidate = function (ev) {
      if (ev.candidate) sendRoomSignal(targetUid, 'ice', JSON.stringify(ev.candidate));
    };
    pc.ontrack = function (ev) {
      if (!peer.stream) peer.stream = new MediaStream();
      peer.stream.addTrack(ev.track);
      if (ev.track.kind === 'video') peer.hasVideo = true;
      renderRoomTiles();
    };
    pc.onconnectionstatechange = function () {
      renderRoomTiles();
    };
    renderRoomTiles();
    if (state.user.uid < targetUid) {
      peer.offered = true;
      try {
        var offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        sendRoomSignal(targetUid, 'sdp', JSON.stringify(offer));
      } catch (err) { console.warn('Room offer error:', err); }
    }
  }

  function removeRoomPeer(uid) {
    var peer = state.roomPeers.get(uid);
    if (!peer) return;
    state.roomPeers.delete(uid);
    if (peer.pc) { try { peer.pc.close(); } catch (e) {} }
    peer.pc = null;
    peer.stream = null;
    renderRoomTiles();
  }

  function subscribeRoomSignals() {
    if (!state.db || !state.user) return;
    if (state.roomSignalsUnsub) state.roomSignalsUnsub();
    state.roomSignalsUnsub = state.db.collection('rooms').doc('study').collection('signals')
      .where('to', '==', state.user.uid)
      .onSnapshot(function (snap) {
        snap.forEach(function (doc) {
          var s = doc.data();
          if (!s || s.from === state.user.uid) return;
          if (state.processedRoomSignals[doc.id]) return;
          state.processedRoomSignals[doc.id] = true;
          // BUG-18: bỏ qua + dọn signal cũ (từ lần vào phòng/phiên WebRTC trước) — áp
          // signal cũ lên RTCPeerConnection mới gây InvalidStateError.
          if (s.createdAt && typeof s.createdAt.toMillis === 'function') {
            if (Date.now() - s.createdAt.toMillis() > ROOM_STALE_MS) {
              doc.ref.delete().catch(function () {});
              return;
            }
          }
          var peer = state.roomPeers.get(s.from);
          if (!peer) peer = ensureRoomPeer(s.from, 'Sĩ tử EduPulse');
          if (!peer || !peer.pc) return;
          if (s.kind === 'sdp') {
            var desc = JSON.parse(s.payload);
            peer.pc.setRemoteDescription(desc).then(function () {
              peer.remoteReady = true;
              peer.pending.forEach(function (c) { peer.pc.addIceCandidate(c).catch(function () {}); });
              peer.pending = [];
              if (desc.type === 'offer') {
                return peer.pc.createAnswer().then(function (ans) {
                  return peer.pc.setLocalDescription(ans);
                }).then(function () {
                  sendRoomSignal(s.from, 'sdp', JSON.stringify(peer.pc.localDescription));
                });
              }
            }).catch(function (err) { console.warn('Room setRemote error:', err); });
          } else if (s.kind === 'ice') {
            var cand = JSON.parse(s.payload);
            if (peer.remoteReady) peer.pc.addIceCandidate(cand).catch(function () {});
            else peer.pending.push(cand);
          }
          doc.ref.delete().catch(function () {});
        });
      }, function (err) { console.warn('Room signals error:', err); });
  }

  function sendRoomSignal(to, kind, payload) {
    if (!state.db || !state.user) return;
    state.db.collection('rooms').doc('study').collection('signals').add({
      from: state.user.uid,
      to: to,
      kind: kind,
      payload: payload,
      createdAt: nowSec()
    }).catch(function () {});
  }

  // Dọn signal cũ (phiên WebRTC trước) dành riêng cho mình khi vào phòng — tránh bị
  // phát lại lên pc mới (BUG-18).
  function cleanupStaleRoomSignals() {
    if (!state.db || !state.user) return;
    state.db.collection('rooms').doc('study').collection('signals')
      .where('to', '==', state.user.uid)
      .get()
      .then(function (snap) {
        var now = Date.now();
        snap.forEach(function (doc) {
          var s = doc.data();
          var stale = !s || !s.createdAt ||
            (typeof s.createdAt.toMillis === 'function' && now - s.createdAt.toMillis() > ROOM_STALE_MS);
          if (stale) doc.ref.delete().catch(function () {});
        });
      }).catch(function () {});
  }

  function leaveRoom() {
    if (!state.roomActive) return;
    state.roomActive = false;
    stopRoomHeartbeat();
    if (state.presenceVerifyTimer) { clearTimeout(state.presenceVerifyTimer); state.presenceVerifyTimer = null; }
    if (state.roomCleanupTimer) { clearInterval(state.roomCleanupTimer); state.roomCleanupTimer = null; }
    if (state.roomSignalsUnsub) { state.roomSignalsUnsub(); state.roomSignalsUnsub = null; }
    state.processedRoomSignals = {};
    if (state.db && state.user) {
      state.db.collection('rooms').doc('study').collection('members').doc(state.user.uid).delete().catch(function () {});
    }
    state.roomPeers.forEach(function (peer) {
      if (peer.pc) { try { peer.pc.close(); } catch (e) {} }
    });
    state.roomPeers.clear();
    if (state.roomLocalStream) { state.roomLocalStream.getTracks().forEach(function (t) { t.stop(); }); state.roomLocalStream = null; }
    stopRoomTimer();
    hideOverlay('room-overlay');
    toast('Đã rời phòng ôn thi.', 'info');
  }

  // Heartbeat phòng chạy bằng Web Worker — không bị throttling khi tab nền/ẩn (BUG-12),
  // nên lastSeen luôn mới → thành viên không bị cleanup oan sau ROOM_STALE_MS.
  function startRoomHeartbeat() {
    stopRoomHeartbeat();
    try {
      var blob = new Blob(
        ["(function(){setInterval(function(){postMessage('hb');}," + ROOM_HEARTBEAT_MS + ");})();"],
        { type: 'text/javascript' }
      );
      var workerUrl = URL.createObjectURL(blob);
      state.roomHeartbeatWorker = new Worker(workerUrl);
      state.roomHeartbeatWorker.onmessage = function () { writeRoomPresence(); };
    } catch (e) {
      // Môi trường không có Worker → fallback setInterval
      state.roomHeartbeatTimer = setInterval(writeRoomPresence, ROOM_HEARTBEAT_MS);
    }
    if (document.visibilityState === 'hidden') writeRoomPresence();
    if (!state.roomVisibilityBound) {
      state.roomVisibilityBound = true;
      document.addEventListener('visibilitychange', function () {
        if (state.roomActive && document.visibilityState === 'hidden') {
          // Ghi heartbeat ngay khi ẩn tab — tránh bị cleanup khi trình duyệt đóng băng JS.
          writeRoomPresence();
        }
      });
    }
  }

  function stopRoomHeartbeat() {
    if (state.roomHeartbeatWorker) {
      try { state.roomHeartbeatWorker.terminate(); } catch (e) {}
      state.roomHeartbeatWorker = null;
    }
    if (state.roomHeartbeatTimer) {
      clearInterval(state.roomHeartbeatTimer);
      state.roomHeartbeatTimer = null;
    }
  }

  function cleanupStaleMembers() {
    if (!state.db) return;
    var now = Date.now();
    state.db.collection('rooms').doc('study').collection('members').get().then(function (snap) {
      snap.forEach(function (doc) {
        var d = doc.data();
        var last = d.lastSeen && typeof d.lastSeen.toDate === 'function' ? d.lastSeen.toDate().getTime() : now;
        if (now - last > ROOM_STALE_MS) {
          if (doc.id !== state.user.uid) doc.ref.delete().catch(function () {});
        }
      });
    }).catch(function () {});
  }

  function updateRoomControlState() {
    var micOn = !(state.roomLocalStream && state.roomLocalStream.getAudioTracks()[0] && !state.roomLocalStream.getAudioTracks()[0].enabled);
    setBtnIcon('#btn-room-mic', 'fa-microphone', 'fa-microphone-slash', micOn);
    var camOn = !(state.roomLocalStream && state.roomLocalStream.getVideoTracks()[0] && !state.roomLocalStream.getVideoTracks()[0].enabled);
    setBtnIcon('#btn-room-cam', 'fa-video', 'fa-video-slash', camOn);
    var btnCam = document.getElementById('btn-room-cam');
    if (btnCam) btnCam.disabled = state.roomKind !== 'video';
    var btnSwitch = document.getElementById('btn-room-switch');
    if (btnSwitch) btnSwitch.disabled = state.roomKind !== 'video';
  }

  function toggleRoomMic() {
    if (!state.roomLocalStream) return;
    var t = state.roomLocalStream.getAudioTracks()[0];
    if (!t) return;
    t.enabled = !t.enabled;
    updateRoomControlState();
    if (state.db && state.user) {
      state.db.collection('rooms').doc('study').collection('members').doc(state.user.uid).update({ micOn: t.enabled }).catch(function () {});
    }
  }

  function toggleRoomCam() {
    if (!state.roomLocalStream || state.roomKind !== 'video') return;
    var t = state.roomLocalStream.getVideoTracks()[0];
    if (!t) return;
    t.enabled = !t.enabled;
    updateRoomControlState();
    renderRoomTiles();
    if (state.db && state.user) {
      state.db.collection('rooms').doc('study').collection('members').doc(state.user.uid).update({ camOn: t.enabled }).catch(function () {});
    }
  }

  function switchRoomCamera() {
    if (!state.roomLocalStream || state.roomKind !== 'video') return;
    var t = state.roomLocalStream.getVideoTracks()[0];
    if (!t) return;
    var next = t.getSettings && t.getSettings().facingMode === 'user' ? 'environment' : 'user';
    t.applyConstraints({ facingMode: next }).catch(function () {});
  }

  function startRoomTimer() {
    if (state.roomTimer) clearInterval(state.roomTimer);
    var start = state.roomStart;
    state.roomTimer = setInterval(function () {
      var el = document.getElementById('room-timer');
      if (el) el.textContent = formatDuration(Math.floor((Date.now() - start) / 1000));
    }, 1000);
  }

  function stopRoomTimer() {
    if (state.roomTimer) { clearInterval(state.roomTimer); state.roomTimer = null; }
  }

  function bindRoomOverlayButtons() {
    var overlay = document.getElementById('room-overlay');
    if (!overlay) return;
    overlay.addEventListener('click', function (e) {
      var btn = e.target.closest('button');
      if (!btn) return;
      if (btn.id === 'btn-room-mic') toggleRoomMic();
      else if (btn.id === 'btn-room-cam') toggleRoomCam();
      else if (btn.id === 'btn-room-switch') switchRoomCamera();
      else if (btn.id === 'btn-room-leave') leaveRoom();
    });
  }

  function bindRoomJoinButtons() {
    var bv = document.getElementById('btn-room-join-voice');
    var bvid = document.getElementById('btn-room-join-video');
    var bvm = document.getElementById('btn-room-join-voice-m');
    var bvidm = document.getElementById('btn-room-join-video-m');
    if (bv) bv.addEventListener('click', function () { joinRoom('voice'); });
    if (bvid) bvid.addEventListener('click', function () { joinRoom('video'); });
    if (bvm) bvm.addEventListener('click', function () { joinRoom('voice'); });
    if (bvidm) bvidm.addEventListener('click', function () { joinRoom('video'); });
  }

  // ---------- Delegated: nút gọi trên tin nhắn ----------
  function bindCallButtons() {
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-call-user]');
      if (!btn) return;
      e.preventDefault();
      var uid = btn.getAttribute('data-call-user');
      var name = btn.getAttribute('data-call-name') || '';
      var type = btn.getAttribute('data-call-type') || 'voice';
      if (!uid) return;
      startCall(uid, name, type);
    });
  }

  // ---------- Quyền camera/micro (xin 1 lần, sau đó mọi cuộc gọi tự kết nối) ----------
  var MediaGate = {
    _primed: false,
    isSupported: function () {
      return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    },
    status: function () {
      var self = this;
      if (this._primed) return Promise.resolve('granted');
      var cached = null;
      try { cached = localStorage.getItem('edupulse_media_granted'); } catch (e) { cached = null; }
      if (cached === '1') { this._primed = true; return Promise.resolve('granted'); }
      if (!this.isSupported()) return Promise.resolve('unsupported');
      if (navigator.permissions && navigator.permissions.query) {
        return Promise.all([
          navigator.permissions.query({ name: 'camera' }).catch(function () { return { state: 'prompt' }; }),
          navigator.permissions.query({ name: 'microphone' }).catch(function () { return { state: 'prompt' }; })
        ]).then(function (rs) {
          var c = rs[0].state, m = rs[1].state;
          if (c === 'granted' && m === 'granted') { self._primed = true; return 'granted'; }
          if (c === 'denied' || m === 'denied') return 'denied';
          return 'prompt';
        });
      }
      return Promise.resolve('prompt');
    },
    // Bấm nút trong cử chỉ chạm: xin quyền lần đầu (hoặc phát hiện đã cấp).
    ensure: function () {
      var self = this;
      return this.status().then(function (st) {
        if (st === 'granted') return true;
        if (st === 'unsupported') return false;
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return false;
        return navigator.mediaDevices.getUserMedia({
          audio: true,
          video: { width: { ideal: 640 }, height: { ideal: 480 } }
        }).then(function (stream) {
          stream.getTracks().forEach(function (t) { t.stop(); });
          self._primed = true;
          try { localStorage.setItem('edupulse_media_granted', '1'); } catch (e) {}
          return true;
        }).catch(function () { return false; });
      });
    },
    refreshToggle: function () {
      var section = document.getElementById('media-toggle-section');
      var label = document.getElementById('media-status-label');
      if (!section || !label) return;
      if (!this.isSupported()) { section.hidden = true; return; }
      section.hidden = false;
      this.status().then(function (st) {
        if (st === 'granted') {
          label.textContent = 'Đã bật · tự kết nối';
          label.style.color = 'var(--success)';
        } else if (st === 'denied') {
          label.textContent = 'Bị chặn · bấm để bật lại';
          label.style.color = 'var(--danger)';
        } else {
          label.textContent = 'Chưa bật';
          label.style.color = 'var(--text-muted)';
        }
      });
    },
    initToggle: function () {
      var self = this;
      var button = document.getElementById('btn-toggle-media');
      if (!button) return;
      button.addEventListener('click', function () {
        button.disabled = true;
        self.ensure().then(function (ok) {
          if (ok) toast('Đã bật camera & micro. Gọi điện sẽ tự kết nối.', 'success');
          else toast('Không thể bật. Vào Cài đặt thiết bị để cho phép camera & micro.', 'warning');
          self.refreshToggle();
        }).finally(function () { button.disabled = false; });
      });
      this.refreshToggle();
    }
  };

  // ---------- Auth ----------
  function onAuthChange(user) {
    var wasAuthed = !!state.user;
    state.user = (user && !user.isAnonymous) ? user : null;
    if (state.user && window.EDUPULSE_APP && typeof window.EDUPULSE_APP.getDb === 'function') {
      state.db = window.EDUPULSE_APP.getDb() || null;
    } else {
      state.db = null;
    }
    if (!state.user) {
      leaveRoom();
      teardownCall();
      if (state.incomingUnsub) { state.incomingUnsub(); state.incomingUnsub = null; }
      if (state.roomMembersUnsub) { state.roomMembersUnsub(); state.roomMembersUnsub = null; }
      state.db = null;
      return;
    }
    state.myName = truncateUtf8Bytes(user.displayName || (user.email ? user.email.split('@')[0] : 'Sĩ tử EduPulse'), 32);
    subscribeIncoming();
    subscribeRoomMembers();
  }

  function init() {
    bindCallOverlayButtons();
    bindRoomOverlayButtons();
    bindRoomJoinButtons();
    bindCallButtons();
    MediaGate.initToggle();
    // Cuộc gọi đến qua push khi app đang mở (iOS ẩn notification ở foreground)
    if (navigator.serviceWorker && navigator.serviceWorker.addEventListener) {
      navigator.serviceWorker.addEventListener('message', function (event) {
        var msg = event.data;
        if (!msg || msg.type !== 'CALL_INCOMING') return;
        Ringtone.unlock();
        showIncomingFromPush(msg.data || {});
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.addEventListener('pagehide', function () {
    if (state.roomActive) {
      if (state.db && state.user) {
        state.db.collection('rooms').doc('study').collection('members').doc(state.user.uid).delete().catch(function () {});
      }
    }
    if (state.callStatus === 'active' && state.callId && state.db) {
      state.db.collection('calls').doc(state.callId).update({ status: 'ended' }).catch(function () {});
    }
  });

  window.EduPulseCalls = {
    onAuthChange: onAuthChange,
    startCall: startCall,
    joinRoom: joinRoom,
    leaveRoom: leaveRoom,
    isInCall: function () { return state.callStatus !== 'idle'; },
    isInRoom: function () { return state.roomActive; },
    openCall: openCall,
    mediaGate: {
      status: function () { return MediaGate.status(); },
      ensure: function () { return MediaGate.ensure(); },
      refreshToggle: function () { MediaGate.refreshToggle(); }
    }
  };
}());