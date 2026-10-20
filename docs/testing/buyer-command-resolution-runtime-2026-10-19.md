# Kiểm chứng Buyer resolver Backend — 19/10/2026

Base `develop 622cfb9` (#69 đã merge). Branch `codex/buyer-resolution-runtime`.
Phạm vi migration/API Backend, chưa Frontend hoặc journal v2. #70/#72 đang
review không được lấy làm dependency; bộ test mới độc lập từ develop.

## Môi trường an toàn

- Container riêng `bckl-buyer-resolution-qa-20261019`, PostgreSQL17,
  loopback5549, DB `bckl_order_resolution_test_buyer_20261019`.
- Không chạm DB demo5432 hoặc containers môn học khác. Không copy `.env` thật.
- Test nhận `DATABASE_URL` trỏ đúng QA; guard từ chối namespace sai trước
  bootstrap/fixture. CI dùng service DB `klcn_ecommerce` riêng của GitHub Actions.
- Fixture là dữ liệu giả có nhãn. Fences immutable được giữ trong disposable DB,
  không vô hiệu trigger để dọn. Dừng/xóa cả container QA chỉ khi không cần evidence.

## Bằng chứng phân lớp

1. Unit: request exact fields, ID/key/hash, fingerprint complete, replay cancellation
   snapshot với reason-hash, malformed receipt và Buyer fence/role/dual outcome.
2. Migration: dựng schema biệt lập bằng Prisma với toàn migration trước đó;
   tạo Seller fence, Seller/Buyer/SYSTEM receipts, snapshot các bảng rồi áp
   migration mới. Đối chiếu không đổi dữ liệu; pair hợp lệ mới được thêm,
   invalid pair/UPDATE/DELETE fence/ReadCommitted/opposing outcome bị chặn.
3. HTTP thực qua hai Nest app + PostgreSQL: tạo Order bằng Checkout COD, hai
   Variant cùng Product, snapshot/ledger/outbox thật. Ảnh chỉ là fixture URL,
   không phải bằng chứng serving ảnh/ES/FAISS.
4. Complete thực qua Seller confirm/packing/ready và Admin ship/mark-delivered,
   sau đó Buyer complete rồi resolver trả biên nhận gốc. D07 dùng internal job
   path thật với mốc due-date fixture có ghi rõ, không giả receipt SYSTEM.

## Ca rủi ro và oracle

| Nhóm | Điều kiện kiểm |
|---|---|
| No-record cancel/complete | Exact CLOSED, replay cùng ID/time, Order/Payment/items/history/stock/version/outbox/job không đổi |
| Committed | Exact original result; cancel hoàn hai dòng nhưng một Product version/outbox, replay không ghi thêm |
| Mismatch/privacy | Actor/owner đọc lại; account khóa401, role khác403, owner khác404, hash/command/Order khác409 |
| PROCESSING | Claim chưa commit giữ actor lock; resolver bounded409, không tạo fence; rollback claim rồi retry được. DB không cho commit PROCESSING lâu dài |
| Payload | JSON strict, query/extra/bool/version/hash hoa, gzip sau giải nén >8KiB và alias URL |
| Durable result | Proxy chỉ relay HTTP thật, cắt socket sau upstream200; DB có fence, Nest app mới replay đúng ID |
| Fault | DB trigger lỗi trước insert và deferred lỗi lúc COMMIT: response500, toàn snapshot cũ còn nguyên |
| Retry | Trigger40001 + sequence QA kiểm tối đa3attempt, không fence sót, Retry-After |
| Race HTTP | DB advisory barrier quan sát pg_locks; execute-first/resolve-first cho cancel/complete, không sleep để đoán thắng |
| Race SQL | Hai connection đã chụp snapshot trước commit: opposing outcome không thể cùng commit |
| Role change | Buyer fence chặn cả năm writer trước replay/policy sau đổi role có quyền tương ứng |
| Quota | 20 lượt mặc định gồm replay, lượt21 bị429, execute vẫn dùng bucket riêng |

## Lệnh tái lập

Đặt DATABASE_URL tới DB QA đã xác minh và JWT secrets **chỉ dành cho test** trong
phiên terminal; không gửi giá trị lên GitHub. Không đặt GITHUB_ACTIONS để né
guard local. Chạy từ root checkout:

```powershell
pnpm install --frozen-lockfile --offline
pnpm --dir BE exec prisma migrate deploy
pnpm --dir BE exec prisma validate
pnpm --dir BE typecheck
pnpm --dir BE lint
pnpm --dir BE test
pnpm --dir BE build
pnpm --dir BE test:e2e
git diff --check
```

Test trọng tâm: `test/buyer-command-resolution-runtime.e2e-spec.ts` và
`test/buyer-resolution-migration.e2e-spec.ts`, từ BE với `vitest.config.e2e.ts`.
Không chạy nhiều tiến trình E2E chung DB cùng lúc; fileParallelism:false chỉ
cô lập fixtures, không là cơ chế đồng thời production.

## Kết quả hiện tại

Kết quả dưới đây là lượt tác giả ban đầu tại `06d8e93`. Hiền và Gemini sau đó
tái lập lỗi fixture giờ ở cùng head; xem mục sửa P2 bên dưới, không dùng CI xanh
hoặc lượt PASS cũ để phủ nhận lỗi test không ổn định đã được xác nhận.

- Frozen offline install, Prisma generate/validate và fresh migrate15 migrations PASS.
- Backend unit671 PASS/28files (42 test mới, gồm3vector contract đối chiếu
  WebCrypto độc lập trong một test); typecheck và Nest build PASS.
- Hai suite Buyer trọng tâm37 PASS (36runtime +1upgrade).
- Full Backend E2E632 PASS /20 TODO nền, 32files PASS /1file skipped, 172.70s.
  TODO/skip không được tính PASS; không activate các TODO harness cũ bằng fixture giả.
- Lint cuối PASS, 0warning/0error; typecheck PASS. Diff-check PASS.

## Sửa P2 fixture hai nguồn giờ — re-review ngày19/10

`corrupt valid-shaped cancellation snapshot cannot become COMMITTED` trước đây
bỏ createdAt nên DB dùng CURRENT_TIMESTAMP, còn completedAt lấy clock Node.
Chênh1ms có thể khiến receipt_check chặn fixture trước khi gọi resolver.
Bản sửa đặt rõ cả hai mốc cố định từ cùng nguồn (2026-01-01T00:00:00Z và
00:00:01Z), giống fixture malformed receipt hiện hữu. Không đổi constraint,
snapshot sai reason-hash, migration, runtime, guard, retry hoặc skip test.

Bổ sung snapshot toàn trạng thái sau khi insert fixture, đối chiếu sau HTTP500:
Order/Payment/items/history/stock/Product.version/outbox/job/commands không đổi;
không có durable closure. Như vậy test thực sự đi tới resolver, không chỉ fail insert.

- Hai suite Buyer runtime+upgrade37/37 PASS (36runtime+1migration).
- Ca lỗi cũ chạy riêng3lần liên tiếp đều PASS; mỗi lượt1PASS/35SKIP do filter tên,
  không tính35SKIP thành PASS hoặc thay full suite bằng test lọc.
- Backend unit671/671 PASS; lint/typecheck/build/Prisma validate/diff-check PASS.
- Full Backend regression bản sửa: **631PASS /1FAIL /20TODO**,31files PASS/
  1FAIL/1SKIP,188.81s. Không báo toàn E2E xanh. Buyer suites PASS; lỗi còn lại
  là `search-hydrate.e2e-spec.ts:817`: hai PATCH Product trả[200,200], test kỳ vọng
  [200,409]. Test Promise.all không barrier buộc cùng version; assertion dừng
  trước kiểm final version. Không suy riêng kết quả này thành production lost-update.
- Source Product/Search và test trên không đổi so baseline622cfb9. Đối chiếu
  readonly baseline622cfb9 trên checkout/DB QA riêng: ca Search chạy riêng3lần
  đều PASS; chưa tái lập FAIL baseline ở ba lượt này, không nhận đã chứng minh
  hết lỗi hoặc biến ba lượt PASS thành full regression PASS.
- Không sửa/nới assertion hoặc skip Search test trong #74. Cần task/test nền
  có barrier snapshot thật, rồi chạy lại full suite trước nhận gate hoàn tất.
- Góp ý P3 log SQLSTATE khi cạn retry chưa thay trong delta này; không phát log
  raw SQL/statement/payload hoặc dữ liệu cá nhân chỉ để tăng mức chi tiết.
- Frontend nền555 PASS/6live SKIP; FE/AI_CLIP/schema.prisma/lockfile không đổi
  so với develop622cfb9. Không nhận FE unit là browser QA.

## Giới hạn và bước tiếp theo

- Hai Nest app trong cùng OS process và restart một app không là kill/crash
  hai OS process; stale SQL snapshot kiểm exclusion ở DB, không thay bài chaos.
- Chưa browser/Buyer Web/journal v2/storage/session UI; BRC22–30 phần Frontend
  vẫn NOT_RUN. Không nâng toàn acceptance32ca hoặc G-FULFILMENT thành DONE.
- Không mới integration Elasticsearch/FAISS hay metric Precision/Recall.
- Có pg deprecation warning nền khi transaction engine rollback lỗi được chủ
  động gây ra; không thay driver/package trong task.
