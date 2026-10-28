# Chạy local và bằng chứng Store/COD

## Tách môi trường trước khi chạy

Đây là hướng dẫn QA, không phải lệnh nâng cấp database demo. Dùng checkout riêng, database QA riêng cổng loopback `127.0.0.1:5549` và app-role không có quyền superuser/CREATEDB/CREATEROLE. Dừng container demo `bckl_postgres` trong thời gian kiểm thử. Không reset/drop database hoặc chạy seed đại trà lên dữ liệu đã có.

Các browser driver từ chối `.env`, `BE/.env`, `FE/.env`, `FE/.env.local` trong checkout; truyền cấu hình QA qua môi trường tiến trình. Không sao chép `.env.example` mặc định cổng 5432 rồi chạy test. `DATABASE_URL` phải được người vận hành xác minh đích/role, không in URL hoặc lưu credential trong log. Không dùng khóa merchant thật cho ca callback giả lập.

## Cài đặt và kiểm code

Node/pnpm theo cấu hình repo, PostgreSQL QA, Chrome và Playwright đã cài trên máy. Không tải model/index khi chỉ kiểm Store/COD.

```powershell
pnpm install --frozen-lockfile
pnpm --dir BE run typecheck
pnpm --dir BE run build
pnpm --dir FE run build
pnpm --dir BE run lint
pnpm --dir FE run lint
pnpm --dir BE test
pnpm --dir FE test
```

Typecheck/build có Prisma generate nhưng không migrate database. Nếu dựng QA mới, chỉ người đã xác minh URL dùng migrator riêng để deploy migration; phiên QA ngày 28/10 dùng 36 migration và không cần migration mới cho Store công khai. Không chạy lại provisioning trên database đã có.

## Kiểm Store

Sau khi nạp môi trường QA riêng, chạy lần lượt để không làm nhiễu phép đối chiếu dữ liệu:

```powershell
pnpm --dir BE exec vitest run src/store/public-store-input.spec.ts
pnpm --dir BE exec vitest run --config vitest.config.e2e.ts test/public-store.e2e-spec.ts
pnpm --dir FE exec vitest run src/features/public-store/ src/pages/ProductDetailPage.test.tsx
```

`scripts/test-public-store-browser.mjs` nhận `--playwright-module <đường dẫn tuyệt đối đến playwright/index.js>` và `--output <thư mục bằng chứng mới>`. Driver tự chạy Backend/Vite trên 3389/5189, Chrome headless, tạo catalog tổng hợp và đóng tiến trình do nó tạo khi kết thúc. Đặt `SEARCH_SYNC_ENABLED`, `SEARCH_RECONCILIATION_ENABLED`, `PRODUCT_IMAGE_REPAIR_ENABLED`, `ORDER_AUTO_COMPLETE_ENABLED`, `NOTIFICATIONS_WORKER_ENABLED` thành `false`, cung cấp hai JWT secret QA riêng. Driver chỉ chấp nhận app-role và các tên database QA đã allowlist trong mã (v971 ở lượt này); không nới thành URL tùy ý.

Thành công phải có `report.json` với source hashes và bốn nhóm viewport/theme. Ảnh Product là SVG fixture được chặn trong Chrome; không tuyên bố đây là kiểm upload ảnh. Các POST `/auth/refresh` của bootstrap ứng dụng được tách khỏi thao tác Store; mọi POST nghiệp vụ khác bị kiểm tra. Không chạy full E2E cùng lúc với browser driver vì chúng cùng tạo fixture.

## Các luồng demo và cờ

| Luồng | Cấu hình / ranh giới |
|---|---|
| Store công khai | `/stores/:storeId`, không cần đăng nhập; Store ACTIVE và chủ hoạt động, Product theo public policy. Không có cờ ghi mới. |
| COD/Order/hậu mãi | Cờ Buyer/Seller Order và hậu mãi theo `.env.example`; server vẫn kiểm quyền/trạng thái. Giao vận và hoàn tiền là mô phỏng. |
| Accounts/Attributes/Admin | Dùng Admin QA riêng và fixture của miền; không lấy tài khoản thật làm fixture. |
| Chat/Review/onboarding | Cần bật các cờ Web tương ứng trong `.env.example` cho cấu hình demo riêng. Chat Product/Order có cờ ngữ cảnh riêng; không tự gửi khi mở từ Product/Order. |
| In-app notifications | Cờ Backend/worker/Web phải phối hợp. Email nghiệp vụ vẫn chưa có, email Auth không thay thế. |
| Google/email/OTP | Cấu hình riêng theo contract từng miền. Google cần Client ID/secret ngoài repo; OTP chỉ sandbox mô phỏng. Không bật Auth email mà thiếu adapter/cấu hình liên quan. |
| Search bằng ảnh | Cần AI/model/index đã chuẩn bị và cờ Web; Store/COD QA không chứng minh AI hoạt động. |
| VNPay | Mặc định tắt; cần merchant riêng, IPN HTTPS và provider acceptance. Callback ký tổng hợp chỉ là QA local, không thay IPN thật. |

Không bật đồng loạt mọi cờ mà chưa có cấu hình/dữ liệu tương ứng. Cờ Vite được đọc lúc khởi động/build; đổi cờ phải chạy lại Web.

## Bằng chứng và phần còn thiếu

[Checkpoint SRS ngày 28/10](release-srs-checkpoint-2026-10-28.md) tách code đã merge, nhánh đang làm và P1 chưa hoàn thành. [Contract Store](../api/public-store.md) ghi trường công khai, cursor và lỗi.

Gallery local `artifacts/release-qa-20261028/index.html` mở được khi không chạy Backend; ảnh/log/artifact sinh tự động không commit. Bản ngày 28/10 có 10 ảnh chọn từ 45 ảnh COD/hậu mãi/Dashboard, SHA-256 trong manifest. Ảnh thiết kế/Figma và ảnh runtime phải được ghi nhãn riêng; chưa có video trong lượt này.
