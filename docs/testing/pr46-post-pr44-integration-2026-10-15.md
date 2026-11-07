# Đồng bộ PR 46 sau merge PR 44 và kiểm thử Backend Order

Ngày 15/10/2026. Nhánh `codex/order-delivery-commands`, head trước sửa `b654605`; merge `origin/develop 2ed3ee5` vào cùng nhánh, không rebase/force push. #44 đã được người dùng merge sau approval Hiền/Đạt; #42/#43/#45 đã có trên develop. Root develop được fast-forward an toàn; giữ nguyên file cá nhân và WIP khác. Không tự merge PR #46.

## 1. Phạm vi và xử lý conflict

Giải 6 conflict: `.env.example`, `BE/README.md`, `BE/src/configure-app.ts`, `BE/src/order/order.module.ts`, `docs/architecture/order-command-backend-readiness.md`, `docs/architecture/system-architecture-overview.md`.

- Giữ list/detail Buyer/Seller, Seller preparation, cancellation, delivery và SearchModule cùng đầy đủ service/guard.
- Giữ CORS/cookie/Retry-After và thứ tự parser GET → Seller command → cancellation → delivery → Checkout/default JSON. Parser là lớp đọc/giới hạn body trước xử lý nghiệp vụ, không phải quyền truy cập.
- Không bỏ quota/timeouts riêng của cancellation. Gộp cấu hình ORDER_COMMAND dùng chung tên biến, bỏ các dòng khai báo trùng do merge.
- Giữ cả tài liệu C2/C3/C4.1, phân biệt bằng chứng lịch sử và trạng thái mới. Detail mục 7.5.11, Seller 7.5.12, delivery 7.5.13; không xóa phần hủy/hoàn kho để thêm delivery.
- Không đổi production delivery service/parser/policy/receipt so với `b654605`. Seller/cancellation giữ nguyên so với develop `2ed3ee5`. Không đổi schema, migration, lockfile, FE, FastAPI hoặc contract Backend–AI. Contract delivery chỉ cập nhật trạng thái/bằng chứng, không đổi request/response.

## 2. Hai ca E2E mới

`BE/test/order-delivery-command.e2e-spec.ts` có 24 ca: 22 cũ + 2 tích hợp mới. Các ca delivery đơn lẻ vẫn ghi rõ READY_TO_SHIP là fixture; không đánh tráo với luồng mới.

### COD tới giao thành công sau giao lại

1. Catalog public/địa chỉ dùng fixture có nhãn; Order không tạo/sửa trạng thái bằng SQL.
2. PUT Cart quantity 2 → POST `/checkouts` COD, stock 5→3; có ledger CHECKOUT_DECREMENT quantityDelta=-2, balanceAfter=3 và UPSERT theo version chính thức.
3. Gọi ba Seller API qua hai ứng dụng/pool PostgreSQL: confirm → start-packing → ready-to-ship. Mỗi bước đúng một command/history; kho/Payment/Product/version/outbox không đổi sau Checkout.
4. Admin ship → delivery-failed → retry-delivery → mark-delivered. Attempt 1→2, retryCount=1; các lệnh mới dùng attempt 1 đến muộn bị STALE_DELIVERY_ATTEMPT và không ghi gì.
5. COD chuyển PAID/paidAt cùng Order.deliveredAt; chưa COMPLETED. Timeline có đúng 8 trạng thái, 7 command; delivery không đổi stock/ledger/Product/version/outbox.
6. Sửa tên catalog và địa chỉ hiện tại sau đặt hàng chỉ để kiểm snapshot: Buyer/Seller detail vẫn giữ hàng/địa chỉ/tiền lúc mua. Buyer không thấy ID Seller/Admin; Seller chỉ thấy audit theo allowlist; không trả key/hash/receipt nội bộ.
7. Gửi lại Checkout/confirm/ship/delivered cùng key/body qua ứng dụng còn lại: receipt trả kết quả gốc, detail vẫn DELIVERED, database không ghi thêm. Đây là mô phỏng bỏ qua phản hồi rồi replay; **không** nhận đã dùng proxy cắt response mạng hoặc browser thật.

### Hủy muộn cạnh tranh Admin ship

Tạo COD thật và chạy Seller tới READY_TO_SHIP; gửi Seller cancel và Admin ship đồng thời qua hai ứng dụng. Ship 200, cancel 409 ORDER_CANNOT_CANCEL; chỉ một command/history/attempt mới, không hoàn kho, không event/version hoặc Payment mutation thừa. Đây là kiểm trạng thái nguồn chặn hủy muộn, **không** gọi là cuộc đua hai lệnh đều có quyền thắng. Các ca confirm-vs-cancel thật của #44 vẫn giữ và chạy lại trong regression.

Swagger assertion được cập nhật để giữ đủ list/detail/Seller/cancel/delivery; không còn kỳ vọng Seller confirm chưa tồn tại. Chưa có Admin complete hoặc generic PATCH status.

## 3. Môi trường và kết quả thực chạy

PostgreSQL 17.11 trong container QA riêng `bckl-checkout-web-qa-20261012`, cổng loopback 5549; database mới **bckl_pr46_post44_20261015**, đủ 12 migration, không dùng database demo. Không có root/BE `.env` trong worktree; cấu hình chỉ đặt cho process, không commit credential. Test setup tắt cron Search/reconciliation/image repair; không dispatch dữ liệu demo sang AI.

| Kiểm tra | Kết quả |
|---|---|
| frozen-lockfile install | PASS, dependency đã có; lockfile không đổi |
| Prisma validate/migrate deploy/status | PASS, 12 migration, up to date |
| Backend full TypeScript / lint / build | PASS, lint không warning |
| Backend unit, maxWorkers=2 | **535/535 PASS**, 23 suites |
| 5 Order E2E suites | **191/191 PASS**, 37.93 giây |
| Full Backend E2E | **511/511 PASS**, 25 suites, 123.31 giây |
| Frontend test / lint / build | **122/122 PASS**, 15 files; TypeScript/Vite build PASS |
| Docker Compose config / git diff-check | PASS |
| Browser / Order UI / FastAPI–ES–FAISS | NOT_RUN trong task này |

Lượt Order đầu có 190 PASS/1 FAIL do assertion mới đợi INVALID_ORDER_TRANSITION thay mã contract hiện hành ORDER_CANNOT_CANCEL. Đã đối chiếu policy, sửa expected trong test, không thay service/contract hoặc skip; chạy lại targeted rồi full đều PASS. Các ERROR từ fault injection/health/response sai là negative tests có chủ đích; warning pg concurrent query và Vite plugin nền còn, chưa sửa trong task đồng bộ này.

Sau targeted cleanup: Orders/Products/SearchOutbox/Users/StockMovement đều 0. Sau full suite: Order/SearchOutbox/StockMovement đều 0, còn Product=1/User=2 từ fixture nền của bộ test; không xóa rộng để ép số liệu sạch. Database QA riêng được giữ để kiểm tra, không ảnh hưởng demo. Số FE 122 thuộc nền PR này; không cộng 239 test ở #55 chưa merge hoặc lấy số test giữa các branch cộng thành kết quả tích hợp.

## 4. Bàn giao và phần chưa hoàn tất

- [x] Đồng bộ nền #44, giữ đủ controller/provider/parser và quota.
- [x] COD thật → Seller → delivery → detail/replay, kèm hủy muộn.
- [x] Chạy lại #44/Order và toàn Backend/FE, kiểm schema không đổi.
- [x] Cập nhật kiến trúc/contract và báo cáo đúng giới hạn.
- [ ] CI đúng head sau push và Hiền re-review delta tích hợp mới.
- [ ] Người dùng quyết định merge #46; sau đó mới sync #47 → #48 theo nền chính thức, chạy lại test từng head.
- [ ] Order UI/browser, notification và nghiệm thu full G-FULFILMENT.
- [ ] Search worker → FastAPI → Elasticsearch/FAISS → hydrate trên head mới; không dùng evidence cũ #44 thay kết quả mới.

Không phát hiện blocker mới trong phần tích hợp đã kiểm, nhưng local PASS không tự thay CI/reviewer. Không cần Đạt approve shipping contract không đổi; khi có thay đổi Search/stock/outbox thực sự thì mới yêu cầu review đúng phạm vi. Không claim refund P1/thu tiền thật hoặc chất lượng tìm kiếm đã hoàn thành.
