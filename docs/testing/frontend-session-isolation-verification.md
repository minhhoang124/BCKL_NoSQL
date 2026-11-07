# Frontend session isolation — chống gửi lại request bằng tài khoản khác

Ngày: 10/10/2026. Trạng thái: **IN_PROGRESS**, chờ CI/review/merge.
Branch: `codex/frontend-session-isolation`, từ `develop f267399`.

## Root cause và phạm vi

Bộ gọi API cũ nhận 401 → refresh bằng cookie hiện tại → gửi lại body ban đầu,
nhưng không kiểm tra tài khoản/phiên lúc gửi ban đầu có còn hiện hành không.
Nếu Buyer A đăng xuất rồi Buyer B đăng nhập trước khi 401 về, POST chứa tên,
số điện thoại và địa chỉ của A có thể được gửi lại bằng token B.

Đã tái hiện hai lần trong lượt review PR #49 `9b447c0`: Chrome, NestJS và
PostgreSQL QA thật; GET canonical của B có một địa chỉ nhập bởi A. Lỗi thuộc
API client đã có trên develop, không phải lỗi riêng tác giả UI Address.

PR sửa **chỉ** API client/AuthProvider/test/tài liệu. Không lấy các file UI,
route, Address adapter hoặc dependency từ #49/#50; không đổi Backend, schema,
quyền USER/SELLER, contract FastAPI, package.json hoặc lockfile.

## Cách hoạt động và giải thích biến

| Thành phần | Ý nghĩa và quy tắc |
| --- | --- |
| `authSessionVersion` | Số thế hệ phiên trong bộ nhớ một tab; tăng khi explicit login/logout/clear, kể cả đăng nhập lại cùng User; không tăng khi refresh xoay token |
| `memoryUserId` | Chủ tài khoản từ SessionResponse Backend; AuthProvider truyền ID khi login, không lấy từ form |
| `refreshFlight` | Một Promise/controller/thế hệ refresh dùng chung trong cùng phiên (single-flight) |
| `AuthSessionChangedError` | Yêu cầu thuộc phiên cũ bị dừng; không phải lỗi nghiệp vụ của Backend |
| Retry | Gửi lại yêu cầu sau 401, tối đa một lần và chỉ cùng phiên/chủ tài khoản |
| Race condition | Request/phản hồi về xen kẽ khiến ghi sai dữ liệu hoặc cập nhật sai phiên |

1. Request chụp thế hệ lúc gửi. Trước refresh, sau refresh, trước retry và trước
   trả dữ liệu thành công phải còn cùng thế hệ.
2. Đổi phiên hủy refresh cũ và tách flight mới. Guard thế hệ vẫn chặn completion
   nếu transport không tuân thủ abort. Completion/lỗi cũ không ghi token,
   clearAuth hoặc xóa flight mới.
3. Refresh trả `user.id` khác chủ tài khoản đã biết: không nhận token/retry;
   xóa phiên cục bộ đó để đăng nhập lại. Startup chưa biết chủ tài khoản cho
   phép nhận session từ cookie như trước.
4. Request đã bị hủy không bắt đầu refresh hoặc retry. Hai request 401 cùng
   phiên vẫn chỉ gửi một refresh, mỗi request retry tối đa một lần.
5. AuthProvider kiểm tra thế hệ trước áp dụng startup/manual refresh hoặc kết
   quả logout. Explicit login ghi chủ tài khoản và kết thúc loading; refresh
   thường chỉ cập nhật User, không khởi tạo một thế hệ đăng nhập mới.

## Kiểm thử độc lập trên develop

```powershell
pnpm install --frozen-lockfile
pnpm --dir FE lint
pnpm --dir FE test
pnpm --dir FE build
git diff --check
```

Kết quả trên nhánh độc lập: install frozen-lockfile PASS (không đổi lockfile),
lint PASS, **47/47 test trong 7 file PASS**, build `tsc -b && vite build` PASS,
diff whitespace PASS. Baseline develop có 23 test; 24 test mới chỉ thuộc Auth.
Số 70 test của lượt kết hợp UI bên dưới không phải số test của PR độc lập này.

Hai file test sửa/thêm: `FE/src/services/apiClient.test.ts` và
`FE/src/contexts/AuthProvider.test.tsx`. Test API dùng `fetchApi` với payload
địa chỉ, không import adapter/UI của PR #49 chưa merge.

24 test mới so với baseline Frontend của develop:

- POST/PATCH/PUT/DELETE/GET 401 về muộn sau A → B không refresh/retry.
- Payload địa chỉ của A không được gửi lại; logout không login lại hoặc login
  lại cùng User vẫn từ chối completion thuộc thế hệ cũ.
- Refresh cũ thành công/401/lỗi mạng không đổi/xóa B; refresh khác chủ tài khoản
  không replay; same-Buyer refresh/retry và concurrent single-flight vẫn hoạt động.
- Flight cũ không giải phóng flight mới; caller phiên cũ không refresh; aborted
  request không refresh; response retry cũ không đổi B; lỗi refresh hiện hành
  vẫn clearAuth; retry 401 không lặp vô hạn; login retry-disabled giữ semantics.
- Startup/manual refresh và logout về muộn không thay/xóa User mới trong React.

Deferred Promise điều khiển thứ tự hoàn tất, kể cả transport bỏ qua AbortSignal.
Không lấy việc gọi abort làm bảo đảm an toàn duy nhất.

## Bằng chứng tích hợp Address bổ sung, không phải UI trong PR này

Lượt QA local ngày 10/10 kết hợp UI PR #49 `9b447c0` với **cùng hai file runtime
apiClient/AuthProvider của bản sửa này**: **70/70 FE test, lint/build PASS** và
**17/17 kịch bản Chrome → NestJS → PostgreSQL PASS**, chạy lại sau sửa.

- JWT hết hạn thật của cùng Buyer: refresh/retry tạo đúng một địa chỉ.
- 401 thật của A được giữ đến sau B login trong cùng SPA: không có địa chỉ A
  trong canonical GET của B; B còn đăng nhập và ghi địa chỉ mới được.
- CRUD/default/validation/reload/double-submit/giới hạn 20/ownership/mobile và
  lỗi mạng sau commit đều đạt. Không báo kết quả này là QA Cart/Order đầy đủ.

QA dùng cổng riêng 3012/5176 và database `bckl_hien_address_cart_20261010_pr`;
không thao tác database demo. Chỉ timing phản hồi, lỗi mạng và expired JWT
được điều khiển; body/status/records từ Backend thật, không handwritten fixture.
Buyer tạm được xóa đúng theo email/id sau khi xác nhận không có đơn, giữ fixture
bàn giao. Artifact/harness local không commit credential hoặc dữ liệu runtime.

Để lặp lại integration: dùng checkout UI #49 + patch này (hoặc UI sau khi merge),
dựng database/API QA riêng theo [PR handoff #51](https://github.com/grumhu124/BCKL_ThuongMaiDienTu/pull/51)
và thực hiện hai Buyer trong cùng SPA. Reload toàn trang hủy request cũ nên
không chứng minh được race. Không dùng tài khoản thật hoặc database demo.

## Giới hạn và thứ tự tích hợp

- Đây là PR sửa common Auth vào develop, không phải PR UI #49/#50. Sau merge,
  Hiền đồng bộ develop vào từng branch UI và re-run test/re-review đúng head.
- Chưa kiểm thử Cart/Checkout/Order toàn luồng; ADMIN/inactive chưa chạy Chrome
  trong lượt QA Address (route/unit test ở UI có bao phủ).
- Race refresh đang chờ/transport bỏ qua abort được kiểm bằng unit test; browser
  bao phủ delayed initial 401 và same-Buyer refresh, không khẳng định test mọi
  race cookie hoặc mọi tab/thiết bị.
- Thế hệ nằm trong một tab, không thêm BroadcastChannel hay tự thu hồi token
  mọi thiết bị. Abort không hoàn tác request đã được Backend chấp nhận.
- Backend phải tiếp tục kiểm JWT/ownership. Không thay đổi quy tắc dữ liệu bằng
  userId từ client, không lưu secret/token vào persistent storage.
- Integration branch có error-code/timeout bổ sung cần merge patch có review,
  không chép đè toàn bộ apiClient hoặc công việc đang dở của thành viên khác.
