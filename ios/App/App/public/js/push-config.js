// Cấu hình Web Push (nhắc ôn hằng ngày) cho EduPulse.
//
// EDUPULSE_PUSH_WORKER_URL: Cloudflare Worker đã deploy (push-worker/).
// Khi URL rỗng, tính năng tự ẩn — app vẫn hoạt động bình thường.
//
// VAPID_PUBLIC là key CÔNG KHAI (an toàn khi nằm trong bundle web).
window.EDUPULSE_PUSH_WORKER_URL = 'https://edupulse-push.genyukisenpai.workers.dev';
window.EDUPULSE_VAPID_PUBLIC_KEY = 'BDxaiUJpVIq3GyRVhs8aYS4b1bhiJuU9ci9945I-vGV5QrVuktFyMEBZc3f7W4TgvGlBANe90T87hvm5fMPbtpM';