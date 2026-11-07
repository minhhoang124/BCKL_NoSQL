# Accounts chỉ đọc — PR integration sau #81

21/10/2026. **IN_PROGRESS / Draft** — màn đọc đã nối vào Admin, chưa nghiệm thu
toàn Accounts/Admin/giai đoạn3 và chưa bật khóa/mở.

**Bổ sung sau #88:** đã chạy browser thật trên3f82a70 sau #74, gồm network/
timeout/logout, rồi sync developd84381a không đổi runtime. Xem
[bằng chứng mới và giới hạn](pr86-post88-qa-2026-10-21.md).
Các dòng NOT_RUN/số liệu phía dưới giữ đúng lịch sử của lượt tương ứng.

**Cập nhật mới nhất sau #74:** nhánh đã nhận develop `fa85f66` tại `c4d6a83`.
Kết quả/giới hạn lượt sync ghi riêng ở [báo cáo sau #74](pr86-post74-sync-2026-10-21.md).
Các bảng và bằng chứng browser phía dưới thuộc baseline `d0b8c49` sau #77,
không phải kết quả browser trên Backend sau #74.

## Nền, phạm vi và cách truy vết

- Nhánh riêng `feat/hien/admin-accounts-integration` từ develop
  `76a62c9c365e63425a293fe96412a8356db33298` sau #81 merge thật.
- Trước push, develop đã nhận #77 tại `bf6f926`. Đã merge nền này vào nhánh
  tại `d0b8c49e432669aee1ec3f718f1e1ef0744c6bd9` rồi chạy lại suite và browser/DB.
  Conflict chỉ ở ghi chú kiến trúc, giữ cả Accounts và Attributes. Bốn blob FE
  dưới đây không đổi; Backend/schema giữ nguyên develop, không thêm writer Attributes.
- Source integration ban đầu `ed4f279b353c27753afc626afbd9694ad0aeaf1a`;
  bản kết hợp được kiểm mới là `d0b8c49`. Sau kiểm chỉ cập nhật tài liệu.
- Theo [điểm nối Hoàng chốt](https://github.com/grumhu124/BCKL_ThuongMaiDienTu/pull/81#issuecomment-6291682161),
  [xác nhận merge preparation](https://github.com/grumhu124/BCKL_ThuongMaiDienTu/pull/81#issuecomment-6297307260),
  [API danh sách](../api/admin-accounts-list.md) và
  [contract Accounts](../api/admin-accounts-proposal.md). Các dòng PROPOSED/
  chưa merge trong tài liệu cũ là snapshot lịch sử; phần ghi nâng cấp vẫn chưa có.
- Không cherry-pick preparation để tạo PR trùng #81. Bốn file integration được
  chuyển từ local và so Git blob, không kéo nhánh Attributes hoặc thay đổi cũ.
  Worktree cũ vẫn được giữ, không reset/clean hoặc force push.

| File source | Git blob sau tích hợp |
|---|---|
| AdminDashboardPage.tsx | `30dcc5fb8ebf97ca130e9425103c8be7f4908fa2` |
| AdminDashboardPage.test.tsx | `c5d9ad05b00b03628dc533f2eecbbe2a7e34a911` |
| AdminAccountsReader.tsx | `4b6eff8202c28d95e8fa807f7f1b59172ca90ede` |
| AdminAccountsLayout.module.css | `2fda6c730ec3a2846d5ac04da87d90b52b08db4c` |

## Màn thật thay đổi gì

1. Bật mục Tài khoản và mount reader đã merge tại `/admin/users` trong Admin
   hiện có. Dùng AuthContext thật và adapter GET `/admin/accounts` qua shared
   client, không token/role mẫu hoặc transport preview trong route thật.
2. Chỉ thêm CSS `embedded` để nằm trong shell; không đổi theme toàn hệ thống.
   Bỏ ghi chú placeholder cũ nói thiếu API danh sách.
3. Giữ query/filter/cursor/no-store/abort/session generation của #81. Không lọc
   riêng một trang ở client rồi nhận là toàn hệ thống; không bịa totalCount.
4. Giữ nguyên Brand editor/tab Catalog, Category, Product/Store, Address/Cart,
   Checkout/Order, AppRouter, AuthProvider/client, Backend/schema/lockfile/AI.
5. Test route/menu xác nhận chỉ GET, không có nút ghi; test integrated403 xóa
   dữ liệu/khóa input và không lộ thông báo chẩn đoán thô.

## Kiểm mới trên checkout integration

| Kiểm | Kết quả ngày21/10 |
|---|---|
| Offline/frozen install | PASS, 585 package từ cache, không đổi lockfile |
| Full FE | **722 PASS / 6 opt-in live SKIP**, 40 file PASS / 1 file SKIP, 28.97s |
| Lint | Exit0; 5 warning Dashboard nền `set-state-in-effect` |
| TypeScript/Vite build | PASS, 92 modules; CSS `index-UoXNftkk.css`, JS `index-UoKQnfOe.js` |
| BE Prisma generate + Nest build | PASS, không sửa source Backend |
| BE typecheck và full unit | PASS, **709 test / 32 file**, 6.69s |
| Migration QA riêng | PASS, **15/15**, gồm foundation Attributes của #77; không sửa migration cũ |
| Diff/scope/whitespace | PASS; không credentials/env/data/index/ảnh runtime/personal AGENTS trong commit |

722 là suite tracked của bản integration, khác 721 preparation và reviewer
probe không commit. Không cộng số test Backend vào tổng FE. Full BE E2E,
AI runtime và toàn hệ thống không chạy lại trong lượt này; CI kiểm riêng sau push.

## Browser → Backend → PostgreSQL mới

Đã dừng đúng tiến trình QA cũ và chạy **cả FE lẫn BE từ checkout integration
`d0b8c49`**: FE loopback5190, Backend3013, PostgreSQL17 QA riêng trên5549.
Không dùng preview5186/5189 hoặc DB demo. Launcher ngoài repo nạp AppModule và
configureApp từ build mới, chỉ ghi method/path/status/cache để quan sát;
không fault gate/response giả cho các ca này. Manifest chốt HEAD, source/build
hash trước QA và xác nhận không đổi trong QA.

Baseline 59 User tổng hợp/3 Store có sẵn từ lượt trước; không tạo hoặc sửa
fixture ở lượt bàn giao. ID dưới đây chỉ thuộc DB QA, không hardcode trong UI.

| Ca thực chạy lại | Kết quả |
|---|---|
| Reload phiên Admin A | PASS, refresh200 rồi đọc được trang đầu50 |
| Cursor/load more | PASS, 50+9=59 ID duy nhất đúng thứ tự DB; email/fullName/isActive và Store ID/name/label khớp baseline |
| Store ACTIVE/CLOSED/SUSPENDED/null | PASS, SELLER có4dòng; User57/Store2 CLOSED, User58/Store3 SUSPENDED, User59 không Store. Store đóng/khóa không biến account active thành inactive |
| q viết hoa + SELLER + account active | PASS, trả đúng User57/Store2 CLOSED |
| Empty/reset | PASS, q không khớp báo rỗng thành công; xóa bộ lọc về50dòng/cursor từ đầu |
| Desktop1280×900/mobile390×844 | PASS quan sát; mobile documentWidth375≤390, thẻ đọc được và không tràn ngang toàn trang |
| Logout → reload → mở thẳng /admin/users | PASS, về Login, không bảng/dữ liệu Admin |
| Admin B sau A logout | PASS qua Login UI, hiện tên B và50dòng; đây là đổi tài khoản tuần tự |
| Buyer/Seller mở thẳng /admin/users | PASS, guard UI đưa về trang công khai, không Accounts. Không gọi đây là direct-HTTP403 test |
| User inactive đăng nhập | PASS, Login báo tài khoản không hoạt động; không coi đây là ca thu hồi inactive Admin JWT đang có |
| Snapshot cuối QA | PASS, 59User/3Store cùng trường và business counts không đổi; GET Accounts không phát mutation/job/outbox |

Trace mới ghi GET Accounts200/no-store và refresh200 hoàn tất; không cộng
OPTIONS hoặc request bị hủy thành ca thành công. Auth refresh-token records
đổi bình thường khi login/refresh/logout, không nằm trong kết luận bất biến nghiệp vụ.

Đối chiếu sau browser: guest GET Accounts và Attributes đều401/no-store;
Admin đọc Accounts SELLER200/no-store, đọc Attributes với Category không tồn
tại404/no-store. Đã giữ đồng thời hai middleware bảo vệ sau merge #77. Không
gọi đây là QA đầy đủ Attributes. Snapshot 15 migration, 59User/3Store không đổi,
không phát sinh attribute audit; source hash không đổi trong lượt kiểm.

Artifact local ngoài repository, nhóm **`accounts-integration-post77-20261021`**:
source manifest/hash, db-before/after, browser-proof, ui-59-rows, trace đã lọc,
verification summary và ảnh desktop/mobile/logout; browser-proof ghi chặn
Buyer/Seller/inactive. Nhóm `accounts-integration-delivery-20261021` là lượt
trước #77, không dùng thay bằng chứng mới. Không upload nguyên thư mục QA;
raw credentials/config nằm riêng,
không token/cookie/body login trong trace. Ảnh local không được coi là URL GitHub.

## Bằng chứng bổ sung trước chuyển nhánh — không nhận là vừa rerun

Các Git blob ứng dụng của bản integration khớp bản local đã kiểm trước đó;
build production cũng giữ cùng tên/hash. Lịch sử sau dùng để truy vết và gửi
kèm khi cần, không thay lượt browser mới hoặc gắn lại nhãn ảnh cũ:

- Local nền `6b88c4d` + cùng delta: GET bị giữ tại QA Backend, logout hủy kết
  nối; A→logout→B bỏ request/filter cũ. Không cưỡng ép stale response qua kết nối
  đã abort; không phải hai profile độc lập.
- Local21/10 cùng source: dừng Backend QA thật → UI lỗi/no row/retry → chạy lại
  đọc50ID; giữ GET20s khiến adapter abort sau15.003s, lỗi/no row rồi retry đúng
  User57; thả request cũ khi client đã đóng không ghi đè màn phục hồi.
- Các trace/ảnh đó giữ trong nhóm artifact local `accounts-postsync-qa-20261020`
  và `accounts-network-qa-20261021`; **không chạy lại fault injection** trên
  checkout mới trong lượt bàn giao này.

## Chưa nghiệm thu / nhờ Hoàng review

- **Hai Admin trong hai browser/profile độc lập: NOT_RUN**, Hiền để ca đó sau.
  Không dùng hai tab cùng cookie hoặc đổi A→B tuần tự làm bằng chứng thay thế.
- Thu hồi quyền giữa GET, refresh hết hiệu lực giữa request, cạnh tranh DB giữa
  trang, cross-browser/full WCAG/load lớn và lỗi SQL/HTTP5xx cụ thể chưa kiểm ở đây.
- Không gọi PATCH khóa/mở cũ. Status hardening/reason/audit/revision/session epoch,
  self-lock/last Admin và command UI vẫn ngoài PR này, chưa nhận Accounts DONE.
- Nhờ Hoàng kiểm điểm mount/menu, giữ shell/guard/Brand/Checkout/Order, session/
  lỗi và phạm vi chỉ đọc. Giữ Draft chờ review/CI và bổ sung ca còn thiếu;
  không tự approve/Ready/merge hoặc đóng gate G-ADMIN/G-OPERATE.

Fresh checkout: cài dependency frozen, dựng PostgreSQL QA và fixture theo
`BE/scripts/admin-accounts-qa.mjs`/API handoff, dùng thêm fixture tổng hợp để
đi qua limit50 và các trạng thái Store; không yêu cầu trùng ID của máy Hiền.
Chạy FE với API URL/port QA của chính máy người thử, credentials gửi riêng.
Chạy lại suite/lint/build và chọn từng ca bảng trên; không coi localhost máy
Hiền là server bàn giao cho máy khác.
