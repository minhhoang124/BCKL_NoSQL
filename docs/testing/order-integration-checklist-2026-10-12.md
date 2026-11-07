# Checklist tích hợp Order sau Cart #50 — 12/10/2026

Baseline `develop d4d1884`. Hoàng tích hợp, Hiền review nghiệp vụ/QA;
Đạt phối hợp riêng CHK-S04 stock → outbox → index. Không đổi contract AI.
Đây là chuẩn bị và trạng thái kiểm chứng, không tuyên bố G-FULFILMENT DONE.

## Nền và thứ tự

Đã merge: Checkout COD #36, Order list #37, audit/receipt #38,
DeliveryAttempt #45, Address #49, Auth #52, client #53, Cart #50.

| PR | Vai trò | Nền kỹ thuật / điểm ghép | Trạng thái toàn luồng |
|---|---|---|---|
| #42 | Buyer/Seller đọc detail snapshot và timeline | List/audit #37/#38; dùng chung quota đọc | Chưa merge, chưa test kết hợp command |
| #43 | Seller confirm → packing → ready | OrderCommand #38; controller/provider/parser | Chưa merge, chưa test HTTP confirm-vs-cancel |
| #44 | Buyer/Seller hủy COD trước giao, hoàn kho | Audit/ledger #38/#36; SearchModule | Đồng bộ develop; chờ re-review |
| #46 | Admin ship/failed/retry/delivered mô phỏng | DeliveryAttempt #45; parser và command receipts | Chưa merge; test riêng không thay luồng từ Checkout |
| #47 | Seller/Admin xác nhận hàng quay về | #45 + ledger/stock; cần #46 để chứng minh luồng failed thật | Chưa merge; không đồng nghĩa hậu mãi/refund |
| #48 | Buyer complete và SYSTEM D07 | #38; migration OrderCompletionJob riêng, scheduler đã có | Đồng bộ develop; chờ re-review |
| #54 | Address → Cart chọn dòng → preview → tạo COD/recovery | #49/#50/#52/#53/#36 | Browser smoke đã chạy, chờ Hiền review; chưa Order UI |

Thứ tự đề nghị tác giả merge sau đủ review/CI: #42 → #43 → #44 → #46
→ #47 → #48. Không stack code các feature chưa merge vào nhánh thành viên.
Sau mỗi merge, sync PR kế tiếp: giữ **tất cả** controller/provider/import trong
`order.module.ts`, parser trong `configure-app.ts`, môi trường và kiến trúc;
không chọn nguyên ours/theirs. Mỗi head mới phải chạy regression và CI riêng.
Approval cũ không phải bằng chứng runtime head kết hợp đã chạy.

## Kịch bản phải chứng minh trên bản tích hợp

Các dòng dưới **NOT_RUN trên bản ghép #42–#48**, dù PR riêng có test.

| ID | Kịch bản | Kết quả phải quan sát |
|---|---|---|
| ORD-I01 | Buyer chọn đúng dòng Cart/địa chỉ, đặt COD; Seller đọc detail | Một Order/Store; snapshot, Decimal string; trừ kho/dòng Cart/Payment/outbox/receipt nguyên tử |
| ORD-I02 | Seller confirm → start-packing → ready-to-ship | Đúng owner/active; Store SUSPENDED xử lý đơn cũ; history và receipt đúng một lần |
| ORD-I03 | Buyer cancel cạnh tranh Seller confirm qua hai HTTP instance | Một state hợp lệ theo thứ tự commit; Buyer không hủy sau confirm; không hoàn kho trùng |
| ORD-I04 | Seller cancel CONFIRMED; Buyer cancel PENDING | COD UNPAID; từng Item có ledger; kho + version/outbox một lần; lỗi SQL rollback toàn bộ |
| ORD-I05 | Admin ship → delivered → Buyer complete | Attempt 1; COD PAID ở DELIVERED; COMPLETED không đổi kho/Payment; detail/timeline hiện hành |
| ORD-I06 | Failed → retry, callback attempt cũ đến muộn | STALE_DELIVERY_ATTEMPT; tối đa 4 lần tổng, không đổi kho khi failed |
| ORD-I07 | Failed → confirm-returned: bán lại/hỏng/mất | Chỉ hàng đã nhận bán lại hoàn kho; hỏng/mất không tăng kho; CANCELLED/Payment/history cùng commit |
| ORD-I08 | Buyer complete cạnh tranh job D07; restart/lease hết | Một completion/history; việc qua restart; lỗi một đơn không chặn batch; retry hữu hạn |
| ORD-I09 | Mất response sau commit, replay cùng key/payload | Receipt bất biến; không tạo hai đơn/attempt/stock movement/outbox; khác payload conflict |
| ORD-I10 | Hai Buyer mua Variant cuối; giá đổi/thiếu kho | Không oversell; báo lỗi và refresh có kiểm soát; không tự đặt lại; failed purchase không mutation |
| ORD-I11 | Buyer/Seller khác owner, account khóa, body/query/extra sai | 404 ngoài owner; phân quyền/validation; không lộ receipt/hash/key hoặc nội dung nháp |
| ORD-I12 | Chỉnh Product/Address sau đặt rồi đọc detail | Snapshot không thay; timeline canonical; không đoán actor/ledger legacy |
| CHK-S04 | Stock giảm/hoàn → SearchOutbox → FastAPI → ES/FAISS → hydrate | Version đơn điệu, event nguyên tử, index cập nhật/retry; PostgreSQL là nguồn chuẩn |

## Bằng chứng và điều kiện trước nối UI

- DB PostgreSQL riêng theo checkout/migration, không demo; Backend thật,
  HTTP giữa các actor; mã fixture rõ nhãn. Không mock thành công để gọi integration.
- Ghi head, migration set, lệnh/test count, PASS/FAIL/NOT_RUN và hạn chế.
- Nối Buyer Order/Seller Order UI sau contract/PR nền merge; Hiền vẫn giữ
  Address/Cart/Admin, Hoàng giữ Checkout/Order/Seller/integration.
- Browser chạy cả desktop/mobile, sáng/tối, loading/error/retry, double submit
  và ownership. Test API không thay trải nghiệm Web; cron không thay doanh thu,
  Review, Notification, refund hoặc shipping thật chưa triển khai.
- CHK-S04 cần phối hợp Đạt nhưng không chặn Hiền review Order chỉ vì chưa có
  kết quả AI; chưa đóng gate Search integration khi chưa chạy chuỗi đó.

Thuật ngữ: dependency = phần nền cần có; regression = kiểm tra lại phần cũ;
receipt = biên nhận đã commit để gửi lại an toàn; lease = quyền xử lý tạm trong DB;
outbox = công việc đồng bộ lưu cùng giao dịch; snapshot = dữ liệu lúc mua.
