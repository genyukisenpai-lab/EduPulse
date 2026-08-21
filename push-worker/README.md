# EduPulse Push Worker — nhắc ôn hằng ngày (100% free)

Cloudflare Workers free plan: không cần thẻ tín dụng, có sẵn Cron Trigger + KV.

## Kiến trúc

- PWA (localhost/https) đăng ký Web Push → gửi subscription + snapshot (kỳ thi tiếp theo) tới worker.
- Worker lưu vào Cloudflare KV (`PUSH_SUBS`).
- Mỗi ngày 18:00 (giờ VN) cron `0 11 * * *` (UTC) quét KV, mã hóa tin nhắn (RFC 8291 aes128gcm) và đẩy thông báo qua FCM/Apple.
- Tin nhắn: "Còn N ngày tới <tên kỳ thi>" — N được PWA cập nhật mỗi khi sửa kỳ thi (không cần gọi Gemini từ worker).

## Deploy (một lần) — TỰ ĐỘNG, 1 lệnh

Yêu cầu: Node.js 18+, tài khoản Cloudflare miễn phí (đăng ký: https://dash.cloudflare.com/sign-up — không cần thẻ).

**Windows:**
```powershell
cd push-worker
.\setup.ps1
```
**Mac/Linux:**
```bash
cd push-worker
./setup.sh
```

Script tự làm hết: login Cloudflare (mở trình duyệt lần đầu) → tạo KV `PUSH_SUBS` → cài secret `VAPID_PRIVATE` → deploy worker → điền URL worker vào `../js/push-config.js` → deploy hosting. Xong là bật được "Nhắc ôn hằng ngày" trong app (kèm 1 thông báo thử ngay khi bật).

### Làm tay (nếu muốn)
```bash
cd push-worker
wrangler login
wrangler kv namespace create PUSH_SUBS      # dán ID vào wrangler.toml
Get-Content vapid-private.txt | wrangler secret put VAPID_PRIVATE   # (Windows) — Mac/Linux: cat ... | wrangler secret put VAPID_PRIVATE
wrangler deploy
```
Sau đó dán URL worker vào `../js/push-config.js` → `EDUPULSE_PUSH_WORKER_URL` và deploy hosting lại.

## Kiểm thử

Khi bật "Nhắc ôn hằng ngày" trong app (tab Tài khoản), app **tự gửi 1 thông báo thử ngay** — đã thấy thông báo là mọi thứ chạy. Cách khác:

```bash
# Gửi thông báo thử tay (cần endpoint từ trình duyệt)
curl -X POST https://edupulse-push.<tên>.workers.dev/send-test \
  -H "Content-Type: application/json" \
  -d '{"endpoint":"<endpoint từ trình duyệt>"}'
```

Xem log cron: `wrangler tail`

## Lưu ý

- iOS: Web Push chỉ hoạt động với PWA **đã cài vào Màn hình chính** (iOS 16.4+), Safari thuần không có push.
- `VAPID_PUBLIC` ở `[vars]` là key công khai (đã nằm sẵn trong `../js/push-config.js`).
- `vapid-private.txt` KHÔNG được public — nếu lộ, chạy lại `node generate-vapid.mjs` và cập nhật cả 2 nơi.
