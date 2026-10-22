# PR #83 — bản kết hợp sau #77 và sửa target CI

Ngày 21/10/2026. Source trước sync `1a1740e`; develop `bf6f926` sau #77/#81.
Conflict duy nhất architecture, giữ đủ ghi chú hai phía và chỉ rõ lịch sử.
Không đổi parser/planner/auditor runtime, không bật controller ghi Attributes.

## Lỗi tái lập

#83 từng sửa CI bằng service mới loopback5549/database
`bckl_order_resolution_test_ci`. Sau khi foundation #77 merge, hai suite GET/
migration có guard riêng chỉ nhận tên Attributes QA hoặc service GitHub5432 cũ.
URL E2E mới của #83 vì vậy không được cả hai guard chấp nhận. CI xanh tại
`1a1740e` trước #77 không chứng minh bản kết hợp này đạt.

Regression `BE/src/catalog/attribute-ci-target.spec.ts` đọc URL thực của hai
step trong workflow và gọi cả hai guard. Trước sửa: **2 FAIL / 2 PASS**, đúng
lỗi `Dedicated Attributes QA database or disposable GitHub service required`.
Không cần kết nối DB hoặc giả GITHUB_ACTIONS để tái lập.

## Sửa tối thiểu

Giữ service QA riêng, chỉ thay tên database sang
`bckl_order_resolution_test_attributes_20261019` ở POSTGRES_DB, healthcheck,
prepare và E2E URL. Tên này thỏa cả hai allowlist đã có. Không nới guard,
không skip suite, không bật cờ CI local để né bảo vệ. PostgreSQL5432 chính của
runner vẫn chỉ phục vụ các step hiện có; Backend E2E chạy hoàn toàn ở service
5549 riêng và migrate/seed đúng cùng database trước chạy test.

Sau sửa: **4/4 regression PASS**. Hai test kiểm URL thật; một test kiểm wiring
service/healthcheck/prepare/E2E đồng nhất; một test giữ chặn port demo, DB lạ và
tham số URL override. Test không chứa secret thật; postgres/postgres chỉ là
credential service dùng một lần trong GitHub runner.

## Kiểm thử bản kết hợp

- Backend lint: PASS, không lỗi/cảnh báo.
- Backend typecheck, Prisma generate, Nest build: PASS.
- Full Backend unit: **837 PASS,36files,5.56s**; gồm4 regression mới, không cộng lặp.
- QA mới riêng: `bckl_order_resolution_test_attributes_20261019_v3183`,
  PostgreSQL17 container riêng chỉ bind127.0.0.1:5549; fresh15migrations và Prisma
  validate PASS. Không dùng demo5432, DB của reviewer hoặc container seminar.
- Full Backend E2E: **647 PASS / 20 TODO**,35filesPASS/1SKIP,152.32s,exit0.
  Bao gồm21 Attributes HTTP/migration và14 protocol/auditor preparation; không
  cộng lại các nhóm vào tổng. Không tính TODO/SKIP là PASS; fault-injection logs
  và warning pg nền không phải assertion failures. Guard local giữ nguyên.
- FE source/Prisma/Product/Search/Store/AI và lockfile khớp develop đã merge;
  không dùng unit/protocol fixture làm proof actual writers hoặc live AI.

## Rà độc lập qua Gemini CLI

`agy --sandbox`, model `gemini-3.8-flash-low`, nhận trực tiếp nội dung hai guard
và diff workflow, không tool/command/file access. Gemini nhận định URL đề xuất
thỏa cả hai guard, port/service khớp. Codex chắt lọc lập luận điều kiện regex;
không dùng các con số đếm ký tự trong câu trả lời làm bằng chứng, vì diễn giải
số đếm chưa chính xác. Test thực gọi hai guard ở trên là bằng chứng quyết định.
Gemini không chạy test, không full review #83 và không phải approval của Đạt.

## Gate và giới hạn

Đạt Request changes tại `6b82435` do CI target cũ; cần review delta sau sync/sửa
và CI đúng head mới trước merge. Không tự dismiss review hoặc coi câu trả lời
Gemini là xác nhận thay Đạt. PREPARATION chưa có API ghi/audit/job producer,
normalized DB unique hoặc Seller coherence; các phần đó phải triển khai và
kiểm thử riêng trên schema thật. Không thay contract Search/FastAPI.
