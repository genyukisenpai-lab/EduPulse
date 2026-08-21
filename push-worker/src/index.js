// EduPulse Push Worker — lưu subscription + gửi nhắc ôn hằng ngày (Cloudflare Workers, free)
// Deploy: xem README.md trong thư mục push-worker/

const enc = new TextEncoder();

function bytesToB64url(bytes) {
  let bin = '';
  bytes.forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlToBytes(str) {
  const base64 = String(str).replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function concatBytes(...arrays) {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) { out.set(a, offset); offset += a.length; }
  return out;
}

async function hkdfSha256(ikm, salt, info, length) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8);
  return new Uint8Array(bits);
}

async function subId(endpoint) {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(endpoint));
  return bytesToB64url(new Uint8Array(digest)).slice(0, 32);
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...corsHeaders(), ...extra } });
}

// ---------- VAPID (ES256 JWT) ----------
// env.VAPID_PRIVATE = d (base64url) — cài qua: npx wrangler secret put VAPID_PRIVATE
// env.VAPID_PUBLIC  = x||y dạng raw 65 byte (base64url) — cài qua [vars] trong wrangler.toml
async function importVapidKeys(vapidPublicB64, vapidPrivateB64) {
  const pubRaw = b64urlToBytes(vapidPublicB64);
  if (pubRaw.length !== 65 || pubRaw[0] !== 0x04) throw new Error('VAPID_PUBLIC không hợp lệ (cần raw 65 byte).');
  const d = b64urlToBytes(vapidPrivateB64);
  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    x: bytesToB64url(pubRaw.slice(1, 33)),
    y: bytesToB64url(pubRaw.slice(33, 65)),
    d: bytesToB64url(d)
  };
  const privateKey = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  return privateKey;
}

async function signVapid(privateKey, endpoint) {
  let audience;
  if (endpoint.includes('web.push.apple.com')) audience = 'https://web.push.apple.com';
  else if (endpoint.includes('fcm.googleapis.com')) audience = 'https://fcm.googleapis.com';
  else audience = new URL(endpoint).origin;
  const header = bytesToB64url(enc.encode(JSON.stringify({ alg: 'ES256', typ: 'JWT' })));
  const payload = bytesToB64url(enc.encode(JSON.stringify({
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: 'mailto:edupulse@example.com'
  })));
  const data = header + '.' + payload;
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, enc.encode(data)));
  return data + '.' + bytesToB64url(sig);
}

// ---------- Mã hóa payload (RFC 8291 aes128gcm) ----------
async function encryptMessage(plaintext, subscription) {
  const p256dh = b64urlToBytes(subscription.keys.p256dh);
  const auth = b64urlToBytes(subscription.keys.auth);
  const salt = crypto.getRandomValues(new Uint8Array(16));

  const ecdh = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const ecdhJwk = await crypto.subtle.exportKey('jwk', ecdh.publicKey);
  const ecdhRaw = concatBytes(new Uint8Array([0x04]), b64urlToBytes(ecdhJwk.x), b64urlToBytes(ecdhJwk.y));

  const peerJwk = {
    kty: 'EC', crv: 'P-256',
    x: bytesToB64url(p256dh.slice(1, 33)),
    y: bytesToB64url(p256dh.slice(33, 65))
  };
  const peerKey = await crypto.subtle.importKey('jwk', peerJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: peerKey }, ecdh.privateKey, 256));

  // RFC 8291 §3.3-3.4:
  //   IKM = HKDF-Expand(HKDF-Extract(auth, shared), "WebPush: info\0" || ua_public || as_public, 32)
  const ikm = await hkdfSha256(sharedSecret, auth, concatBytes(enc.encode('WebPush: info\0'), p256dh, ecdhRaw), 32);
  //   PRK = HKDF-Extract(salt, IKM)  (salt = salt ngẫu nhiên trong header)
  //   CEK  = HKDF-Expand(PRK, "Content-Encoding: aes128gcm\0", 16)
  //   NONCE= HKDF-Expand(PRK, "Content-Encoding: nonce\0", 12)
  const cek = await hkdfSha256(ikm, salt, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdfSha256(ikm, salt, enc.encode('Content-Encoding: nonce\0'), 12);

  // RFC 8188 §6.1: record = plaintext + delimiter (0x02 cho record cuối) + padding
  const record = concatBytes(enc.encode(plaintext), new Uint8Array([0x02]));

  const aesKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aesKey, record));

  // RFC 8291 §4: header = salt(16) + rs(4) + idlen(1) + keyid; keyid = khóa tạm (65 byte), idlen = 65
  const header = concatBytes(salt, new Uint8Array([0x00, 0x00, 0x10, 0x00]), new Uint8Array([0x41]), ecdhRaw);
  return concatBytes(header, ciphertext);
}

// ---------- Gửi push ----------
async function sendPush(sub, env, title, body, data) {
  try {
    const encrypted = await encryptMessage(JSON.stringify({ title, body, data: data || null }), sub);
    const privateKey = await importVapidKeys(env.VAPID_PUBLIC, env.VAPID_PRIVATE);
    const jwt = await signVapid(privateKey, sub.endpoint);
    const response = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        'TTL': '86400',
        'Content-Type': 'application/octet-stream',
        'Content-Encoding': 'aes128gcm',
        'Authorization': 'vapid t=' + jwt + ', k=' + env.VAPID_PUBLIC
      },
      body: encrypted
    });
    if (response.status === 404 || response.status === 410) {
      const id = await subId(sub.endpoint);
      await env.PUSH_SUBS.delete(id);
      return { ok: false, detail: 'expired ' + response.status + ' — đã xóa subscription' };
    }
    if (!response.ok) {
      return { ok: false, detail: 'push service ' + response.status + ': ' + (await response.text()).slice(0, 200) };
    }
    return { ok: true, detail: 'sent' };
  } catch (error) {
    return { ok: false, detail: String(error?.message || error) };
  }
}

// ---------- Đọc tin nhắn mới nhất từ Firestore REST (miễn phí, rules cho read: true) ----------
async function getLatestChatMessage(env) {
  const base = `https://firestore.googleapis.com/v1/projects/${env.FIRESTORE_PROJECT_ID}/databases/(default)/documents/rooms/general/messages`;
  const url = base + '?orderBy=createdAt%20desc&pageSize=1';
  const response = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!response.ok) {
    return { ok: false, error: 'Firestore ' + response.status + ': ' + (await response.text()).slice(0, 300) };
  }
  const data = await response.json();
  const docs = data.documents || [];
  if (!docs.length) return { ok: true, msg: null };
  const doc = docs[0];
  const fields = doc.fields || {};
  const id = decodeURIComponent((doc.name || '').split('/').pop() || '');
  return {
    ok: true,
    msg: {
      id,
      text: fields.text?.stringValue || '',
      authorId: fields.authorId?.stringValue || '',
      authorName: fields.authorName?.stringValue || 'Sĩ tử EduPulse',
      hasAttachment: !!fields.attachment
    }
  };
}

// Gửi push tức thì khi có tin nhắn chat mới (gọi từ app người gửi, không chờ cron)
async function notifyChat(env, msg) {
  if (!msg || !msg.id) return { ok: false, detail: 'missing message' };
  const lastId = await env.PUSH_SUBS.get('LAST_CHAT_MSG');
  if (lastId === msg.id) return { ok: true, detail: 'already sent' };
  const authorId = msg.authorId || '';
  const authorName = (msg.authorName || 'Sĩ tử EduPulse').slice(0, 32);
  const text = msg.text || '';
  const hasAttachment = !!msg.hasAttachment;
  const body = text
    ? (text.length > 60 ? text.slice(0, 60) + '…' : text)
    : (hasAttachment ? 'Đã gửi tài liệu mới' : 'Có tin nhắn mới');
  const list = await env.PUSH_SUBS.list();
  const results = [];
  for (const key of list.keys) {
    const raw = await env.PUSH_SUBS.get(key.name);
    if (!raw) continue;
    let sub;
    try { sub = JSON.parse(raw); } catch (e) { continue; }
    if (sub.uid && sub.uid === authorId) continue;
    const push = await sendPush(sub, env, authorName, body, { type: 'chat' });
    results.push({ key: key.name, ok: push.ok, detail: push.detail });
  }
  await env.PUSH_SUBS.put('LAST_CHAT_MSG', msg.id);
  return { ok: true, detail: JSON.stringify(results) };
}

async function broadcastChatMessage(env) {
  const result = await getLatestChatMessage(env);
  if (!result.ok) return { ok: false, detail: result.error };
  const msg = result.msg;
  if (!msg || !msg.id) return { ok: true, detail: 'no message' };

  const lastId = await env.PUSH_SUBS.get('LAST_CHAT_MSG');
  if (lastId === msg.id) return { ok: true, detail: 'no new message' };

  return notifyChat(env, msg);
}

// Gửi push cuộc gọi đến ĐÚNG người được gọi (theo uid) — app người gọi gọi tới ngay khi tạo call doc.
async function notifyCall(env, data) {
  if (!data || !data.calleeUid || !data.callId) return { ok: false, detail: 'missing data' };
  const callerName = (data.callerName || 'Sĩ tử EduPulse').slice(0, 32);
  const type = data.type === 'video' ? 'video' : 'voice';
  const list = await env.PUSH_SUBS.list();
  const results = [];
  for (const key of list.keys) {
    const raw = await env.PUSH_SUBS.get(key.name);
    if (!raw) continue;
    let sub;
    try { sub = JSON.parse(raw); } catch (e) { continue; }
    if (!sub.uid || sub.uid !== data.calleeUid) continue;
    const push = await sendPush(sub, env,
      'Cuộc gọi ' + (type === 'video' ? 'video' : 'thoại'),
      callerName + ' đang gọi bạn — mở app để trả lời.',
      { type: 'call', callId: data.callId, callType: type, callerUid: data.callerUid, callerName });
    results.push({ key: key.name, ok: push.ok, detail: push.detail });
  }
  return { ok: true, detail: JSON.stringify(results) };
}

// ---------- Router ----------
const MOTIVATIONAL_QUOTES = [
  'Đừng chờ đến ngày thi mới tiếc vì đã không bắt đầu hôm nay.',
  'Mỗi 25 phút hôm nay là một bước gần hơn với ước mơ của bạn.',
  'Người chiến thắng là người dậy sớm và bắt tay vào học, không chần chừ.',
  'Học vốn là rèn luyện — mỗi ngày một chút, điểm số sẽ nói lên tất cả.',
  'Không có kỳ thi nào vượt qua được người kiên trì ôn luyện mỗi ngày.'
];

async function sendSmartReminders(env) {
  // Giờ Việt Nam = UTC + 7
  const now = new Date();
  const vnMin = (now.getUTCMinutes() + 15) % 60;
  const vnHour = (now.getUTCHours() + 7 + Math.floor((now.getUTCMinutes() + 15) / 60)) % 24;
  const hh = String(vnHour).padStart(2, '0');
  const mm = String(vnMin).padStart(2, '0');
  const hm = hh + ':' + mm;
  const dayKey = now.toISOString().slice(0, 10);

  const list = await env.PUSH_SUBS.list();
  const results = [];
  for (const key of list.keys) {
    const raw = await env.PUSH_SUBS.get(key.name);
    if (!raw) continue;
    const sub = JSON.parse(raw);
    const snapshot = sub.snapshot || {};
    const push = snapshot.push || { times: ['18:00'], quote: true };
    const times = Array.isArray(push.times) ? push.times : ['18:00'];

    if (times.indexOf(hm) === -1) continue;

    // Tránh gửi trùng nếu cron chạy 2 lần trong cùng khung giờ
    const dedupeKey = 'LAST_PUSH_' + key.name + '_' + hm + '_' + dayKey;
    const already = await env.PUSH_SUBS.get(dedupeKey);
    if (already) continue;

    const isMorning = hm === '06:30' && push.quote !== false;
    let title;
    let body;
    if (isMorning) {
      title = '🌅 Chào buổi sáng, sĩ tử!';
      body = MOTIVATIONAL_QUOTES[Math.floor(Math.random() * MOTIVATIONAL_QUOTES.length)];
    } else if (snapshot.title) {
      title = 'Còn ' + snapshot.days + ' ngày tới ' + snapshot.title;
      body = 'Một phiên 25 phút bây giờ sẽ giúp bạn vững bước hơn. Mở app để xem lịch học hôm nay.';
    } else {
      title = 'EduPulse — nhắc ôn';
      body = 'Hôm nay có gì để học? Mở app xem kỳ thi tiếp theo.';
    }

    const result = await sendPush(sub, env, title, body);
    if (result.ok) {
      await env.PUSH_SUBS.put(dedupeKey, '1', { expirationTtl: 3600 * 3 });
    }
    results.push({ key: key.name, at: hm, ok: result.ok, detail: result.detail });
  }
  return { count: results.length, at: hm, results };
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() });
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    try {
      const url = new URL(request.url);
      const body = await request.json();

      if (url.pathname === '/subscribe') {
        if (!body.endpoint || !body.keys || !body.keys.p256dh || !body.keys.auth) {
          return json({ error: 'Thiếu endpoint/keys.' }, 400);
        }
        const id = await subId(body.endpoint);
        await env.PUSH_SUBS.put(id, JSON.stringify({
          endpoint: body.endpoint,
          keys: body.keys,
          uid: body.uid || '',
          snapshot: body.snapshot || null,
          updatedAt: Date.now()
        }));
        return json({ ok: true });
      }

      if (url.pathname === '/unsubscribe') {
        const id = await subId(body.endpoint);
        await env.PUSH_SUBS.delete(id);
        return json({ ok: true });
      }

      if (url.pathname === '/update-snapshot') {
        const id = await subId(body.endpoint);
        const raw = await env.PUSH_SUBS.get(id);
        if (raw) {
          const data = JSON.parse(raw);
          data.snapshot = body.snapshot || null;
          data.uid = body.uid || data.uid || '';
          data.updatedAt = Date.now();
          await env.PUSH_SUBS.put(id, JSON.stringify(data));
        }
        return json({ ok: true });
      }

      if (url.pathname === '/send-test') {
        const id = await subId(body.endpoint);
        const raw = await env.PUSH_SUBS.get(id);
        if (!raw) return json({ error: 'Không tìm thấy subscription.' }, 404);
        const result = await sendPush(JSON.parse(raw), env, 'EduPulse', 'Thông báo thử — nhắc ôn hằng ngày đã hoạt động.');
        return json({ ok: result.ok, detail: result.detail });
      }

      if (url.pathname === '/notify-chat') {
        // App người gửi gọi tới ngay khi tin nhắn vừa được lưu → push tức thì (không chờ cron)
        const result = await notifyChat(env, body);
        return json({ ok: result.ok, detail: result.detail });
      }

      if (url.pathname === '/notify-call') {
        // App người gọi gọi tới ngay khi call doc được tạo → push cuộc gọi đến người được gọi
        const result = await notifyCall(env, body);
        return json({ ok: result.ok, detail: result.detail });
      }

      return json({ error: 'Not found.' }, 404);
    } catch (error) {
      return json({ error: String(error?.message || error) }, 500);
    }
  },

async scheduled(event, env) {
    const cron = event.cron || '';
    // Cron mỗi phút: kiểm tra tin nhắn chat mới
    if (cron === '* * * * *' || cron === '*/1 * * * *') {
      const chat = await broadcastChatMessage(env);
      console.log('edupulse chat broadcast:', JSON.stringify(chat));
      return;
    }
    // Cron 15 phút/lần: nhắc ôn theo khung giờ sinh học từng người + quote sáng (giờ Việt Nam UTC+7)
    if (cron === '*/15 * * * *' || cron === '0,15,30,45 * * * *') {
      const results = await sendSmartReminders(env);
      console.log('edupulse smart reminders:', JSON.stringify(results));
      return;
    }
    // Cron khác: vẫn chạy chat broadcast mặc định
    const chat = await broadcastChatMessage(env);
    console.log('edupulse chat broadcast:', JSON.stringify(chat));
  }
};