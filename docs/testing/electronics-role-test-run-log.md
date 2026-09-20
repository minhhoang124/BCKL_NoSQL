# Nhật ký chạy test case Web — Giai đoạn 2

Cập nhật: 18/09/2026. Nguồn ca kiểm thử: [`electronics-role-test-cases.md`](electronics-role-test-cases.md). **U01 và U02 đã PASS trên Backend test cô lập; 23 ca khác chưa chạy.** `NOT_RUN` là chưa chạy; sau khi bắt đầu lượt chạy, dùng `PASS`, `FAIL` hoặc `BLOCKED` cùng bằng chứng/lý do cụ thể. `PARTIAL` ở cột khả năng nghĩa là chỉ chạy được một phần bước của ca.

## Điều kiện chung trước khi chạy

- Ghi ngày/giờ, môi trường, URL, commit FE/BE/Search, phiên bản database migration, người chạy và cấu hình test không chứa secret.
- Nhận mapping chính thức từ Hoàng. Join bằng `externalId`, kiểm tra `productId` là số nguyên dương, không trùng, tồn tại trong PostgreSQL và cùng `externalId`; lưu hash/tên file mapping. Không dùng ID prototype 1–1200.
- Ghi rõ Product nào là DRAFT, APPROVED/ACTIVE, HIDDEN, REJECTED; chỉ fixture công khai hợp lệ mới được dùng để kỳ vọng xuất hiện trong Search. Gói 86 DRAFT không tự thành sản phẩm công khai.
- Tạo U1/U2, S1/S2, A1 bằng fixture được phép và ghi ID; tạo Store/Product/Variant/Order riêng khi ca yêu cầu. Che token, mật khẩu và dữ liệu cá nhân khỏi bằng chứng.
- Với mỗi ca: ghi input, expected, actual, trạng thái, link ảnh/log hoặc response đã che dữ liệu nhạy cảm, mã bug và người sửa nếu FAIL. Nếu BLOCKED, ghi API/fixture/mapping còn thiếu và người phụ trách.

| Trường của lượt chạy | Giá trị cần điền |
| --- | --- |
| Ngày giờ / người chạy / môi trường | 18/09/2026 18:54 ICT; Hiền/Codex; PostgreSQL 18 tạm trên localhost:55439, database riêng `hien_auth_test` |
| FE commit / BE commit / Search commit | BE nền `7d54752` (`develop` khi tạo branch); FE và Search không chạy trong lượt U01/U02 |
| Migration / index / model | 5 Prisma migration đã áp dụng; không dùng Search index/model |
| Mapping `externalId → productId` và SHA-256 | Chưa nhận |
| Fixture User/Store/Product/Variant/Order | U01/U02 dùng tài khoản test có email sinh theo thời gian, tự xóa sau test; không dùng Store/Product/Order |
| Bằng chứng chung / bug tracker | `BE/test/hien-auth-acceptance.e2e-spec.ts`: 2/2 PASS; `BE/test/auth.e2e-spec.ts`: 5/5 PASS; `BE/test/store-catalog.e2e-spec.ts`: 4/4 PASS; BE unit: 4/4 PASS. Không phát hiện bug ở U01/U02 |

## Theo dõi 25 ca

| ID | Khả năng chuẩn bị tại 18/09 | Dependency còn thiếu hoặc bước cần kiểm tra | Trạng thái chạy | Actual / bằng chứng / bug |
| --- | --- | --- | --- | --- |
| U01 | ĐÃ_CHẠY_BACKEND | Tài khoản test được đặt `isActive=false` bằng fixture trong database cô lập | PASS | Đăng nhập đúng 200 có access token, sai mật khẩu 401, tài khoản inactive 401, token cũ gọi `/auth/me` 401; acceptance E2E 2/2 |
| U02 | ĐÃ_CHẠY_BACKEND | Dùng `/admin/categories` và JWT USER; không kiểm tra Frontend UI ở lượt này | PASS | Đăng ký công khai `accountType=ADMIN` trả 400; USER gọi Admin API trả 403; acceptance E2E 2/2 |
| U03 | BLOCKED | Hoàng import + mapping; Product công khai hợp lệ; Search/Backend filter và phân trang | NOT_RUN | — |
| U04 | PARTIAL | Đạt có API ảnh độc lập trên PR #8 Draft; cần môi trường chạy/contract và tích hợp test | NOT_RUN | — |
| U05 | BLOCKED | NestJS search hydration + fixture ID ẩn/không tồn tại; Search Service tích hợp | NOT_RUN | — |
| U06 | BLOCKED | Product Variant fixture và Cart API | NOT_RUN | — |
| U07 | BLOCKED | Order/checkout API, tồn kho Variant và fixture cạnh tranh | NOT_RUN | — |
| U08 | BLOCKED | Order/COD API, snapshot OrderItem và fixture Seller sửa Product | NOT_RUN | — |
| U09 | BLOCKED | Cart/Order nhiều Store và fixture hai Store | NOT_RUN | — |
| U10 | BLOCKED | Order cancel, stock movement và quy tắc trạng thái | NOT_RUN | — |
| U11 | BLOCKED | Order/Chat API và fixture U1/U2 | NOT_RUN | — |
| U12 | BLOCKED | Review API và Order hoàn tất hợp lệ | NOT_RUN | — |
| S01 | BLOCKED | Product Draft/Option/Variant API ở PR sau PR #15 | NOT_RUN | — |
| S02 | BLOCKED | Product/Variant/Order API và fixture hai Store | NOT_RUN | — |
| S03 | BLOCKED | Product Option/Image/Variant API | NOT_RUN | — |
| S04 | BLOCKED | Product Draft/submission API và thông tin kiện hàng | NOT_RUN | — |
| S05 | BLOCKED | Seller Order status API và lịch sử | NOT_RUN | — |
| S06 | BLOCKED | Order COMPLETED, doanh thu Seller và fixture hủy | NOT_RUN | — |
| S07 | BLOCKED | Chat REST/WebSocket, reconnect/read cursor và fixture hai Store | NOT_RUN | — |
| A01 | BLOCKED | Product moderation + Search/Backend hydration và fixture đủ điều kiện công khai | NOT_RUN | — |
| A02 | BLOCKED | Admin khóa/mở tài khoản và chính sách phiên | NOT_RUN | — |
| A03 | BLOCKED | PR #15 Category/Store API đã merge; cần fixture Product tham chiếu Category và Product moderation API để chạy toàn ca. PR #18 Product DRAFT còn đang review | NOT_RUN | — |
| A04 | BLOCKED | Admin statistics và Order fixture nhiều Store | NOT_RUN | — |
| P01 | BLOCKED | Order/COD/Payment model và VNPay/MoMo sandbox | NOT_RUN | — |
| P02 | BLOCKED | Sandbox callback/IPN, idempotency và trạng thái Payment | NOT_RUN | — |

`BLOCKED` trong cột khả năng là đánh giá dependency tại thời điểm chuẩn bị, **không** phải kết quả chạy. U01/U02 PASS chỉ xác nhận hành vi Backend trong môi trường test cô lập, không xác nhận UI hoặc bản tích hợp. Khi chạy ca khác, cập nhật trạng thái ở cột “Trạng thái chạy”, ghi actual và bằng chứng.

## Nhật ký chi tiết từng lượt

Sao chép mẫu này cho mỗi ca thực sự chạy:

```text
Case ID:
Ngày giờ / người chạy / môi trường:
FE / BE / Search commit; migration; index/model:
Mapping file + SHA-256; externalId → productId đã xác minh:
Fixture IDs và trạng thái Product/Store/Order:
Request/bước thực hiện (không chứa token/secret):
Expected:
Actual:
Kết quả: PASS | FAIL | BLOCKED
Bằng chứng (đã che dữ liệu nhạy cảm):
Bug/owner/dependency còn thiếu nếu FAIL hoặc BLOCKED:
Ngày retest / kết quả:
```

## Cập nhật dependency ngày 19/09/2026

PR #16 đã merge; branch #17 đã đồng bộ develop để chạy full CI. Kết quả U01/U02 phía trên vẫn là bằng chứng Backend cô lập của lượt 18/09, không phải UI/tích hợp.

Hoàng đã công bố mapping 86 Product DRAFT tại [comment PR #8](https://github.com/grumhu124/BCKL_ThuongMaiDienTu/pull/8#issuecomment-5742159306). Lượt test trên chưa sử dụng/xác minh mapping này; U03 vẫn cần đối chiếu database tích hợp, fixture công khai hợp lệ và NestJS hydrate/filter. Không đổi 23 ca chưa chạy thành PASS. Chưa có kết quả Precision/Recall đủ nhãn.
