# Dashboard Admin/Seller — nguồn doanh thu và hoàn tiền chung

Implementation trên `codex/dashboard-runtime`, base `5802ae4` sau hậu mãi #119.
Chưa tích hợp UI; không gọi đây là tiền thực thu, lợi nhuận hay settlement.
Theo [contract chung](dashboard-aftersales-contract.md).

## API đọc

- `GET /admin/dashboard?from=2026-01-01&to=2026-02-01&bucket=day`
- `GET /seller/dashboard?from=2026-01-01&to=2026-02-01&bucket=month`
- `GET /admin/dashboard/data-quality?from=2026-01-01&to=2026-02-01&limit=20`
- `GET /seller/dashboard/data-quality?from=2026-01-01&to=2026-02-01&limit=20&beforeId=123`

JWT bắt buộc. Admin và Seller là hai quyền riêng, không kế thừa. Mỗi transaction
đọc lại actor active/role/credentialVersion. Seller dùng Store theo sellerId
canonical; không nhận storeId từ client. Store CLOSED vẫn đọc lịch sử của mình;
không vì thế được bán mới. Seller chưa có Store trả404. Dữ liệu người mua như
địa chỉ, điện thoại, hash và token không nằm trong response.

`from/to` là ngày ISO hợp lệ trong 2000..2099, timezone Asia/Ho_Chi_Minh,
khoảng nửa mở `[from,to)`, tối đa366 ngày. Không truyền giờ UTC từ client.
`bucket=day|month|quarter`, mặc định day; trả đủ kỳ rỗng. Kỳ đầu/cuối bị cắt
được ghi `partial=true`, `periodStart` vẫn là đầu kỳ lịch. Query lạ/trùng/mảng
hoặc GET/HEAD có body bị400; tất cả response kể cả lỗi có `Cache-Control: no-store`.
Data-quality chỉ nhận from/to/limit/beforeId, limit1..50, cursor id giảm dần
exclusive. Không nhận bucket trên endpoint này.

## Response và nguồn chỉ số

Mỗi response có `scope`, Store canonical (Seller) hoặc null (Admin), `asOf`
lấy từ clock PostgreSQL trong snapshot, timezone và range. Summary có currency VND.
Mọi tiền là chuỗi hai số thập phân; aggregate dùng PostgreSQL numeric rộng,
không JS float, không giới hạn tổng bằng Decimal(14,2) của từng bản ghi.

| Trường | Ý nghĩa và nguồn |
|---|---|
| totals.completedOrderCount | Số đơn COMPLETED hợp lệ có completedAt trong kỳ, mỗi Order một lần |
| totals.grossMerchandise | Tổng subtotal của các đơn trên, không gồm shipping |
| totals.effectiveRefundMerchandise | Số dương từ `-RevenueAdjustment.amount` có effectiveAt trong kỳ, qua RefundRecord và Order hợp lệ |
| totals.netMerchandise | Gross trong kỳ trừ refund effective trong kỳ, có thể âm |
| totals.completedShipping | Shipping riêng của các đơn gross, không trừ refund hàng hóa |
| buckets | Cùng các chỉ số trên theo lịch UTC+7; không lấy mẫu top50 |
| pendingRefundMerchandise | Refund thành công với adjustment chưa effective, lifetime tại asOf; không phụ thuộc kỳ |
| dataQuality.invalidSnapshotOrderCount | Số Order ứng viên có snapshot/projection không hợp lệ, đã loại khỏi cả hai vế tiền |
| createdOrderCountsByCurrentStatus | Đơn tạo trong kỳ, nhóm theo trạng thái hiện tại tại asOf; không phải lịch sử chuyển trạng thái |
| currentProductCountsByStatus | Số Product hiện tại theo sellerStatus và moderationStatus, hai phân loại riêng; không phải tồn kho variant |
| currentUserCountsByRoleAndActive | Chỉ Admin: số User hiện tại theo role/active, không theo kỳ |
| currentStoreCountsByStatus | Chỉ Admin: số Store hiện tại, gồm PENDING/ACTIVE/REJECTED/SUSPENDED/CLOSED |

Refund chỉ đọc nguồn hậu mãi đã merge, không trừ Payment lần nữa. Refund mode
hiện tại là SIMULATED. Pending không tạo doanh thu âm trước completion. Hook
completion chung Buyer/system kích hoạt adjustment cùng transaction; Dashboard
không tự kích hoạt, tự hoàn tiền, sửa snapshot hoặc sinh Search job.

## Chất lượng dữ liệu và tính nhất quán

Cùng một CTE kiểm tiền/order/payment/item, mốc fulfillment và provenance refund
được dùng cho summary, buckets và data-quality. Snapshot discount chưa hỗ trợ,
NaN, sai tổng/Payment hoặc thiếu adjustment đều bị loại, không đoán thành0 hợp lệ.
Order lỗi không đóng góp gross lẫn refund; có thể tra `orderId`, `storeId`,
`issues` qua data-quality. Không trả snapshot riêng tư của Buyer.

Tập ứng viên gồm completedAt trong kỳ, refund effective trong kỳ và mọi refund
pending/thiếu adjustment tại asOf. Đơn COMPLETED thiếu completedAt được kiểm
theo createdAt trong kỳ để báo lỗi, **không** lấy createdAt làm ngày doanh thu.
Vì pending/thiếu projection là lifetime, số lỗi không chỉ là số đơn tạo trong kỳ.
Đây không phải công cụ quét toàn bộ mọi trạng thái lịch sử của database.

Mỗi request dùng RepeatableRead READ ONLY, statement timeout5s và transaction
timeout15s. Không trả aggregate dở dang khi query timeout; trả503
`DASHBOARD_UNAVAILABLE`. Count vượt giới hạn số nguyên an toàn cũng503, không
làm tròn. Quyền được kiểm tại snapshot transaction; không tuyên bố liên tục
thu hồi quyền giữa chừng sau khi snapshot đã bắt đầu.

## Kiểm thử và giới hạn bàn giao

Fixture tài chính lịch sử là synthetic; không dùng làm bằng chứng checkout thực.
Suite `BE/test/dashboard-runtime.e2e-spec.ts` chạy HTTP/PostgreSQL riêng, kiểm
completion thật và replay, pending activation, refund khác kỳ, nhiều item,
NaN/discount/thiếu projection, phân quyền, cursor, >50 đơn, aggregate rộng,
cache/body và bất biến Order/Payment/audit/tồn kho/Search.
Không thay schema hoặc cần migration mới trong PR Dashboard. Rollout vẫn cần
đủ27 migration của nền hậu mãi trước khi chạy Backend. Không chạy QA trên DB demo.
