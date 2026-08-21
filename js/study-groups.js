/* EduPulse Study Groups — nhóm học nhỏ: chia sẻ tài liệu & giao bài tập cho nhau */
(function () {
  'use strict';

  var state = {
    user: null,
    db: null,
    groups: [],
    openGroupId: null,
    unsubs: {},
    uploading: false
  };

  function $(id) { return document.getElementById(id); }

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
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

  // Cắt chuỗi theo byte UTF-8 (khớp quy tắc Firestore `.size()`)
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

  function myName() {
    if (!state.user) return 'Sĩ tử EduPulse';
    return truncateUtf8Bytes(state.user.displayName || (state.user.email ? state.user.email.split('@')[0] : 'Sĩ tử EduPulse'), 32);
  }

  function requireReady(verbose) {
    if (!state.user || !state.db || !state.user.emailVerified) {
      if (verbose) {
        if (!state.user || !state.db) {
          toast('Đăng nhập và xác thực email để dùng Học nhóm.', 'warning');
        } else {
          toast('Tài khoản chưa xác thực email — mở email đã đăng ký, bấm liên kết xác thực rồi thử lại.', 'warning');
        }
        if (window.EDUPULSE_APP && typeof window.EDUPULSE_APP.openTab === 'function') window.EDUPULSE_APP.openTab('tab-account');
      }
      return false;
    }
    return true;
  }

  function fv() {
    return window.firebase && window.firebase.firestore ? window.firebase.firestore.FieldValue : null;
  }

  function ts() {
    var f = fv();
    return f ? f.serverTimestamp() : new Date();
  }

  function groupRef(id) {
    return state.db.collection('groups').doc(id);
  }

  // ---------- AUTH ----------
  function onAuthChange(user) {
    var wasAuthed = !!state.user;
    state.user = (user && !user.isAnonymous) ? user : null;
    if (state.user && window.EDUPULSE_APP && typeof window.EDUPULSE_APP.getDb === 'function') {
      state.db = window.EDUPULSE_APP.getDb() || null;
    } else {
      state.db = null;
    }
    tearDownSubs();
    if (!state.user) {
      state.groups = [];
      state.openGroupId = null;
      render();
      return;
    }
    subscribeMyGroups();
    render();
  }

  function tearDownSubs() {
    Object.keys(state.unsubs).forEach(function (key) {
      try { if (typeof state.unsubs[key] === 'function') state.unsubs[key](); } catch (e) { /* noop */ }
    });
    state.unsubs = {};
  }

  // ---------- SUBSCRIPTIONS ----------
  function subscribeMyGroups() {
    if (!state.db || !state.user) return;
    try {
      state.unsubs.myGroups = state.db.collection('groups')
        .where('memberUids', 'array-contains', state.user.uid)
        .onSnapshot(function (snap) {
          state.groups = snap.docs.map(function (doc) { return { id: doc.id, data: doc.data() }; })
            .sort(function (a, b) {
              var ta = a.data && a.data.createdAt && a.data.createdAt.toMillis ? a.data.createdAt.toMillis() : 0;
              var tb = b.data && b.data.createdAt && b.data.createdAt.toMillis ? b.data.createdAt.toMillis() : 0;
              return tb - ta;
            });
          if (state.openGroupId && !state.groups.some(function (g) { return g.id === state.openGroupId; })) {
            state.openGroupId = null;
          }
          render();
        }, function (err) {
          console.warn('subscribeMyGroups failed:', err && err.message || err);
        });
    } catch (e) {
      console.warn('subscribeMyGroups failed:', e);
    }
  }

  // Nhóm tạo trước khi có groupCodes: chủ nhóm mở nhóm sẽ tự đăng ký lại mã
  function healInviteCode(gid, data) {
    if (!data || data.ownerUid !== state.user.uid || !data.joinCode) return;
    state._healedCodes = state._healedCodes || {};
    if (state._healedCodes[gid]) return;
    state._healedCodes[gid] = true;
    var ref = state.db.collection('groupCodes').doc(data.joinCode);
    ref.get().then(function (s) {
      if (!s.exists) return ref.set({ groupId: gid, groupName: data.name || '' });
      return null;
    }).catch(function (e) {
      console.warn('healInviteCode failed:', e && e.message || e);
    });
  }

  function subscribeGroup() {
    var gid = state.openGroupId;
    if (!gid || !state.db || !state.user) return;
    try {
      state.unsubs.group = groupRef(gid).onSnapshot(function (doc) {
        if (doc.exists) {
          var g = state.groups.find(function (x) { return x.id === gid; });
          if (g) g.data = doc.data();
          healInviteCode(gid, doc.data());
        }
        renderDetail();
      });
      state.unsubs.members = groupRef(gid).collection('members').onSnapshot(function (snap) {
        state.members = snap.docs.map(function (d) { return { id: d.id, data: d.data() }; }).sort(function (a, b) {
          return (a.data.role === 'owner' ? 0 : 1) - (b.data.role === 'owner' ? 0 : 1);
        });
        renderDetail();
      });
      state.unsubs.files = groupRef(gid).collection('files').orderBy('createdAt', 'desc').onSnapshot(function (snap) {
        state.files = snap.docs.map(function (d) { return { id: d.id, data: d.data() }; });
        renderDetail();
      });
      state.unsubs.assignments = groupRef(gid).collection('assignments').orderBy('createdAt', 'desc').onSnapshot(function (snap) {
        state.assignments = snap.docs.map(function (d) { return { id: d.id, data: d.data() }; });
        renderDetail();
      });
    } catch (e) {
      console.warn('subscribeGroup failed:', e);
    }
  }

  // ---------- GROUP ACTIONS ----------
  function makeJoinCode() {
    var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    var code = '';
    for (var i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
  }

  async function createGroup(name) {
    if (!requireReady(true)) return;
    name = (name || '').trim();
    if (!name) { toast('Nhập tên nhóm.', 'warning'); return; }
    if (name.length > 50) { toast('Tên nhóm tối đa 50 ký tự.', 'warning'); return; }
    try {
      await state.user.getIdToken(true);
      var uid = state.user.uid;
      var gid = 'grp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      // Đăng ký mã mời trước (retry nếu trùng mã hi hữu)
      var joinCode = '';
      for (var attempt = 0; attempt < 3; attempt++) {
        joinCode = makeJoinCode();
        try {
          await state.db.collection('groupCodes').doc(joinCode).set({ groupId: gid, groupName: name });
          break;
        } catch (codeErr) {
          if (attempt === 2) throw codeErr;
        }
      }
      var groupData = {
        name: name,
        joinCode: joinCode,
        ownerUid: uid,
        memberUids: [uid],
        memberCount: 1,
        createdAt: ts()
      };
      try {
        await groupRef(gid).set(groupData);
      } catch (groupErr) {
        await state.db.collection('groupCodes').doc(joinCode).delete().catch(function () { /* rollback */ });
        throw groupErr;
      }
      try {
        await groupRef(gid).collection('members').doc(uid).set({
          uid: uid,
          name: myName(),
          role: 'owner',
          joinedAt: ts()
        });
      } catch (memberErr) {
        await groupRef(gid).delete().catch(function () { /* rollback */ });
        await state.db.collection('groupCodes').doc(joinCode).delete().catch(function () { /* rollback */ });
        throw memberErr;
      }
      state.groups.unshift({ id: gid, data: groupData });
      state.openGroupId = gid;
      subscribeGroup();
      render();
      toast('Đã tạo nhóm "' + name + '".', 'success');
    } catch (err) {
      toast('Không tạo được nhóm: ' + (err.code || err.message), 'warning');
    }
  }

  async function joinGroup(code) {
    if (!requireReady(true)) return;
    code = (code || '').trim().toUpperCase();
    if (code.length !== 6) { toast('Mã mời gồm 6 ký tự.', 'warning'); return; }
    try {
      await state.user.getIdToken(true);
      // Tra mã qua collection ánh xạ (người ngoài không đọc được group trực tiếp)
      var codeSnap = await state.db.collection('groupCodes').doc(code).get();
      if (!codeSnap.exists) { toast('Không tìm thấy nhóm với mã này.', 'warning'); return; }
      var ref = codeSnap.data() || {};
      var gid = ref.groupId;
      if (!gid) { toast('Mã mời không hợp lệ.', 'warning'); return; }

      // Đọc được group = đã là thành viên → mở luôn
      var gSnap = null;
      try { gSnap = await groupRef(gid).get(); } catch (readErr) { gSnap = null; }
      if (gSnap && gSnap.exists) {
        toast('Bạn đã ở trong nhóm này rồi.', 'info');
        state.openGroupId = gid;
        subscribeGroup();
        render();
        return;
      }

      var uid = state.user.uid;
      var batch = state.db.batch();
      batch.set(groupRef(gid).collection('members').doc(uid), {
        uid: uid,
        name: myName(),
        role: 'member',
        joinedAt: ts()
      });
      batch.update(groupRef(gid), {
        memberUids: fv().arrayUnion(uid),
        memberCount: fv().increment(1)
      });
      await batch.commit();
      state.openGroupId = gid;
      subscribeGroup();
      render();
      toast('Đã tham gia nhóm "' + (ref.groupName || 'nhóm') + '".', 'success');
    } catch (err) {
      if (err && err.code === 'permission-denied') {
        toast('Không tham gia được: nhóm đã đầy (tối đa 20 thành viên) hoặc mã không hợp lệ.', 'warning');
      } else {
        toast('Không tham gia được nhóm: ' + (err.code || err.message), 'warning');
      }
    }
  }

  async function leaveGroup(gid) {
    if (!requireReady(true)) return;
    var g = state.groups.find(function (x) { return x.id === gid; });
    var isOwner = g && g.data.ownerUid === state.user.uid;
    if (isOwner) {
      if (!confirm('Bạn là chủ nhóm. Rời nhóm sẽ xóa nhóm cho mọi người. Tiếp tục?')) return;
    } else if (!confirm('Rời khỏi nhóm này?')) return;
    try {
      var uid = state.user.uid;
      var batch = state.db.batch();
      batch.delete(groupRef(gid).collection('members').doc(uid));
      if (isOwner) {
        batch.delete(groupRef(gid));
        if (g.data.joinCode) {
          batch.delete(state.db.collection('groupCodes').doc(g.data.joinCode));
        }
      } else {
        batch.update(groupRef(gid), {
          memberUids: fv().arrayRemove(uid),
          memberCount: fv().increment(-1)
        });
      }
      await batch.commit();
      if (state.openGroupId === gid) state.openGroupId = null;
      toast(isOwner ? 'Đã xóa nhóm.' : 'Đã rời nhóm.', 'success');
    } catch (err) {
      toast('Không rời được nhóm: ' + (err.code || err.message), 'warning');
    }
  }

  // ---------- FILES ----------
  var MAX_FILE_BYTES = 20 * 1024 * 1024;
  var CHUNK_SIZE = 700000; // base64 ~933KB < giới hạn 1MiB/tài liệu Firestore
  var CHUNKS_PER_BATCH = 6;

  function bytesToBase64(bytes) {
    var binary = '';
    var blockSize = 8192;
    for (var start = 0; start < bytes.length; start += blockSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(start, start + blockSize));
    }
    return btoa(binary);
  }

  // Ghi file thành chunks (chunk trước, meta sau — lỗi giữa chừng không lộ file hỏng)
  async function writeFileChunks(gid, file, fileId, onProgress) {
    var bytes = new Uint8Array(await file.arrayBuffer());
    var chunkCount = Math.ceil(bytes.length / CHUNK_SIZE) || 1;
    var fileRef = groupRef(gid).collection('files').doc(fileId);
    for (var start = 0; start < chunkCount; start += CHUNKS_PER_BATCH) {
      var batch = state.db.batch();
      for (var index = start; index < Math.min(start + CHUNKS_PER_BATCH, chunkCount); index++) {
        var chunk = bytes.slice(index * CHUNK_SIZE, Math.min((index + 1) * CHUNK_SIZE, bytes.length));
        batch.set(fileRef.collection('chunks').doc(String(index).padStart(4, '0')), {
          authorId: state.user.uid,
          index: index,
          data: bytesToBase64(chunk)
        });
      }
      await batch.commit();
      if (onProgress) onProgress(Math.min(start + CHUNKS_PER_BATCH, chunkCount), chunkCount);
    }
    await state.db.batch().set(fileRef, {
      name: file.name.slice(0, 150),
      type: file.type || 'application/octet-stream',
      size: file.size,
      authorId: state.user.uid,
      authorName: myName(),
      chunkCount: chunkCount,
      createdAt: ts()
    }).commit();
    return chunkCount;
  }

  // Lưu file: ưu tiên Supabase Storage (nếu đã cấu hình), fallback Firestore chunks
  function supabaseUploadUrl() {
    var cfg = window.SUPABASE_STORAGE || {};
    return cfg.uploadUrl || '';
  }

  async function storeGroupFile(gid, file, fileId, onProgress) {
    var uploadUrl = supabaseUploadUrl();
    if (uploadUrl) {
      var token = await state.user.getIdToken(true);
      var fd = new FormData();
      fd.append('file', file, file.name);
      var res = await fetch(uploadUrl, { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: fd });
      var data = null;
      try { data = await res.json(); } catch (e) { /* bỏ qua */ }
      if (!res.ok || !data || !data.url) {
        throw new Error((data && data.error === 'upload_failed' && data.detail ? 'upload_failed: ' + data.detail : (data && data.error) || ('HTTP ' + res.status)));
      }
      await state.db.batch().set(groupRef(gid).collection('files').doc(fileId), {
        name: file.name.slice(0, 150),
        type: file.type || 'application/octet-stream',
        size: file.size,
        authorId: state.user.uid,
        authorName: myName(),
        storageUrl: data.url,
        chunkCount: 1, // không dùng chunks khi lưu Supabase — chỉ để thỏa mãn rules
        createdAt: ts()
      }).commit();
      return;
    }
    await writeFileChunks(gid, file, fileId, onProgress);
  }

  // Chuyển Word/Excel/TXT sang PDF trước khi lưu (lỗi thì giữ file gốc)
  async function prepareFileForUpload(file, onStatus) {
    if (!file) return file;
    var api = window.EduPulseDoc2Pdf;
    if (!api || typeof api.toPdf !== 'function') return file;
    var r = await api.toPdf(file, onStatus);
    if (r && r.blob && r.blob.size <= MAX_FILE_BYTES) {
      return { blob: r.blob, name: r.name, type: r.type };
    }
    return { blob: file, name: file.name, type: file.type };
  }

  async function uploadFile(file) {
    if (!requireReady(true)) return;
    if (!state.openGroupId) return;
    var allowedTypes = new Set([
      'application/pdf', 'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain'
    ]);
    if (!file) return;
    var effType = file.type || 'text/plain';
    if (file.size > MAX_FILE_BYTES || (!allowedTypes.has(effType) && !effType.startsWith('image/'))) {
      toast('Hỗ trợ ảnh hoặc tài liệu tối đa 20 MB (PDF, Word, PowerPoint, Excel, TXT).', 'warning');
      return;
    }
    if (state.uploading) return;
    state.uploading = true;
    var btn = $('btn-g-file-upload');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang tải…'; }
    try {
      await state.user.getIdToken(true);
      var gid = state.openGroupId;
      var fileId = 'gfile_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
      var prepared = await prepareFileForUpload(file, function (status) {
        if (btn && status) btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> ' + status;
      });
      var upFile = new File([prepared.blob], prepared.name, { type: prepared.type });
      await storeGroupFile(gid, upFile, fileId, function (done, total) {
        if (btn) btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> ' + Math.round(done / total * 100) + '%';
      });
      toast(prepared.name !== file.name ? 'Đã chia sẻ "' + prepared.name + '" vào nhóm.' : 'Đã chia sẻ tài liệu vào nhóm.', 'success');
    } catch (err) {
      toast('Không chia sẻ được tài liệu: ' + (err.code || err.message), 'warning');
    } finally {
      state.uploading = false;
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-upload"></i> Chia sẻ'; }
      var input = $('g-file-input');
      if (input) input.value = '';
    }
  }

  async function getFileBlob(gid, fileId) {
    var fileRef = groupRef(gid).collection('files').doc(fileId);
    var snap = await fileRef.get();
    var chunksSnap = await fileRef.collection('chunks').orderBy('index').get();
    if (!snap.exists || chunksSnap.empty) throw new Error('File not found');
    var parts = [];
    chunksSnap.forEach(function (chunkDoc) {
      var binary = atob(chunkDoc.data().data);
      var bytes = new Uint8Array(binary.length);
      for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      parts.push(bytes);
    });
    return { blob: new Blob(parts, { type: snap.data().type || 'application/octet-stream' }), name: snap.data().name };
  }

  // Lấy Blob của file bất kể nguồn lưu trữ (Supabase URL hoặc Firestore chunks)
  async function fetchGroupFileBlob(gid, fileId) {
    var snap = await groupRef(gid).collection('files').doc(fileId).get();
    var meta = snap.exists ? (snap.data() || {}) : {};
    if (meta.storageUrl) {
      var res = await fetch(meta.storageUrl);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var blob = await res.blob();
      return { blob: blob, name: meta.name, type: meta.type || blob.type };
    }
    var legacy = await getFileBlob(gid, fileId);
    return { blob: legacy.blob, name: meta.name || legacy.name, type: meta.type };
  }

  // ---------- ACTION SHEET: LƯU VÀO APP / LƯU VÀO MÁY ----------
  var sheetCtx = null;

  function ensureActionSheet() {
    var el = document.getElementById('g-file-action-sheet');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'g-file-action-sheet';
    el.innerHTML =
      '<div class="fas-backdrop"></div>' +
      '<div class="fas-panel" role="dialog" aria-label="Tùy chọn lưu tệp">' +
        '<div class="fas-title">Lưu tệp này vào đâu?</div>' +
        '<button type="button" class="fas-option" data-act="app"><i class="fa-solid fa-book-open"></i><span><strong>Lưu vào app</strong><small>Vào “Tài liệu của tôi” — xem lại cả khi không có mạng</small></span></button>' +
        '<button type="button" class="fas-option" data-act="device"><i class="fa-solid fa-download"></i><span><strong>Lưu vào máy</strong><small>Tải tệp về thiết bị</small></span></button>' +
        '<button type="button" class="fas-cancel">Hủy</button>' +
      '</div>';
    document.body.appendChild(el);
    el.querySelector('.fas-backdrop').addEventListener('click', closeActionSheet);
    el.querySelector('.fas-cancel').addEventListener('click', closeActionSheet);
    el.querySelectorAll('[data-act]').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        if (!sheetCtx) return;
        var ctx = sheetCtx;
        var act = btn.getAttribute('data-act');
        el.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
        try {
          var f = await (ctx.blobPromise || fetchGroupFileBlob(ctx.gid, ctx.fileId));
          if (!f) throw new Error('Không tải được tệp');
          if (act === 'device') {
            saveToDevice(f.blob, ctx.name || f.name);
            toast('Đã lưu vào máy.', 'success');
          } else {
            var lib = window.EduPulseLibrary;
            if (!lib || typeof lib.saveBlob !== 'function') throw new Error('Thiếu bộ lưu thư viện');
            var r = await lib.saveBlob(f.blob, ctx.name || f.name, f.type);
            toast(r && r.duplicate ? 'Tệp này đã có trong Tài liệu của tôi.' : 'Đã lưu vào Tài liệu của tôi.', 'success');
          }
        } catch (err) {
          toast('Không thực hiện được: ' + (err.message || err), 'warning');
        } finally {
          closeActionSheet();
        }
      });
    });
    return el;
  }

  function openFileActionSheet(gid, fileId, name) {
    if (!requireReady(true)) return;
    // Tải sẵn blob trong lúc người dùng đọc sheet — iOS cần share() gần gesture
    sheetCtx = { gid: gid, fileId: fileId, name: name, blobPromise: fetchGroupFileBlob(gid, fileId).catch(function () { return null; }) };
    ensureActionSheet().classList.add('open');
  }

  function closeActionSheet() {
    var el = document.getElementById('g-file-action-sheet');
    if (el) {
      el.classList.remove('open');
      el.querySelectorAll('button').forEach(function (b) { b.disabled = false; });
    }
    sheetCtx = null;
  }

  // Lưu vào máy: tải xuống trực tiếp
  function saveToDevice(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name || 'tai-lieu';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 4000);
  }

  // ---------- ASSIGNMENTS ----------
  function submitAssignment(form) {
    if (!requireReady(true)) return;
    if (!state.openGroupId) return;
    var title = ($('g-assign-title').value || '').trim();
    var subject = $('g-assign-subject').value;
    var desc = ($('g-assign-desc').value || '').trim();
    var due = $('g-assign-due').value;
    if (!title) { toast('Nhập tiêu đề bài tập.', 'warning'); return; }
    var fileInput = $('g-assign-file');
    var file = fileInput && fileInput.files ? fileInput.files[0] : null;
    if (file) {
      var effType = file.type || 'text/plain';
      var allowed = new Set(['application/pdf', 'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'text/plain']);
      if (file.size > MAX_FILE_BYTES || (!allowed.has(effType) && !effType.startsWith('image/'))) {
        toast('Tệp đính kèm tối đa 20 MB (PDF, Word, TXT, ảnh).', 'warning');
        return;
      }
    }
    (async () => {
      try {
        await state.user.getIdToken(true);
        var gid = state.openGroupId;
        var payload = {
          title: title.slice(0, 120),
          subject: subject || '',
          description: desc.slice(0, 2000),
          dueDate: due || '',
          assignerUid: state.user.uid,
          assignerName: myName(),
          createdAt: ts()
        };
        var fileId = null;
        if (file) {
          var prepared = await prepareFileForUpload(file);
          var upFile = new File([prepared.blob], prepared.name, { type: prepared.type });
          fileId = 'gfile_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
          await storeGroupFile(gid, upFile, fileId);
          payload.fileId = fileId;
          payload.fileName = prepared.name.slice(0, 150);
          payload.fileType = prepared.type || 'application/octet-stream';
          payload.fileSize = prepared.blob.size;
        }
        await groupRef(gid).collection('assignments').add(payload);
        toast('Đã giao bài tập cho nhóm.', 'success');
        form.reset();
      } catch (err) {
        toast('Không giao được bài tập: ' + (err.code || err.message), 'warning');
      }
    })();
  }

  async function toggleComplete(aid, checked) {
    if (!requireReady(true)) return;
    if (!state.openGroupId) return;
    var uid = state.user.uid;
    try {
      await state.user.getIdToken(true);
      var ref = groupRef(state.openGroupId).collection('assignments').doc(aid).collection('completions').doc(uid);
      if (checked) {
        await ref.set({ uid: uid, name: myName(), done: true, completedAt: ts() });
      } else {
        await ref.delete().catch(function () {});
      }
    } catch (err) {
      toast('Không cập nhật được trạng thái: ' + (err.code || err.message), 'warning');
    }
  }

  function subscribeCompletions(aid) {
    var gid = state.openGroupId;
    if (!gid || !state.db || !state.user) return;
    var key = 'comp_' + aid;
    if (state.unsubs[key]) return;
    state.unsubs[key] = groupRef(gid).collection('assignments').doc(aid).collection('completions').onSnapshot(function (snap) {
      if (!state.completions) state.completions = {};
      state.completions[aid] = snap.docs.map(function (d) { return { id: d.id, data: d.data() }; });
      renderAssignments();
    }, function () { /* noop */ });
  }

  // ---------- RENDER ----------
  function initialOf(name) {
    var ch = (name || '?').trim().charAt(0);
    return ch ? ch.toUpperCase() : '?';
  }

  function fileIconClass(name, type) {
    var n = String(name || '').toLowerCase();
    var t = String(type || '').toLowerCase();
    if (/\.pdf$/.test(n) || /pdf/.test(t)) return 'fa-solid fa-file-pdf';
    if (/\.(docx?|odt)$/.test(n) || /word|msword|document/.test(t)) return 'fa-solid fa-file-word';
    if (/\.pptx?$/.test(n) || /powerpoint|presentation/.test(t)) return 'fa-solid fa-file-powerpoint';
    if (/\.(xlsx?|csv)$/.test(n) || /excel|spreadsheet/.test(t)) return 'fa-solid fa-file-excel';
    if (/^image\//.test(t) || /\.(png|jpe?g|gif|webp|bmp)$/.test(n)) return 'fa-solid fa-file-image';
    if (/\.txt$/.test(n) || /^text\//.test(t)) return 'fa-solid fa-file-lines';
    return 'fa-solid fa-file';
  }

  function render() {
    var root = $('groups-root');
    if (!root) return;
    if (!state.user) {
      root.innerHTML =
        '<div class="groups-empty">' +
          '<i class="fa-solid fa-people-group"></i>' +
          '<p>Đăng nhập (email đã xác thực) để tạo hoặc tham gia nhóm học.</p>' +
          '<button class="btn-primary-action" data-goto-account>Đăng nhập / Đăng ký</button>' +
        '</div>';
      var go = root.querySelector('[data-goto-account]');
      if (go) go.addEventListener('click', function () {
        if (window.EDUPULSE_APP && typeof window.EDUPULSE_APP.openTab === 'function') window.EDUPULSE_APP.openTab('tab-account');
      });
      return;
    }
    if (!state.user.emailVerified) {
      root.innerHTML =
        '<div class="groups-empty">' +
          '<i class="fa-solid fa-envelope-circle-check"></i>' +
          '<p>Tài khoản chưa xác thực email. Mở hộp thư của bạn, bấm liên kết xác thực do EduPulse gửi, rồi quay lại đây.</p>' +
          '<button class="btn-primary-action" data-goto-account>Vào tài khoản</button>' +
        '</div>';
      var gb = root.querySelector('[data-goto-account]');
      if (gb) gb.addEventListener('click', function () {
        if (window.EDUPULSE_APP && typeof window.EDUPULSE_APP.openTab === 'function') window.EDUPULSE_APP.openTab('tab-account');
      });
      return;
    }
    if (state.openGroupId) { renderDetail(); return; }
    renderList();
  }

  function renderList() {
    var root = $('groups-root');
    if (!root) return;
    var cards = state.groups.length
      ? state.groups.map(function (g) {
          var d = g.data || {};
          var isOwner = d.ownerUid === state.user.uid;
          return '<div class="group-card">' +
            '<button type="button" class="group-card-open" data-open-group="' + escapeHtml(g.id) + '">' +
              '<span class="group-card-icon"><i class="fa-solid fa-users-between-lines"></i></span>' +
              '<span class="group-card-info">' +
                '<span class="group-card-name">' + escapeHtml(d.name) + (isOwner ? ' <span class="group-owner-badge">CHỦ NHÓM</span>' : '') + '</span>' +
                '<span class="group-card-meta">' + (d.memberCount || 0) + ' thành viên · Mã mời <code>' + escapeHtml(d.joinCode) + '</code></span>' +
              '</span>' +
              '<span class="group-card-chevron"><i class="fa-solid fa-chevron-right"></i></span>' +
            '</button>' +
            '<button type="button" class="group-card-leave" data-leave-group="' + escapeHtml(g.id) + '" title="Rời nhóm" aria-label="Rời nhóm"><i class="fa-solid fa-arrow-right-from-bracket"></i></button>' +
          '</div>';
        }).join('')
      : '<div class="groups-empty"><i class="fa-solid fa-users"></i><p>Bạn chưa tham gia nhóm nào. Tạo nhóm mới hoặc nhập mã mời từ bạn bè để bắt đầu học cùng nhau.</p></div>';
    root.innerHTML =
      '<div class="header-greeting-wrap groups-header">' +
        '<h1 class="greeting-title"><i class="fa-solid fa-people-group"></i> Học nhóm</h1>' +
        '<p class="greeting-sub">Tạo nhóm nhỏ để chia sẻ tài liệu và giao bài tập cho nhau.</p>' +
      '</div>' +
      '<div class="groups-actions">' +
        '<button class="btn-primary-action" id="btn-g-create"><i class="fa-solid fa-plus"></i> Tạo nhóm mới</button>' +
        '<button class="btn-ghost-action" id="btn-g-join"><i class="fa-solid fa-key"></i> Tham gia bằng mã</button>' +
      '</div>' +
      '<form class="groups-form" id="g-create-form" hidden>' +
        '<input id="g-create-name" class="form-input-control" maxlength="50" placeholder="Tên nhóm, VD: Tổ ôn Toán 12A1">' +
        '<button class="btn-primary-action" type="submit"><i class="fa-solid fa-check"></i> Tạo</button>' +
      '</form>' +
      '<form class="groups-form" id="g-join-form" hidden>' +
        '<input id="g-join-code" class="form-input-control" maxlength="6" placeholder="Mã mời 6 ký tự, VD: A1B2C3" style="text-transform:uppercase;">' +
        '<button class="btn-primary-action" type="submit"><i class="fa-solid fa-right-to-bracket"></i> Tham gia</button>' +
      '</form>' +
      '<div class="groups-list">' + cards + '</div>';
    bindList();
  }

  function bindList() {
    var btnCreate = $('btn-g-create');
    var btnJoin = $('btn-g-join');
    var formCreate = $('g-create-form');
    var formJoin = $('g-join-form');
    if (btnCreate) btnCreate.addEventListener('click', function () {
      formCreate.hidden = !formCreate.hidden;
      formJoin.hidden = true;
      if (!formCreate.hidden) $('g-create-name').focus();
    });
    if (btnJoin) btnJoin.addEventListener('click', function () {
      formJoin.hidden = !formJoin.hidden;
      formCreate.hidden = true;
      if (!formJoin.hidden) $('g-join-code').focus();
    });
    if (formCreate) formCreate.addEventListener('submit', function (e) {
      e.preventDefault();
      createGroup($('g-create-name').value);
    });
    if (formJoin) formJoin.addEventListener('submit', function (e) {
      e.preventDefault();
      joinGroup($('g-join-code').value);
    });
    var root = $('groups-root');
    if (!root) return;
    root.querySelectorAll('[data-open-group]').forEach(function (btn) {
      btn.addEventListener('click', function () { state.openGroupId = btn.getAttribute('data-open-group'); subscribeGroup(); renderDetail(); });
    });
    root.querySelectorAll('[data-leave-group]').forEach(function (btn) {
      btn.addEventListener('click', function () { leaveGroup(btn.getAttribute('data-leave-group')); });
    });
  }

  function renderDetail() {
    var root = $('groups-root');
    if (!root) return;
    var gid = state.openGroupId;
    var g = state.groups.find(function (x) { return x.id === gid; });
    var d = g ? (g.data || {}) : null;
    if (!d) {
      root.innerHTML = '<div class="groups-empty"><i class="fa-solid fa-spinner fa-spin"></i><p>Đang tải nhóm…</p></div>';
      return;
    }
    var members = state.members || [];
    var files = state.files || [];
    var assignList = state.assignments || [];

    var membersHtml = members.map(function (m) {
      var isOwner = m.data.role === 'owner';
      return '<li class="group-member">' +
        '<span class="group-member-avatar">' + escapeHtml(initialOf(m.data.name)) + '</span>' +
        '<span class="group-member-name">' + escapeHtml(m.data.name) + (m.id === state.user.uid ? ' <em>(bạn)</em>' : '') + '</span>' +
        (isOwner ? '<span class="group-owner-badge">CHỦ NHÓM</span>' : '') +
      '</li>';
    }).join('') || '<li class="group-member"><span>Chưa có thành viên.</span></li>';

    var filesHtml = files.map(function (f) {
      var dd = f.data || {};
      return '<li class="group-file">' +
        '<span class="group-file-icon"><i class="' + fileIconClass(dd.name, dd.type) + '"></i></span>' +
        '<span class="group-file-info">' +
          '<span class="group-file-name">' + escapeHtml(dd.name) + '</span>' +
          '<span class="group-file-meta">' + escapeHtml(dd.authorName || '') + ' · ' + formatSize(dd.size) + '</span>' +
        '</span>' +
        '<button type="button" class="btn-icon-round" data-dl-file="' + escapeHtml(f.id) + '" title="Tải xuống" aria-label="Tải xuống"><i class="fa-solid fa-download"></i></button>' +
      '</li>';
    }).join('') || '<li class="group-file muted"><i class="fa-solid fa-folder-open"></i> Chưa có tài liệu. Hãy chia sẻ đề cương, bài giảng, đề thi mẫu…</li>';

    var assignmentsHtml = assignList.map(function (a) {
      var ad = a.data || {};
      var completed = (state.completions && state.completions[a.id]) || [];
      var doneCount = completed.filter(function (c) { return c.data && c.data.done; }).length;
      var myDone = completed.some(function (c) { return c.id === state.user.uid && c.data && c.data.done; });
      var names = completed.filter(function (c) { return c.data && c.data.done; }).map(function (c) { return c.data.name || 'ai đó'; });
      var att = (ad.fileId && ad.fileName)
        ? '<button class="btn-ghost-action" data-dl-assign="' + escapeHtml(ad.fileId) + '"><i class="fa-solid fa-paperclip"></i> ' + escapeHtml(ad.fileName) + '</button>'
        : '';
      var due = ad.dueDate ? '<span class="group-assign-due"><i class="fa-regular fa-calendar-days"></i> Hạn: ' + escapeHtml(ad.dueDate) + '</span>' : '';
      var subj = ad.subject ? '<span class="group-assign-subject">' + escapeHtml(ad.subject) + '</span>' : '';
      var pct = members.length ? Math.round(doneCount / members.length * 100) : 0;
      return '<div class="group-assign">' +
        '<div class="group-assign-head">' + subj + ' <b>' + escapeHtml(ad.title) + '</b> ' + due + '</div>' +
        (ad.description ? '<p class="group-assign-desc">' + escapeHtml(ad.description) + '</p>' : '') +
        (att ? '<div class="group-assign-att">' + att + '</div>' : '') +
        '<div class="group-assign-meta">Giao bởi: ' + escapeHtml(ad.assignerName) + '</div>' +
        '<label class="group-assign-check"><input type="checkbox" data-complete="' + escapeHtml(a.id) + '"' + (myDone ? ' checked' : '') + '> Tôi đã hoàn thành</label>' +
        '<div class="group-assign-progressbar"><span style="width:' + pct + '%"></span></div>' +
        '<div class="group-assign-progress">' + doneCount + '/' + members.length + ' đã xong' + (names.length ? ' · ' + names.join(', ') : '') + '</div>' +
      '</div>';
    }).join('') || '<div class="groups-empty"><i class="fa-solid fa-clipboard-list"></i><p>Chưa có bài tập nào được giao.</p></div>';

    var subjects = (window.EduPulseStudy && Array.isArray(window.EduPulseStudy.SUBJECTS))
      ? '<option value="">Môn (tùy chọn)</option>' + window.EduPulseStudy.SUBJECTS.map(function (s) { return '<option value="' + escapeHtml(s) + '">' + escapeHtml(s) + '</option>'; }).join('')
      : '<option value="">Môn (tùy chọn)</option>';

    root.innerHTML =
      '<div class="groups-header groups-header-detail">' +
        '<button class="btn-back-pill" id="btn-g-back"><i class="fa-solid fa-arrow-left"></i> Danh sách nhóm</button>' +
        '<div class="groups-detail-title">' +
          '<span class="groups-detail-icon"><i class="fa-solid fa-users-between-lines"></i></span>' +
          '<div>' +
            '<h1 class="greeting-title">' + escapeHtml(d.name) + '</h1>' +
            '<p class="greeting-sub">Mã mời <code>' + escapeHtml(d.joinCode) + '</code> · ' + (d.memberCount || 0) + ' thành viên</p>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<section class="stats-card group-section">' +
        '<div class="stats-card-title"><i class="fa-solid fa-users"></i> Thành viên</div>' +
        '<ul class="group-member-list">' + membersHtml + '</ul>' +
      '</section>' +
      '<section class="stats-card group-section">' +
        '<div class="stats-card-title"><i class="fa-solid fa-folder-open"></i> Tài liệu chia sẻ</div>' +
        '<form class="groups-form" id="g-file-form">' +
          '<input id="g-file-input" class="form-input-control" type="file" accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,image/*">' +
          '<button class="btn-primary-action" id="btn-g-file-upload" type="submit"><i class="fa-solid fa-upload"></i> Chia sẻ</button>' +
        '</form>' +
        '<ul class="group-file-list">' + filesHtml + '</ul>' +
      '</section>' +
      '<section class="stats-card group-section">' +
        '<div class="stats-card-title"><i class="fa-solid fa-clipboard-list"></i> Bài tập giao nhau</div>' +
        '<button class="btn-primary-action" id="btn-g-new-assign"><i class="fa-solid fa-plus"></i> Giao bài tập</button>' +
        '<form class="groups-form" id="g-assign-form" hidden>' +
          '<input id="g-assign-title" class="form-input-control" maxlength="120" placeholder="Tiêu đề, VD: Giải 5 câu hình không gian (H2.1-H2.5)">' +
          '<select id="g-assign-subject" class="form-input-control">' + subjects + '</select>' +
          '<input id="g-assign-due" class="form-input-control" type="date" title="Hạn nộp">' +
          '<input id="g-assign-file" class="form-input-control" type="file" accept=".pdf,.doc,.docx,.txt,image/*">' +
          '<textarea id="g-assign-desc" class="form-input-control" maxlength="2000" rows="2" placeholder="Ghi chú / yêu cầu (tùy chọn)"></textarea>' +
          '<button class="btn-primary-action" type="submit"><i class="fa-solid fa-paper-plane"></i> Giao</button>' +
        '</form>' +
        '<div class="group-assignments">' + assignmentsHtml + '</div>' +
      '</section>';
    bindDetail();
  }

  function bindDetail() {
    var btnBack = $('btn-g-back');
    if (btnBack) btnBack.addEventListener('click', function () {
      state.openGroupId = null;
      tearDownSubs();
      subscribeMyGroups();
      render();
    });
    var fileForm = $('g-file-form');
    if (fileForm) fileForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var input = $('g-file-input');
      uploadFile(input && input.files ? input.files[0] : null);
    });
    var btnNew = $('btn-g-new-assign');
    var assignForm = $('g-assign-form');
    if (btnNew) btnNew.addEventListener('click', function () {
      assignForm.hidden = !assignForm.hidden;
      if (!assignForm.hidden) $('g-assign-title').focus();
    });
    if (assignForm) assignForm.addEventListener('submit', function (e) {
      e.preventDefault();
      submitAssignment(assignForm);
    });
    var root = $('groups-root');
    if (!root) return;
    root.querySelectorAll('[data-dl-file]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var f = state.files.find(function (x) { return x.id === btn.getAttribute('data-dl-file'); });
        if (f) openFileActionSheet(state.openGroupId, f.id, f.data && f.data.name);
      });
    });
    root.querySelectorAll('[data-dl-assign]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openFileActionSheet(state.openGroupId, btn.getAttribute('data-dl-assign'));
      });
    });
    root.querySelectorAll('[data-complete]').forEach(function (box) {
      var aid = box.getAttribute('data-complete');
      subscribeCompletions(aid);
      box.addEventListener('change', function () { toggleComplete(aid, box.checked); });
    });
  }

  function formatSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  // ---------- INIT ----------
  function init() {
    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.EduPulseStudyGroups = {
    onAuthChange: onAuthChange,
    createGroup: createGroup,
    joinGroup: joinGroup,
    leaveGroup: leaveGroup
  };
})();