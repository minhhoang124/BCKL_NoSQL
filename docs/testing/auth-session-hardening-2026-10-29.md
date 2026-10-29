# Auth, dependency và QA hardening —29/10/2026

Nhánh `fix/hoang/release-hardening` từ `develop a88a11d`, độc lập với PR133.
Chỉ tính tích hợp sau review/merge. Không đưa public hoặc thay source Demo5173
trong lượt này. Không thay contract Backend–AI, dataset, model hoặc provider.

## Vấn đề và hành vi sau sửa

|Ca trước sửa|Sau sửa|Bằng chứng|
|---|---|---|
|Form từ site khác login200, phát cookie, refresh200|403 trước ghi session, không cookie, refresh401|Chrome headless thật, local HTTP, app-role DML|
|Register password Unicode83byte; password khác hậu tố vẫn login|Register/login từ chối >72byte; đúng72byte vẫn hoạt động|HTTP/PostgreSQL, DTO và service helper|
|20 lần sai password đều401, không quota account dùng chung|Quota theo IP/account trong PG; 429 + Retry-After, hai app dùng chung|Ca giới hạn thấp, default10, cạnh tranh8request|
|Cleanup có thể chờ row hết hạn bị khóa|SKIP LOCKED, request khác vẫn được xử lý|Hai connection thật; giữ khóa row rồi gọi admission|
|Account bị chặn không tính tiếp quota IP|IP được tính trước, commit khi account từ chối|Từ chối account vẫn tiêu thụ IP; không đi tiếp bcrypt|
|QA target mới bị các suite cũ từ chối|Thêm đúng tên target mới, giữ host/port/role; tách provisioner D07|Full E2E chạy được trên máy mới, không giả CI|

Không gọi lỗi email padded là bypass HTTP đã xác nhận: DTO hiện có đã chặn
email raw không hợp lệ. Chuẩn hóa rate key trước kiểm chiều dài là phòng vệ
nhất quán thêm sau review. Logout không bị shared-IP quota ngăn thu hồi phiên.

## Kiểm tra cuối

|Nhóm|Kết quả|
|---|---|
|Backend unit|1761 PASS|
|Web|1667 PASS /6 live SKIP|
|Full Backend E2E|1187 PASS /1 live SKIP /20 TODO nền|
|Auth focused HTTP/PG|32 PASS bằng app-role không superuser/CREATEDB/CREATEROLE|
|Backend TypeScript/build/lint|PASS|
|Web build|PASS, còn cảnh báo bundle>500kB nền|
|Prisma generate, migrations, schema diff|PASS, không drift|
|pnpm audit --prod|0 advisory ở thời điểm kiểm, trước sửa13|
|Chrome login CSRF|PASS oracle sau sửa:403/no cookie/refresh401|
|Argon Medium review cuối|Không finding P1/P2 xác nhận trong source được cung cấp; static-only|

Số test thấp hơn nhánh PR133 ở một số nhóm là do base khác nhau: nhánh này từ
develop chưa chứa Search analytics của PR133. Không lấy test hai nhánh cộng
thành một bản phát hành đã tích hợp.

Full E2E dùng schema-owner migrator không có superuser/CREATEDB/CREATEROLE vì
fixture tạo trigger/DDL. Không mô tả mọi ca full là app-role DML. Ca32 riêng có
app-role DML thực. CI dùng disposable postgres service có superuser nên ca
xác nhận least-privilege đánh dấu skip trên CI; bằng chứng đó được chạy local.
Các ca chức năng/đối kháng còn lại vẫn chạy trên CI.

## Dependency và tương thích

Patch chính xác trong pnpm overrides và lockfile: multer2.5.0, proxy-addr2.0.8,
body-parser2.4.0, qs6.16.1, fast-uri3.1.9, source-map-js1.2.2, mysql2 3.23.1,
và deepmerge-ts8.0.0 trong @prisma/config. Không nâng Prisma lên8 prerelease.

Override deepmerge-ts có thay đổi major: v8 đổi cách merge Map và một số type/
deepmergeInto. Prisma config của repo dùng plain objects; đã đọc release notes,
chạy generate, migrate/schema và full E2E trên override. Không tuyên bố tương
thích mọi Prisma config ngoài repo. Giữ pin và kiểm lại khi cập nhật Prisma.

Nguồn:
- https://github.com/RebeccaStevens/deepmerge-ts/releases/tag/v8.0.0
- https://github.com/advisories/GHSA-jqcg-44mw-7w3h
- https://github.com/advisories/GHSA-27r3-jxmh-p828
- https://github.com/advisories/GHSA-q7qp-rjg7-q26m

Quét sạch advisory không phải bằng chứng hết mọi lỗ hổng. Chưa kiểm toàn bộ
ASVS, tải lớn, TLS public, provider thật hoặc khôi phục sau sự cố production.

## Truy vết các lượt chưa đạt

- Lượt full đầu:1036PASS/10FAIL/132SKIP/20TODO. Lỗi do fixture đăng ký cùng
  socket chạm quota, các target Attributes cũ chưa nhận DB mới và oracle cũ
  chờ400 cho Auth body70KiB trong khi contract mới chặn413 ở8KiB.
- Không tắt admission: functional suite có quota test cao sau kiểm target;
  Auth suite riêng vẫn kiểm quota thấp/default10, nhiều instance và DB clock.
- Lượt full kế tiếp1178PASS/1SKIP/20TODO; sau review thêm ca và patch Prisma
  dependency, lượt cuối1187PASS/1SKIP/20TODO. Không lấy lượt lỗi làm PASS.
- Chrome fixture ban đầu thiếu Origin trong Node fetch có Sec-Fetch metadata;
  sửa đúng client QA gửi Origin đã cấu hình, không bỏ kiểm Origin của server.

Artifacts riêng ngoài Git: `machine-local/hardening-20261029` trong workspace
điều phối, gồm JSON/log, Chrome PNG và output review. Không commit secret,
password fixture, URL provisioner, ảnh, dump hoặc artifact sinh tự động.

## Rollout còn phải làm

Apply migration mới và grant DML bảng rate cho app-role trước chạy code. Giữ
checksum các migration cũ. Tài khoản legacy có password>72byte cần recovery
hợp lệ, không tự sửa hash. Sau proxy phải chốt IP/cookie/origin và kiểm HTTPS.

Đọc [contract Auth](../api/auth-session-hardening.md) và
[gate staging](../deployment/staging-readiness-2026-10-29.md). Email ngoài,
Google LINK thật, VNPay IPN thật/MoMo và release UI xuyên luồng vẫn có gate riêng.
