# Đồng bộ #43 sau #53 — 12/10/2026

Merge develop `41450b4` vào head đã review `2b20b89`, không rebase/force-push.
Conflict chỉ ở system-architecture-overview; giữ mô tả C2 và bổ sung nền
DeliveryAttempt #45, Address #49, Auth #52 và client #53 từ develop.
Không sửa source Order/configure-app; không sửa SQL/checksum migration dùng
chung. #42/#43 chưa merge khi kiểm thử; không gộp detail chưa merge vào #43.

Kiểm trên cây đã đồng bộ: frozen install, BE typecheck/lint/build,
Prisma validate, 411/411 unit, 406/406 E2E (22 suite), FE 75/75 test,
lint/build và diff-check PASS. E2E dùng PostgreSQL QA riêng port 5549,
database bckl_checkout_web_20261012; không thao tác demo. Database QA có thêm
completion-job migration từ lượt tích hợp trước; không coi đây là kiểm fresh
database đúng tập migration branch. CI sau push kiểm fresh riêng.
Cảnh báo pg query đang thực thi vẫn có; fault-injection logs là ca kiểm lỗi.

Hiền đã approve ba quyết định ở head trước: Store SUSPENDED được xử lý đơn
cũ nếu Seller active; receipt timeline chỉ transition của command; quota
20/phút/actor/instance gồm replay, không thay bảo đảm PostgreSQL chống trùng.
Các câu hỏi review trong mô tả lịch sử phải hiểu theo thời điểm đó.
Chưa chạy browser/full Order journey; không nâng G-FULFILMENT DONE.
Review/CI cần đối chiếu head merge mới. Kết hợp #42/#43 sau merge vẫn cần test
tích hợp riêng để giữ cả controller đọc detail và command.
