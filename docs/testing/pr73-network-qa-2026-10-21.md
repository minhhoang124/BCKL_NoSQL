# Attributes #73 — bổ sung QA mạng và timeout

Ngày21/10/2026. **Read-only DEV QA**, không nghiệm thu toàn Attributes/Admin/G3.

## Bản được kiểm và phạm vi

- Head thực chạy: `5689e3c2f699aca316a0bb89ef7d0f717309b8d2`, nền develop
  `d84381a7838a5d0bd343635f1a2262a534e381b7`.
- Lượt bàn giao sau kiểm chỉ thêm tài liệu; không sửa code FE/BE, contract,
  migration, shared Auth/client, Catalog production hoặc bật tạo/sửa.
- Giữ nguyên hai tài liệu local đang sửa dở của Hiền, không stage chúng.
- Đối chiếu adapter timeout15s, reader list/detail/options và snapshot PostgreSQL
  thật. Không dùng transport preview hoặc test mock thay bằng chứng DB.

## Môi trường và cách gây lỗi

Trang DEV hiện có dùng AuthProvider/LoginPage/shared client và ba GET thật;
Frontend, Backend Nest và PostgreSQL17 trên máy QA riêng. Fixture tổng hợp
5definitions/5options,16migration giữ nguyên, không reset/seed hoặc DB demo.

Launcher ngoài Git trì hoãn đúng GET list/detail/options20s **trước Nest handler**;
không sửa status/DTO/role, không thay response bằng dữ liệu giả. Ca mất kết nối
dừng và khởi động lại duy nhất tiến trình Backend QA đã tạo; không đổi network
settings, Docker hoặc Backend khác. Gate cuối trở về pass, dịch vụ chạy lại.
Trace chỉ chứa method/path/status/cache/thời gian, không credentials/token/cookie.

## Bằng chứng mới

| Ca | Kết quả thực chạy |
|---|---|
| List timeout | Client đóng GET chưa hoàn tất sau15003ms; UI báo lỗi an toàn, bỏ danh sách và detail cũ; retry phục hồi đúng2dòng đầu |
| Detail timeout | Đóng GET sau15005ms; bỏ detail/options, giữ danh sách đã đọc hợp lệ; chọn lại đọc revision6/usage2 và2options thật |
| Options trang2 timeout | Đóng GET sau15007ms; bỏ toàn detail/options, không nối trang cũ; chọn lại rồi tải2→4→5options đúngDB |
| Backend ngừng, tải options | Hiện lỗi và bỏ detail/options, không hiển thị0 như đã đọc thành công |
| Backend ngừng, đọc detail | Hiện lỗi, không giữ detail cũ như dữ liệu mới |
| Backend ngừng, tải list | Bỏ danh sách/detail và hiện thông báo tải thất bại |
| Backend phục hồi | Tải lại list→chọn definition→đọc đủ5options; revision6/usage2/flagsfalse và usage0/1 khớpfixture |
| Bất biến DB | Category/definition/option/Product/ProductValue trước=sau; audit/outbox/job/Order vẫn0; không request ghi Admin |
| Bất biến source | Hash FE/BE build trước=sau khớp manifest và head5689e3c |
| Hồi quy chọn lọc | **52PASS/3files**,5.55s:43reader/adapter +9DEVentry; không cộng vào tổng fullsuite cũ |

Lỗi hiển thị: “Không tải được cấu hình. Hãy thử tải lại; chưa có dữ liệu để kết
luận.” Phần chi tiết/options có lỗi không được giả là dữ liệu mới; danh sách
đã đọc hợp lệ không bắt buộc bị xóa khi riêng detail/options lỗi.

Trace ghi `completed=false` tại ba mốc timeout. Không cưỡng ép response muộn
qua socket đã abort hoặc gọi release sau20s là response UI nhận được. Đây là
thử hạn15s ở adapter trên GET bị trì hoãn, **không** phải PostgreSQL statement
timeout/rollback hoặc bằng chứng concurrent revision qua một writer thật.

Không phát hiện lỗi cần sửa ứng dụng. Không chạy lại full821FE/lint/build trong
lượt này vì source không đổi; các kết quả đó ở [báo cáo trước](pr73-live-read-qa-2026-10-21.md)
giữ baseline/lượt chạy riêng, không nhận thành test mới.

## Artifact và giới hạn

Artifact local ngoài Git nhóm `attributes-network-qa-20261021`: manifest,
snapshot trước/sau, trace, browser-proof, verification-summary và ảnh ba timeout,
mất kết nối/phục hồi. Không đưa nguyên thư mục setup, cấu hình riêng hoặc tài
khoản QA lên GitHub; đường dẫn local không là môi trường truy cập cho máy khác.

- Hai Admin hai browser/profile độc lập vẫn **NOT_RUN**, Hiền để cuối.
- Concurrent revision với API ghi, mất quyền/refresh giữa request, SQLtimeout/
  HTTP5xx cụ thể, Catalog production và toàn luồng ghi vẫn chưa nghiệm thu.
- Không bật tạo/sửa, gọi PATCHlegacy, thay gate hoặc nhận toàn Admin/G3 DONE.
- Nhờ Hoàng re-review head bàn giao tài liệu mới, chốt phạm vi read-only và
  bước tiếp theo; giữ Draft, không tự approve/Ready/merge PR của mình.
