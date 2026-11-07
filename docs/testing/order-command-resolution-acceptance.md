# Acceptance resolution/fence — 16/10/2026

Tất cả dưới đây **NOT_RUN**: nhánh này chỉ contract, không API/schema/test code.
Nguồn: [contract đề xuất](../api/seller-order-command-resolution-contract.md).
Nền035656b, #58 approve nguyên tắc; #60 vẫn preparation. Không cộng test nền
C2 hoặc Web read thành bằng chứng resolution.

QA DB mới riêng, hai Nest instance và hai PostgreSQL connections. Dựng COD qua
Checkout; không reset DB demo. Tắt Search/repair/D07 ngoài scenario cần kiểm.
Theo dõi Order/Payment/history/receipt/stock/movement/Product.version/outbox và
fence trước/sau; timestamp/identity khi replay; không xuất raw key/token/PII.

| ID | Ca cần kiểm | Kỳ vọng | Layer |
|---|---|---|---|
| R01 | Đã có receipt C2, Order đã tiến thêm bước | COMMITTED receipt gốc đúng commandId, không fence/side effect | HTTP/DB |
| R02 | Chưa thực thi, resolve lặp | Một fence, CLOSED identity/timestamp giống nhau, Order không đổi | HTTP/DB |
| R03 | Command giữ lock trước resolver | Command commit; resolver COMMITTED, không fence | Hai app/DB barrier |
| R04 | Resolver giữ lock trước command | CLOSED commit; lệnh đến muộn bị chặn, không receipt/history | Hai app/DB barrier |
| R05 | Cùng key khác Order/command/hash | Conflict, không đóng hoặc lộ biên nhận khác | HTTP/DB |
| R06 | Hai resolver đồng thời và restart | Cùng durable outcome/id, không queue memory | Hai app + restart |
| R07 | Resolve commit rồi cắt response | Replay resolve cùng key phục hồi, không fence thứ hai | Proxy/HTTP/DB |
| R08 | SQL lỗi trước commit fence | Rollback, không trả CLOSED thành công, key chưa bị nhận đã đóng | DB fault injection |
| R09 | Cùng USER key chuyển role, gọi cancel/returned/delivery/complete | Tất cả writers chặn, không side effect; SYSTEM độc lập | HTTP/DB toàn writer |
| R10 | Writer cố quên helper gọi insert trực tiếp | DB guard fail-closed, không fence+receipt đồng tồn tại | Migration/DB |
| R11 | Cross-table write-skew, hai connections snapshot cũ | Serializable abort/retry; nonserializable bị guard từ chối | DB isolation tests |
| R12 | Update/delete fence, sửa identity, malformed record | Constraints/immutable guard chặn; preserve legacy receipts | Migration/DB |
| R13 | Nâng cấp DB đã có receipts/history | Migration mới không backfill/đổi business data; retry/replay cũ giữ nguyên | Migration fresh/upgrade |
| R14 | Account inactive/sai role/sai owner/Store status đổi | Auth/ownership chặn trước trả receipt; owner active vẫn resolve state đã đổi | HTTP/DB |
| R15 | JSON/query/key/ID/content-type/8KiB sai | Lỗi strict, no-store; không ghi fence hoặc Order | HTTP |
| R16 | Command/resolve xen kẽ vượt20/phút | Chung bucket/Retry-After; không bypass bằng endpoint khác | HTTP hai routes |
| R17 | Lock/statement/pool/deadline retry cạn | Bounded409+Retry-After; không500 lộ key, không vòng lặp vô hạn | HTTP/DB |
| R18 | Receipt corrupt/hashVersion lạ/cả receipt+fence | Fail-closed500, không sửa receipt để cứu kết quả | DB fixture/HTTP |
| R19 | FE CLOSED200 sai identity/extra/date/type/session cũ | Không settle/clear storage | Contract/component |
| R20 | CLOSED hợp lệ nhưng storage remove lỗi | Blocked, không mở lệnh mới | Component/browser |
| R21 | COMMITTED receipt hợp lệ rồi GET lỗi | Báo đã ghi nhận/chưa tải lại, chỉ retryGET | Browser/HTTP/DB |
| R22 | Reload/đổi account/cùng ID phiên mới trong execute/resolve pending | Không auto resend/clear/toast phiên cũ; cùng key sau explicit replay | Browser cùng SPA |
| R23 | Confirm dialog cancel/double click | Không persist nếu cancel; một intent và một durable outcome | Browser/HTTP/DB |
| R24 | Sau CLOSED hợp lệ Seller tạo ý định mới | GET mới/confirm mới/key mới, key cũ vẫn bị chặn | Browser/HTTP/DB |
| R25 | Tạo claim PROCESSING rồi UPDATE identity trước hoàn tất; từng field và cả bộ hợp lệ khác | Guard mới chặn id/orderId/scope/type/actorId/key/command/hash/hashVersion/createdAt bằng NULL-safe compare, kể cả NULL↔non-NULL; không thể đổi sang key đã fence. No-op identity và transition hoàn tất hợp lệ vẫn chạy; rollback không commit claim dở | Migration/DB hai connections khi cạnh tranh |

Ghi fault method: discarded response trong test không phải bằng chứng TCP/socket
loss; mock JSON không thay validator response thực. Chỉ đánh PASS trên đúng head
và migration đã chạy. Run lint/build/typecheck/unit/fullBE E2E/Prisma validate và
diff-check trước bàn giao implementation; contract-only branch không chạy giả.
