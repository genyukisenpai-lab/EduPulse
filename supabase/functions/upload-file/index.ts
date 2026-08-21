// Supabase Edge Function: upload-file
// Xác thực Firebase ID token (email verified) rồi mới ghi file vào bucket.
// Không cần thư viện ngoài — dán nguyên file này vào Dashboard > Edge Functions.
//
// Bucket yêu cầu: "group-files" (Public read).
// ENV tự có trong Edge Functions: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

const FIREBASE_PROJECT_ID = 'tsa1-69053'; // TODO: đổi nếu đổi project Firebase
const BUCKET = 'group-files';
const MAX_BYTES = 20 * 1024 * 1024;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface Jwk { kty: string; n: string; e: string; kid: string; alg: string; use: string }

let jwksCache: { keys: Jwk[]; fetchedAt: number } | null = null;
const JWKS_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

async function getJwks(): Promise<Jwk[]> {
  if (jwksCache && Date.now() - jwksCache.fetchedAt < 3600_000) return jwksCache.keys;
  const res = await fetch(JWKS_URL);
  if (!res.ok) throw new Error('jwks_fetch_failed');
  const data = await res.json();
  jwksCache = { keys: data.keys as Jwk[], fetchedAt: Date.now() };
  return jwksCache.keys;
}

function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b64 = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  return Uint8Array.from(b64, (c) => c.charCodeAt(0));
}

function b64urlJson<T>(s: string): T {
  return JSON.parse(new TextDecoder().decode(b64urlDecode(s))) as T;
}

async function verifyFirebaseIdToken(token: string): Promise<{ uid: string }> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('malformed_token');
  const header = b64urlJson<{ kid: string; alg: string }>(parts[0]);
  const payload = b64urlJson<Record<string, unknown>>(parts[1]);
  if (header.alg !== 'RS256') throw new Error('bad_alg');
  const jwk = (await getJwks()).find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('kid_not_found');
  const key = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    b64urlDecode(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!ok) throw new Error('bad_signature');
  const now = Math.floor(Date.now() / 1000);
  if (payload.iss !== `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`) throw new Error('bad_issuer');
  if (payload.aud !== FIREBASE_PROJECT_ID) throw new Error('bad_audience');
  if (typeof payload.exp !== 'number' || payload.exp < now) throw new Error('token_expired');
  if (payload.email_verified !== true || typeof payload.user_id !== 'string') throw new Error('email_not_verified');
  return { uid: payload.user_id as string };
}

function safeName(name: string): string {
  return name.replace(/[^\w.\-\u00C0-\u1FFF ]+/g, '_').slice(-120) || 'file';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
  try {
    const auth = req.headers.get('Authorization') || '';
    if (!auth.startsWith('Bearer ')) throw new Error('missing_token');
    const { uid } = await verifyFirebaseIdToken(auth.slice(7));

    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) throw new Error('no_file');
    if (file.size > MAX_BYTES) throw new Error('too_large');

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    if (!SUPABASE_URL) throw new Error('env_missing');
    // Ưu tiên secret tự đặt (key legacy đã verify), rồi mới đến env mặc định
    const KEY_VARS = ['STORAGE_SERVICE_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_KEY'];
    const keys = KEY_VARS.map((v) => Deno.env.get(v)).filter((k): k is string => !!k);
    if (!keys.length) throw new Error('env_missing');

    const path = `${uid}/${crypto.randomUUID()}/${safeName(file.name)}`;
    const body = await file.arrayBuffer();
    let lastErr = 'no_key_worked';
    let uploadedUrl: string | null = null;
    for (const key of keys) {
      const up = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': file.type || 'application/octet-stream',
          'x-upsert': 'false',
        },
        body,
      });
      if (up.ok) {
        uploadedUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
        break;
      }
      lastErr = `${up.status}: ${await up.text()}`;
    }
    if (!uploadedUrl) {
      return new Response(JSON.stringify({ error: 'upload_failed', detail: lastErr }), {
        status: 502,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ url: uploadedUrl, path, size: file.size }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String((err as Error)?.message || err) }), {
      status: 401,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
