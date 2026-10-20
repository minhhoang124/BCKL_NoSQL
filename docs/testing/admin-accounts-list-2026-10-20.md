# Admin Accounts list — kiểm thử và bàn giao 20/10/2026

Baseline `develop 6d682e4`. Phạm vi chỉ đọc của contract #76 (`a761879`,
Hiền/Đạt đã approve contract); không nhận approval contract là approval code.

## Thay đổi

GET `/admin/accounts` dưới guard Admin, strict query/cursor/allowlist;
PostgreSQL RepeatableRead READ ONLY, actor đọc lại trong snapshot, statement
timeout5s, maxWait2s/transaction7s. Middleware GET/HEAD trước guards/parser
đặt no-store cả lỗi, không nhận body. PATCH status cũ không thay đổi.
Không migration hoặc sửa schema, JWT, Search/AI, FE hay dữ liệu demo.

## Kiểm thử đã chạy

- `pnpm install --frozen-lockfile --offline`: PASS, không đổi lockfile.
- Lint, typecheck, build: PASS (0 lỗi/warning oxlint của Backend).
- Full Backend unit: **683/683 PASS**, 30files; gồm26 query +4 transaction tests mới.
- Nest + PostgreSQL targeted Accounts: **15/15 PASS** lượt đầu trước sửa assertion
  độc lập dữ liệu của ca wildcard; full rerun cuối ghi dưới đây.
- Fresh DB QA **14 migrations PASS**, không migration mới.
- `admin-accounts-qa.mjs`: chạy2lần PASS, cùng5ID, không reset dữ liệu/password cũ.
- Full Backend E2E sau sửa assertion: **612 PASS /20 TODO**, 31files PASS/1SKIP,
  171.27s. Có15ca Accounts HTTP/PostgreSQL mới; không cộng lại thành tổng khác.
- `git diff --check`, cú pháp script Node: PASS.

DB riêng `bckl_order_resolution_test_accounts_1020` trên container QA
`bckl-buyer-resolution-qa-20261019`, loopback5549. Không đọc/ghi DB demo5432
hoặc container seminar. Script dùng password runtime tự sinh, không đưa credential
vào repo/GitHub; Hiền tự đặt password/môi trường QA trên máy theo hướng dẫn API.

## Ma trận bằng chứng

| Rủi ro | Bằng chứng |
|---|---|
| Guest/Buyer/Seller/inactive Admin, JWT role cũ | HTTP thật qua JWT strategy/guards + PostgreSQL |
| Lộ password/token/địa chỉ/Order | Assert exact keys response và Store summary/null |
| Query lạ/trùng/bracket/invalid int/bool/role | Unit + HTTP400 và no-store |
| Pagination | limit2 đi hết5fixture theoID, không trùng, nullcursor, page rỗng |
| Tìm email/fullName/role/inactive | HTTP + DB fixtures, case-insensitive và combinedfilters |
| SQL wildcard/injection | Test text literal %, _, backslash và SQL-looking string, không raw SQL từ client |
| Role/state đổi sau token | Current DB guard chặn403/401; unit thêm service recheck trong transaction |
| GET gây mutation | User snapshot và job/outbox counts bất biến |
| Snapshot và bounds | Unit assert options READ ONLY/RepeatableRead/timeouts, HTTP dùng DB thật |
| UI/Browser/live Admin Accounts | **NOT_RUN**, chưa có màn Accounts tích hợp trong PR Backend |

Lượt full E2E đầu fail1 assertion mới: ca q=`_` giả định toàn DB không có ký tự
underscore, trong khi test nền để lại fixtures hợp lệ chứa ký tự này. Đã sửa
test bằng fixture dương có ký tự literal và cursor phạm vi fixture mới, giữ
nguyên implementation tìm kiếm; không sửa production để che lỗi test.

## Hiền tiếp tục phần nào

[API/cách dựng QA](../api/admin-accounts-list.md) gồm script fixture cục bộ,
hai Admin độc lập, Buyer/Seller/Store và inactive User. Nối danh sách chỉ đọc,
loading/lỗi/rỗng/filters/cursor và isolation phiên. Chưa bật khóa/mở dựa PATCH
cũ; status hardening/revision/audit/epoch sẽ là PR riêng.

GET thực hiện substring scan, chưa benchmark tải lớn/trigram index hoặc rate
limit phân tán; query bounds/timeouts không được gọi là chứng minh chịu tải.
Không nghiệm thu toàn G-ADMIN hoặc Accounts command khi chỉ có read API.
