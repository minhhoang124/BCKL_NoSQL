# Bàn giao Backend Attributes để Hiền nối editor

PR #94, nhánh `codex/admin-attribute-write-api`, nền develop `e394c9e`.
**RUNTIME REVIEW, chưa merge; chưa nghiệm thu UI ghi.** Xem head cuối trên PR;
không lấy approval `01b4c88` thay review delta timeout/tooling mới.

## 1. Phạm vi đã có

-3GET Admin đọc đủ inactive/usage và4POST/PATCH definition/options thật.
- Revision/CAS (chỉ ghi khi phiên bản còn đúng), lý do/confirmation, audit và
  durable Search job (công việc lưu trong DB) cùng transaction.
- Lock/query timeout55P03/57014 trả503, Retry-After:1; không tự chạy lại mutation.
- Fixture opt-in sinh2Admin độc lập,1Seller có Store ACTIVE,1Buyer;4kiểu
  TEXT/NUMBER0/BOOLEANfalse/SINGLE_SELECT, option bật/tắt, Product DRAFT và
  Product APPROVED đã mua qua Checkout COD thật có snapshot SKU/giá/địa chỉ.
- Không chuyển runtime vào develop hoặc bật editor chính thức chỉ từ gói QA.

## 2. Checkout sạch — không dùng thư mục có.env của demo

Sau fetch, tạo checkout riêng từ **head đã xác minh của PR94**, ví dụ PowerShell:

```powershell
git fetch origin
git worktree add --detach ../bckl-attributes-qa origin/codex/admin-attribute-write-api
cd ../bckl-attributes-qa
git rev-parse HEAD
pnpm install --frozen-lockfile --offline
```

Nếu chưa có cache package, bỏ `--offline` sau khi kiểm lockfile; không tải code
hoặc schema từ branch khác vào lúc test. Không copy root.env/BE.env sang checkout.
Launcher sẽ từ chối hai file đó. PostgreSQL17, Node theo repo và pnpm11.25.0.

## 3. Tạo database RIÊNG trên máy Hiền

Chỉ chạy khi cổng5549 chưa được dùng. Nếu có container/DB của người khác ở5549,
**không dừng/xóa hoặc đổi mapping của họ**; nhờ người quản lý cấp một DB QA mới
đúng allowlist trên service đó thay vì chạy Compose mới.

Trong PowerShell mới, sinh secret cục bộ; các lệnh gán không in giá trị:

```powershell
function New-AttributesQaSecret {
  $qaBytes = New-Object byte[] 32
  $qaRng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $qaRng.GetBytes($qaBytes); ([BitConverter]::ToString($qaBytes)).Replace('-', '') }
  finally { $qaRng.Dispose() }
}
$env:ATTRIBUTES_QA_BOOTSTRAP_PASSWORD = New-AttributesQaSecret
$env:ATTRIBUTES_QA_MIGRATOR_PASSWORD = New-AttributesQaSecret
$env:JWT_ACCESS_SECRET = New-AttributesQaSecret
$env:JWT_REFRESH_SECRET = New-AttributesQaSecret
docker compose -p bckl-attributes-handoff-qa -f tools/attributes-qa/compose.yaml up -d --build --wait
$env:DATABASE_URL = 'postgresql://bckl_attributes_qa:{0}@127.0.0.1:5549/bckl_order_resolution_test_attributes_20261019_v1' -f $env:ATTRIBUTES_QA_MIGRATOR_PASSWORD
$env:SEARCH_SYNC_ENABLED = 'false'
$env:SEARCH_RECONCILIATION_ENABLED = 'false'
$env:PRODUCT_IMAGE_REPAIR_ENABLED = 'false'
$env:ORDER_AUTO_COMPLETE_ENABLED = 'false'
$env:FRONTEND_URL = 'http://localhost:5173'
node scripts/run-attributes-handoff-qa.mjs --check-target
if ($LASTEXITCODE -ne 0) { throw 'QA target refused; stop here' }
pnpm --dir BE exec prisma migrate deploy
pnpm --dir BE run build
```

Compose có project/volume riêng, chỉ bind127.0.0.1:5549. Bootstrap role postgres
chỉ dùng init; Backend dùng `bckl_attributes_qa` NOSUPERUSER/NOCREATEDB/NOCREATEROLE,
owner của đúng DB QA. Không dùng root/demo Compose, prisma migrate reset hoặc down-v.
17migration áp dụng nguyên bản, không sửa migration chung. Mỗi lệnh chỉ chạy tiếp
khi exit0; không dùng seed dùng chung thay fixture này.

**Sửa portable23/10:** Compose build imageLinux từ `tools/attributes-qa/Dockerfile`,
`COPY --chmod=0755` hook vào image; không bind-mount hook từ filesystem máy nhận.
Giữ cả Dockerfile khi gửi gói. Không cần `chmod` thủ công trên Windows/macOS.
Volume đã init lỗi phải giữ để chẩn đoán; không restart/down-v/reset để che lỗi.
Muốn kiểm gói từ đầu dùng project/volume mới riêng. Kiểm tự động opt-in:
`node scripts/test-attributes-qa-compose.mjs` (refuse khi5549đang có dịch vụ).
Script dựng hai volume mới,17migration/seed2lượt/Swagger; chỉ stop container
của chính nó, giữ volume/dữ liệu và private credentials local. Không gửi toàn
bộ artifacts; [bằng chứng/giới hạn nền nhận gói](attributes-portable-init-fix-2026-10-23.md).

Giữ secret riêng an toàn và giữ phiên PowerShell; **không sinh password mới rồi
mong volume cũ đổi password**. Khi volume đã tồn tại, init không chạy lại. Không
đưa env/URL có mật khẩu vào GitHub, ZIP, ảnh chụp hoặc chat; không copy sang DB demo.
Nếu dùng DB được cấp sẵn, đặt DATABASE_URL qua kênh riêng; script yêu cầu loopback
5549, tên `bckl_order_resolution_test_attributes_20261019` hoặc hậu tố `_v`1–8chữ số
không bắt đầu0, schema public, password ít nhất12ký tự và role không đặc quyền.

## 4. Seed dữ liệu và mở API tại MÁY NHẬN

```powershell
node scripts/run-attributes-handoff-qa.mjs
node scripts/run-attributes-handoff-qa.mjs --serve
```

Seed mặc định kết thúc sau khi kiểm fixture; **mỗi lần tạo bundle mới**, không
reset password/role hoặc xóa lịch sử cũ. API chưa chạy nếu chưa dùng `--serve`.
Server bind127.0.0.1:3014; Swagger `http://127.0.0.1:3014/docs`. Dừng bằng Ctrl+C.
Nếu3014 đang có dịch vụ khác, không kill dịch vụ đó; chọn môi trường QA phù hợp.
Không tunnel/chia sẻlocalhost của Hoàng hoặc mở API này ra mạng.

Kết quả seed ở **Git common root** (repo chính nếu dùng worktree):
`artifacts/attributes-handoff-qa/attributes-<suffix>/`:

- `credentials.private.json`: email/mật khẩu được sinh trên máy nhận; không token,
  không DATABASE_URL. Dùng đăng nhập mới qua POST/auth/login; không gửi file này.
- `fixture-map.json`: Category/definition/option/Product/Order IDs và revision.
  Có qaDatabase để chọn đúng DB nếu đã tạo nhiều môi trường QA. Không hard-code
  ID/revision từ ví dụ hoặc chọn nhầm bundle của DB khác theo thời gian tạo.

Thư mục bị Git ignore, không đồng nghĩa đã mã hóa: giữ quyền truy cập máy phù hợp.
Hai profile trình duyệt khác nhau dùng Admin-A/B. FE của Hiền dùng API URL3014
theo cấu hình của FE; origin/CORS phải khớp FRONTEND_URL. Auth/call API dùng client
đã có; không chép token/mật khẩu vào source hoặc localStorage fixture công khai.
Không cần model/ES/FAISS để nối editor; cron Search/repair/auto-complete tắt trong QA.

## 5. API và cách xử lý lỗi

Base `/admin/categories/{categoryId}/attributes`; GET list/detail/options như
contract #65; POST definition; PATCH definition; POST/PATCH options. Xem
[request/response chính xác](../api/admin-category-attributes-write-runtime.md).
GET/PATCH/options trả revision hiện hành; mutation gửi expectedRevision đó.

-400/409: giữ draft, chỉ rõ lỗi; stale revision phải người dùng đối chiếu dữ liệu,
  không tự nâng revision rồi PATCH. Option identity đã dùng không đổi nghĩa.
- Policy đổi required/active/custom: confirmation riêng và reason10–500codepoints.
- No-op đúng revision: không thêm audit/job/revision; stale no-op vẫn409.
-503/timeout/5xx/mất response: giữ draft, khóa write/selection/tab liên quan;
  chưa biết kết quả thì không tự POST/PATCH lại. Retry-After không là proof rollback.
  API Catalog chưa có durable resolver như Order; GET không phải proof unlock.
- GET không mutation hoặc nhận thiếu inactive thành danh sách quản trị đầy đủ.

## 6. Checklist Hiền kiểm sau khi có Backend nền đã merge

1. Hai Admin đọc cùng revision: A sửa thành công, B dùng bản cũ nhận409 và giữ draft.
2. Đổi definition/option sai nesting:404; Buyer/Seller403, guest401; no-store.
3. DRAFT đã dùng type/slug và option đã dùng value/slug: không cho đổi, không xóa value.
4. TEXT, NUMBER0, BOOLEANfalse hiển thị đúng; option inactive vẫn có trong Admin,
   không lẫn ProductOptionValue/SKU với thuộc tính mô tả.
5. Thay required/active/custom đòi reason+consent; lỗi/revision giữ form;
   double-click/đổi tab/selection khi pending không gửi mutation chồng.
6. Product đã mua và GET Buyer/Seller giữ snapshot sau thay metadata/rule;
   Search chỉ được nhận durable job, không báo index đã hoàn tất từ response API.
7. Mất mạng sau gửi: không tự unlock/replay; không ghi thông tin nhạy cảm vào log.
8. Logout/account switch không cập nhật UI bằng response phiên cũ.

## 7. Giới hạn nghiệm thu

Catalog approval/Store setup là dữ liệu QA tổng hợp, không bằng chứng Seller UI
hoặc moderation browser. Ảnh Product là URL fixture, chưa có managed image file;
không nhận ảnh hiển thị làPASS. ES/FAISS không chạy nên chỉ kiểm DB/outbox, không
nhận live Search DONE. Seed kiểm login/HTTP/Checkout/DB, chưa chứng minh editor
browser, dark/mobile hoặc toàn Admin giai đoạn3. Kết quả thực chạy ở báo cáo
kiểm thử timeout/handoff cùng PR; không dùng bước hướng dẫn chưa chạy như evidence.

Kết thúc: dừng API bằng Ctrl+C; nếu chính đợt này tạo QA Compose thì
`docker compose -p bckl-attributes-handoff-qa -f tools/attributes-qa/compose.yaml stop`.
Giữ volume/dữ liệu/audit; không down-v, không dừng container demo của người khác.
