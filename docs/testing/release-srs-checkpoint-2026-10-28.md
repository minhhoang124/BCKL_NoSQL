# Rà phạm vi và kiểm thử ngày 28/10/2026

Nguồn phạm vi: `docs/project/implementation-scope.md`; đối chiếu `docs/analysis/hien/srs-v3.md`. P0/P1 vẫn là cam kết trước bảo vệ, không tự chuyển thành P2.

## Kết quả đã đọc bằng chứng

Nền `develop 532d79d` (#130). Đầu ngày và khi tiếp tục không có PR mở. Ba lượt CI develop gần nhất đã thành công khi rà đầu ngày; không suy ra CI cho thay đổi mới.

QA riêng PostgreSQL cổng loopback 5549, database v971, 36 migration, app-role không có superuser/CREATEDB/CREATEROLE. Không reset database hay dùng demo.

- COD Chrome: 4 tổ hợp desktop/mobile và sáng/tối, thêm một nhóm nối chính Order do Web đặt qua Seller xử lý, mô phỏng giao, Buyer hoàn tất, yêu cầu hậu mãi, Seller duyệt và Dashboard. Doanh thu 20000, hoàn tiền 20000, thuần 0; một refund/adjustment, refund-only không hoàn kho.
- Hậu mãi: 9 nhóm; mất phản hồi, reload/đối chiếu, từ chối/khiếu nại/Admin duyệt trả hàng, nhận hàng cạnh tranh, loại không được hoàn kho. Các ca lịch sử dựng sẵn không được gọi là cùng luồng đặt hàng Web.
- Dashboard: 9 nhóm; hoàn tiền khác kỳ, snapshot không hợp lệ và lỗi 503 phải xóa số cũ. Tổng 45 PNG của ba lượt được chấp nhận; chưa video.
- Review Argon Medium phát hiện oracle Dashboard chỉ kiểm thuần 0 có thể sai dương. Đã sửa: đợi đúng phản hồi kỳ đã chọn, kiểm cả gross/refund 20000 và net 0, kiểm số POST và bản ghi. Review delta không còn P1/P2; đây là review tự động, không giả danh approval thành viên.

Artifacts local không commit: `artifacts/release-qa-20261028/journey-1793148131521`, `aftersales-1793148162143`, `dashboard-1793148186306`.

## Phần đang khép và còn thiếu

| Phần | Trạng thái thực tế / việc tiếp |
|---|---|
| Store công khai P0 | Thiếu route/profile riêng trên nền đang rà. Nhánh hiện tại thêm API/Web dùng chung public Product policy; chỉ nghiệm thu sau HTTP, Chrome và tích hợp. |
| Accounts/Attributes/Chat/Review/onboarding | Mã đã có qua các PR merge; nhiều cờ mặc định tắt. Không coi mặc định mở toàn hệ thống; cần cấu hình demo và giữ bằng chứng từng miền. |
| Email thông báo nghiệp vụ P1 | Chưa adapter/queue email nghiệp vụ. Email verify/reset Auth không thay thế. Cần retry sau commit, dedupe theo sự kiện/người nhận/kênh, kiểm Mailpit; chưa nghiệm thu gửi ra ngoài. |
| Thống kê tìm kiếm Store P1 | Chưa API số lần xuất hiện/click theo Product/Store/chiến lược và kỳ. Dashboard doanh thu không thay thế. Cần chốt nguồn đo, dedupe, bot và quyền; không đổi AI wire ngầm. |
| VNPay sandbox P1 | #130 có runtime gated và QA callback giả lập; chưa nhận IPN thật. Merchant Admin đăng nhập được, SIT/cấu hình thông báo bên ngoài đang chặn. Tunnel cũ hết hạn; không dùng lại URL. |
| MoMo sandbox P1 | Chưa runtime/credential; vẫn ghi việc còn thiếu. |
| Demo/tài liệu | Cần hướng dẫn local hiện hành, cờ tính năng, actor/fixture và gallery bằng chứng. Ảnh thiết kế không thay kiểm thử luồng thật. |

## Thứ tự tiếp tục

1. Khép test/API/Web Store công khai và PR riêng, kiểm đúng commit trước tích hợp.
2. Đóng gói runbook/demo và ma trận bằng chứng; không công bố toàn dự án hoàn thành.
3. Email nghiệp vụ và đo Search theo Store bằng lát cắt độc lập, giữ commit/contract review riêng.
4. VNPay provider acceptance khi truy cập SIT/cấu hình IPN được, rồi phần sandbox còn cam kết.

## Gate local cuối của nhánh Store

- Backend unit 1700 PASS; full E2E 1125 PASS / 1 SKIP / 20 TODO, 67 files PASS / 2 SKIP. Full E2E dùng migrator để tạo các child database được bảo vệ, không gọi toàn bộ lượt này là app-role. 20 TODO là checklist lịch sử, không tính PASS.
- Store HTTP riêng bằng app-role 24/24 PASS; parser 25/25 PASS. Ban đầu fixture nested Variant sai scalar, sau đó gặp database đang khởi động; đã sửa fixture và chạy lại khi `pg_isready` thành công. Không sửa logic nghiệp vụ để né lỗi.
- Web full 1666 PASS / 6 live SKIP trước bổ sung kiểm biến thể rỗng; lượt tập trung cuối 34/34 PASS gồm ProductDetail hiện có. TypeScript, BE build, FE build và lint đạt; còn warning nền React/ref cleanup và bundle >500KB.
- Store Chrome cuối bốn tổ hợp viewport/theme PASS, 6 ảnh: `artifacts/release-qa-20261028/store-browser-1793158375786`. Tải 24→26 sản phẩm; hết hàng đúng nhãn, empty/hidden Store, không tràn ngang, không pageerror, không POST nghiệp vụ, Order/Stock/Search counts không đổi. Auth bootstrap refresh của ứng dụng được tách riêng, không gọi cả ứng dụng là không có POST.
- Gemini Argon Medium review source và delta: NONE P1/P2; static-only. P3 kiểm giá min/max và biến thể rỗng đã bổ sung. Xóa dữ liệu cũ khi tải thêm lỗi là lựa chọn fail-closed có test, không giữ Shop đã mất quyền công khai. Query delimiters trống được URLSearchParams bỏ qua, nhưng mọi khóa/giá trị vẫn allowlist/bounds.
- Các browser driver cũ chỉ thêm đúng tên QA v971 vào allowlist, giữ host/port/role. Không có migration mới, không sửa shared Product policy hoặc Backend–AI wire. Ảnh/log/secret không commit.
