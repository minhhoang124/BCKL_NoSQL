# PR #54 — Browser QA 12/10/2026

## Kết luận và phạm vi

Ứng dụng từ head `6b58df9` + follow-up UX được chạy trong Chrome thật (headless), React/Vite
→ HTTP NestJS thật → PostgreSQL QA riêng. **4/4 scenario PASS**, có 18 ảnh
được mở và kiểm tra trực tiếp. Không dùng AuthContext mock hoặc HTTP success
fixture. Có fault injection (cố ý tạo lỗi đường truyền) ở các ca lỗi mạng.
Không nâng toàn bộ Checkout/Order thành DONE và không tự approve/merge.

| Cấu hình | Scenario chính | Kết quả |
|---|---|---|
| Desktop 1440×1080, sáng | Address → selected Cart → COD | PASS |
| Desktop 1440×1080, tối | Commit thật rồi mất response; reload/replay cùng key/body | PASS |
| Mobile 390×844, sáng | Đổi giá sau preview; từ chối rồi thử lại với dữ liệu hợp lệ | PASS |
| Mobile 390×844, tối | Thiếu kho sau preview; từ chối; empty/loading/network error/retry | PASS |

## Các bước đã kiểm

1. **Đăng nhập — PASS:** điền form thật; Backend cấp phiên/cookie. Tải trang
   mới giữ phiên qua refresh cookie, không tiêm token vào trình duyệt.
2. **Address — PASS:** tạo địa chỉ bằng UI/API; địa chỉ được dùng trong Checkout.
3. **Cart — PASS:** có hai variant, chọn một; link chuyển đúng lựa chọn sang
   Checkout, không tự mua toàn bộ giỏ.
4. **Preview — PASS:** chọn địa chỉ, nhấn kiểm tra giá/kho; tổng 20.000 đ.
   Heading/text `rgb(32,36,43)` trên nền trắng; select có cặp màu tường minh.
   Keyboard focus hiện outline; Enter gọi preview được. Document không tràn
   ngang ở 1440 hoặc 390 px. Kiểm ảnh preview/receipt/pending/error đều dễ đọc.
5. **COD — PASS:** mỗi Buyer có một Order PENDING_CONFIRMATION, payment UNPAID,
   tổng 20.000, snapshot địa chỉ đúng, một OrderItem quantity 2. Variant đã
   mua stock 5→3; một StockMovement, một SearchOutbox; dòng đã mua bị xóa.
   Variant không chọn vẫn stock 5 và còn trong giỏ.
6. **Replay — PASS:** route handler chuyển POST thật tới API, đợi 201/commit
   rồi bỏ response. Browser giữ intent, reload, gửi lại cùng key/body; hai
   request chỉ tạo một Order/movement/outbox. Đây là mô phỏng mất đường truyền
   sau commit thật, không phải HTTP response thành công tự viết.
7. **Lỗi và trạng thái — PASS có lưu ý UX:** giá đổi hoặc thiếu kho không tạo
   Order/movement/outbox và không xóa dòng giỏ. Sau phục hồi fixture QA,
   reload/preview/đặt COD thành công. Giỏ rỗng khóa preview. Cố ý giữ GET cart
   để kiểm loading. Abort GET cart cho thấy lỗi và nút Tải lại; bỏ lỗi rồi
   retry đọc được dữ liệu thật. Không có pageerror JavaScript ở bốn cấu hình.

## Lưu ý UX không dùng để tuyên bố đã hoàn thiện

- **Đã sửa Checkout GET thất bại:** chỉ hiện empty state sau GET thành công;
  lỗi GET dùng thông báo tải dữ liệu, không suy luận trạng thái giao dịch.
  Khi reload thất bại không dùng cart/address cũ để preview hoặc đặt đơn.
- **Đã sửa giá/kho đổi sau đặt:** có nút Tải lại giỏ và giá; khóa preview cũ
  cho tới khi Buyer tải lại, rồi Buyer preview/xác nhận thủ công. Không tự
  gửi giao dịch với giá mới. Browser retest đi qua nút này, không dùng reload
  trang để lách đường phục hồi. Pending intent chưa rõ commit vẫn giữ nguyên;
  không cho refresh tạo giao dịch khác.
- **Đã sửa địa chỉ dài:** có tóm tắt đầy đủ địa chỉ đã chọn, tự xuống dòng,
  bên ngoài native select; đọc được trên mobile.
- **Header global dark mode:** ô search kế thừa nền control tối, placeholder
  khó đọc. Ngoài sửa màu của Checkout; cần task shell riêng, không sửa lan
  sang Header/Address/Cart trong QA này.

## Bằng chứng và tái chạy

- Harness: `scripts/test-checkout-browser.mjs`; head thực chạy ghi trong
  `artifacts/checkout-browser/results.json` và comment bàn giao trên PR.
- Kết quả/18 ảnh/report HTML: `artifacts/checkout-browser/`, được Git ignore;
  không gửi dữ liệu runtime vào commit. Mở `report.html` để xem ảnh theo bước.
- Bốn screenshot nhỏ chỉ chứa Checkout fixture synthetic, đã bỏ Header/email,
  không có secret hoặc dữ liệu demo, tại [bằng chứng review công khai](../qa/evidence/checkout-browser-20261012/README.md).
- DB cho phép duy nhất `127.0.0.1:5549/bckl_checkout_web_20261012`; script
  kiểm tra host/port/name/query trước bootstrap. Đặt DATABASE_URL,
  JWT_ACCESS_SECRET, JWT_REFRESH_SECRET bằng giá trị QA riêng; không dùng
  `.env` hoặc secret demo. Cần BE đã build, migration QA đã provision.
- Cần Playwright và Chrome cài sẵn. Chạy từ root checkout:

```powershell
$env:QA_HEAD = (git rev-parse HEAD)
node scripts/test-checkout-browser.mjs --playwright-module <duong-dan-playwright/index.mjs>
```

Vite dùng port 5186 loopback/strictPort; Nest dùng port loopback ngẫu nhiên.
Search sync/reconciliation/image repair tắt trong harness; finally đóng
browser/server. Fixture có namespace browserqa riêng và DB QA giữ để kiểm
tra, không xóa dữ liệu demo. Mỗi lượt tạo fixture mới, không phải seed production.
Các lượt đầu harness dừng do email QA local-part quá dài hoặc chưa chuyển
sang keyboard modality khi đo focus; đã sửa harness và chạy lại đầy đủ.

Chạy lại follow-up: FE **157 PASS, 4 live SKIP mặc định**, lint/build PASS;
live jsdom → HTTP/PostgreSQL **4/4 PASS** explicit; browser **4/4 PASS** độc
lập với jsdom; node syntax check/diff-check PASS. Năm test UX mới kiểm failed
GET/retry, địa chỉ đủ, empty state thật, giá đổi/reload fail/recover và giữ
pending intent khi GET lỗi.
Không gọi 133 Backend E2E lượt trước là đã chạy lại lần này.

## Giới hạn và release gate

- Đồng bộ 12/10 sau merge #50: `develop d4d1884`. Conflict chỉ tại
  route Checkout; giữ cả `/cart` và `/checkout`, không đổi Cart/API/Auth.
  FE 157 PASS (4 live SKIP mặc định), lint/build PASS; chạy lại Chrome thật
  4/4 PASS trên QA riêng sau đồng bộ. Dữ liệu/ảnh đầy đủ nằm ở artifacts bị ignore.
  Không nối Order UI hoặc lấy kết quả này làm nghiệm thu fulfillment.

- Lượt kiểm trước đồng bộ có Cart #50 `10e7400` chưa merge và develop #53 `41450b4`.
- DB QA có 13 migrations, bao gồm completion-job từ đợt tích hợp trước;
  không phải fresh database chỉ theo bộ migration #54. CI head `6b58df9`
  có hai job SUCCESS khi kiểm tra, không thay bằng chứng browser này.
- Chưa chạy Firefox/Safari, thiết bị điện thoại thật, screen reader, full
  keyboard journey, multi-Store checkout/concurrent Buyers trong browser,
  catalog/image ingress, SearchOutbox dispatch/ES/FAISS, Seller delivery
  hoặc Buyer hoàn tất. Không tuyên bố WCAG compliant hoặc G-CHECKOUT DONE.
- #54 vẫn Draft/CHANGES_REQUESTED; cần Hiền re-review bản sửa và bằng chứng.
  Không resolve discussion thay reviewer. Chưa nối Order UI trong task này.
