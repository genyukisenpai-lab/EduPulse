# EduPulse

Ứng dụng đếm ngược kỳ thi trọng điểm (THPTQG, HSA, TSA, HSG), đồng bộ đám mây và phòng chat cộng đồng sĩ tử thời gian thực.

## Kết nối Firebase

1. Tạo một project trên [Firebase Console](https://console.firebase.google.com/) và thêm **Web app**.
2. Trong **Authentication > Sign-in method**, bật **Email/Password** và **Google**. Với Google, nhập email hỗ trợ nếu Firebase yêu cầu.
3. Tạo **Cloud Firestore** (Production mode), sau đó dán nội dung tệp `firestore.rules` vào tab **Rules** và Publish. Chat có thể chia sẻ ảnh, PDF, Word, PowerPoint, Excel và TXT tối đa 2 MB bằng Firestore, không cần Firebase Storage hay nâng cấp gói. Chỉ tài khoản đã xác thực email mới tải lên được.
4. Dán thông số Web app vào [js/firebase-config.js](js/firebase-config.js). Không đưa tệp cấu hình đã điền thông số nhạy cảm vào kho công khai nếu chính sách dự án của bạn không cho phép.

Khi Firebase đã cấu hình, mỗi người dùng đăng nhập (qua Email hoặc Google) có một bản ghi tùy chỉnh riêng tại `users/{uid}/settings/app`; hồ sơ người dùng (tên, email, avatar) nằm ở `users/{uid}/settings/profile`; phòng chat dùng chung nằm tại `rooms/general/messages`. Người dùng chưa đăng nhập có thể xem giao diện và dữ liệu ngoại tuyến, nhưng cần đăng nhập bằng Email hoặc Google để đồng bộ đám mây và tham gia trò chuyện cộng đồng.

## Chạy ứng dụng

Yêu cầu Node.js 18 trở lên.

```powershell
node server.js
```

Mở `http://localhost:3000`. Nếu Firebase chưa được cấu hình, giao diện vẫn hoạt động ngoại tuyến nhờ dữ liệu dự phòng trên trình duyệt và API cục bộ.

### Bật AI (Gemini)

Có hai cách, chọn một:

**Cách 1 — Chạy bằng server cục bộ (khuyến nghị, key không lộ ra trình duyệt):**

1. Tạo key từ [Google AI Studio](https://aistudio.google.com/app/apikey).
2. Chạy server kèm key (nhiều key phân cách bằng dấu phẩy):

```powershell
$env:GEMINI_API_KEYS = "key1,key2"; node server.js
```

**Cách 2 — Deploy lên Firebase Hosting (không có server):**

1. Tạo key từ [Google AI Studio](https://aistudio.google.com/app/apikey).
2. Mở `js/ai-config.js` và dán key vào mảng: `window.EDUPULSE_GEMINI_API_KEYS = ['KEY_CUA_BAN'];`.
3. Deploy: `firebase deploy --only hosting,firestore:rules`.

> ⚠️ Với Cách 2, key được gửi xuống trình duyệt nên **công khai với mọi người dùng web** — chỉ dùng key riêng, giới hạn quota. Không commit key vào Git (`js/ai-config.js` đã nằm trong `.gitignore`). Khi chưa cấu hình key hoặc AI không phản hồi, trợ lý tự động dùng chế độ offline.

## Cài như ứng dụng (PWA)

EduPulse có thể cài trên máy tính và điện thoại. Khi chạy từ `localhost` hoặc một tên miền HTTPS, trình duyệt sẽ hiện đề nghị **Cài EduPulse**. Sau lần mở đầu tiên, giao diện và các tệp cốt lõi được lưu offline; dữ liệu Firebase/chat vẫn cần Internet để đồng bộ thời gian thực.
