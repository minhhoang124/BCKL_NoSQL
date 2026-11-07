# C2 Backend hiện có — kiểm chứng sẵn sàng 16/10/2026

Source Backend `develop 09daae0`, không thay code/schema. Chạy từ checkout
`codex/auth-header-theme-fix` chỉ có delta FE CSS/test/harness; BE giữ nguyên.
Không lấy #56/#57/#58 chưa merge vào bài kiểm thử.

## Kết quả thực chạy

- Database **mới** `bckl_c2_readiness_20261016_a`, QA container loopback5549.
  13 migration deploy thành công; không seed/reset DB demo5432 hoặc DB manual QA.
- `pnpm --dir BE test:e2e test/seller-order-command.e2e-spec.ts`:
  **54/54 PASS**,1suite,10.49giây tổng/5.54giây test.
- Nest app và otherApp độc lập, PostgreSQL thật; JWT actor fixture ký bằng
  test service, không gọi đây là login/cookie/browser flow.
- Suite cleanup theo marker của fixture trên DB test riêng; database được giữ,
  không drop hoặc dọn dữ liệu manual QA. Có log500 có chủ đích từ fault injection
  history/receipt và pg deprecation warning cũ; không nhận warning-free runtime.

## Mapping các tình huống cần chuẩn bị

| Phạm vi | Bằng chứng suite đã chạy | Chưa chứng minh |
|---|---|---|
| confirm → packing → ready | Cả3command; COD Checkout thật→C2→Buyer/Seller detail; snapshot/Payment/kho/version/outbox giữ nguyên | Nút C2 Web chưa nối |
| Gửi trùng | Hai app cùng key chỉ1transition/history/receipt; key khác cùng nguồn chỉ1winner; scope xuyên command/Order | Double-click browser/coordinator runtime |
| Gửi lại sau mất kết quả | Test bỏ qua response đã nhận rồi restart app, replay từ receipt DB với key cũ; receipt gốc dù state đã đi tiếp | Cắt socket/proxy sau commit C2 hoặc client reload giữa POST thật; không gọi discard=response loss trên transport |
| Tranh chấp/chờ khóa | Lock wait hữu hạn,409/Retry-After rồi cùng intent thành công; current DB role/active kiểm dưới khóa | UI cooldown/timeout/retry có xác nhận |
| Rollback | Ép lỗi history/receipt cuối transaction, không ghi state nửa vời | UI diễn giải đúng unknown outcome |
| Quyền/Payment | Sai chủ404, account khóa/role đổi chặn trước replay, Store SUSPENDED xử lý đơn cũ, Payment lỗi không tự sửa | Phiên đổi trong SPA khi POST đang chờ |
| Definite rejection/đóng key | Không có API/fence mới trong suite này | Toàn bộ C2R của #58 vẫn NOT_RUN/PROPOSED |

## Bước triển khai sau review

Giữ nguyên [ma trận C2 Web](seller-command-web-test-matrix.md) cho controller/
browser/recovery mới; không đổi toàn bộ35dòng thành PASS từ54case Backend cũ.
Trước bật nút cần adapter/journal/settlement đã review, test mất response transport
thật, F5/đổi phiên/GET lỗi sau receipt và hai app cạnh tranh resolve với lệnh cũ.
Không sửa lỗi HTTP hiện có thành tín hiệu xóa pending ở FE.
