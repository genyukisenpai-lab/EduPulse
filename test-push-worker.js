// Test toàn bộ logic Cloudflare Worker (mã hóa RFC 8291 + VAPID + KV + cron) — chạy thuần Node 18+.
// Lưu ý: kiểm tra BẢN GIẢI MÃ ngược — nếu payload worker gửi giải mã được với khóa private test thì mã hóa đúng.
const fs = require('fs');
const path = require('path');

const VAPID_PUBLIC = fs.readFileSync(path.join(__dirname, 'push-worker/vapid-public.txt'), 'utf8').trim();
const VAPID_PRIVATE = fs.readFileSync(path.join(__dirname, 'push-worker/vapid-private.txt'), 'utf8').trim();

const b64url = buf => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlToBytes = str => new Uint8Array(Buffer.from(String(str).replace(/-/g, '+').replace(/_/g, '/'), 'base64'));

function kvStore() {
  const map = new Map();
  return {
    put: async (k, v) => map.set(k, v),
    get: async k => (map.has(k) ? map.get(k) : null),
    delete: async k => map.delete(k),
    list: async () => ({ keys: [...map.keys()].map(name => ({ name })) })
  };
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + detail : ''));
}

(async () => {
  const enc = new TextEncoder();
  const concat = (...arrs) => {
    const total = arrs.reduce((s, a) => s + a.length, 0);
    const out = new Uint8Array(total);
    let o = 0;
    for (const a of arrs) { out.set(a, o); o += a.length; }
    return out;
  };
  const hkdf = async (ikm, salt, info, length) => {
    const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
    return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
  };

  // ---- test-side: cặp khóa ECDH "trình duyệt" giả lập + subscription ----
  const browserKeys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const browserJwk = await crypto.subtle.exportKey('jwk', browserKeys.publicKey);
  const p256dhRaw = concat(new Uint8Array([0x04]), b64urlToBytes(browserJwk.x), b64urlToBytes(browserJwk.y));
  const authSecret = crypto.getRandomValues(new Uint8Array(16));
  const sub = {
    endpoint: 'https://push.example.com/v1/abcdef',
    keys: { p256dh: b64url(p256dhRaw), auth: b64url(authSecret) }
  };

  // ---- giả lập push service: bắt request, cho test tự giải mã ----
  const pushCalls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.startsWith('https://push.example.com')) {
      pushCalls.push({ url: u, init });
      return { ok: true, status: 200, text: async () => '' };
    }
    return realFetch(url, init);
  };

  const env = { PUSH_SUBS: kvStore(), VAPID_PUBLIC, VAPID_PRIVATE };
  const worker = await import('./push-worker/src/index.js');
  const send = async (pathname, body) => {
    const req = new Request('https://edupulse-push.test' + pathname, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return worker.default.fetch(req, env);
  };

  // 1) OPTIONS CORS
  const optionsRes = await worker.default.fetch(new Request('https://edupulse-push.test/subscribe', { method: 'OPTIONS' }), env);
  check('OPTIONS → 204 + CORS', optionsRes.status === 204 && optionsRes.headers.get('Access-Control-Allow-Origin') === '*', String(optionsRes.status));

  // 2) GET bị từ chối
  const getRes = await worker.default.fetch(new Request('https://edupulse-push.test/'), env);
  check('GET → 405', getRes.status === 405, String(getRes.status));

  // 3) subscribe thiếu field → 400
  const badRes = await send('/subscribe', { endpoint: 'x' });
  check('subscribe thiếu keys → 400', badRes.status === 400, String(badRes.status));

  // 4) subscribe OK
  const subRes = await send('/subscribe', { ...sub, snapshot: { title: 'Thi THPT', days: 12 } });
  const subJson = await subRes.json();
  check('subscribe → 200 ok', subJson.ok === true, JSON.stringify(subJson));

  // 5) send-test → gửi push qua push service
  const testRes = await send('/send-test', { endpoint: sub.endpoint });
  const testJson = await testRes.json();
  check('send-test → ok', testJson.ok === true, testJson.detail);

  const call = pushCalls[pushCalls.length - 1];
  check('push request đúng endpoint', call.url === sub.endpoint, call.url);

  const headers = call.init.headers;
  check('Content-Encoding: aes128gcm', headers['Content-Encoding'] === 'aes128gcm', String(headers['Content-Encoding']));
  check('TTL=86400', headers['TTL'] === '86400', String(headers['TTL']));
  check('Authorization chứa vapid t= và k=', /^vapid t=.*, k=.*$/.test(headers['Authorization']), String(headers['Authorization']).slice(0, 60) + '…');

  // 6) Xác minh chữ ký VAPID bằng khóa công khai
  const authHeader = headers['Authorization'];
  const jwt = authHeader.match(/t=([^,]+)/)[1];
  const [h, p, sig] = jwt.split('.');
  const sigBytes = b64urlToBytes(sig);
  const pubRaw = b64urlToBytes(VAPID_PUBLIC);
  const vapidPubJwk = { kty: 'EC', crv: 'P-256', x: b64url(pubRaw.slice(1, 33)), y: b64url(pubRaw.slice(33, 65)) };
  const vapidPubKey = await crypto.subtle.importKey('jwk', vapidPubJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const sigOk = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, vapidPubKey, sigBytes, enc.encode(h + '.' + p));
  check('Chữ ký VAPID hợp lệ (ES256)', sigOk === true, '');
  const payloadJwt = JSON.parse(new TextDecoder().decode(b64urlToBytes(p)));
  check('JWT aud = origin push service', payloadJwt.aud === 'https://push.example.com', payloadJwt.aud);

  // 7) Giải mã payload (RFC 8291) bằng khóa private "trình duyệt"
  const body = call.init.body;
  check('payload có header salt+rs+idlen', body.length > 86, String(body.length) + ' bytes');
  check('idlen=65 (keyid chứa khóa tạm)', body[20] === 0x41, String(body[20]));
  const salt = body.slice(0, 16);
  const ephRaw = body.slice(21, 86);
  const ciphertext = body.slice(86);
  const ephJwk = { kty: 'EC', crv: 'P-256', x: b64url(ephRaw.slice(1, 33)), y: b64url(ephRaw.slice(33, 65)) };
  const ephKey = await crypto.subtle.importKey('jwk', ephJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: ephKey }, browserKeys.privateKey, 256));
  // RFC 8291 §3.3-3.4: IKM = HKDF-Expand(HKDF-Extract(auth, shared), "WebPush: info\0"||ua||as, 32)
  const ikm = await hkdf(shared, authSecret, concat(enc.encode('WebPush: info\0'), p256dhRaw, ephRaw), 32);
  // PRK = HKDF-Extract(salt, IKM); CEK/NONCE = HKDF-Expand(PRK, "Content-Encoding: ...\0", 16/12)
  const cek = await hkdf(ikm, salt, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(ikm, salt, enc.encode('Content-Encoding: nonce\0'), 12);
  const aesKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['decrypt']);
  const plaintext = new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aesKey, ciphertext));
  const msg = JSON.parse(plaintext.replace(/\u0002$/, ''));
  check('Payload giải mã = {title, body}', !!msg.title && !!msg.body, plaintext);

  // 8) update-snapshot rồi chạy cron → title dùng snapshot
  await send('/update-snapshot', { endpoint: sub.endpoint, snapshot: { title: 'ĐGNL 2027', days: 5 } });
  pushCalls.length = 0;
  await worker.default.scheduled({ cron: '0 11 * * *' }, env);
  check('Cron gửi push cho subscription còn hiệu lực', pushCalls.length === 1, pushCalls.length + ' lần gửi');
  const call2 = pushCalls[pushCalls.length - 1];
  const decrypted2 = await (async () => {
    const b2 = call2.init.body;
    const salt2 = b2.slice(0, 16);
    const eph2 = b2.slice(21, 86);
    const c2 = b2.slice(86);
    const ephJwk2 = { kty: 'EC', crv: 'P-256', x: b64url(eph2.slice(1, 33)), y: b64url(eph2.slice(33, 65)) };
    const ephKey2 = await crypto.subtle.importKey('jwk', ephJwk2, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const shared2 = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: ephKey2 }, browserKeys.privateKey, 256));
    const ikm2 = await hkdf(shared2, authSecret, concat(enc.encode('WebPush: info\0'), p256dhRaw, eph2), 32);
    const cek2 = await hkdf(ikm2, salt2, enc.encode('Content-Encoding: aes128gcm\0'), 16);
    const nonce2 = await hkdf(ikm2, salt2, enc.encode('Content-Encoding: nonce\0'), 12);
    const aes2 = await crypto.subtle.importKey('raw', cek2, { name: 'AES-GCM' }, false, ['decrypt']);
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce2, tagLength: 128 }, aes2, c2));
  })();
  check('Sau update-snapshot: title dùng snapshot', decrypted2.includes('ĐGNL 2027') && decrypted2.includes('Còn 5 ngày'), decrypted2);

  // 9) Cron sau khi unsubscribe → không gửi gì
  await send('/unsubscribe', { endpoint: sub.endpoint });
  pushCalls.length = 0;
  await worker.default.scheduled({ cron: '0 11 * * *' }, env);
  check('Cron không gửi sau unsubscribe', pushCalls.length === 0, pushCalls.length + ' lần gửi');

  // 10) unsubscribe → send-test → 404
  const goneRes = await send('/send-test', { endpoint: sub.endpoint });
  check('Sau unsubscribe: send-test → 404', goneRes.status === 404, String(goneRes.status));

  const failed = results.filter(r => !r.ok);
  console.log('\n===== ' + (failed.length === 0 ? 'TẤT CẢ ' + results.length + ' TEST PASS' : failed.length + '/' + results.length + ' TEST FAIL') + ' =====');
  process.exit(failed.length === 0 ? 0 : 1);
})().catch(err => { console.error('FATAL:', err); process.exit(1); });