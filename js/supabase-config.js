// Supabase Storage (tùy chọn) — lưu file học nhóm nặng hơn qua Edge Function.
// Hướng dẫn điền:
//   1. Tạo project tại supabase.com (free, không cần thẻ)
//   2. Storage > New bucket: tên "group-files", tick Public
//   3. Edge Functions > Create function "upload-file", dán nội dung
//      supabase/functions/upload-file/index.ts rồi Deploy
//   4. Dán URL function (dạng https://<ref>.supabase.co/functions/v1/upload-file) vào dưới đây
// Khi uploadUrl rỗng, app tự dùng kênh Firestore chunks như cũ — không lỗi gì cả.
window.SUPABASE_STORAGE = {
  uploadUrl: 'https://qmgcixzmdoclindssbpb.supabase.co/functions/v1/upload-file',
};
