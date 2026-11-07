# #87/#90/#89 sau merge Accounts #86 và Attributes read #73

Ngày21/10/2026; nền develop chính thức `be568e0` sau `e409335`.
Normal merge, không rebase/force, conflict chỉ ghi chú kiến trúc; đọc và giữ
cả hai phía, giữ #88 đã merge. Không nhận migration uniqueness mới ở nhánh khác.

| PR | Head trước đợt sync này | Full unit chạy lại | E2E chọn lọc chạy lại |
|---|---|---|---|
| #87 Seller attributes | `27182fb` |765 PASS/34files,15.97s|33 PASS/3files,12.42s|
| #90 upload security | `20ecd50` |803 PASS/37files,18.75s|32 PASS/3files,15.51s|
| #89 Backend Search health | `fd7ac76` |812 PASS/36files,18.15s|35 PASS/3files,13.19s|

Mỗi E2E chọn lọc gồm Accounts list + Admin Attributes read và suite riêng:
seller-attribute-coherence, product-import hoặc admin-system-health.
Chạy tuần tự trên DB QA v904, không reset/đổi schema mới. Các lỗi được cố ý
tiêm trong tests xuất hiện ở log, không phải lỗi ngoài kiểm soát. Demo giữ tắt;
không test/connect/migrate/dọn DB demo, không đưa profile/secret vào Git.

Backend source/tests/Prisma/AI mỗi nhánh không đổi so head trong bảng;
#90 giữ cả lockfile upload patch. FE mỗi nhánh nguyên byte develop be568e0.
Full FE822PASS/6liveSKIP đã chạy trên source đó khi kiểm bản kết hợp #73;
không mô tả là ba lượt FE chạy độc lập. Chưa browser mới. Không nhận 6SKIP là PASS.

Full Backend E2E của đợt trước #88 có baseline/báo cáo riêng:
[#87](pr87-post88-sync-2026-10-21.md),
[#90](pr90-post88-sync-2026-10-21.md),
[#89](pr89-post88-sync-2026-10-21.md). Lượt mới này chỉ chạy E2E chọn lọc,
không nâng số test đó thành full E2E rerun.
Native Backend→FastAPI smoke của #89 trong báo cáo trước cũng không phải lần
chạy mới ở lượt sync này; source/contract không đổi, chưa all-ready ES/CLIP/FAISS.

Lint/typecheck/build/diff trên ba bản kết hợp đã đạt trước commit/push;
CI và re-review đúng head mới vẫn là gate. Không merge bằng approval head cũ,
không bật Catalog writes, health UI, shared writer fence hay tự đổi phạm vi.
