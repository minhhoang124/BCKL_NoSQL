# Backend Attributes — foundation và Admin read

Ngày 19/10/2026. Branch `codex/admin-attribute-read`, baseline `622cfb9`.
**IN_PROGRESS / chưa merge; chưa bàn giao toàn bộ Backend #65.**

## Phạm vi đợt này

- Migration mới thêm revision cấu hình và bảng audit bất biến; không bịa audit lịch sử.
- GET `/admin/categories/:categoryId/attributes`: limit mặc định50, tối đa100,
  afterId và isActive; trả cả inactive theo mặc định, thứ tự ID tăng.
- GET cùng path `/:attributeId`: metadata, revision, usage và timestamp.
- GET cùng path `/:attributeId/options`: phân trang, inactive, usage và definitionRevision.
- JWT/current active ADMIN theo Auth hiện hành. Sai nesting404, guest401, Buyer403.
- `Cache-Control:no-store` từ middleware trước guards, kể cả lỗi xác thực/validation.
- Query strict: không extra/duplicate/array/coercion; ID nguyên dương <=2147483647.
- Read-only RepeatableRead transaction: dữ liệu trang, usage và revision cùng snapshot.
  maxWait2s, transaction5s, statement timeout3s. Không tự ghi audit/job từ GET.

Không thay đổi FastAPI hoặc payload Search, không sửa UI của Hiền.

## Revision và audit: cơ chế, không phải đã hoàn thành API ghi

Revision là số phiên bản cấu hình. DB trigger tăng một lần khi metadata thực sự
đổi; no-op giữ nguyên. Cho phép CAS ghi old+1, không tăng hai lần; chặn reset,
nhảy số và tràn Int. Option INSERT/UPDATE thực sự đổi tăng revision cha trong cùng
transaction; option no-op không tăng, không chuyển option sang definition khác.
API option tương lai phải khóa/kiểm revision cha rồi dựa vào trigger tăng revision,
không tự increment thêm lần nữa. Option DELETE không thuộc API contract.

Bảng audit chứa actor, identity đối tượng, old/new JSON, lý do, correlation UUID,
revision và thời gian. UPDATE/DELETE bị chặn. Actor có FK Restrict; category/definition/
option giữ ID lịch sử, không FK cascade xóa audit theo cấu hình. Đây là quyết định
migration cần reviewer kiểm; không dùng nó làm lý do tự xóa ProductValue.
**Hiện chưa producer audit từ API ghi**: bảng mới trống không có nghĩa đã có đầy đủ
audit nghiệp vụ. Các API POST/PATCH cũ vẫn tồn tại và chưa đáp ứng toàn contract #65.

Error mới400/404 dùng `{statusCode,code,message}` với `VALIDATION_ERROR`,
`CATEGORY_NOT_FOUND`, `ATTRIBUTE_NOT_FOUND`. Auth giữ envelope hiện hành;
exception nội bộ dùng Nest500 sanitized. Đây là ranh giới chỉ ba GET mới,
không nhận đã chuẩn hóa toàn Catalog error/write contract.

## Bằng chứng và giới hạn

Local PostgreSQL17 trên loopback5549, database Attributes riêng; không truy cập demo5432.
Hai suite mới: HTTP với Nest/PostgreSQL thật và migration trên schema tạm độc lập.
Test migration dựng bảng tiền nhiệm tối thiểu có dữ liệu cũ rồi áp SQL mới;
không gọi đó là proof upgrade trên snapshot dữ liệu production đầy đủ.
Fresh migration chain15 migrations cũng chạy trên DB riêng.

- Backend unit:649 PASS tại lượt đầu, gồm20 parser cases.
- E2E lượt đầu:610 PASS/20TODO,32 files PASS/1SKIP; gồm15 cases mới.
- Prisma validate/typecheck/lint/build/diff-check: PASS tại lượt đầu.
- Sau lượt đầu bổ sung envelope lỗi, fixture usage hai Product và chặn revision reset
  khi metadata đổi: phải chạy lại trên DB v2 mới trước bàn giao; kết quả cuối ghi bên dưới.
- Không chạy browser/editor/live Search trong PR read-only này.

### Kết quả cuối trên DB v2 (bản SQL và code cuối)

- Fresh chain15 migrations PASS; Prisma validate PASS; migrate diff DB/schema không khác.
- Backend lint/build/typecheck PASS.
- Toàn bộ unit649/649 PASS.
- Toàn bộ E2E610 PASS/20TODO,32files PASS/1SKIP,156.30s.
  Có15E2E mới (6HTTP,9migration) và20unit parser mới; không nhận20TODO là đã chạy.
- Usage HTTP kiểm hai Product DRAFT thực tham chiếu cùng option; số đếm2,
  không chỉ fixture không có dữ liệu.
- Diff-check PASS. Log injected failure trong suites hồi quy là ca mô phỏng lỗi có chủ đích;
  pg concurrent-query deprecation là warning nền, không phải assertion fail.
- Chưa chạy CI của PR này hoặc full browser/AI integration. Chưa là approval migration/API.

## Những phần còn phải triển khai trước khi Hiền nối ghi

1. Unique normalized name/value, audit trùng trước migrate, không tự gộp dữ liệu.
2. POST/PATCH definition/options với expectedRevision, confirmation/reason/type/usage gates.
3. Atomic metadata+audit+durable reconciliation; retry cạnh tranh và rollback.
4. Seller value/submit đọc cấu hình trong cùng transaction/lock đúng thứ tự.
5. Optional inactive projection/public/Search nhất quán, Đạt review semantics.
6. Full acceptance #65, QA hai Admin/Seller rồi merge/bàn giao write API.

Không cho UI nhận bước read này là Backend Attributes toàn bộ đã xong.

## Sửa P2 no-store — 20/10/2026

Đạt phát hiện middleware GET/case-sensitive không phủ HEAD và path hoa/thường
mà Express/Nest vẫn nhận. Thay đúng hai điều kiện: GET hoặc HEAD, regex không
phân biệt hoa/thường; vẫn đặt header trước guards. Không đổi Auth hoặc routing.

Regression mới dùng configureApp/controller thật với guard/read-service giả rõ
nhãn (không DB). Trước sửa:5/6ca FAIL thiếu Cache-Control; sau sửa6/6PASS.
Kiểm lowercase/uppercase/mixed cho GET/HEAD, đủ3route và200/400/401/403/404.
Backend full unit655PASS, lint/typecheck/build/diff-check PASS.
Thêm6E2E tương ứng với JWT/PostgreSQL thật. Lượt local20/10 không bootstrap
được vì Docker engine tắt/DB5549 không truy cập; chưa có PASS E2E cho head sửa.
Không dùng610PASS của head cũ thay kết quả bản mới; cần chạy lại khi Docker bật.

Đã chạy lại ngày20/10 sau khi Docker bật và sync develop335b455:21E2E trọng tâm,
679unit và toàn bộ618E2E PASS/20TODO. Lint/typecheck/build/Prisma/diff-check PASS.
Chi tiết tại [báo cáo bản kết hợp](pr77-post78-72-sync-2026-10-20.md);
CI/re-review đúng head mới vẫn là gate, chưa tự merge.

Finding concurrency của Gemini: hai INSERT option có thể giữ FK KEY SHARE rồi
đụng nâng lên FOR UPDATE ở AFTER trigger, gây deadlock40P01. API ghi option
chưa có ở scope này; PR write phải khóa parent trước ghi child, thống nhất lock
order với Seller/definition operations và kiểm retry/rollback nhiều connection.
Không đổi trigger/migration hoặc nhận write safety đã hoàn thành trong P2 này.
