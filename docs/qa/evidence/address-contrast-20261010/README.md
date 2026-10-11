# Address: contrast retest — 2026-10-10

Sửa cục bộ `AddressBookPage.module.css`: khung nền trắng, chữ tối, native controls theo light color-scheme trong phạm vi màn Address; không sửa theme/global CSS, API hoặc schema.

## Bằng chứng

- Frontend: PR #49, base HEAD `9b447c02202e002c99a6cb98a7c1b39c3285f945` cộng bản sửa CSS trong commit chứa tài liệu này.
- Backend thật: QA PR #51 HEAD `e15af4467f9614b5c2a29e6647caf3a1b5637f04`, PostgreSQL riêng, không dùng database demo.
- Browser đang dùng dark preference; root vẫn `rgb(22, 23, 29)`. Heading Address `rgb(32, 36, 43)` trên khung trắng; input trắng/chữ tối, color-scheme light.
- Desktop 1280 × 900 và mobile viewport 390 × 844: tiêu đề/list/form đọc rõ, không tràn ngang. Mobile là giả lập viewport, không phải thiết bị vật lý.
- Test 46/46 (9 files), lint, build và diff whitespace: PASS sau sửa CSS.
- Đã mở form thêm rồi hủy; không tạo đơn hàng. Đây là retest CSS, không chạy lại toàn bộ QA nghiệp vụ.

Ảnh chỉ chụp vùng tiêu đề cần đối chiếu, loại vùng tài khoản/địa chỉ QA. Không đăng credentials, cấu hình hoặc dữ liệu đăng nhập. Hai frontend Address/Cart được chạy lần lượt, không phải một bundle đã tích hợp.

### Desktop

![Address desktop, cropped to heading](desktop.jpg)

### Mobile

![Address mobile, cropped to heading](mobile.jpg)

## Giới hạn

Không kết luận Cart → Checkout end-to-end PASS. Không ép browser sang light/forced-colors. Chưa thay đổi theme hoặc Header chung. Cần Hoàng re-review bản sửa và quyết định merge theo CI hiện tại.
