# Onboarding Seller — nhánh triển khai26/10/2026

Base develop `169df59`. Đã triển khai API, Web và QA trên nhánh riêng: User
gửi hồ sơ Store, Admin duyệt mới cấp quyền bán, giữ khả năng mua ở Store khác.
Chỉ coi là bản tích hợp sau merge; rollout mặc định tắt. Bằng chứng và giới hạn
ở [báo cáo kiểm thử](../testing/seller-onboarding-2026-10-26.md).
Không KYC, thuế, ngân hàng hoặc giấy tờ thật; dùng dữ liệu tổng hợp khi demo.

## Quyền và tương thích

Thêm StoreApplication 1:1 Store, một revision chung cho hồ sơ/quyết định,
contactName/contactPhone/pickupAddress/returnAddress; tên/mô tả vẫn ở Store.
StoreSellerGrant lưu chứng cứ cấp quyền gắn owner/Store/Admin/audit. Role cũ
là projection tương thích, chưa xóa hoặc thay enum trên các miền đang chạy.
Chỉ PENDING→ACTIVE lần đầu mới tạo grant, USER→SELLER và rotate credentialVersion/
thu hồi refresh cùng giao dịch. Chủ phải đăng nhập lại. Hash/journal không có
role/cv nên mã cũ vẫn đối chiếu được sau đăng nhập, không xóa metadata để né401.

SELLER_ONBOARDING_ENABLED là rollout opt-in; khi bật, đăng ký công khai luôn
USER dù client cũ gửi accountType=SELLER. Phải triển khai đồng nhất mọi replica
và bật ACCOUNT_BUYER_ACCESS_ENABLED/VITE_ACCOUNT_BUYER_ACCESS_ENABLED trước
duyệt để không mất quyền mua sau promotion. Server từ chối duyệt khi Buyer gate
chưa bật. Không đổi cờ trong khi có giao dịch/journal đang chờ; rollback không
xóa grant/đơn/lịch sử và không được tắt quyền Buyer gây mất đường phục hồi.

Phân luồng theo StoreApplication tồn tại, không suy từ role:

- USER/SELLER chưa có Store gửi hồ sơ mới; legacy SELLER không có Store cũng
  dùng luồng mới, khi duyệt không rotate nếu role đã SELLER.
- Store legacy không có application giữ API/UI cũ; không tự backfill grant
  hoặc bịa lịch sử duyệt từ enum. Endpoint mới báo LEGACY_STORE_WORKFLOW_REQUIRED.
- Store mới có application không dùng API sửa/nộp lại/duyệt legacy, kể cả khi
  tắt rollout. Store SUSPENDED/CLOSED không tự sửa/nộp lại hoặc tạo Store khác.
- Admin khôi phục SUSPENDED→ACTIVE phải có grant cũ, không cấp lại grant.

## Giao dịch và phục hồi

User actor/owner được khóa theo id tăng trước Store/Application, kiểm DB role,
active và credentialVersion sau khóa. Serializable, retry toàn giao dịch tối đa
3lần chỉ khi40001/40P01 đã abort. User row tồn tại làm chốt cho first-submit,
unique Store.sellerId là lớp bảo vệ thêm; không dựa vào khóa hàng chưa tồn tại.

Mỗi ghi có UUID actor/hash/action/target. Receipt APPLIED hoặc CLOSED insert-once
cùng giao dịch, audit bất biến, revision tăng đúng1; không có cập nhật receipt.
Reconcile chỉ trả receipt hoặc đóng key chưa chạy, không tự nộp/duyệt/cấp quyền.
Mỗi lần trả kết quả kiểm lại quyền target hiện hành; khóa tài khoản chặn replay.
Profile/reason không nằm trong browser journal; chỉ UUID/hash/target/kỳ vọng.
Timeout không tự gửi lại; GET lỗi sau receipt không được replay mutation.

Store/history/application/audit/grant/role/session/Search job commit hoặc rollback
cùng nhau. Search enqueue khi vào/ra ACTIVE, worker được phép no-op nếu Store
chưa có Product. Không gọi AI/network trong giao dịch. Composite FK grant→
Store(id,sellerId) cần unique(id,sellerId) mới; không sửa migration cũ.

## Review thiết kế trước migration

Argon gemini-4-argon-medium/Medium đã phản biện: bổ sung unique composite,
phân luồng legacy, replay sau promotion/đăng nhập, khóa User trước first-submit
và chỉ một revision. Các điểm này được đưa vào thiết kế trên. Giữ trigger
append-only đơn giản theo convention repo; không bỏ kiểm DB chỉ để dễ teardown.
Đây là review AI kỹ thuật theo ủy quyền người dùng thay review thủ công, không
giả thành human approval. Không thay contract Backend–AI hoặc quyền Admin.
