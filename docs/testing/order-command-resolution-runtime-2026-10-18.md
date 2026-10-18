# Resolver Order: triển khai và bằng chứng QA — 18/10/2026

## Trạng thái và phạm vi

Nhánh `codex/order-command-resolution-runtime`, nền `develop 9956379`.
IN_PROGRESS, chưa merge và chưa nối giao diện giao dịch. Contract #62 đã merge;
đợt này triển khai thật migration/API thay vì chỉ khung test. Không đổi FastAPI.

## Luồng để đọc hiểu

1. Web giữ mã Idempotency-Key gốc khi mất phản hồi; không tự tạo mã mới.
2. Seller xác nhận đối chiếu/dừng ý định chưa thực thi, gửi command gốc.
3. Backend kiểm quyền hiện tại, khóa User → Store → Order và đọc PostgreSQL.
4. Có receipt (biên nhận kết quả): trả COMMITTED với snapshot gốc, replayed=true.
5. Chưa có: ghi fence (bản chặn mã yêu cầu), trả CLOSED_WITHOUT_EXECUTION sau commit.
6. Mã đã đóng không thể được thực thi về sau; mã mới là ý định mới cần xác nhận.

Resolver không đổi trạng thái đơn hoặc hoàn kho. Trạng thái Store/Payment dùng
để quyết định thực thi không được ngăn đối chiếu; quyền sở hữu/tài khoản vẫn bắt
buộc. Không trả chi tiết lỗi DB, không log key/token/địa chỉ.

## Code chính

- Migration `20261018040000_order_command_resolution`: bảng, FK, unique, check,
  chống hai kết quả trái nhau, identity bất biến và bản chặn không sửa/xóa.
- `order-command-resolution.service.ts`: xác thực/transaction/replay/retry.
- `order-command-fence.ts`: kiểm tra trước replay ở đủ năm service ghi Order.
- Controller Seller hiện có: JSON 8 KiB, no query, no-store, chung quota 20/phút.
- Không sửa migration đã merge. Fixture cũ tạo OrderCommand trực tiếp được đổi
  sang Serializable để tuân thủ ràng buộc mới, không bỏ assertion nghiệp vụ.

## Kiểm tra đã chạy

Database riêng `bckl_order_resolution_test_runtime_1792294184136`, cổng 5549;
không đụng database demo cổng 5432. Giữ fixture bất biến trong DB QA dùng một lần.

- Deploy đủ 14 migration trên database mới: PASS.
- Backend typecheck/lint/build/Prisma validate: PASS.
- Backend unit: 629 PASS (27 file).
- Năm suite trọng tâm: 172 PASS sau sửa fixture Checkout/Buyer (không bỏ FK).
- Full Backend E2E lượt cuối 10:43–10:45 ngày 18/10: **591 PASS, 20 TODO**;
  30 file PASS, 1 file chỉ có TODO. Không có test FAIL.
- Có HTTP thật qua Nest và PostgreSQL; hai instance ứng dụng; proxy thực sự bỏ
  response sau commit; barrier SQL hai kết nối với snapshot cũ; không HTTP mock.
- Có kiểm tra quota chung resolve/execute, replay, quyền, payload, body quá lớn,
  bản chặn bất biến, identity PROCESSING, mã mới/mã đã đóng.

Các lỗi fixture đã xử lý: runner nâng quota (đã bỏ override, tách Seller mỗi ca),
fixture đổi Buyer phải giữ FK Checkout/Buyer, và timestamp receipt phải hoàn tất
sau createdAt. Full E2E cuối 591 PASS sau các sửa này. Không nới DB/rate limit để
test qua. `git diff --check` sạch; log ERROR từ ca chủ động gây lỗi là dự kiến.

## Bổ sung bằng chứng độc lập ngày18/10 (16:09–16:12)

Không thay source runtime hoặc migration. Thêm 4 ca thực thi: key CLOSED và
COMMITTED bị dùng trên Order khác cùng Seller; hash gốc không khớp; bảng kiểm
8 identity sai (actor/scope/key/command/hash/hashVersion) bị DB chặn và rollback.
Key quá dài bị VARCHAR chặn bằng SQLSTATE22001; lỗi identity khác23514, không
nới constraint để test qua. Fixture Order mới có Checkout riêng đúng unique
checkoutId+storeId. Lượt đầu 4 ca bổ sung FAIL do fixture/assertion, đã sửa;
không tính lượt đầu là PASS.

Lượt cuối full Backend E2E: **595 PASS, 20 TODO**, 30 file PASS/1 TODO file.
Runtime resolver hiện **34 PASS**, migration upgrade vẫn chạy trong full suite.
Unit629 PASS; lint/typecheck/build/Prisma validate/diff-check PASS. Lượt unit
đầu bị sandbox EPERM trước thực thi test; chạy lại được cấp quyền đã PASS.

### Đối chiếu checklist lịch sử với bằng chứng thật

| Yêu cầu | Bằng chứng thực thi | Giới hạn |
|---|---|---|
| R01/R02/R24 | HTTP receipt gốc, close/replay, key cũ sau intent mới | Backend, chưa Web |
| R03/R04/R11 | HTTP barrier và hai SQL snapshot Serializable, hai hướng thắng | Hai ứng dụng/kết nối, không hai OS process |
| R05 | Khác command, khác Order cho cả hai outcome, khác hash | Hash sai là fixture DB có chủ đích |
| R06/R07/R08 | Hai Nest app, bootstrap lại, proxy mất response sau commit, rollback lỗi insert | Không crash/restart OS process |
| R09/R10 | Đủ năm writer cùng fence; direct SQL đối nghịch bị chặn | Cross-role một số ca gọi service thật thay HTTP |
| R12/R25 | Fence immutable, tám malformed identities, Serializable bắt buộc, mười identity fields | Không vét cạn mọi giá trị/null/FK |
| R13 | Migration engine nâng schema cũ, giữ lịch sử/snapshot | QA schema riêng, không DB demo |
| R14/R15/R16/R17 | Quyền hiện hành, input/body/quota, DB timeout và ba lần retry | Không thay nghiệm thu browser |
| R18 | Receipt hỏng fail-closed; unit defensive checks, DB exclusion | Không phá trigger để tạo dual outcome; hashVersion lạ bị DB constraint chặn ở resolution |

20 TODO ở khung cũ được giữ như checklist lịch sử, đã sửa nhãn lỗi thời
NOT_IMPLEMENTED. Không cộng TODO vào PASS và không dùng chúng làm bằng chứng
đã phủ toàn bộ acceptance. R19–R23/FE settlement thuộc đợt tích hợp Web sau.

### Đính chính cách diễn giải báo cáo Gemini

Store và Payment trong Seller command được khóa FOR SHARE, không phải tất cả
FOR UPDATE. Cancellation/returned còn khóa Store và Product; returned confirmation
kết thúc Order CANCELLED, không tạo status RETURNED. Bảng lần giao là
delivery_attempts. Hai Nest app trong Vitest không phải hai OS process độc lập.
Kết quả PASS không chứng minh tuyệt đối “không có lỗi ngầm/100% contract”.

## Chưa được nhận hoàn tất

- Migration nâng cấp giữ nguyên snapshot dữ liệu cũ; restart ứng dụng, fault DB,
  HTTP command-first/resolver-first và cross-role đủ năm writer đã PASS ở lượt
  172 ca. Cross-role gọi service thật/DB thật, không phải mọi ca đều qua HTTP.
- Timeout DB và ca ép đúng ba lần serialization conflict: PASS trong full E2E.
- R05 đã bổ sung HTTP khác Order/hash; R12 chưa phủ hết
  mọi tổ hợp malformed row; impossible dual outcome được unit và DB exclusion
  bảo vệ, chưa tạo DB hỏng bằng cách vô hiệu trigger trong runtime test.
- Khung acceptance cũ còn TODO: không coi các ca mới là đã phủ trọn mọi Rxx.
- FE settlement (xử lý kết quả đối chiếu), mount Seller Web, browser reload/
  đổi tài khoản/mất phản hồi và toàn luồng giao dịch: NOT_RUN/chưa triển khai.

Thứ tự tiếp: hoàn thiện các gate Backend → review/merge Backend → nối FE bằng
contract đã merge → kiểm browser/live DB. Không bật nút chỉ vì SQL test PASS.

## Chạy lại

Dùng DATABASE_URL của **DB QA riêng** có tên `bckl_order_resolution_test_*` ở
`127.0.0.1:5549`, JWT secrets QA cung cấp riêng, không sao chép `.env` demo.
Local test từ chối DB ngoài phạm vi; CI dùng PostgreSQL service dùng một lần.
Chạy `pnpm --dir BE exec prisma migrate deploy`, rồi `pnpm --dir BE test:e2e`.
Migration test tạo schema ngẫu nhiên trong DB QA, dùng migration engine thật và
chỉ dọn schema/temp workspace được kiểm tên; không reset database.

## Điểm nối giao diện ở PR kế tiếp

- `FE/src/services/orderApi.ts`: thêm handle/adapter resolver và validator runtime
  strict cho hai outcome; dùng original key và body `{command}`, không tạo key.
  COMMITTED phải kiểm toàn bộ receipt bằng validator hiện có. Không dùng GET
  detail hoặc HTTP 200 chưa validate làm bằng chứng đã giải quyết yêu cầu.
- `orderIntentJournal.ts`: bổ sung thao tác đóng intent bằng resolution đã kiểm
  đúng identity; không giả `commandId` để tái dùng acknowledgement cũ. Việc xóa
  phải so khớp toàn bộ pending hiện tại; storage lỗi thì vẫn blocked.
- `sellerCommandRecovery.ts`/coordinator: một bộ điều phối ổn định theo phiên;
  kiểm session version và pending trước/sau HTTP. COMMITTED xử lý receipt;
  CLOSED chỉ giải phóng đúng ý định cũ, không tự gửi lệnh mới. Mọi timeout,
  401/409/500 hoặc response hỏng vẫn giữ intent chưa rõ kết quả.
- `SellerCommandReview.tsx`: thêm xác nhận riêng cho đối chiếu/dừng ý định;
  không gắn resolver vào nút mang nghĩa chỉ "gửi lại". Sau kết quả cần GET mới;
  nếu GET lỗi, không gửi lại lệnh đã được ghi nhận hoặc tự chuyển bước kế tiếp.
- Sau Backend review/merge mới mount vào Seller detail; kiểm browser reload,
  bấm hai lần, mất phản hồi, storage lỗi, logout/đổi tài khoản, GET lỗi sau ack.
  Không thay Admin/Address/Cart của Hiền hoặc bật Buyer cancellation trong đợt này.
