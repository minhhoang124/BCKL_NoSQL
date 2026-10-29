# Listing nhiều SKU, chọn mua và Chat chia sẻ đơn — 29/10/2026

Base develop `edab510` là squash PR135; CI sau merge đã đạt6/6. Nhánh hiện
tại `feat/hoang/listing-variants-chat-acceptance`; implementation đầu59277df.
Các checkpoint cũ ghi PR135 chưa merge là lịch sử, không phải trạng thái mới.

## Hành vi được bổ sung

Seller nhập thuộc tính TEXT/NUMBER/BOOLEAN/SINGLE_SELECT, bao gồm option chuẩn
và custom khi definition cho phép. False và0 là giá trị thật. Có tối đa hai
nhóm phân loại, khai báo trước SKU đầu tiên; mỗi SKU chọn đúng một giá trị
mỗi nhóm, giữ giá/tồn kho riêng. Danh sách và selected Product được tải lại
sau ghi để không tiếp tục dùng snapshot cũ. Field thuộc tính nhận lại giá trị
server nếu cùng Product có giá trị saved mới; không hiển thị schema cũ khi
đổi danh mục hoặc nhận phản hồi muộn.

Buyer chọn tổ hợp trên ProductDetail, thấy giá và tình trạng đúng SKU, đặt
số lượng mong muốn trong giỏ rồi sang Checkout. PUT giỏ là **thay số lượng**
của SKU, không cộng dồn; copy giao diện nói rõ. Không gửi giá từ component
mua hàng. Backend kiểm lại quyền, giá và kho khi Checkout. Pending ref chặn
gửi lặp trong cùng tick; kết quả phiên cũ không hiện sang tài khoản mới;
lỗi mạng không tự retry thao tác ghi.

Code chức năng tách trong `FE/src/features/seller-listing/`, tái dùng style
hiện có để thuận tiện đợt đồng bộ toàn bộ giao diện của owner. Không nhận đã
hoàn thành thiết kế lại. Chưa có editor điều chỉnh/xóa SKU đã tạo, import
hàng loạt, nhiều kho hoặc giá khuyến mãi.

## Hai lỗi API được tái hiện và sửa

1. Hai request tạo cùng tổ hợp: ba lượt HTTP thật đều201/500, DB vẫn chỉ có
   một variant. Race vượt precheck làm Prisma P2002 rơi thành500. Bản sửa dùng
   helper constraint hiện có để trả409; giữ nguyên transaction/CAS/outbox.
   Hồi quy khóa Product để **cả hai** request đi qua precheck và chờ FK tại
   INSERT; kiểm cả trùng tổ hợp và trùng Seller SKU giữa hai Product. Kết quả
   phải201/409, chỉ một dòng, đúng giá/kho của request thắng, không lộ lỗi DB.
2. Thêm nhóm sau SKU trả201, làm tổ hợp sẵn có thiếu trục; API chưa có đường
   sửa/xóa tổ hợp để phục hồi bình thường. Bản sửa kiểm variant trong cùng
   transaction của createOptionGroup và trả409 không đổi Product. Đây cũng
   là quy tắc UI mới. CAS theo Product.version vốn có bảo vệ hai writer;
   không bỏ CAS hoặc sửa payload/version outbox bất biến.

Không đổi schema/migration hoặc wire Backend–AI. Backend vẫn là nguồn quyền
và giá/kho; UI disabled chỉ hướng dẫn thao tác.

## Bằng chứng QA

- Backend unit1785 PASS; Web1689 PASS/6 opt-in SKIP; typecheck hai phía,
  lint và build đã qua. Cảnh báo React/ref và bundle Web>500KB có từ trước.
- Focused HTTP/PostgreSQL41 PASS: variant concurrency/axis guard, Product
  lifecycle, attribute coherence, Chat Order context. DML app-role trên DB
  `bckl_order_resolution_test_hardening_20261029`,39 migrations.
- Chrome listing6 nhóm PASS tại59277df: required attribute thiếu bị400,
  sau lưu SINGLE_SELECT thành công;2 nhóm/4 SKU; Admin duyệt/public; các
  probe ghi trái quyền403/404; SKU hết hàng bị chặn; SKU thứ hai mua2 đơn vị,
  một cart PUT/một Order, kho chỉ SKU đó3→1, các SKU khác7/0/2 không đổi.
  Bản driver cuối kiểm thêm snapshot unitPrice30000/lineTotal60000.
- Chat Order4 nhóm Chrome PASS tại59277df; desktop/mobile sáng/tối, mở từ
  Order thật của Checkout, chia sẻ có thao tác xác nhận, lịch sử/replay và
  kiểm quyền không lộ thông tin giao hàng riêng. Không nhận multi-instance
  realtime hoặc chat media đã nghiệm thu.
- Argon Medium đọc snapshot59277df, có response NO_CONFIRMED_FINDINGS P1/P2.
  Codex kiểm thêm giả thuyết sau review, tái hiện axis guard thiếu và bổ sung
  regression/sửa. Review AI tĩnh, không phải Gemini chạy các test runtime.

Artifact ngoài Git `machine-local/integration-20261029/`: listing browser
`remaining-1793291769792`, Chat Order `remaining-1793291788796`, HTTP41
`remaining-1793292392087`, `unit-listing-results.json`,
`listing-web-unit-final.json`. Source review/hashes ở
`machine-local/listing-acceptance-20261029`. Lỗi harness/selector và lỗi đã
tái hiện giữ riêng, không xóa hoặc cộng các lượt rerun thành coverage.

## Môi trường Demo đã cập nhật

Launcher ngoài Git chạy source `release-integration`, giữ checkout `repo`
nguyên nhánh. Backend/AI/Web chỉ listen loopback. Demo DB được pg_dump trước
khi nâng38→39 migrations; User/Product/Variant/Order/Payment/stock movement
giữ nguyên số dòng tại bước migration. App DML riêng, migrator riêng. Thêm
preflight so khớp tên migration trước khi khởi động profile; QA/Catalog khác
không tự được migrate. Các secret/profile/dump không vào Git.

Chrome trên Demo đã login→Search model thật24 kết quả→chọn Product134/SKU2314
→giỏ→COD Order2. Snapshot110000VND×1; Order PENDING_CONFIRMATION, Payment UNPAID;
một stock movement-1, kho19; replay cùng key200/replayed không tăng đơn/kho.
Đây là dữ liệu mô phỏng, không tiền thật. Journal tránh chạy lại tạo Order mới.
Report: `machine-local/demo-web-release-20261029`, backup migration ở
`machine-local/demo-release-upgrade-1793289992838`.

Smoke API cũ có assertion chỉ chấp nhận Order PENDING_CONFIRMATION nên fail
khi gặp đơn demo1 đã COMPLETED; không sửa/reset đơn1. Luồng browser mới và
đối chiếu DB ở trên là bằng chứng bổ sung riêng. Build CLI có một lượt gọi
sai `--root`; đã chạy lại bằng root positional và thành công.

HTTPS/proxy, provider còn thiếu, QC VNPay thủ công, tải/rollback và bộ nộp
cuối vẫn mở. Không gọi đợt này là pentest toàn hệ thống hoặc production-ready.

## CI tổng và quota email ở ranh giới cửa sổ

CI đầu của f360a52 qua build/unit nhưng E2E1202 PASS/1 FAIL/3 SKIP/20 TODO.
Ca email quota chạy qua17:00 UTC: production dùng fixed window15 phút, còn
test đòi đúng3 thư dù5 request có thể nằm ở hai cửa sổ. Không sửa quota hoặc
nguồn production. Test gửi7 request trong thời gian bounded, nhóm token theo
PG createdAt/window, kiểm mỗi cửa sổ<=3, có request bị chặn, mail khớp token,
token cũ chưa used/revoked và tài khoản vẫn login. Vì7 lớn hơn tổng capacity
hai cửa sổ, test vẫn bắt lỗi nếu quota không thực thi; không nới thành4.
Suite email riêng13 ca PASS sau sửa. Log CI fail giữ ngoài Git, không gọi đó
là CI xanh hoặc bỏ qua ca fail khi merge.
