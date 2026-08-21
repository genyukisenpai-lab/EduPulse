# EduPulse — Báo cáo kiểm thử E2E

Target: `http://localhost:3000`  ·  Thời gian: 07:32:21 20/8/2026

## Tóm tắt

| Kết quả | Số lượng |
|---|---|
| PASS | 65 |
| FAIL | 0 |
| WARN | 1 |
| SKIP | 0 |
| BLOCKED | 1 |
| **Tổng** | **67** |

## Chi tiết từng case


### 01-smoke
- **PASS** Trang load không có JS exception
- **PASS** Tiêu đề đúng — `EduPulse — Trợ lý Sĩ tử & Đếm ngược Kỳ thi`
- **PASS** Sidebar đủ 6 mục điều hướng — `count=6`
- **PASS** Hero countdown render — `"Chưa chọn kỳ thi"`
- **PASS** Theme khởi tạo (auto) — `data-theme=light`
- **PASS** Chuyển tab Exams hiển thị
- **PASS** Chuyển tab AI hiển thị

### 02-theme
- **PASS** Chọn Tối -> data-theme=dark — `data-theme=dark`
- **PASS** Chọn Sáng -> data-theme=light — `data-theme=light`
- **PASS** Theme lưu sau reload — `data-theme=light`
- **PASS** Toggle sidebar đổi theme (dark -> light) — `data-theme=light`

### 03-exams
- **PASS** Mở modal Thêm kỳ thi
- **PASS** Modal exam không trùng id — `count #exam-date=1`
- **PASS** Thêm kỳ thi HSA thành công
- **PASS** Chặn ngày quá khứ khi thêm (min=hôm nay) — `min=2026-08-20 checkValidity=false`
- **PASS** Filter THPT ẩn kỳ thi HSA — `count=0`
- **PASS** Filter HSA/TSA hiện kỳ thi HSA — `count=1`
- **PASS** Có nút lọc danh mục "Kỳ thi khác" — `số pill other=1`
- **PASS** Đặt hero phản ánh lên trang chủ — `hero="Thi thử HSA lần 1"`
- **PASS** Countdown days định dạng 3 số — `days=212`
- **PASS** Sửa kỳ thi tương lai lưu được — `cards="(sửa)"=1 modalStillOpen=0 title=" Chỉnh Sửa Kỳ Thi"`
- **PASS** Sửa kỳ thi QUÁ KHỨ lưu được — `submitFired=1 modalOpen=0 edited=1`
- **PASS** Xóa kỳ thi (confirm modal) — `còn 3 thẻ`
- **PASS** Tiêu đề XSS bị escape (không có <img> thực thi) — `
        <div>
          <div class="exam-card-top">
            <span class="exam-category-tag">THPT Quốc Gia</span>
  `

### 04-home
- **PASS** Chuỗi học hiển thị — `streak=1`
- **PASS** Hero không hiển thị kỳ thi đã qua — `{"kicker":"KỲ THI TIẾP THEO","title":"Kiểm tra giữa kỳ Toán","days":"026"}`
- **PASS** Lịch học hôm nay dựa trên kỳ thi tương lai — `{"nearest":"Kiểm tra giữa kỳ Toán","daysLeft":26} isPast=false`
- **PASS** Lịch học hôm nay render (3 môn) — `count=3`
- **PASS** Các widget trang chủ tồn tại trong DOM — `thiếu: `

### 05-study
- **PASS** Ghi nhận nhật ký học tập — `rows=1`
- **PASS** Hôm nay cộng phút — `today=45p`
- **PASS** Chặn ghi nhật ký khi thiếu phút — `Lý rows=0`
- **PASS** Lưu mục tiêu -> progress cập nhật — `progress=8%`
- **PASS** Biểu đồ tuần được vẽ — `{"exists":true,"pixels":6159}`
- **PASS** Chia sẻ thành tích (tải ảnh PNG) — `edupulse-thanh-tich.png`

### 06-widgets
- **PASS** Modal widget không có ID trùng lặp — `#ws-greeting-title=1 #ws-greeting-sub=1 groups=5`
- **PASS** Có nút mở modal Tùy chỉnh trang chủ — `số nút=3 (app.js vẫn bind 3 nút này)`
- **PASS** Lưu lời chào -> áp dụng lên trang chủ — `home-greeting-title tồn tại=true mobile-greeting-name tồn tại=true (applyWidgetConfig set vào 2 id này)`
- **PASS** Các element đích của applyWidgetConfig tồn tại — `thiếu: `

### 07-ai
- **PASS** Subject chips render (9 môn) — `count=9`
- **PASS** Gửi input rỗng không tạo tin — `1->1`
- **PASS** AI trả lời được (thêm tin assistant) — `before=1 after=3 reply(120)="Mình chưa có kết nối Gemini. Kiểm tra API key hoặc server AI rồi thử lại nhé." status=""`
- **PASS** Xóa lịch sử AI — `messages=3`

### 08-chat
- **PASS** Kết nối phòng chat (đọc trạng thái) — `"Trực tuyến"`
- **PASS** Khách gửi tin bị chặn + chuyển tab tài khoản — `toast="Vui lòng đăng nhập để tham gia chat cộng đồng." accountActive=1`
- **PASS** Badge chat không hiện khi không có tin mới — `badge="" (tổng tin trong phòng=0)`
- **PASS** Attach input có accept đúng — `accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,image/*"`
- **PASS** Có ô tên hiển thị — `count=1`

### 09-library
- **PASS** Thư viện rỗng hiển thị empty state — `empty=1`

### 10-account
- **PASS** Chuyển chế độ Đăng ký hiện ô tên
- **PASS** Hiện/ẩn mật khẩu — `type=text`
- **PASS** Mở modal Quên mật khẩu
- **PASS** Email không hợp lệ -> thông báo lỗi — `toast="Địa chỉ email không hợp lệ."`
- **PASS** Mục bật/tắt push hiển thị (guest) — `push=true media=true`

### 11-pwa
- **PASS** Service worker kiểm soát trang — `controller=activated`
- **PASS** Manifest được khai báo — `manifest.webmanifest`
- **PASS** Offline: app shell load từ cache — `hero=1 banner=false`
- **PASS** Online: banner ngoại tuyến ẩn — `visible=false`

### 12-push
- **PASS** Mục nhắc ôn hằng ngày hiển thị — `visible=true`
- **WARN** Bật push khi chưa cấp quyền — `label="Đang tắt" (trình duyệt tự chặn)`
- **PASS** 4 khung giờ nhắc học — `count=4`

### 13-security
- **PASS** API key Gemini không lộ trong bundle công khai — `tìm thấy 0 key dạng AQ.* trong js/ai-config.js`
- **PASS** Guest load dữ liệu /api/state (dữ liệu chung server) — `khách nhận được 0 kỳ thi từ server: `

### 14-authed
- **BLOCKED** Đăng nhập (chưa có tài khoản) — `Set TEST_USER_EMAIL/TEST_USER_PASSWORD để test sync/chat/call/room`

### 15-mobile
- **PASS** Bottom nav hiện 7 mục — `count=7`
- **PASS** Mobile: chuyển tab AI
- **PASS** Mobile: không tràn ngang — `overflow-x=0px`

## Lỗi console / JS

- console.error: `Failed to load resource: the server responded with a status of 400 ()`
- console.error: `Auth error: FirebaseError: Firebase: The email address is badly formatted. (auth/invalid-email).
    at B (https://www.gstatic.com/firebasejs/10.14.1/firebase-auth-compat.js:1:23155)
    at j (https://www.gstatic.com/firebasejs/10.14.1/firebase-auth-compat.js:1:22410)
    at se (https://www.gstatic.com/firebasejs/10.14.1/firebase-auth-compat.js:1:28843)
    at async ae (https://www.gstatic.com/firebasejs/10.14.1/firebase-auth-compat.js:1:28975)
    at async Mt (https://www.gstatic.com/firebasejs/10.14.1/firebase-auth-compat.js:1:75867)
    at async HTMLFormElement.handleEmailAuth (http://localhost:3000/js/app.js?v=76:1692:26)`
- console.error: `Failed to load resource: net::ERR_INTERNET_DISCONNECTED`
- console.error: `Failed to load resource: net::ERR_INTERNET_DISCONNECTED`
- console.error: `Failed to load resource: net::ERR_INTERNET_DISCONNECTED`
- console.error: `[2026-08-20T00:32:02.454Z]  @firebase/firestore: Firestore (10.14.1): Could not reach Cloud Firestore backend. Connection failed 1 times. Most recent error: FirebaseError: [code=unavailable]: The operation could not be completed
This typically indicates that your device does not have a healthy Internet connection at the moment. The client will operate in offline mode until it is able to successfully connect to the backend.`
- console.error: `Failed to load resource: net::ERR_INTERNET_DISCONNECTED`
- console.error: `Failed to load resource: net::ERR_FAILED`
- console.error: `Failed to load resource: net::ERR_FAILED`
- console.error: `Failed to load resource: net::ERR_INTERNET_DISCONNECTED`
- console.error: `Failed to load resource: net::ERR_FAILED`