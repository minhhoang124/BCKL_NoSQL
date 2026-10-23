# Search Health UI fixture QA — 22/10/2026

Trạng thái: **PREPARATION**, chỉ kiểm cách giao diện diễn giải fixture. Tất cả ảnh
trong tài liệu này đều mang nhãn **KHÔNG PHẢI DỮ LIỆU LIVE**. Kết quả không xác
nhận Backend #89, FastAPI, Elasticsearch, FAISS hoặc PostgreSQL đang hoạt động.

## Kết quả giao diện fixture

| Ca | Desktop | Mobile | Kết quả |
|---|---:|---:|---|
| READY | PASS | PASS | Hiện riêng PostgreSQL, Search, ba capability và bốn component |
| DEGRADED | PASS | PASS | Badge suy giảm và reason code không bị đổi thành lỗi tổng quát |
| UNAVAILABLE | PASS | PASS | Hiện không khả dụng; không tô PostgreSQL lỗi theo Search fixture |
| UNKNOWN / AI mất kết nối | PASS | PASS | Không bịa trạng thái component khi thiếu snapshot hợp lệ |
| Snapshot hết hạn | PASS | PASS | Hiện UNKNOWN và “Kết quả đã hết hạn” |
| Index trống | PASS | PASS | Hiện cảnh báo “Index đang trống”, vector count bằng 0 |
| Loading và tải lại | PASS | PASS | Nút bị khóa khi đang tải; tải lại chỉ gọi adapter Backend |
| Lỗi quyền | PASS | PASS | Thông báo 403 không lộ nội dung lỗi và khóa lần đọc tiếp theo |
| Đổi phiên khi request đang chờ | PASS tự động | PASS tự động | Response của phiên cũ bị bỏ bằng `AuthSessionChangedError` |

Điểm sửa sau kiểm hình: khóa màu tiêu đề trong module để dark preference không
làm chữ mất tương phản; thu gọn badge/card và dải cảnh báo fixture ở breakpoint
mobile. Không thay theme toàn hệ thống.

## Ảnh minh họa PREPARATION

- [Desktop READY](screenshots/admin-search-health-preparation/desktop-ready.png)
- [Desktop snapshot hết hạn](screenshots/admin-search-health-preparation/desktop-stale.png)
- [Mobile UNAVAILABLE](screenshots/admin-search-health-preparation/mobile-unavailable.png)
- [Mobile index trống](screenshots/admin-search-health-preparation/mobile-empty-index.png)

## Kiểm tra tự động trên source hiện tại

- Search Health: 10/10 test PASS, gồm parser/endpoint, actor, refresh, UNKNOWN,
  loading, stale, empty index, 403 và đổi phiên.
- Toàn Frontend: 833 PASS, 6 live SKIP.
- Build production: PASS.
- Lint: PASS với 5 cảnh báo `set-state-in-effect` có sẵn tại
  `AdminDashboardPage.tsx`; không phát sinh cảnh báo mới từ Search Health.

## Chưa được nghiệm thu

Các ca SH-UI01–10 trong
`admin-search-health-ui-preparation-2026-10-22.md` vẫn **NOT_RUN** với môi trường
thật. Sau khi #89 merge phải đồng bộ lại `develop`, chạy lại toàn bộ kiểm tra và
QA UI → Backend → FastAPI/Elasticsearch/FAISS/PostgreSQL; không tái sử dụng ảnh
fixture này để tuyên bố bản tích hợp mới đã PASS.
