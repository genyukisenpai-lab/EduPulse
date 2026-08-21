// Sinh cặp VAPID key (P-256) cho Web Push — chạy: node generate-vapid.mjs
import { generateKeyPairSync } from 'crypto';
import { writeFileSync } from 'fs';

const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pubJwk = publicKey.export({ format: 'jwk' });
const privJwk = privateKey.export({ format: 'jwk' });

const b64url = buf => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const x = Buffer.from(pubJwk.x, 'base64');
const y = Buffer.from(pubJwk.y, 'base64');
const publicKeyB64 = b64url(Buffer.concat([Buffer.from([0x04]), x, y]));
const privateKeyB64 = b64url(Buffer.from(privJwk.d, 'base64'));

console.log('VAPID_PUBLIC=' + publicKeyB64);
console.log('VAPID_PRIVATE=' + privateKeyB64);

writeFileSync('vapid-private.txt', privateKeyB64 + '\n');
writeFileSync('vapid-public.txt', publicKeyB64 + '\n');
console.log('Đã lưu vào vapid-private.txt / vapid-public.txt (private KHÔNG được đưa lên web).');