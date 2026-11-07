# Bàn giao chuyển máy — 28/10/2026

## Điểm tiếp tục

Nhánh `codex/store-search-analytics`, nền `develop` tại `a88a11d1af7cefb2a82728cfc561ec219c5e62f6` (#132 email nghiệp vụ). Công việc tiếp theo đang khép FR-RPT-02: thống kê số thẻ Product được hiển thị/nhấp trong tìm kiếm, Seller chỉ Store của mình, Admin tổng hợp. Không đổi Backend–AI wire hay phạm vi đánh giá7 truy vấn.

Mã nguồn runtime, migration38, Web tracking/report, test và contract được đưa lên nhánh này. Chưa tính là đã tích hợp `develop` khi chưa merge. Collection mặc định tắt. Báo cáo chỉ gồm mẫu đã ghi nhận, không phải toàn bộ lưu lượng hoặc bằng chứng chất lượng AI.

Đọc tiếp: [contract](../api/store-search-analytics.md), [bằng chứng kiểm thử](../testing/store-search-analytics-2026-10-28.md), SRS FR-RPT-02 và hướng dẫn an toàn QA hiện có.

## Lấy mã trên máy mới

1. Clone/fetch `grumhu124/BCKL_ThuongMaiDienTu`, checkout `codex/store-search-analytics`; kiểm `git status` sạch và `git log -1` khớp remote. Không chép đè checkout có thay đổi chưa lưu.
2. Đọc README → architecture overview → work assignment → implementation scope → business processes → CONTRIBUTING → delivery guide → AI contract → Product domain/implementation plan. Tuân thủ AGENTS.md hiện hành.
3. Dùng Node/pnpm theo repository và `pnpm install --frozen-lockfile`. `pnpm --dir BE run build` sinh Prisma client/build Nest; `pnpm --dir FE run build` kiểm TypeScript/Vite.
4. Dựng PostgreSQL QA riêng, local chỉ loopback5549; migration bằng tài khoản migrator QA, app bằng role không superuser/CREATEDB/CREATEROLE. Không khởi chạy test nếu chưa xác minh đích. Không nạp `.env` demo vào runner. Chỉ chạy `prisma migrate deploy`, không sửa migration cũ hoặc dùng reset/db push.
5. Unit: `pnpm --dir BE test`; Web: `pnpm --dir FE exec vitest run --pool=forks --maxWorkers=1`. E2E: `pnpm --dir BE run test:e2e` sau khi cấu hình DATABASE_URL QA rõ ràng; xem các helper guard trước khi chạy. Khi cần tên DB mới, bổ sung đúng một tên vào allowlist, không bỏ kiểm host/port/role.
6. Chrome: `scripts/test-search-analytics-browser.mjs --output <thu-muc-minh-chung-moi> --playwright-module <duong-dan-playwright/index.js>`. Cần Chrome, build BE hiện tại, role app QA và database demo dừng. Script mặc định chỉ nhận DB QA Chrome `_v977`; không trỏ tới DB có dữ liệu demo. Script dùng các cổng local3389/5189/3398 và tự đóng Nest/Vite/Chrome/AI stub khi xong. AI trong driver là provider tổng hợp; cần AI model/index thật nếu muốn bổ sung nghiệm thu provider, không đổi nhãn test giả lập thành live AI.

Các helper máy cũ trong `deliverables/` có đường dẫn cố định và private profile riêng; không dùng mù quáng trên máy mới. Test/driver đã commit mới là nguồn để dựng QA lại; sửa đường dẫn cục bộ một cách có kiểm chứng.

## Những gì Git không mang sang

- `.env`, secret JSON, private profile QA, database/container/volume, uploads, dataset lớn, model weights, embedding và FAISS index không được commit.
- Chuyển secret qua kênh riêng nếu cần. Google OAuth và VNPay private JSON nằm ngoài repo trên máy cũ; không dán giá trị vào chat hoặc PR. Không chép `.env` vào checkout QA.
- Ảnh/log minh chứng nằm dưới `artifacts/search-analytics-qa-20261028/` và `artifacts/search-analytics-browser-qa-20261028/`; nếu cần dùng báo cáo, sao chép riêng hai thư mục này. Bản nguồn và tổng kết kiểm thử có trong Git.
- Máy cũ giữ nguyên DB QA v975 (HTTP/full E2E), v976 (bản sao nâng cấp37→38, dữ liệu cũ được đối chiếu), v977 (Chrome riêng). Không tự xóa hoặc lấy các DB này thay cho DB demo. Container demo `bckl_postgres` được giữ dừng; không có thao tác sửa/xóa/khôi phục dữ liệu demo trong task này.

## Thứ tự sau khi tiếp tục

1. Đọc trạng thái PR/CI đúng commit mới, kiểm comment mới và đối chiếu bằng chứng. Không dùng approval của commit khác; không tự merge trái AGENTS.md hiện hành.
2. Nếu cần nghiệm thu AI thật, chạy riêng với model/index QA của Đạt, giữ rõ nguồn dữ liệu; kiểm cả tìm chữ/tìm ảnh, không mở collection toàn lịch sử.
3. Chỉ bật thu thập khi đã đặt cutoff UTC hợp lệ, duy trì retention và kiểm Seller/Admin trên cấu hình triển khai. Tắt không được trả0 giả; không xem số0 đã ghi là chứng minh không có lưu lượng.
4. Cập nhật SRS/checklist trạng thái sau tích hợp thật. VNPay provider IPN và dịch vụ email bên ngoài vẫn là các nghiệm thu riêng; không báo đã xong từ task Search này.

Tạm dừng sau khi đẩy nhánh theo yêu cầu chuyển máy. Không đặt automation hoặc tiếp tục task khác trong thời gian dừng.
