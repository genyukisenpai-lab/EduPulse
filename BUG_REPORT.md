# Báo cáo kiểm thử E2E — EduPulse (App đếm ngược kỳ thi)

Ngày: 2026-08-19 · Kiểm thử viên: AI tester (Playwright 1.62.1, Chromium headless)
Môi trường: **Local** `http://localhost:3000` (`node server.js`) và **Deploy** `https://tsa1-69053.web.app`

---

## 1. Tóm tắt kết quả

| Môi trường | Tổng case | PASS | FAIL | WARN | SKIP | BLOCKED |
|---|---|---|---|---|---|---|
| Local | 67 | 54 | 9 | 3 | 0 | 1 |
| Deploy | 67 | 54 | 9 | 2 | 1 | 1 |
| **Local (sau khi sửa bug)** | **67** | **65** | **0** | **1** | **0** | **1** |

- **9 FAIL giống hệt nhau ở cả local và deploy** → là lỗi thật của app, không phải lỗi môi trường.
- Không có JS exception (`pageerror` = 0) khi load. Các lỗi console ghi nhận đều do test cố tình gây ra (email sai, offline) hoặc mất mạng trong lúc test offline.
- Ảnh chụp màn hình từng case: `screenshots/test-report/<suite>/*.png`; report máy: `screenshots/test-report/report.md` + `report.json`.

### Kết quả test 2 người dùng (suite `16-twouser`, deploy, 2 tài khoản đã xác thực)

| Tổng case | PASS | FAIL | BLOCKED |
|---|---|---|---|---|
| 12 | 12 | 0 | 0 |

- PASS: đăng nhập A/B, đồng bộ exam lên Firestore `users/{uid}/settings/app` (+ cleanup), chat chéo realtime 2 chiều, gọi video 1-1 (incoming → active 2 đầu → kết thúc ẩn overlay), phòng study hiển thị, đếm đủ 2 thành viên, rời phòng.
- **BUG-17 đã sửa và xác minh:** suite `16-twouser` chạy local đạt **12/12 PASS** (trước đây 11/12).

---

## 2. Ma trận phạm vi đã test

- Smoke (load, tabs, hero) · Theme (sáng/tối/tự động, lưu qua reload, toggle) · Quản lý kỳ thi (CRUD, filter, ngày quá khứ, XSS, hero) · Trang chủ (streak, lịch học, hero) · Thống kê (nhật ký, mục tiêu, biểu đồ, chia sẻ ảnh) · Widget settings · AI (chips, rỗng, hỏi thật, xóa lịch sử) · Chat (gating khách, badge, attach) · Thư viện · Tài khoản (đăng ký/đăng nhập form, quên mật khẩu, hiện mật khẩu) · PWA/Offline (SW, manifest, load cache khi mất mạng) · Push UI · Bảo mật (key lộ, rò dữ liệu khách) · Mobile viewport 390×844.

Chưa test được: đăng nhập thật, sync tài khoản, gửi tin chat, gọi điện, phòng study (cần tài khoản đã xác thực — **BLOCKED**, set `TEST_USER_EMAIL`/`TEST_USER_PASSWORD` để chạy `14-authed`).
→ **Đã test xong** qua suite `14-authed` (login/gửi chat/logout) và `16-twouser` (2 người dùng: sync, chat realtime, gọi video, phòng study) với 2 tài khoản đã xác thực.

---

## 3. BUG ĐÃ XÁC NHẬN

### 🔴 CRITICAL

#### BUG-1 — 5 API key Gemini THẬT đang hoạt động bị lộ công khai
- **Bằng chứng:** `13-security` lấy `js/ai-config.js` và tìm thấy **5 key dạng `AQ.*`** (local lẫn deploy). AI trả lời **thành công** bằng key này → key còn sống, ai cũng dùng được.
- **Vị trí:** `js/ai-config.js:10` (GEMINI_CLIENT_KEYS), `js/app.js` (luôn ưu tiên gọi Gemini client-side), `server.js:13` (`GEMINI_API_KEYS` từ env chỉ dùng cho `/api/ai`).
- **Rủi ro:** bất kỳ ai mở DevTools/đọc source đều lấy được key → dùng vô tội vạ, tiêu quota, phát sinh chi phí; hoàn toàn vô hiệu hoá ý định "giữ key trên server".
- **Cách tái hiện:** `GET /js/ai-config.js`, tìm `AQ.` → dán key gọi Gemini trực tiếp.
- **Khuyến nghị:** xoá key khỏi client; client bắt buộc gọi `/api/ai` (server) khi tự host; nếu dùng Firebase Hosting thuần (không server) thì đổi sang Cloud Function/edge.

---

### 🟠 HIGH

#### BUG-2 — Không sửa được kỳ thi đã qua hạn (modal đứng im, không lưu)
- **Bằng chứng (động):** `03-exams :: Sửa kỳ thi QUÁ KHỨ lưu được → FAIL` — `submitFired=0, modalOpen=1, edited=0`. Sửa kỳ thi **tương lai** thì OK.
- **Vị trí:** `js/app.js:1779` `openExamEditModal` set `exam-date.min = getLocalDateString()`; `index.html:713` ô ngày `required`. Native validation chặn submit vì ngày cũ `< hôm nay`.
- **Tác động:** kỳ thi đã thi xong không bao giờ sửa/sửa điểm được dù `handleExamSubmit` (app.js:1784) hoàn toàn cho phép.
- **Cách tái hiện:** có kỳ thi ngày 2026-06-27 (đã qua) → tab Kỳ thi → ✏️ → đổi tên → Lưu → không có gì xảy ra.
- **Khuyến nghị:** chỉ set `min` cho luồng THÊM mới, không set khi SỬA; hoặc tự chuyển về hôm nay khi SỬA kỳ thi quá khứ.

#### BUG-3 — Tính năng "Tùy chỉnh trang chủ" chết hoàn toàn (regression)
3 lỗi đè lên nhau (cùng suite `06-widgets`, cả 3 đều FAIL):
1. **Không có nút nào mở được modal:** `#btn-open-widget-settings`, `#btn-mobile-widget-settings`, `#btn-open-widget-settings-account` **không tồn tại** trong `index.html` hiện tại, nhưng `app.js:2696` vẫn bind click vào 3 id này → modal không bao giờ mở được. (Session cũ có nút, bản hiện tại đã gỡ mà quên gỡ code.)
2. **ID trùng lặp:** hai group "Lời chào" giống hệt (index.html:616-627) cùng id `ws-greeting-title`/`ws-greeting-sub` (count=2). `saveWidgetSettings` (app.js:2665-2666) đọc input **đầu tiên** → người dùng sửa ô thứ hai thì bị mất câm.
3. **Không có chỗ để áp dụng:** `applyWidgetConfig` (app.js:797-822) set text/visibility vào `home-greeting-title`, `home-greeting-sub`, `mobile-greeting-name`, `home-stat-*-label`, `home-panel-*`, `home-stats-grid`, `home-exams-panel`, `home-community-panel` — **tất cả không tồn tại** trong DOM hiện tại. Chỉ `hero-kicker` + `hero-countdown-box` còn tồn tại. Lưu lời chào → không đổi gì trên trang chủ.
- **Cách tái hiện:** không có nút nào trên toàn app mở được modal; ép mở modal rồi Lưu → không có gì đổi.
- **Khuyến nghị:** thêm lại nút mở (header trang chủ + tab tài khoản), gỡ group "Lời chào" trùng, và đồng bộ `applyWidgetConfig` với cấu trúc home hiện tại (hoặc cập nhật DOM để có các element đó).

#### BUG-4 — Hero hiển thị kỳ thi ĐÃ QUA với nhãn "KỲ THI TIẾP THEO"
- **Bằng chứng (động):** `04-home :: Hero không hiển thị kỳ thi đã qua → FAIL` — `{kicker:"KỲ THI TIẾP THEO", title:"Thi Tốt nghiệp THPT", days:"000"}`. Kỳ thi THPT (2026-06-27, đã qua) vẫn được chọn làm hero mặc định và hiện đếm ngược 000 ngày như "kỳ thi tiếp theo".
- **Vị trí:** `js/app.js:1302-1304` `getHeroExam()` = `exams.find(isHero) || exams[0]` — không lọc quá khứ (trong khi `getNearestExam` app.js:2967 và `isUpcomingExam` có lọc).
- **Khuyến nghị:** khi hero là kỳ thi đã qua, hiển thị trạng thái "Đã diễn ra" hoặc tự fallback sang kỳ thi tương lai gần nhất.

---

### 🟡 MEDIUM

#### BUG-5 — "Lịch học hôm nay" dựa trên kỳ thi đã qua
- **Bằng chứng (động):** `04-home :: Lịch học hôm nay dựa trên kỳ thi tương lai → FAIL` — `{nearest:"Thi Tốt nghiệp THPT", daysLeft:0} isPast=true`.
- **Vị trí:** `js/study.js:107-117` `getDailySchedule()` sort **tất cả** exam theo ngày lấy `[0]`, không lọc quá khứ → ngày đầu tiên là kỳ thi đã qua; kéo theo lệch mục tiêu phút (cộng bonus 40' khi `daysLeft<=7` = 0).
- **Khuyến nghị:** filter `isUpcomingExam` trước khi sort (giống app.js).

#### BUG-6 — Rò rỉ / trộn dữ liệu giữa các khách (state dùng chung 1 file)
- **Bằng chứng (động):** `13-security :: Guest load dữ liệu /api/state → WARN` — khách mới (localStorage rỗng) nhận được **toàn bộ kỳ thi do người dùng khác tạo** (test thêm 1 kỳ thi → khách khác load thấy ngay).
- **Vị trí:** `js/app.js:570-575` guest PUT toàn bộ `appState` lên `/api/state`; `js/app.js:484-498` loadState fallback đọc luôn file chung khi localStorage trống; `server.js:39` CORS `*`.
- **Tác động:** dữ liệu cá nhân (kỳ thi, nhật ký, mục tiêu) của người này hiện ra người khác; không có cơ chế phân tách user trên server.
- **Khuyến nghị:** bỏ fallback `/api/state` (hoặc chỉ dùng cho môi trường dev/khôi phục thủ công), hoặc thêm user-scoped key + auth trên server.

#### BUG-7 — File dữ liệu server bị hỏng mã hóa tiếng Việt (mojibake)
- **Bằng chứng:** `data/edupulse.json` chứa `Thi T��`t nghi���p THPT`, `Ki���m tra...` (ký tự thay thế `�`). Nếu khách load fallback `/api/state` sẽ thấy rác chữ.
- **Vị trí:** `server.js` (ghi `utf8`); nghi ngờ payload PUT bị gửi sai encoding hoặc file được ghi bởi bên khác. Cần kiểm tra `readJsonBody` (concat Buffer sang string) và thêm log.
- **Khuyến nghị:** gom Buffer rồi `Buffer.concat().toString('utf8')`; xoá file rác hiện tại.

---

### 🟢 LOW

- **BUG-8 — Badge chat sai nghĩa:** `updateChatBadge(snapshot.size)` (app.js:729) hiển thị **tổng tin đã nạp** (test thấy badge="2" khi có 2 tin), không phải số tin **chưa đọc** và không reset sau khi mở chat.
- **BUG-9 — Không có nút lọc "Kỳ thi khác":** `03-exams :: Có nút lọc danh mục "Kỳ thi khác" → FAIL` (số pill other=0); kỳ thi category `other` chỉ thấy ở "Tất cả". `index.html:202-206`.
- **BUG-10 — Chuỗi học không sync:** `STREAK_KEY='edupulse_streak'` (app.js:83) chỉ lưu localStorage, không nằm trong `appState` nên không đồng bộ lên cloud khi đăng nhập.
- **BUG-11 — Tên tác giả dễ bị `permission-denied`:** `slice(0,32)` theo ký tự JS (app.js:911,1094) nhưng Firestore rule `size() <= 32` tính **byte** → tên tiếng Việt dài có dấu có thể vượt → ghi chat fail.
- **BUG-12 — Tab nền bị đuổi khỏi phòng:** heartbeat phòng (`ROOM_STALE_MS=90000`, calls.js:11; timer calls.js:820) chạy theo `setInterval` → tab bị throttle khi ẩn → thành viên bị cleanup sau 90s dù còn online.
- **BUG-13 — File type rỗng bị chặn:** tài liệu đính kèm `type` rỗng bị từ chối mặc dù nằm trong allowlist (giảm khả năng gửi).
- **BUG-14 — UX bảo mật nhỏ:** dùng `confirm()` native để xóa kỳ thi (app.js:1500); `user-scalable=no` chặn phóng to chữ trên mobile (khó đọc với người kém thị lực).

---

### 🔵 HIGH (mới, từ test 2 người dùng)

#### BUG-17 — Phòng study đếm sai thành viên 10-30s sau cuộc gọi 1-1 (presence bị kẹt queue) — ✅ ĐÃ SỬA
- **Bằng chứng (động, lặp lại ổn định trên local lẫn deploy):** sau khi gọi video A↔B rồi **cả hai vào phòng study**, suốt ~10-22s **A thấy 1 thành viên, B thấy 2** (`Ffasaciv649@ittiv.com` / `Tuan121@yahoo.mail10p.com`). Client thứ 3 (page mới, cache trống, đọc `source:'server'`) xác nhận **doc presence của B không hề có trên server** trong khoảng thời gian đó → A nhìn đúng server, B đang nhìn **doc ảo trong cache cục bộ** (phantom member).
- **Nguyên nhân (đã xác minh bằng trace từng write op của cả 2 client):** sau cuộc gọi, **hàng đợi ghi Firestore của B bị nghẽn** (`db.waitForPendingWrites()` trả `STILL_PENDING` tới ≥8s dù `navigator.onLine=true`) do **bão xóa signal**: mỗi lần `onSnapshot` của `subscribeCallSignals()` (calls.js:444-466) phát lại, `snap.forEach` **lặp lại toàn bộ các doc signal chưa xóa được và re-delete từng cái** — hàng trăm lần với cùng một ID. Các delete đầu tiên này bị từ chối (`Missing or insufficient permissions`) vì **rules đã deploy lỗi thời** (chưa có `allow delete:` cho `calls/{callId}/signals`), nên doc còn tồn tại trên snapshot → mỗi signal mới kéo theo O(n²) lần delete → queue B không bao giờ cạn → write presence (calls.js:937-947) bị giữ pending → không tới server. (Xác nhận thêm: phòng KHÔNG gọi trước thì không kẹt — cuộc gọi chính là mồi.)
- **Cách sửa:** (1) dedupe signal trong `subscribeCallSignals()` và `subscribeRoomSignals()` (calls.js) — mỗi doc chỉ xử lý + delete **một lần** bằng `state.processedCallSignals`/`state.processedRoomSignals`, chặn hẳn vòng lặp n²; (2) deploy `firestore.rules` (cho phép `delete` signal bởi người gửi/người nhận) — xác minh sau deploy: **không còn `WRITE-ERR` nào**, mọi delete signal hoàn thành, doc không chất đống.
- **Kết quả:** `debug-room3.js` → `waitForPendingWrites` A=53ms/B=1ms, phòng đếm A=2 B=2 ở mọi mốc 4s-42s; `test_e2e_twouser.js local` → **12/12 PASS**.

---

### ⚫ MEDIUM (mới)

#### BUG-15 — Cuộc gọi 'ringing' mồ côi không bao giờ hết hạn → callee bị đổ chuông/chặn UI mỗi lần đăng nhập
- **Bằng chứng (động):** khi người gọi thoát/crash trang mà không hủy cuộc gọi, doc `calls/{id}` ở trạng thái `ringing` **tồn tại vĩnh viễn**. Ở lần đăng nhập sau, `subscribeIncoming` (calls.js:744-792) tìm thấy nó → hiện overlay "cuộc gọi đến" + đổ chuông, **chặn toàn bộ UI trong `RING_TIMEOUT_MS=45s`** (calls.js:10). `teardownCall` (calls.js:616-639) chỉ ẩn overlay tại chỗ, **không cập nhật doc** → lần đăng nhập kế tiếp lại đổ chuông tiếp (thậm chí không có người gọi thật).
- **Cách tái hiện:** mở 2 tab, A gọi B, đóng thẳng tab A (không bấm hủy) → đăng nhập B lại → overlay cuộc gọi đến bất ngờ, kéo dài 45s.
- **Khuyến nghị:** khi timeout incoming, cập nhật doc thành `status:'missed'`; thêm watchdog server (Cloud Function) hoặc `TTL` để dọn các doc `ringing` quá hạn.

#### BUG-16 — Rule Firestore khiến `calls` KHÔNG BAO GIỜ xóa được (collection tăng vô hạn)
- **Bằng chứng (động):** xóa doc `calls/*` từ client (dù là participant hợp lệ) luôn trả `permission-denied`. Lý do: `firestore.rules:71-73` dùng `allow update, delete: ... && request.resource.data.status in [...]` — với thao tác **DELETE**, `request.resource` là `null` nên `.data.status` không tồn tại → điều kiện false → từ chối. Vì BUG-15 không bao giờ tự sửa doc `ringing` và client không xóa được, collection `calls` chất đống mỗi cuộc gọi (kể cả đã kết thúc).
- **Vị trí:** `firestore.rules:56-90`.
- **Khuyến nghị:** tách `allow delete:` riêng (chỉ cần điều kiện participant, không kiểm `request.resource.data`), và/hoặc cho phép callee đổi `ringing`→`missed`.

---

### 🟢 LOW (mới)

- **BUG-18 — Mesh phòng bị lỗi WebRTC ngay sau cuộc gọi 1-1:** console của bên bị gọi ghi loạt `InvalidStateError` khi tham gia phòng sau cuộc gọi (`PeerConnection cannot create an answer...`, `Failed to set local answer sdp: Called in wrong state: stable`) — nghi do signal cũ còn sót trong `rooms/study/signals` được `subscribeRoomSignals` (calls.js:1016-1050) phát lại cho RTCPeerConnection mới của phòng → peer có thể dừng ở "Đang kết nối…" mãi. Cần test thêm để xác nhận mức độ ảnh hưởng.

---

## 4. Ghi chú không phải lỗi / giới hạn môi trường

- **Push notification không bật được trong headless:** Chromium không cấp quyền Notification → toggle giữ trạng thái "Đang tắt" (WARN, không phải lỗi app). Nên kiểm thủ công trên trình duyệt thật / iPhone (cần cài vào Màn hình chính, iOS 16.4+).
- **AI lúc đầu báo "Không gọi được Gemini"** (1 lần trên local do mạng), chạy lại thì trả lời thành công → không phải lỗi.
- **Offline:** app load được từ cache khi mất mạng (PASS) nhưng chỉ sau khi đã truy cập online ít nhất 1 lần (bản chất PWA, đúng thiết kế).

---

## 5. Khuyến nghị ưu tiên sửa

1. Xoay/ẩn toàn bộ Gemini key trên client (BUG-1) — rủi ro tài chính.
2. Sửa BUG-2 (sửa kỳ thi quá khứ) + BUG-3 (widget settings) + BUG-4 (hero) — trải nghiệm cốt lõi.
3. Sửa BUG-5/6/7 (dữ liệu sai + rò rỉ) trước khi mở rộng người dùng.
4. Sửa BUG-17 (presence phòng bị kẹt sau cuộc gọi) + BUG-15/16 (cuộc gọi mồ côi + không xóa được calls) — nhóm gọi điện/phòng study là tính năng realtime chính. → **BUG-17 đã sửa xong (xem mục 3).**
5. Xử lý các LOW (BUG-8→14, BUG-18) trong đợt tiếp theo.

## 6. Cách chạy lại

```
node server.js               # mở terminal 1 (local)
node test_e2e_suite.js local   # test localhost:3000
node test_e2e_suite.js deploy  # test https://tsa1-69053.web.app
# có tài khoản đã xác thực:
$env:TEST_USER_EMAIL="..."; $env:TEST_USER_PASSWORD="..."; node test_e2e_suite.js deploy
# test 2 người dùng (cần 2 tài khoản đã xác thực):
$env:USER1_EMAIL="..."; $env:USER1_PASSWORD="..."; $env:USER2_EMAIL="..."; $env:USER2_PASSWORD="..."; node test_e2e_twouser.js deploy
```

Kết quả tự ghi vào `screenshots/test-report/report.md` + `report.json` (+ `report-twouser.json`) + ảnh từng suite.