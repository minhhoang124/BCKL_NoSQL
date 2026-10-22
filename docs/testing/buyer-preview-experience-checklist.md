# Rà trải nghiệm #40 — 09/10/2026

**CODE/DOM CHECK ONLY — chưa có visual audit.** Product Design audit yêu cầu
ảnh chụp thực tế; công cụ Browser lỗi `failed to write kernel assets` trước khi
mở trang. Không có ảnh chụp được chấp nhận và không kết luận desktop/mobile PASS.

## Các bước cần kiểm trên trình duyệt

| Bước | Màn/kiểm tra | Kết quả hiện tại |
|---|---|---|
| 1 | Desktop 1440×900: Checkout, đọc nhóm Store/tổng/COD/nhãn giả lập | Browser NOT_RUN; DOM có dữ liệu và nhãn |
| 2 | Mobile 390×844 và 320×568: không cuộn ngang/cắt giá, label/select, nút dễ bấm | NOT_RUN; CSS breakpoint không phải bằng chứng |
| 3 | Giá đổi/thiếu kho/unknown: ẩn tổng, khóa bước tiếp, hướng dẫn phục hồi | DOM test có; browser NOT_RUN |
| 4 | Result: receipt khác tracking, mất response không tạo key mới | DOM test có; browser NOT_RUN |
| 5 | List/detail: lọc rỗng, lỗi/tải, quay lại, đổi Order không giữ thông báo đơn cũ | DOM một phần; browser/keyboard NOT_RUN |
| 6 | Cart → Checkout: chỉ selected Variant/quantity, owned address, back giữ tập chọn | Chưa nối Cart; end-to-end NOT_RUN |

## Sửa chuẩn bị từ rà code (không phải phát hiện qua screenshot)

- Làm rõ tập chọn Cart hiện chỉ là fixture; không dựng link chết đến màn Cart
  chưa có hoặc viết màn Cart thay Hiền. Contract handoff: selected Variant và
  quantity; Backend tính tiền, không tin tổng từ frontend.
- Detail được key theo demoId để reset state/error/notice khi chuyển đơn.
- Nav đang chọn có nhấn mạnh bằng CSS theo aria-current; thêm wrap nội dung
  dài. Chưa đo contrast, zoom 200%, focus/thứ tự Tab hoặc screen reader.

## Acceptance trước nối API

Chụp và đọc ảnh từng bước desktop/mobile ở đúng state, kiểm focus bàn phím,
loading/error/empty/retry, back/reload, giá dài, tên dài; ghi actual/expected.
Hiền/Hoàng thống nhất Cart handoff sau khi màn của Hiền sẵn sàng. Sau đó mới
nối #36/#37 và detail/command được review; không lấy fixture làm PASS giao dịch.
