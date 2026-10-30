# Thu hồi phiên và lệnh Checkout/Order đang chờ

Ngày30/10/2026, timing oracle tái hiện ba lỗi trên PostgreSQL/HTTP thật: yêu cầu đã qua JWT guard, bị chờ trước business service, User credentialVersion tăng, nhưng Checkout vẫn201, Sellerconfirm/cancel vẫn200 và đổi dữ liệu. Không có mật khẩu hoặc token thật trong fixture.

## Quy tắc đã triển khai

HTTP controller lấy credentialVersion từ actor đã được JwtStrategy xác thực, truyền nguyên giá trị vào service. Dưới khóa User FOR UPDATE sẵn có, service đọc credentialVersion hiện tại và gọi `assertCurrentWriteEpoch` trước replay, ghi command/fence hoặc thay tiền/kho. Mismatch trả401; không rebase expected version sau retry. Controller thiếu epoch truyền0 và fail closed. JWT legacy chỉ hợp lệ ở CV1; JwtStrategy chuẩn hóa thành CV1 trước khi controller dùng.

Phạm vi: Checkoutcreate; Sellerconfirm/start-packing/ready-to-ship; Buyer/Sellercancel; Admindeliverycommands; Seller/Adminreturned; Buyercomplete; Buyer/Sellerpreparation/Sellerclose resolver. Hai nhánh returned dùng chung controllerbase đã truyền epoch. Các check active, role, ownership, command policy, idempotency key và transaction lock order được giữ nguyên.

Expected epoch là tham số nội bộ cuối phương thức, không thêm trường JSON/DTO, không đổi hash/receipt hoặc migration. Trusted direct-service call có thể bỏ qua tham số để tương thích job/fixture; **HTTP writer mới phải truyền verified actor epoch**. SYSTEMauto-completion không có actorHTTP và giữ nhánh scheduler riêng.

## Bằng chứng và giới hạn

`BE/test/auth-write-epoch.e2e-spec.ts` có10ca HTTP/PostgreSQL với barrier sau realJWTguard, gọi lại business service thật và commit CV1→2 thật. Kiểm Checkout, Buyercancel/complete, Sellerconfirm/cancel, Adminship, ba resolver và replay receipt cũ; kết quả401 với snapshot Checkout/Order/Payment/items/stock/outbox/commands/fence/history/cart không đổi.

Lượt RED: `be-final-focused-1793371957417` có3AuthFAIL đúng lỗi trên và7reconciliationPASS. Lượt sau fix: `be-final-focused-1793372290649`74PASS gồm10Auth+7reconciliation+35SKU+22Notifications. Các artifact ở root máy `machine-local/final-day-20261030/`, không nằm trong Git.

Không suy đây là kiểm mọi request timing trên toàn Backend. Những miền khác có cơ chế riêng (Aftersales/Review/Store/Chat/Settings); các endpoint Product nội dung legacy và những timing chưa có oracle không được gắn nhãn đã kiểm từ10ca này. HTTP revocation sau khi transaction đã giữ User lock sẽ tuần tự sau transaction; không hủy ngược một transaction đã commit.
