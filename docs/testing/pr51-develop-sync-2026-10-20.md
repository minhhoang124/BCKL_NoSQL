# PR #51 — đồng bộ develop ngày 20/10/2026

## Phạm vi

Nhận develop `2f78a986265bbeed8341b164493c9dcac0e774fb` vào nhánh
`codex/address-cart-handoff`, từ head `47fe1fd`.
Không thay đổi logic script prepare/serve/verify hoặc nghiệp vụ Backend.

Giải quyết conflict bằng cách giữ cả hai phía:

- CI: giữ kiểm tra guard Address/Cart và Python evaluation tools.
- README Backend: giữ hướng dẫn QA và API Order/COD mới.
- Kiến trúc: giữ công cụ QA lẫn các mục runtime Order, Brand, Accounts và health.
- Runbook: cập nhật nền hiện tại; không nhận API smoke là nghiệm thu UI.

## Kiểm tra thực tế

| Kiểm tra | Kết quả |
| --- | --- |
| Guard QA Node tests | 10 PASS |
| Backend lint | PASS |
| Prisma generate + Nest build | PASS |
| Backend unit | 683 PASS / 30 files |
| prepare/serve/verify với PostgreSQL trên bản kết hợp | NOT_RUN |
| Browser Address/Cart/Checkout | NOT_RUN |

Lần chạy unit trong sandbox dừng trước collection do EPERM khi đổi tên cache
tạm của Vitest; chạy lại ngoài sandbox đạt đầy đủ, không sửa test để né lỗi.
Log lỗi giả lập health/Search trong unit không phải lỗi assertion.

Checkout có cấu hình QA ignored tồn tại từ trước. Không ghi đè, không in secret,
không tự dùng lại database đó; lượt API mới cần checkout/cấu hình và DB QA riêng.
Không dùng database demo cổng 5432.

## Gate

Approval cũ không thay review bản hợp nhất. Chưa merge #51; cần reviewer kiểm
head mới và CI sau push. Không coi việc sync này là toàn bộ Checkout/Order đã QA.
