# Ổn định kiểm thử cạnh tranh Product/Search

19/10/2026. Base `develop 622cfb9`; branch `codex/product-concurrency-test`.
**TEST-ONLY / chưa merge. Không thay runtime, API, migration hoặc contract AI.**

## Vấn đề và phạm vi kết luận

Full E2E trên Buyer #74 head `a989529` có631PASS/1FAIL/20TODO. Lỗi tại test
`handles concurrent mutations with optimistic locking` nhận `[200,200]` thay
`[200,409]`. Source Product/Search và test đó giống baseline622cfb9.
Ba lượt chạy test cũ riêng trên baseline đều PASS; kết quả này không phủ nhận
lỗi quan sát trong full suite hoặc chứng minh không có bug khác.

`Promise.all` chỉ gửi hai yêu cầu; không giữ cả hai ở cùng snapshot version.
Request thứ hai có thể đọc sau khi request thứ nhất commit. API PATCH hiện không
nhận expectedVersion của client, nên hai lần cập nhật tuần tự là hai lệnh hợp lệ.
Test cũ thiếu precondition để bắt buộc một409; không nên chỉ nới assertion thành
"200 hoặc409", bỏ test, thêm sleep hoặc retry tới khi xanh.

## Thay đổi kiểm thử

1. Với DRAFT và APPROVED, wrapper test gọi **ownership/snapshot read thật**, rồi
   giữ kết quả cho tới khi cả hai request đã đọc. Assert cả hai version bằng
   initial.version trước khi chấp nhận kết quả test.
2. Không stub transaction, updateMany, version, outbox hoặc response HTTP. Hai
   PATCH đi qua Nest/Auth/service, Serializable/retry và PostgreSQL thật.
3. Giữ nguyên oracle `[200,409]`, version chỉ+1, final name thuộc request thắng.
4. APPROVED phải về DRAFT/NOT_SUBMITTED và tạo đúng một DELETE ở version mới;
   DRAFT không tạo Search event mới. Không thay đổi contract indexing.
5. Ca riêng gửi tuần tự hai PATCH: cả hai200, version+2, tên lần cuối đúng,
   không phát event thừa cho DRAFT. Không trộn tình huống này với cùng snapshot.

Barrier là điểm điều khiển **chỉ trong test**, không phải khóa production hay
bằng chứng cross-process. Wrapper chỉ giữ snapshot sau khi đọc thật; cả hai
transaction ghi vẫn cạnh tranh ở DB. Deadline4s để fail rõ nếu không đủ hai
request, không chọn winner theo elapsed time; HTTP cũng có deadline. finally
release gate, drain các request và restore spy, tránh treo hoặc ảnh hưởng ca sau.

## Môi trường

- PostgreSQL17 container QA loopback5549 hiện hữu, **DB mới riêng cho task**:
  `bckl_order_resolution_test_pr74_base_20261019`.
- Bản QA tạm kết hợp #74 a989529 + commit test d151f68 dùng DB khác:
  `bckl_order_resolution_test_pr74_search_20261019`.
- Không dùng DB demo5432, DB Gemini hoặc DB Attributes. Không đặt GITHUB_ACTIONS.
- Không reset dữ liệu chia sẻ; immutable fixtures chỉ nằm trong DB disposable.
- Không lấy nhánh QA tạm làm nền tính năng chính thức hoặc thay approval #74.

## Bằng chứng thực tế

- Ba ca trọng tâm PASS ở lượt đầu và5lượt liên tiếp tiếp theo.
  Mỗi lượt3PASS/45SKIP do filter;45SKIP không tính thành PASS.
- Toàn suite Search/Hydrate48/48PASS,14.44s.
- Backend lint/typecheck/build/Prisma validate/diff-check PASS.
- Toàn bộ unit629/629PASS,27files; toàn bộ E2E trên nền develop với bản sửa:
  **597PASS/20TODO**,30files PASS/1SKIP,157.86s,exit0.
- QA tạm `f1bdd1f` = Buyer #74 `a989529` + commit test-only `d151f68`:
  **634E2E PASS/20TODO**,32files PASS/1SKIP,175.06s,exit0. Fresh15migrations PASS
  trước chạy; không thay source Buyer hoặc bản #74 trên remote trong đợt test này.
- 20TODO/skip không tínhPASS. Lượt #74 trước đó631PASS/1FAIL vẫn là kết quả thực
  của head a989529 chưa có bản sửa test; không ghi đè hoặc chuyển thành xanh giả.
- Hai full suites dùng hai DB riêng và cùng PostgreSQL QA container; không nhận
  đây là stress/load test, browser QA, integration ES/FAISS hoặc mọi lỗi đã hết.

Các lệnh từ root checkout, sau khi đặt DATABASE_URL và JWT test-only vào phiên shell:

```powershell
pnpm --dir BE exec vitest run --config vitest.config.e2e.ts test/search-hydrate.e2e-spec.ts -t 'same-version concurrent|sequential Product edits'
pnpm --dir BE exec vitest run --config vitest.config.e2e.ts test/search-hydrate.e2e-spec.ts
pnpm --dir BE lint
pnpm --dir BE typecheck
pnpm --dir BE build
pnpm --dir BE test
pnpm --dir BE exec prisma validate
pnpm --dir BE test:e2e
git diff --check
```

Không copy DATABASE_URL của máy thật hoặc đặt GITHUB_ACTIONS để né guard. Các log
injected failures là ca fault có chủ đích; pg concurrent-query deprecation warning
nền vẫn tồn tại, không sửa driver/dependencies trong task test-only này.

## Giới hạn và bước tiếp

Không sửa stale-client contract, thêm If-Match, thay chính sách cập nhật Product,
hoặc nhận đã xử lý mọi dạng lost-update. Khi cần token version từ UI phải có
thiết kế/review API riêng. Không thay payload Search hay chạy integration AI thật.

Review/merge PR test vào develop trước; sau đó đồng bộ #74 và chạy lại exact-head
regression/CI/re-review. Proof kết hợp local không cho phép tự merge hoặc dùng
approval cũ thay review head đã đồng bộ. Gemini vẫn độc lập review #77/#74/#75.
