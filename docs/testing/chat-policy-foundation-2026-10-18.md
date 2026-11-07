# Nền policy Chat độc lập — 18/10/2026

Baseline develop7e58255. SRS FR-CHT-01/UC-HT10/D08 và quyết định Hiền đã
review trên #41 (19cf324) là căn cứ nghiệp vụ; không ghép code unmerged.
Không thay schema/API/Auth/Socket/Frontend hoặc Order. Chỉ pure policy + unit
tests; chưa được gọi từ AppModule/route/gateway. Chat chưa CURRENT/DONE.

## Luồng và các biến

`assertCanOpenChat(actor,store)`: actor phải active và role USER, không tự chat,
Store ACTIVE và owner active. Không tự gửi Product context khi mở.

`assertCanReadChat(actor,store,conversation)`: active USER đúng buyer hoặc
active SELLER đúng owner Store. Sai conversation/Store/owner trả404 chung;
Admin không mặc định có quyền. Buyer vẫn đọc lịch sử khi owner bị khóa.

`assertCanSendChat(...)`: kiểm membership trước; Store ACTIVE hoặc SUSPENDED
kèm `hasVerifiedPriorTransaction=true` và owner active. Thiếu bằng chứng cũ
mặc định false/read-only. PENDING/REJECTED chỉ đọc lịch sử hợp lệ.

`hasVerifiedPriorTransaction` là FACT NỘI BỘ đọc từ DB cho đúng Buyer–Store,
không field DTO hoặc boolean client. Chưa có service tạo fact này. Khi tích hợp
phải xác minh Order và thời điểm đình chỉ bằng nguồn audit đáng tin; không lấy
tuổi Conversation làm bằng chứng. Nếu không chứng minh được thì fail closed.

`advanceChatReadSequence(current,observed)`: con trỏ không lùi; chỉ gọi sau khi
server kiểm membership và resolve messageId thuộc đúng Conversation sang sequence
trong transaction. Hàm thuần không tự chứng minh message thuộc Conversation.

Code lỗi/status ở đây là đề xuất nội bộ để review, chưa public contract mới.
Caller phải đọc canonical facts trong giao dịch; policy không phải middleware
hay cơ chế thu hồi Socket push. Không cache account/ownership lúc join rồi dùng
mãi; push cần kiểm recipient token/active/membership trước phát dữ liệu.

## Phạm vi test và phần chưa làm

Tests quyền/Store state/self-chat/account lock/Admin/ngoài scope/suspended proof,
con trỏ cũ/trùng/mới/invalid. Các object là fixture unit, không DB/REST/Socket.
Chưa message persistence, idempotency hash/replay, sequence cấp trong row lock,
rate limiter, schema/constraints, expiry/reconnect/unread hoặc UI.

Đặc biệt unit test read sequence không thay kiểm thứ tự commit/cursor bằng hai
connection. Chưa test G-AFTERSALE/Chat realtime. Không thêm model/table dựa vào
nhánh #41 chưa merge hoặc cập nhật SRS để nhận phần chưa triển khai.

## Bước tiếp theo

### Bổ sung chuẩn bị Message (cùng nhánh, chưa transport)

prepareChatMessage kiểm strict object TEXT/PRODUCT_CONTEXT; sender/conversation
là tham số server, body không được override. Text trim, tối đa2000 Unicode code
points, giữ newline/tab; reject control chars và Unicode surrogate hỏng.
PRODUCT_CONTEXT chỉ kiểm ID, chưa cấp quyền xem Product hoặc đảm bảo Product
thuộc Store; service runtime bắt buộc kiểm canonical visibility/ownership.

clientMessageId đề xuất bounded printable ASCII1–128, không whitespace; đây là
chi tiết implementation chờ reviewer xác nhận, chưa public contract. Hash v1
SHA256 từ envelope cố định conversation/sender/payload chuẩn hóa, không ghi key
vào logs. Cùng scoped key phải cùng identity/hashVersion/hash; khác trả conflict.
Hàm so sánh chỉ gọi sau authorize + DB lookup đúng scoped key. Không tạo/sửa
Message, không emit và chưa có unique DB constraint chống hai insert đồng thời.
Không nhận unit replay comparison là đã hoàn thiện idempotency runtime.

37test mới cho strict body/Unicode/keys/hash/replay; cùng31policy là68Chat tests.
Full Backend662PASS/27files sau bổ sung; build PASS. Lint lượt đầu có warning
control regex do chủ động chặn ký tự điều khiển; đổi sang codepoint check và
chạy lại, không tắt rule. Không thay schema/lockfile hoặc mở API.

Kiểm tra18/10: frozen/offline install ignore-scripts và Prisma generate PASS;
31 Chat unit tests PASS, nằm trong625 full Backend unit tests/26files PASS
(không cộng31 lần nữa). Backend lint/Nest build/diff-check PASS.
Warning plugin vite-tsconfig-paths và logs lỗi mock health/Search/repair từ
negative unit tests nền, không là kết nối DB hoặc lỗi Chat live.
Không E2E/DB/Socket/browser vì không có transport/schema runtime trong PR này.

#41 vào nền chính thức → cập nhật domain/contract sequence và evidence D08 →
migration mới/constraints → REST service dùng cùng policy → Socket adapter → UI.
Order resolver không phải dependency Chat trước mua. Đạt không cần đổi Search.
