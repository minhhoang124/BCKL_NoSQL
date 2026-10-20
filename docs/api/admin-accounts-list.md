# Admin Accounts — API danh sách chỉ đọc

20/10/2026 — IN_PROGRESS trên nhánh `codex/admin-accounts-read`, chưa merge.
Triển khai phạm vi đọc theo contract PR #76 (`a761879`); không thay khóa/mở,
JWT, schema, audit hoặc Search. Hiền có thể chuẩn bị nối UI từ contract này;
chỉ nghiệm thu tích hợp sau Backend merge và QA Web thật.

## Request và quyền

`GET /admin/accounts` — Bearer access JWT, current active ADMIN.
Guest/inactive 401, USER/SELLER 403. Role JWT cũ không vượt quyền DB hiện hành.
Service kiểm lại actor trong cùng snapshot đọc dữ liệu.
GET/HEAD có `Cache-Control: no-store` cả lỗi; không nhận request body.

| Query | Quy tắc |
|---|---|
| limit | Mặc định 50, integer 1..100 |
| afterId | ID nguyên dương <=2147483647; lấy ID lớn hơn, thứ tự tăng |
| q | NFC + trim, tối đa120 Unicode code points; chứa email/fullName không phân biệt hoa/thường |
| role | USER, SELLER hoặc ADMIN; schema hiện là single-role |
| isActive | Chính xác chuỗi true/false, không nhận 1/0 |

Tham số lạ, trùng, array/bracket và giá trị sai trả400. `q` rỗng sau trim
được coi là không tìm kiếm; không nhận control characters trong chuỗi đã chuẩn hóa.
Ký tự `%`, `_`, `\` tìm literal, không mở rộng thành SQL wildcard.
Không log nguyên query/email và không trả totalCount toàn bộ.

## Response

```json
{
  "items": [{
    "id": 125,
    "email": "seller@example.invalid",
    "fullName": "Seller QA",
    "role": "SELLER",
    "isActive": true,
    "createdAt": "2026-10-20T00:00:00.000Z",
    "updatedAt": "2026-10-20T00:00:00.000Z",
    "store": {"id": 17, "name": "Store QA", "status": "ACTIVE"}
  }],
  "nextCursor": null
}
```

`fullName`/`store` có thể null. Các ngày là ISO8601 UTC. Không passwordHash,
refresh/access token, phone/address hoặc nested Order. Store inactive/suspended
vẫn hiển thị để quản trị, không phải bằng chứng Store được bán hàng.
`nextCursor` là ID cuối trang nếu còn hàng; null kết thúc. Khi đổi bộ lọc,
UI reset cursor/dữ liệu, chặn response phiên cũ. Không dùng `items.length`
để suy ra tổng toàn hệ thống. Các trang là các snapshot riêng, không hứa
snapshot cố định xuyên nhiều request khi tài khoản thay đổi đồng thời.

## Đọc code và giới hạn

- `admin-account-list.ts`: đọc query strict và middleware no-store trước guards/parser.
- `admin-account-list.service.ts`: select allowlist + transaction RepeatableRead
  read-only (ảnh chụp dữ liệu nhất quán), statement timeout5s/transaction7s.
- `admin-account.controller.ts`: GET dưới guard Admin cũ, PATCH giữ nguyên.
- Không migration mới, không audit/job/outbox từ GET.
- Tìm contains chưa có trigram index; timeout giới hạn tải, không cam kết
  hiệu năng dữ liệu lớn. Khi đo tải thực cần query/index migration riêng.
- **Không bật nút khóa/mở mới:** PATCH cũ chưa có revision/reason/audit/epoch,
  chống tự khóa/Admin cuối theo toàn bộ contract #76.

## Bàn giao Hiền và dữ liệu QA

Fresh checkout nhánh PR, `pnpm install --frozen-lockfile`. Dựng PostgreSQL17
QA riêng bind `127.0.0.1:5549`, DB tên `bckl_order_resolution_test_<suffix>`.
Không dùng DB demo5432. Đặt DATABASE_URL/JWT_ACCESS_SECRET/JWT_REFRESH_SECRET
riêng trên máy; không gửi file env hoặc đưa secret vào comment GitHub.

1. `pnpm --dir BE exec prisma migrate deploy` trên URL QA vừa đặt.
2. Đặt biến môi trường `QA_ACCOUNT_PASSWORD` tối thiểu12 ký tự (tự chọn, gửi riêng nếu cần).
3. `node BE/scripts/admin-accounts-qa.mjs` — tạo hai Admin, Buyer, Seller+Store,
   một User inactive. In ID/email, không in mật khẩu; chạy lại không đổi password/data cũ.
4. `pnpm --dir BE start:dev` với BACKEND_PORT riêng (ví dụ3011), FRONTEND_URL của UI QA.
5. Đăng nhập qua `POST /auth/login` bằng Admin email script in ra và password
   tự đặt. Dùng accessToken gọi GET này. Hiền dùng apiClient hiện có, không lưu token riêng.
6. QA UI: tải/lỗi/rỗng, filter/reset/pagination, hai Admin, logout/đổi tài khoản,
   request cũ không cập nhật phiên mới; đối chiếu ID/email/Store trên DB riêng.

Script fixture không reset account cũ, không nâng role hoặc kích hoạt account
có sẵn. Script từ chối host/port/DB ngoài phạm vi QA. Không commit dữ liệu QA.
