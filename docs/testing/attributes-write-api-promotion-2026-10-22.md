# Attributes write runtime — promote từ local, 22/10/2026

## Nền và phạm vi

Branch `codex/admin-attribute-write-api`, base develop
`e394c9eb3c13c8f96bfe40f5be97d5efb97d192e`.
Tái sử dụng checkout sạch của #92 đã merge (`attribute-normalized-uniqueness`)
nhưng branch mới; không sửa ref #92 hoặc các candidate chưa commit.

Chỉ promote runtime delta từ candidate tree
`aa66a38ed8877187acdd80d9184eca305be92582`, không ghép PR nền chưa được duyệt.
Giữ Auth/Health/upload/UI/Prisma/AI/lockfile của develop mới. Không migration mới.
Ba component HTTP/service và Catalog DI/parser mở bốn API thật; bỏ hai writer
legacy để không còn đường bỏ qua revision/audit/policy.

Seller create/value/category move/submit tham gia Category fence. Submit kiểm
rule trong snapshot ghi; public/Search projection bỏ optional value vô hiệu.
Hai regression cũ cập nhật envelope/reason/expectedRevision theo contract #65;
teardown giữ actor được immutable audit tham chiếu, không xóa hoặc tắt audit.

## Kiểm thực tế trên source promoted

| Kiểm | Kết quả |
| --- | --- |
| Dependency frozen/ignore-scripts/prefer-offline | PASS, policy giữ bật, không đổi lockfile |
| Prisma generate; Backend lint/typecheck | PASS |
| HTTP runtime + composition + Seller + kernel | **85 PASS/4files,16.60s**:33runtime +10composition +6Seller +36kernel |
| Full Backend unit | **1034 PASS/47files,7.53s** |
| Nest build / Prisma validate | PASS |
| Full Backend E2E | **799 PASS/20TODO**,46filesPASS/1SKIP,224.79s; gồm33runtime +10composition, không cộng85subset |

Full E2E đã bật live Health bằng explicit Python executable: FastAPI thật từ
checkout, model/index cố ý chưa tải. Test tạo lỗi audit/job/invalid HTTP có log
ERROR chủ đích; exit0 và assertion cuối đạt. Không coi log lỗi mô phỏng là lỗi
nghiệp vụ đang xảy ra, cũng không tắt log để làm xanh. pg query-in-flight và
vite-tsconfig-paths warning nền vẫn còn. Không có flake409/409 trong lượt này;
root cause lịch sử vẫn giữ OPEN.

Subset/lượt lặp không cộng vào tổng. Fixture auth của runtime suite đăng nhập
HTTP thật; hai app/pool độc lập, có lock-wait PostgreSQL thật. Composition suite
kiểm module DB/policy/worker, không nhận mười ca đó là HTTP authorization proof.

## Rủi ro được kiểm

- Guest/non-Admin/account đổi trạng thái, ID/nesting/body/extra/null/limit/quota.
- Hai Admin cùng revision/option insert: một quyết định hợp lệ, không double
  revision/audit hoặc raw deadlock; rollback thật khi audit hoặc enqueue lỗi.
- Type/slug/value đang dùng không đổi nghĩa; required SELECT cần option active;
  no-op không mutation, revision exhaustion không tràn/reset.
- Admin đổi rule khi Seller đang nhập/submit: shared fence và canonical retry,
  không chỉ khóa trong một process. Public mất eligibility ngay trước worker.
- Order COD thật giữ snapshot/SKU/address/payment/history/stock sau đổi rule;
  replay Checkout tại app thứ hai vẫn receipt gốc, không trừ kho lần hai.
- Search worker phát đúng payload/version/delete/upsert; không event thừa cho
  metadata vô hại hoặc Product không bị ảnh hưởng.

## An toàn / tái lập

Lượt này dùng launcher local có guard, không root/BE.env, demo dừng, cluster QA
riêng127.0.0.1:5549/DBv905/role giới hạn, đã có17migrations. Không reset/drop/
prepare/migrate hoặc purge audit/job. Fixture bất biến giữ để đối chiếu.
Launcher/private profile không commit hoặc gửi reviewer. Reviewer tự dựng QA
riêng theo guard trong `BE/test/helpers/runtime-qa-target.ts` và
`attribute-read-qa-target.ts`, áp17migration trên DB mới có kiểm target rõ ràng.
Không dùng DB demo5432 hoặc mượn URL localhost của Hoàng làm host chia sẻ.

Sau khi có QA target hợp lệ, từ BE dùng các script `lint`, `typecheck`, `test`,
`build`, `test:e2e`. Chọn file runtime bằng
`test/admin-attribute-write-runtime.e2e-spec.ts`; composition là
`test/attribute-write-composition.e2e-spec.ts`. Không sửa setup-env/guard để chạy.
Không in token/URL DB. CI billing không được gọi là CI xanh.

Chưa chạy browser editor/FE writes hoặc loaded Elasticsearch/FAISS cho rule mới.
FE không đổi so develop đã kiểm939PASS/6SKIP trước runtime; không gọi số base
là lượt FE mới. AI source không đổi; Health live nếu được bật chỉ chứng minh
wiring với FastAPI cố ý chưa tải model/index. 20TODO lịch sử vẫn chưa hoàn thành.

Issue Order409/409 lịch sử vẫn OPEN; không xóa bằng một full rerun xanh hoặc
chỉnh business/timeout để che. Không nhận quota RAM là distributed rate limit,
không nhận Catalog có durable unknown-outcome recovery. Sau review/merge mới
bàn giao commit/API/fixture riêng cho Hiền nối editor và chạy browser QA.
