# Seller cancel/returned Web và đối chiếu kết quả

Phạm vi: hủy đơn sớm, xác nhận hàng giao thất bại đã quay về và phục hồi yêu cầu chưa rõ kết quả. PostgreSQL là nguồn nghiệp vụ; giao vận vẫn mô phỏng. Không thêm refund ngân hàng hoặc quyền LOST cho Seller.

## Thực thi và biên nhận

Web `/seller/orders/:orderId/close` đọc Order và Store thuộc Seller hiện hành. Cancel chỉ mở ở PENDING_CONFIRMATION/CONFIRMED và payment chưa thanh toán theo policy Backend; hàng quay về chỉ COD/UNPAID/DELIVERY_FAILED. Store ACTIVE/SUSPENDED có thể xử lý nghĩa vụ cũ theo policy, không đồng nghĩa được mở giao dịch mới khi bị khóa.

- `POST /seller/orders/:id/cancel`: reasonCode OUT_OF_STOCK/CANNOT_FULFIL/OTHER, reasonText đã trim1–500 ký tự.
- `POST /seller/orders/:id/confirm-returned`: reasonCode RETURN_RECEIVED hoặc DAMAGED, reasonText, receiptReference1–100 ký tự, restockable boolean. Seller không được LOST.
- Cả hai dùng original `Idempotency-Key`16–128 ký tự ASCII `[A-Za-z0-9_-]`. Auth/session/ownership và mọi điều kiện nghiệp vụ vẫn được Backend kiểm lại trong transaction.
- Trả biên nhận committed, kiểm order/command/actor/body/timeline; payment amount/provider phải khớp snapshot Order đã đọc. Không nhận HTTP200 hoặc GET trạng thái làm biên nhận lệnh gốc.

Journal sessionStorage chỉ giữ schemaVersion/actorId/orderId/command/idempotencyKey/requestHash; không lưu lý do/biên nhận hàng. Chặn cùng lúc preparation và close chưa rõ kết quả. Không tự POST khi mount/reload/timeout/401. Thử lại thủ công đúng nội dung dùng cùng key/hash; nội dung khác bị chặn trước network.

## Đối chiếu khi không nhớ nội dung gốc

`POST /seller/orders/:id/resolve-close-command`, original key trong header, body đúng ba field:

```json
{"command":"cancel","hashVersion":1,"requestHash":"<64 ký tự hex chữ thường>"}
```

command chỉ cancel/confirm-returned. JWT Seller đang active, không query, ID integer hợp lệ, JSON tối đa8KiB sau giải nén; no-store, ingress guard Seller hiện có. Web có checkbox xác nhận riêng; resolver không tự chạy khi mở trang.

Hai kết quả:

| Kết quả | Ý nghĩa và dữ liệu |
|---|---|
| COMMITTED | `{outcome,receipt}`; biên nhận bất biến gốc, replayedtrue. Backend tái dựng body từ snapshot và tính lại hash; FE kiểm hash cùng journal, payment và toàn bộ biên nhận trước khi settle |
| CLOSED_WITHOUT_EXECUTION | `{outcome,resolutionId,orderId,command,hashVersion,requestHash,actorId,resolvedAt}`; key đã đóng bền, chưa thực thi lệnh. FE đối chiếu từng identity/hash trước khi xóa đúng journal |

**Đóng key không phải hủy Order**, không hoàn kho, không tạo Payment hay thực hiện lại command. Hash do caller gửi khi chưa có lệnh chỉ dùng làm fence cho key của chính actor, không phải bằng chứng body gốc. Key sai fingerprint không được biến thành quyền thực thi.

Resolver lấy lock User→Store→Order và kiểm lại ownership ở Serializable với deadline/retry hữu hạn. Execution cũng kiểm fence trước replay/new-command policy; trigger chống hai outcome và SSI giữ nguyên. Nếu execution thắng, resolver trả receipt; nếu resolver thắng, original request đến muộn bị409 ORDER_COMMAND_CLOSED (hoặc IDEMPOTENCY_CONFLICT nếu identity khác). Không thể có cả command và fence cùng actorScope/key.

401/429 hoặc kết quả đối chiếu chưa xác minh giữ journal. Không thêm nút xóa local chỉ dựa GET/4xx; cần server proof. Nếu journal hỏng/khác identity, khóa thao tác để điều tra, không tự sửa/hash lại. Biên nhận hợp lệ về sau khi rời trang có thể settle trong cùng auth epoch bằng CAS; không cập nhật React sau unmount và không xóa journal của phiên mới.

## Migration và vận hành

Migration `20261030100000_seller_close_command_resolution` là migration40: mở rộng constraint hiện có cho Seller cancel/confirm-returned, giữ Buyer/preparation pairs, regex, immutability và opposing-outcome triggers. Không sửa migration đã dùng chung, không backfill body/history.

Nâng Backend/parser/fence validator và Web cùng bản đã kiểm; không dùng code cũ không hiểu Seller close fences để nhận đầy đủ khả năng rollback. Trước rollout cần backup, kiểm migrations và chạy lại smoke. Bằng chứng upgrade QA39→40 không tự có nghĩa demo/staging đã nâng hoặc rollback executable đã nghiệm thu.

Runtime app-role chỉ DML; các suite fault-injection có DDL dùng migrator trên QA riêng, không nâng quyền app-role. Rate guard hiện per-instance; sessionStorage theo tab, không tuyên bố mutex nhiều tab/instance hoặc production throughput.
