# Accounts — durable invalidation theo Store ownership

## Lỗi và bản sửa

Nền develop2f78a98. AuthService.updateAccountStatus trước đây chỉ enqueueSeller
khi current role SELLER. Một account sở hữu Store nhưng role hiện là USER/ADMIN
vẫn phải invalidation theo ownership; dùng role làm điều kiện có thể bỏ mất job.
Contract #76 đã yêu cầu xác định Store sở hữu từ DB.

Thay điều kiện bằng tx.store.findUnique(sellerId), trong cùng transaction với
update User và enqueueSeller. Key SELLER của job là scope theo owner ID, không
phải quyền cho phép account truy cập Seller API. Không mở quyền USER/ADMIN bán hàng.
Không gọi trực tiếp ES/FAISS và không sửa Store.status hoặc trạng thái Order.

No-op giữ nguyên return và không lookup/write/job. Account đổi thật mà không
Store không tạo job. Lỗi lookup/enqueue làm transaction thất bại, không trả success.
Worker hiện hữu đọc canonical Product; PENDING job không nghĩa index đã sync.

## Kết quả

- Frozen offline install PASS, không đổi lockfile.
- Unit mới7PASS; full Backend690PASS/31files (đã bao gồm7).
- PostgreSQL17 riêng5549, DB mới bckl_order_resolution_test_accountowner,
  14fresh migrations PASS; 5service/transaction tests +15Accounts HTTP đọc PASS.
- Ba role USER/ADMIN/SELLER sở hữu Store: lock/unlock đều có durable job; Store
  SUSPENDED giữ nguyên. Enqueue lỗi rollback cả isActive/updatedAt, không job.
  No-op không đổi timestamps/job. Fixture do suite tạo được cleanup theo ID riêng.
- Lint/build/diff-check PASS. Không DB demo5432.

Test5ca mới gọi service thật và PostgreSQL, không phải HTTP authorization proof.
15HTTP tests là API list cũ. Full E2E/browser/live ES/FAISS chưa chạy ở lượt này.

## Chưa hoàn thành

Không nhận toàn bộ Accounts status hardening đã xong. PATCH cũ còn thiếu
expectedRevision/reason/audit, chống tự khóa/Admin cuối và sessionEpoch.
Không bật UI khóa/mở mới. Migration/rollout legacy token và protocol mọi writer
phải được review trước khi triển khai đầy đủ theo #76.

Phương án cần review: khi phát hành epoch, token không có epoch phải đăng nhập
lại rõ ràng; không fallback epoch0 vĩnh viễn. Lock tăng epoch/revoke refresh
atomic; unlock không hồi sinh access/refresh cũ. Refresh đang chạy phải kiểm
epoch/current actor trong transaction trước persist token. Đây là đề xuất kỹ
thuật, chưa đổi JWT/schema hoặc nhận acceptance đã PASS.
