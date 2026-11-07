# Đồng bộ #68 sau Brand và tooling — 18/10/2026

Đầu vào: Seller `acbf28f`; develop `aa62c84` gồm Brand #64, evaluation #25,
preflight #34/#35 và Chat readiness #41. Approval Hiền tại `acbf28f` không tự
nghiệm thu cây kết hợp mới. Giữ cờ Seller QA mặc định false.

## Giải conflict / ranh giới

Chỉ conflict `docs/architecture/system-architecture-overview.md`: giữ Seller
Web/runtime evidence và toàn Brand/lịch sử/nền mới; thêm mốc đồng bộ hiện tại.
Không chọn bỏ toàn bộ một phía. Source Seller, harness, `.env.example` không
đổi so `acbf28f`; các additions Brand giữ từ develop. Backend/Prisma/AI và
lockfile phải khớp develop; không schema/API hoặc nối Buyer #69/#70.

## Kiểm chứng mới

Chạy mới trên cây kết hợp:

- FE threads/maxWorkers1: **555 PASS / 6 live SKIP**, 35 file PASS / 1 SKIP,
  64.96s; lượt chờ lâu vẫn hoàn tất exit0, không bị hủy hoặc sửa timeout.
- FE runner mặc định đối chứng: **555 PASS / 6 SKIP**, 12.87s, exit0.
- FE lint và TypeScript/Vite build PASS, 5 warning Admin nền giữ nguyên.
- Backend unit **629 PASS / 27 file**; Prisma validate và Nest build PASS.
- Evaluation tool10/10 và preflight9/9 PASS; harness `node --check` PASS.
- Source identity checks PASS: source Seller/harness/env giống acbf28f;
  Backend/Prisma/AI/lockfile khớp aa62c84; không còn unmerged entry.

Backend unit có log nhánh lỗi mô phỏng, không phải health/DB live failure.
Không đổi runner cấu hình repository hoặc tắt test để đạt. Browser/Nest/
PostgreSQL mới **NOT_RUN**; 6 nhóm live tác giả trước đây và review Hiền là
bằng chứng head cũ, không tự chuyển thành live PASS cho bản đồng bộ này.
Không đụng database demo, migrate/reset hoặc artifact runtime.

Chỉ push sau diff/source-identity/conflict checks và regression phù hợp. Gửi
Hiền review delta và CI đúng head mới; không merge chỉ dựa approval cũ.
