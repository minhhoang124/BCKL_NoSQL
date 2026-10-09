# Kiểm chứng bản sửa 13 lỗi kiểu Backend

Ngày chạy: **09/10/2026**. Branch: `codex/backend-typecheck-fix`, tách từ
`origin/develop` tại `c6e0ba1`. Bản sửa chưa review/merge.

## Nguyên nhân và thay đổi

| Nhóm | Số lỗi trước sửa | Cách sửa |
|---|---:|---|
| Prisma config | 1 | Bỏ `earlyAccess` không còn thuộc `PrismaConfig` của phiên bản đang cài; giữ nguyên datasource và seed |
| Kiểu HTTP server trong E2E | 10 | Thay import `supertest/types` không giải được bằng alias chung `App = Parameters<typeof request>[0]`, suy ra từ API công khai |
| Search reconciliation test | 1 | Bỏ kiểm tra trường `locked` không tồn tại; kiểm tra `failed = 0`, có Product bị skip, tổng stats khớp và Product DRAFT không đổi/không sinh outbox |
| Kiểu seed JavaScript | 1 | Thêm `seed-demo-user.d.mts` mô tả đầu vào Prisma và kết quả `User`; mock có kiểu, không dùng `any` để né lỗi |

Lệnh tái hiện trước sửa: `pnpm --dir BE exec tsc --noEmit -p tsconfig.json`.
Kết quả: exit 1, đúng 13 diagnostic. Đây là lỗi kiểm tra kiểu, không phải bằng
chứng có 13 lỗi nghiệp vụ runtime. Nest build chỉ include `src`; Vitest biên
dịch/chạy test nhưng không kiểm tra toàn bộ kiểu. Vì vậy hai bước này trước đây
có thể đạt trong khi full typecheck vẫn lỗi.

## Chống tái diễn

- `pnpm --dir BE typecheck` sinh Prisma Client rồi kiểm tra source, test và
  `prisma.config.ts`, không phát sinh migration hoặc thay dữ liệu.
- Workflow CI thêm bước riêng chạy lệnh này. Chưa có kết quả GitHub CI cho bản
  sửa local này; không nhầm kiểm tra local đạt với CI đã chạy xanh.
- Giữ nguyên strict checking và phạm vi test trong tsconfig; không thêm
  `@ts-ignore`, không bỏ test khỏi kiểm tra kiểu.
- Seed security có 5 ca: từ chối nâng quyền USER, tạo account thiếu, giữ nguyên
  account demo hợp lệ, từ chối account inactive và sai mật khẩu. Kiểu của Prisma
  transaction user delegate cũng được kiểm tra tương thích với declaration.

## Kết quả thực chạy

| Kiểm tra | Kết quả |
|---|---|
| `pnpm install --frozen-lockfile` | PASS, lockfile không đổi |
| `pnpm --dir BE typecheck` | PASS, không còn diagnostic; chạy lại sau sửa test vẫn PASS |
| `pnpm --dir BE lint` | PASS |
| `pnpm --dir BE test` | PASS, 126 test / 11 file |
| `pnpm --dir BE build` | PASS |
| `pnpm --dir BE exec prisma validate` | PASS |
| Migration deploy + seed database mới | PASS, đủ 9 migration hiện có |
| `pnpm --dir BE test:e2e` | PASS, 158 test / 14 file |
| `git diff --check` | PASS |

Database E2E riêng: `bckl_backend_typecheck_20261009_a`, PostgreSQL Docker.
Checkout không có `.env` hoặc `BE/.env` để tránh ghi đè cấu hình database kiểm
thử; credential chỉ được truyền trong môi trường tiến trình, không ghi vào repo.
Không chạy migration/seed/test trên database demo. Không thay schema, migration,
runtime API, contract FastAPI, dữ liệu demo hay code của PR Checkout/Order.

## Giới hạn

- Chạy lại lúc tiếp tục task ngày 09/10: typecheck, lint, 126 unit test, build
  và Prisma validate đều PASS. Docker engine chưa chạy ở lần kiểm tra này nên
  chưa chạy lại E2E; 158 ca trong bảng trên là bằng chứng đợt kiểm tra trước,
  không phải kết quả mới. CI của PR sẽ chạy E2E trên PostgreSQL riêng.
- PR #39 tại commit `aa23cc3`: GitHub CI run `37915664295` có cả
  `repository-checks` (bao gồm Backend typecheck/E2E trên PostgreSQL của CI)
  và `AI Service - Ruff and Pytest` PASS. Đây là bằng chứng chạy lại trên CI;
  không nói Docker local đã hoạt động. Commit tài liệu tiếp theo cần CI riêng.

- Không phải kiểm thử toàn hệ thống hoặc bằng chứng mọi lỗi của project đã hết.
- Không chạy lại FE hoặc AI suite vì không sửa các miền này.
- Còn cảnh báo nền `vite-tsconfig-paths` và pg concurrent-query deprecation;
  chúng không làm bộ kiểm tra trên thất bại và chưa được sửa trong task này.
- Declaration của seed phải được cập nhật cùng JavaScript nếu contract helper
  thay đổi sau này; unit test hiện kiểm chứng các nhánh runtime liên quan.
