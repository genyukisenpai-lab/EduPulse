#!/usr/bin/env bash
# EduPulse Push Worker — SETUP MỘT LẦN (Mac/Linux)
# Chạy:  cd push-worker ; ./setup.sh
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$(dirname "$0")"

step() { printf '\n=== %s ===\n' "$1"; }

[ -f vapid-private.txt ] || { echo 'THIẾU vapid-private.txt — chạy: node generate-vapid.mjs' >&2; exit 1; }

step 'Đăng nhập Cloudflare (mở trình duyệt — lần đầu cần xác nhận)'
npx wrangler@latest login

step 'Tạo KV namespace PUSH_SUBS'
KV_OUTPUT="$(npx wrangler@latest kv namespace create PUSH_SUBS)"
KV_ID="$(echo "$KV_OUTPUT" | grep -oE 'id = "[a-f0-9]+"' | head -1 | grep -oE '[a-f0-9]{32}')"
[ -z "$KV_ID" ] && { echo "Không đọc được KV ID. Kết quả: $KV_OUTPUT" >&2; exit 1; }
sed -i.bak "s/id = \"REPLACE_WITH_KV_ID\"/id = \"$KV_ID\"/" wrangler.toml
rm -f wrangler.toml.bak
echo "KV ID: $KV_ID"

step 'Cài secret VAPID_PRIVATE (khóa bí mật)'
cat vapid-private.txt | npx wrangler@latest secret put VAPID_PRIVATE

step 'Deploy worker lên Cloudflare'
DEPLOY_OUTPUT="$(npx wrangler@latest deploy 2>&1)"
echo "$DEPLOY_OUTPUT"
WORKER_URL="$(echo "$DEPLOY_OUTPUT" | grep -oE 'https://[a-z0-9-]+\.workers\.dev' | head -1)"
[ -z "$WORKER_URL" ] && { echo 'Không đọc được URL worker.' >&2; exit 1; }
echo "Worker URL: $WORKER_URL"

step 'Điền URL worker vào js/push-config.js'
CFG="$ROOT/js/push-config.js"
sed -i.bak "s|window\.EDUPULSE_PUSH_WORKER_URL = '';|window.EDUPULSE_PUSH_WORKER_URL = '$WORKER_URL';|" "$CFG"
rm -f "$CFG.bak"
echo "Đã ghi: EDUPULSE_PUSH_WORKER_URL = $WORKER_URL"

step 'Deploy hosting (đưa cấu hình mới lên web)'
cd "$ROOT"
npx firebase-tools deploy --only hosting

cat <<'EOF'

==============================================================
XONG! Tất cả đã sẵn sàng.
- Mở app (hoặc tải lại nếu đang mở) -> tab Tài khoản
- Bật "Nhắc ôn hằng ngày" -> mỗi ngày 18:00 nhận thông báo.
- Ngay khi bật sẽ có 1 thông báo thử để xác nhận.
==============================================================
EOF