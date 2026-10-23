# Trạng thái và đường găng Frontend/QA Admin giai đoạn 3 — 22/10/2026

Tài liệu này gom phần Hiền có thể làm độc lập và dependency cần Hoàng/Đạt bàn
giao. Không thay contract, không tự chuyển `NOT_RUN` thành PASS và không nhận
toàn bộ Admin/giai đoạn 3 đã nghiệm thu.

## Đã có bằng chứng

| Module | Phạm vi đã kiểm | Kết quả | Giới hạn |
|---|---|---|---|
| Accounts #86 | Hai profile Admin độc lập đọc danh sách, filter/pagination, phiên tách biệt, logout/direct route; đối chiếu DB | PASS phạm vi đọc; digest trước/sau `5d5b843efe6637e4b021b3b56f560b98` | Khóa/mở NOT_RUN |
| Attributes #73/#77 | Admin đọc list/detail/options, inactive/filter/cursor, Buyer bị chặn, logout/reload; đối chiếu DB | PASS phạm vi đọc; digest trước/sau `b56473a1208377a9242641b6d9bd2c40` | CRUD/race/job/Search NOT_RUN |
| Brand/Category #71 | Tạo/chỉnh/tắt-bật fixture qua UI, Backend/PostgreSQL riêng | PASS theo bằng chứng PR #71 | Không đại diện Attributes |
| Search Health UI | Route/adapter đã nối Backend #89; quyền Admin, parser, cache/timeout/revoke và FastAPI thật chưa tải model/index | IN_PROGRESS; API integration PASS | READY/DEGRADED với deployment model/index thật còn NOT_RUN |

## Việc có thể hoàn thiện độc lập

- Giữ Search Health UI sẵn sàng rebase; chạy test/lint/build trên code local.
- Hoàn thiện checklist Attributes AT01–AT34, fixture và mẫu evidence; không bật
  nút ghi trước Backend CRUD.
- Chuẩn bị checklist Accounts khóa/mở: self-lock, last-active-Admin, reason/audit,
  optimistic concurrency, session revocation, hai Admin race và rollback.
- Giữ manifest QA không nhạy cảm: commit FE/BE, migration, DB alias, fixture IDs,
  browser/viewports, expected/actual và mục chưa chạy.

## Dependency đang chặn nghiệm thu

1. **Search Health:** #89 đã merge và UI đã nối. Còn cần deployment QA có
   model/index/Elasticsearch thật để chốt READY/DEGRADED end-to-end.
2. **Attributes ghi:** #83/#91/#92 và Backend CRUD đầy đủ phải merge; cần fixture,
   migration, audit/job/race harness. API đọc không đủ để bật editor ghi.
3. **Accounts khóa/mở:** Backend phải bàn giao bảo vệ self/last Admin, reason/audit,
   concurrency và vô hiệu phiên; PATCH cơ bản không đủ nghiệm thu.
4. **Dashboard và hậu mãi:** cần contract/API riêng; không dùng số mẫu để nhận PASS.

## Checklist Accounts khóa/mở sau bàn giao

| ID | Ca kiểm | Kỳ vọng | Hiện tại |
|---|---|---|---|
| ACC-W01 | Admin khóa/mở User/Seller kèm lý do hợp lệ | DB/audit đúng actor/reason; UI cập nhật từ response thật | NOT_RUN |
| ACC-W02 | Admin tự khóa hoặc khóa Admin active cuối cùng | Backend từ chối; không mutation/audit lẻ | NOT_RUN |
| ACC-W03 | Hai Admin đổi cùng account/version | Một thắng, một stale/conflict; không lost update | NOT_RUN |
| ACC-W04 | Khóa account đang đăng nhập | Access/refresh bị vô hiệu theo contract; reload/direct route không còn quyền | NOT_RUN |
| ACC-W05 | 400/401/403/409/5xx/timeout và mất response sau commit | Không double-submit/auto retry mù; unknown buộc reconcile | NOT_RUN |
| ACC-W06 | Lỗi audit/transaction | Rollback status/audit/session epoch toàn bộ | NOT_RUN |

## Thứ tự ngắn nhất để hoàn tất

1. Hoàng review/merge PR Search Health UI; sau đó chạy loaded-runtime QA để chốt
   READY/DEGRADED end-to-end (không dùng ảnh fixture làm bằng chứng live).
2. Merge/bàn giao Attributes CRUD → Hiền nối editor hiện có, QA AT01–AT34 theo
   phần thực sự triển khai.
3. Bàn giao Accounts status hardening → Hiền bật khóa/mở và chạy ACC-W01–06.
4. Chốt contract/API Dashboard và hậu mãi → nối UI, QA, rồi tổng hợp nghiệm thu
   toàn Admin. Mỗi module merge riêng; không chờ tất cả mới bắt đầu module đã đủ.
