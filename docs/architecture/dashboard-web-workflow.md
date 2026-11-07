# Dashboard Web Admin/Seller —26/10/2026

Nhánh `codex/dashboard-web` từ develop `7f735a6` sau #120. Nối
[API Dashboard đã merge](../api/dashboard-runtime.md), không thay Backend,
schema, Auth hoặc mở cờ giao dịch khác.

Admin xem ở `/admin`, dưới các việc cần xử lý hiện hành. Seller chọn tab
**Thống kê** trong `/seller`; Store CLOSED vẫn đọc lịch sử theo quyền Backend.
Không gọi trực tiếp PostgreSQL/AI/Search từ trình duyệt.

## Luồng và trạng thái

- Mặc định tháng hiện tại theo UTC+7, ngày kết thúc exclusive. Bộ lọc ngày/
  tháng/quý chỉ gửi khi chọn Xem thống kê; khoảng tối đa366 ngày. Draft bộ lọc
  không thay nhãn của số liệu đã tải. Phản hồi phải khớp scope/Store/range/
  timezone/currency/bucket và từng cửa sổ kỳ.
- Tiền được kiểm và cộng/trừ bằng BigInt cents, định dạng chuỗi; không Number
  hoặc float. Net phải bằng gross-refund và tổng buckets khớp totals; số count
  phải là safe integer. Lỗi dữ liệu không được đổi thành0 hoặc hiển thị một phần.
- Doanh thu hàng, refund effective, net, shipping và pending lifetime trình
  bày riêng. Net âm hợp lệ khi refund kỳ sau. Nhãn ghi rõ refund mô phỏng,
  không phải lợi nhuận/settlement. Các count hiện tại khác với count đơn tạo
  trong kỳ, không diễn giải như lịch sử chuyển trạng thái.
- Mỗi lần tải bỏ số liệu cũ, hủy request cũ và tăng generation. Thất bại chỉ
  cho read-retry, không có mutation trong module này. Snapshot query bất biến
  trước await, response cũ không ghi đè range mới.
- Màn hình remount theo actor/role/session epoch/Store. Đọc còn chờ kiểm lại
  epoch/generation/unmount/abort trước cập nhật state. 401/403 dừng thao tác,
  bỏ dữ liệu và hướng dẫn đăng nhập lại; 404 Seller giải thích chưa có Store.

## Đối chiếu và hiển thị

Data-quality dùng đúng range đã tải, limit20, cursor giảm exclusive. Một flight
mỗi lượt đọc; đổi range hủy pagination cũ. Response kiểm Store và mã lỗi,
không giữ trường Buyer riêng tư. Trang đối chiếu có thời gian snapshot riêng,
không giả nó nguyên tử với summary từ request trước. Lỗi đọc trang sau cho
phép đọc lại từ đầu, không tự thay số liệu tài chính.

Bảng theo kỳ cuộn ngang trong khung trên mobile. Section Dashboard hỗ trợ
data-theme dark, có nền riêng để giữ tương phản trong Admin shell hiện tại;
chưa đổi toàn bộ theme của website hay thêm bộ chuyển theme toàn sàn.

## Bàn giao và giới hạn

[Kiểm thử và Chrome QA](../testing/dashboard-web-2026-10-26.md). Chưa UI hậu mãi,
thông báo, export hay settlement/provider refund; không nhận toàn dự án DONE.
Dataset QA lịch sử là synthetic, khác với chứng minh checkout giao dịch thật.
Không có migration mới; giữ yêu cầu đủ27 migration của nền #119/#120 khi deploy.
