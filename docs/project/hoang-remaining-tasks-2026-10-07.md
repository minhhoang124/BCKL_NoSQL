# Checklist phần Hoàng — 07/10/2026

Owner: @grumhu124. Review nghiệp vụ/DB: @Hiennq44; review Search: @dungdat.

Theo dõi/cập nhật tại [issue #33](https://github.com/grumhu124/BCKL_ThuongMaiDienTu/issues/33); phần Hiền/Đạt tại [issue #32](https://github.com/grumhu124/BCKL_ThuongMaiDienTu/issues/32).

Baseline kiểm thử lịch sử ngày 07/10: `develop 6663fab`; nền móng/Auth cơ bản, Store/Product/importer và Search đã merge; Address/Cart **Backend** đã merge. Cập nhật trạng thái ngày 08/10: #29 đã merge vào `develop` tại `c6e0ba1`, sau khi Hiền và Đạt approve thiết kế. Không xem các release gate hoàn tất chỉ vì có schema/API/CI. Buyer Address/Cart UI được giao Hiền; Buyer Checkout/Order UI, Seller UI, Backend và tích hợp vẫn thuộc Hoàng.

## A. Làm ngay — chuẩn bị Checkout

- [x] #29 đã được Hiền và Đạt approve; [review Search của Đạt](https://github.com/grumhu124/BCKL_ThuongMaiDienTu/pull/29#pullrequestreview-5439915734). Người dùng đã merge tại `c6e0ba1`; agent không tự merge. Đây là chấp thuận thiết kế, không phải nghiệm thu Checkout runtime.
- [x] Đạt đã chuẩn bị [runbook/preflight ở #35](https://github.com/grumhu124/BCKL_ThuongMaiDienTu/pull/35), head `88e1c78`, CI xanh; Hiền đã approve ngày 08/10. Công cụ chỉ kiểm tra nền: **integrationStatus=NOT_RUN**, CHK-S01–S03 chưa nghiệm thu.
- [x] Rà schema/migration/Cart/Address/public policy/outbox và lập [preflight](../testing/checkout-preflight-2026-10-07.md). Audit chỉ đọc phát hiện DB demo thiếu hai migration đã merge; audit SQL chạy được trên DB Cart test, không chứng minh Checkout runtime đã đạt.
- [x] Tạo DB test riêng `bckl_checkout_preflight_20261007_a`, deploy 9 migration hiện có; Prisma validate/lint/build PASS, 122 unit + 158 E2E PASS trên BE source bằng develop. Audit chỉ đọc sau test PASS; chưa có Checkout API nên CHK/QCHK vẫn NOT_RUN.
- [ ] Đồng bộ DB demo sau kiểm tra/backup bằng migration đã merge; audit lại đúng database trước migration Checkout mới. Không lấy số 0 ở DB test làm số liệu của DB demo.
- [ ] Chuẩn bị migration mới `hashVersion`, `receiptVersion`, `receiptJson` và constraint. Không sửa migration #26/#30; không backfill hash v1 bằng suy đoán. Row legacy chưa chứng minh hash/receipt phải từ chối replay an toàn.
- [ ] Nhánh implementation từ develop mới nhất sau dependency merge; cập nhật kiến trúc theo đúng CURRENT/IN_PROGRESS/TARGET.

## B. Ưu tiên code sau review — Checkout/COD

- [ ] Preview: subset Cart/quantity đúng, địa chỉ thuộc Buyer, public/price/stock check, privacy allowlist; lỗi dòng trả `canCheckout=false`, totals null theo contract.
- [ ] Canonical request hash v1; Decimal tiền nguyên đồng, 50 dòng, quantity 1–99, body 64 KiB, giới hạn tổng tiền; lỗi/rate limits đúng Q1–Q7.
- [ ] Tạo COD: một Checkout/Buyer/key, một Order/Store; snapshot địa chỉ/sản phẩm/giá, Payment UNPAID/history/movement, tiêu thụ đúng dòng Cart. Toàn nhóm cùng transaction commit/rollback.
- [ ] Trừ kho có điều kiện, lock theo thứ tự; hai người mua sản phẩm cuối chỉ một người thành công. Retry serialization/deadlock hữu hạn, không retry mọi lỗi.
- [ ] Stock → một Product.version/event mỗi Product, đọc lại public payload bằng listingInclude/categories trong cùng tx. Ghi outbox lỗi phải rollback toàn bộ. Không gọi FastAPI trong tx.
- [ ] Receipt v1 bất biến trong cùng tx; replay cùng key/body nhận kết quả gốc, khác body lỗi conflict. Lookup chỉ đọc; timeout giữ key/body, không tạo key mới để né kết quả chưa rõ.
- [ ] Unit/E2E/DB isolation/race bằng connection độc lập; CHK/QCHK và Search CHK-S01–S03. Swagger + architecture + SRS traceability; PR nhỏ, review Hiền/Đạt theo phạm vi.

## C. Tiếp theo — Order và UI mua hàng

- [ ] Buyer xem danh sách/chi tiết/lịch sử Order; Seller chỉ xem Order của Store mình.
- [ ] Command lifecycle đúng actor: xác nhận → đóng gói → sẵn sàng giao → vận chuyển mô phỏng → giao → hoàn tất. Không PATCH enum tùy ý.
- [ ] Delivery-failed khớp lần giao hiện hành; tối đa 3 **giao lại**, tức 4 lần giao tổng cộng. COD PAID ở DELIVERED; doanh thu ở COMPLETED.
- [ ] Hủy hợp lệ/hoàn kho đúng một lần; command retry không đổi dữ liệu lần hai. Buyer/job hoàn tất theo contract; CHK-S04 kiểm hoàn kho → Search.
- [ ] Buyer Checkout/Order UI, Seller xử lý Order UI; trạng thái chờ/mất mạng/giá đổi/hết kho/timeout và browser evidence. Tích hợp hai màn Address/Cart của Hiền.

## D. P0 còn lại — tách task, không nhét vào PR Checkout

- [ ] Auth đa quyền/capability + onboarding Store theo SRS: một người mua và bán, giữ dữ liệu cũ; migration/review riêng, không thay Auth âm thầm. Hồ sơ và public Store bổ sung khoảng trống sau audit.
- [ ] Hoàn thiện Seller Product/Store UI và Public/Search UI theo API thật; chốt gate G-LISTING/G-DISCOVERY cùng Hiền/Đạt.
- [ ] Chat text realtime + lịch sử/phân trang/read/unread; ownership Buyer–Store, reconnect và chống gửi trùng theo thiết kế Chat.
- [ ] Review sau Order COMPLETED; phản hồi Seller/moderation; thông báo trong ứng dụng sau commit; Dashboard doanh thu/đơn, phối hợp Admin Hiền.

## E. P1 và bàn giao trước bảo vệ

- [ ] Email verify/reset, Google OAuth, phone OTP sandbox theo thiết kế được review; không liên kết tài khoản chỉ vì email trùng.
- [ ] VNPay/MoMo sandbox sau COD/Payment ổn định; xác minh callback và idempotency, không tiền thật.
- [ ] ReturnRequest/hoàn tiền mô phỏng: snapshot, hạn mức một OrderItem, refund/restock/adjustment đúng một lần theo scope; không hoàn kho chỉ vì chấp thuận.
- [ ] Docker toàn hệ thống/fresh checkout, seed nhỏ, backup/restore demo, security/rate limit/load checks và logging an toàn.
- [ ] Rà lỗi typecheck toàn Backend riêng với build; không dùng build PASS để che typecheck FAIL. Test/report/demo/ERD/SRS/kiến trúc đồng bộ và ghi limitation.

## Thứ tự và tiến độ

**A → B → C** là đường ưu tiên mua hàng; Hiền làm UI/Admin và Đạt làm Search/evaluation song song. D/E tách dependency, cần ước lượng lại khi Checkout có kết quả test; chưa hứa hoàn thành toàn bộ trước 11/10. Chat vẫn P0, sandbox/Auth/hậu mãi vẫn P1 trước bảo vệ, không âm thầm chuyển sang đề xuất.

Checkbox chỉ tick khi có bằng chứng phù hợp, không tự tick vì issue/plan được tạo. Nguồn chuẩn: `docs/project/implementation-scope.md`, SRS v3.1 và #29/Q1–Q7; mọi yêu cầu mới sửa tài liệu và review trước code.

Thuật ngữ: **preflight** = kiểm tra nền trước triển khai; **receipt** = biên nhận kết quả checkout gốc; **snapshot** = bản chụp dữ liệu lúc đặt; **transaction** = nhiều thay đổi cùng thành công/hoàn tác; **race condition** = lỗi do thao tác đồng thời; **replay** = gửi lại cùng yêu cầu để lấy kết quả cũ.
