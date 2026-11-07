# Acceptance contract phục hồi Buyer — 18/10/2026

Trạng thái: **PROPOSED / NOT_RUN**. Đây là yêu cầu kiểm thử cho triển khai sau
review, không phải bằng chứng Backend/Web đã hoạt động. Không sửa schema/API.

Nguồn: [contract đề xuất](../api/buyer-order-command-resolution-proposal.md),
[readiness](../architecture/buyer-order-command-readiness-2026-10-18.md).
Fixture hash là dữ liệu giả: [JSON](../api/examples/buyer-command-recovery-proposed-v1.json).

## Ma trận bắt buộc trước nghiệm thu

| ID | Tình huống / oracle cần kiểm | Trạng thái |
|---|---|---|
| BRC-01 | SHA256 Backend và WebCrypto khớp ba vector, canonical property order | NOT_RUN |
| BRC-02 | Trim đúng luật hiện có; Unicode không tự NFC; đổi reason làm đổi hash | NOT_RUN |
| BRC-03 | Body thừa/thiếu, bool hashVersion, hash hoa/sai độ dài, key newline bị từ chối | NOT_RUN |
| BRC-04 | Không token, tài khoản khóa, sai owner; không lộ đơn hoặc receipt | NOT_RUN |
| BRC-05 | Seller/Admin không dùng endpoint Buyer; client không tự chọn actorScope | NOT_RUN |
| BRC-06 | Receipt cancel hợp lệ replay nguyên resultSnapshot, không trả trạng thái Order mới | NOT_RUN |
| BRC-07 | Receipt complete hợp lệ có actor BUYER; không nhận SYSTEM receipt | NOT_RUN |
| BRC-08 | Receipt hỏng reason/hash/payment/timeline/identity bị chặn trước COMMITTED | NOT_RUN |
| BRC-09 | Cùng key khác order/command/hash trả conflict, không ghi fence khác | NOT_RUN |
| BRC-10 | PROCESSING trả in-progress; không đóng key hoặc tự thực thi | NOT_RUN |
| BRC-11 | Không receipt complete và hash sai canonical: 400, không fence | NOT_RUN |
| BRC-12 | Không receipt cancel: đóng toàn scoped key, không giả đã chứng minh reason gốc | NOT_RUN |
| BRC-13 | CLOSED replay cùng resolutionId/time; không mutation Order/Payment/stock/outbox | NOT_RUN |
| BRC-14 | Execute commit trước resolver: chỉ COMMITTED và một receipt | NOT_RUN |
| BRC-15 | Resolver commit trước execute: execute bị fence, không mutation | NOT_RUN |
| BRC-16 | Hai connection đồng thời, stale snapshot: không thể vừa receipt vừa fence | NOT_RUN |
| BRC-17 | Rollback/commit lỗi và process restart: không success giả, retry an toàn | NOT_RUN |
| BRC-18 | Buyer complete đối đầu SYSTEM D07: một transition; không mượn receipt SYSTEM | NOT_RUN |
| BRC-19 | Seller confirm/cancel đối đầu Buyer cancel: một kết quả hợp lệ, hoàn kho tối đa một lần | NOT_RUN |
| BRC-20 | Migration mới bảo toàn Seller fence/receipt và guard năm writer; SYSTEM không đổi | NOT_RUN |
| BRC-21 | Direct SQL sửa identity/fence hoặc dùng isolation không hợp lệ bị chặn | NOT_RUN |
| BRC-22 | Pending USER complete v1 nâng metadata cùng key; Seller v1 giữ nguyên | NOT_RUN |
| BRC-23 | Unknown/corrupt journal bị blocked, không xóa/reset/tạo slot né pending | NOT_RUN |
| BRC-24 | Session/pending đổi khi await digest hoặc HTTP: callback cũ không settle | NOT_RUN |
| BRC-25 | Storage throw/no-op/remove lỗi: không mở giao dịch mới | NOT_RUN |
| BRC-26 | Reload cancel v2 không tái tạo body hoặc gửi lại với reason vừa nhập | NOT_RUN |
| BRC-27 | Malformed 200/timeout/401/403/404/409/429/500 giữ pending; không auto rekey | NOT_RUN |
| BRC-28 | COMMITTED/CLOSED chỉ settle đúng invocation; JSON clone/GET không là proof | NOT_RUN |
| BRC-29 | Biết outcome nhưng GET lỗi: chỉ tải lại, không POST lại/chuyển bước tự động | NOT_RUN |
| BRC-30 | Browser thật: double click, reload, mất response sau commit, đổi tài khoản | NOT_RUN |
| BRC-31 | Quota riêng, retry có giới hạn, deadline; log không chứa key/hash/reason/token | NOT_RUN |
| BRC-32 | Hủy nhiều Variant cùng Product: ledger/history/version/outbox đúng một giao dịch | NOT_RUN |

## Cách ghi bằng chứng khi triển khai

Mỗi lượt ghi head SHA, base SHA, migration áp dụng, lệnh/test thực chạy, DB QA
riêng và giới hạn. Race dùng hai giao dịch/connection có điểm điều khiển, không
lấy sleep hoặc khóa một process làm bảo đảm. Đối chiếu trước/sau Order, Payment,
OrderCommand, OrderCommandResolution, history, ledger, Product.version và outbox.
Không dùng DB demo; không ghi credentials, lý do thật hoặc token vào báo cáo.

Kiểm JSON/hash bằng thuật toán độc lập chỉ chứng minh fixture nhất quán; không
đổi các ca trên thành PASS và không thay integration Nest/PostgreSQL/browser.

Gate review cần chốt: đóng cancel bằng fingerprint do client cung cấp khi chưa
có receipt; quyền riêng tư hash; journal v2 tương thích; quota/timeout; allowed
pair và guard DB. Sau đó mới mở PR migration/API và PR Web riêng.
