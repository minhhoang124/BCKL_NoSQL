# Address/Cart — dựng môi trường QA trên máy Hiền

## Phạm vi

Cập nhật23/10: đã nhận develop `4ed07a3` sau Buyer Web #99; script không đổi.
Đã kiểm lại checkout/DB mới,17migration,10guard,preparelặp và9nhóm HTTP thật.
[Bằng chứng mới/giới hạn](pr51-post-buyer-sync-2026-10-23.md). Nội dung ngày22/10
dưới đây là baseline lịch sử, không còn coi #95/#96 là dependency chưa merge.

Bộ bàn giao có script chạy **Backend thật + PostgreSQL riêng**, đồng bộ nền
`develop e394c9e` ngày 22/10/2026, gồm Buyer resolver, Attributes foundation,
Accounts/health và giao diện cam đã merge; không lấy #94/#95/#96 pending.
Không cần merge các PR Order đang mở; không thay schema, Auth, router hoặc UI.
Address UI #49 và Cart UI #50 đã merge; kiểm thử trình duyệt vẫn là bước riêng.
API smoke PASS không chứng minh UI DONE. Đã chạy lại prepare lặp/serve/verify
trên PostgreSQL QA mới và giữ nguyên cấu hình QA cũ; browser vẫn NOT_RUN.
[Baseline, kết quả và giới hạn](pr51-post-develop-sync-2026-10-22.md).

`127.0.0.1`/`localhost` là máy đang mở trình duyệt, không phải dịch vụ chia sẻ trên
máy Hoàng. Hiền tự tạo DB/tài khoản; không cần file DB/JWT của Hoàng hoặc tunnel.

## 1. Lấy script (checkout mới)

Yêu cầu Node/pnpm theo README, Git, Docker Desktop đang chạy và cổng rảnh.
Không checkout đè nhánh UI đang có sửa dở:

```powershell
git clone --branch codex/address-cart-handoff https://github.com/grumhu124/BCKL_ThuongMaiDienTu.git BCKL-address-cart-qa
cd BCKL-address-cart-qa
pnpm install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { throw 'Install failed' }
```

## 2. PostgreSQL riêng — chỉ lần đầu

Container/volume dưới đây **khác** `bckl_postgres` và dữ liệu demo. Nhập mật khẩu
QA mới khi hộp thoại hiện ra. Nếu tên/cổng đã tồn tại, kiểm tra môi trường của
mình, không xóa volume hoặc kill dịch vụ khác. Lần sau dùng `docker start bckl_address_cart_qa`.

```powershell
$qaCredential = Get-Credential -UserName postgres -Message 'Nhap mat khau PostgreSQL QA rieng'
$env:POSTGRES_PASSWORD = $qaCredential.GetNetworkCredential().Password
docker run --name bckl_address_cart_qa -d -p 127.0.0.1:5541:5432 -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD -e POSTGRES_DB=bckl_hien_address_cart_20261010_local -v bckl_address_cart_qa_pgdata:/var/lib/postgresql/data postgres:17-alpine
if ($LASTEXITCODE -ne 0) { throw 'Container creation failed; inspect name/port, do not delete data' }
Remove-Item Env:POSTGRES_PASSWORD
docker exec bckl_address_cart_qa pg_isready -U postgres -d bckl_hien_address_cart_20261010_local
```

Chỉ tiếp tục khi `accepting connections`. Nếu chưa sẵn sàng, chạy lại `pg_isready`.
Docker quản trị viên có thể đọc env container: chỉ dùng mật khẩu QA, không secret thật.

## 3. Migration/build/fixture

Tiếp tục cùng terminal có `$qaCredential`. Không in DB URL/mật khẩu:

```powershell
$qaUri = [UriBuilder]'postgresql://127.0.0.1:5541/bckl_hien_address_cart_20261010_local'
$qaUri.UserName = 'postgres'
$qaUri.Password = [Uri]::EscapeDataString($qaCredential.GetNetworkCredential().Password)
$env:DATABASE_URL = $qaUri.Uri.AbsoluteUri
$env:HANDOFF_API_PORT = '3011'
$env:HANDOFF_FE_PORT = '5175'
pnpm --dir BE exec prisma migrate deploy
if ($LASTEXITCODE -ne 0) { throw 'Migration failed' }
pnpm --dir BE build
if ($LASTEXITCODE -ne 0) { throw 'Build failed' }
pnpm --dir BE qa:address-cart:guards
if ($LASTEXITCODE -ne 0) { throw 'Safety guards failed' }
node BE/scripts/address-cart-handoff.mjs prepare
if ($LASTEXITCODE -ne 0) { throw 'Prepare failed' }
Remove-Item Env:DATABASE_URL
```

Script chỉ nhận PostgreSQL loopback tên `bckl_hien_address_cart_YYYYMMDD` (có thể
thêm `_local`/`_qa`); từ chối demo/E2E/remote và query override connection. Đây
không phải sandbox bảo mật: phải xác minh đúng DB. Không chạy `prisma db seed`,
`migrate reset` hoặc full E2E vào DB này.

`prepare` sinh hai Buyer USER active, hai Seller/Store, Category lá, năm Product,
giỏ và địa chỉ giả có nhãn QA. Không dùng ABO. Public fixtures được tạo trực tiếp,
không chứng minh Seller moderation. ID do PostgreSQL sinh: đọc output, không hard-code.

| Fixture | Store | Giá VND | Kho | Kiểm thử |
|---|---|---:|---:|---|
| normal | A | 10000.00 | 200 | quantity 1–99 |
| other-store | B | 25000.00 | 10 | nhóm giỏ |
| last-stock | A | 12000.00 | 1 | quantity=2 bị từ chối |
| out-of-stock | A | 15000.00 | 0 | không mua được |
| private-draft | A | 16000.00 | 8 | không lộ nội dung nháp |

Chạy lại prepare không reset mật khẩu/giỏ/địa chỉ/giá/kho đã sửa. Muốn fixture
sạch dùng checkout và DB mới; không xóa config rồi chạy vào DB cũ.

File riêng bị Git ignore, **không gửi/post screenshot chứa credentials**:

- `BE/.env.address-cart-buyers.txt`: email/password hai Buyer để login UI.
- `BE/.env.address-cart-handoff.json`: DB/JWT/accounts và ID; giữ để phục hồi.
- `BE/.env.address-cart-handoff-uploads/`: SVG QA tự sinh.
- `BE/.env.address-cart-handoff-verification.json`: kết quả cục bộ.

0600 trên POSIX không thay thế Windows ACL; giữ thư mục cá nhân, không chia sẻ.

## 4. Chạy Backend và smoke test HTTP thật

Terminal A từ root checkout QA:

```powershell
node BE/scripts/address-cart-handoff.mjs serve
```

API/docs mặc định: `http://127.0.0.1:3011/docs`. Launcher lấy DB/JWT từ config
riêng, bind loopback, tắt Search Sync/Reconciliation/Image Repair/auto-complete;
không ghi ES/FAISS chung. Không tự đổi cổng. Nếu cổng bận, chọn cổng khác ở bước 3
trước prepare lần đầu, không kill dịch vụ khác.

Terminal B từ root checkout QA (A vẫn chạy):

```powershell
node BE/scripts/address-cart-handoff.mjs verify
if ($LASTEXITCODE -ne 0) { throw 'QA failed; do not claim PASS' }
```

Verifier dùng HTTP thật: login/me/refresh; CRUD Address, isolation Buyer,
default/20-address guard; Cart hai Store, quantity/stock/Decimal, không giữ kho,
không lộ nháp; Product/ảnh public; preview một món không tạo Order. Buyer tạm
được tạo qua register và dọn đúng phạm vi; chỉ ghi PASS sau cleanup thành công.
Lỗi thì file có thể còn RUNNING/kết quả cũ: xem exit code và timestamp.
Chạy verify tuần tự trên fixture ban đầu; QA thủ công đổi giá/kho có thể làm
assert fail, script không tự reset dữ liệu. Dừng API bằng Ctrl+C.

## 5. UI Hiền chạy từ checkout UI riêng

Trong checkout có #49/#50, cài dependencies, rồi terminal C:

```powershell
$env:VITE_API_URL = 'http://127.0.0.1:3011'
pnpm --dir FE dev --host 127.0.0.1 --port 5175 --strictPort
```

Mở đúng `http://127.0.0.1:5175`, không trộn localhost; CORS chỉ cho origin lưu ở
prepare. strictPort tránh Vite đổi cổng âm thầm. Dùng Buyer A/B trên máy chạy API.
Checkout QA nền develop không tự có UI từ #49/#50 hoặc nhánh Order local của Hoàng.

Routes: `/account/addresses`, `/cart`. Chỉ sửa router/menu cho hai màn, giữ
Order/Seller/Admin và refresh. Điểm nối dự kiến sang Checkout:
`/checkout?variantId=10&variantId=25` (ID chỉ ví dụ): 1–50 PostgreSQL Int dương,
duy nhất, được chọn và mua được; không đưa giá/quantity/token/PII vào URL.
Query rỗng/lỗi không tự chọn toàn giỏ. Checkout đọc lại Cart/Address và Preview.
Helper/Checkout thật do Hoàng tích hợp task riêng, **không có trong PR QA này**;
chưa có route trên checkout UI thì ghi kiểm thử nối Checkout NOT_RUN.

Hiền ghi bằng chứng browser desktop/mobile cho:

1. A/B không thấy dữ liệu nhau; refresh/đổi tài khoản không giữ dữ liệu cũ.
2. Address CRUD/default, lỗi unset mặc định/địa chỉ thứ 21.
3. Cart nhóm Store, lineCount/totalQuantity, purchasableSubtotal chỉ món mua được.
4. Quantity 0/100/vượt kho/hết kho; nháp chỉ thông tin tối thiểu để xóa.
5. URL đúng món chọn; không âm thầm mua toàn giỏ/subset.
6. Loading/timeout/API tắt/phiên hết hạn có lỗi/retry phù hợp.

**NOT_RUN trong verifier:** browser UI Hiền, giao dịch tạo/hủy/hoàn kho, Seller
xử lý/giao/hoàn tất, ES/FAISS, thanh toán/vận chuyển production.
Báo lỗi gửi branch/commit/thời điểm/route/HTTP status/mã lỗi/ảnh đã che PII;
không gửi env, DB URL, token/cookie hoặc file credentials.

## 6. Bằng chứng kiểm thử bộ bàn giao — 10/10/2026

Kiểm từ checkout sạch trên develop `f267399`, không dùng nhánh Order integration:

- `pnpm install --frozen-lockfile`: PASS, lockfile không đổi.
- Migrate deploy 12 migrations vào DB QA mới: PASS; prepare hai lần không trùng.
- Sửa thử tên/giá/kho fixture rồi prepare: giữ nguyên chỉnh sửa; khôi phục fixture sau test.
- HTTP verifier hai lượt liên tiếp: PASS, kiểm tra sau cleanup còn 4 User/5 Product,
  0 Order/0 SearchOutbox. QA dùng cổng riêng 3012/5176, không thay dịch vụ demo.
- Safety guards 10/10; Backend unit 377/377; Frontend nền 23/23; lint/build,
  Backend typecheck và Prisma validate: PASS.
- E2E Address/Cart/Checkout Preview 94/94 trên DB E2E khác DB bàn giao: PASS.
  Lượt E2E đầu thiếu JWT test ở checkout sạch nên chưa chạy được; đã sinh JWT test
  riêng rồi chạy lại, không sửa Auth để bỏ kiểm tra secret.
- CI có bước chạy safety guards; HTTP verifier hiện là kiểm tra local, không tự
  chạy trong CI. Full Backend E2E local và browser UI Hiền: NOT_RUN trong đợt này.

PASS local không thay kết quả CI/review, không là phê duyệt merge tự động.
