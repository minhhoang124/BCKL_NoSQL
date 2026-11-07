# Chuẩn bị Google OAuth — 27/10/2026

**Cập nhật 27/10:** #127 đã merge; nhóm đã tạo Client ID, giữ secret riêng và
đăng nhập Google thật trên nhánh OAuth kế tiếp. Xem [runtime/QA](google-oauth-2026-10-27.md).
Các mục dưới là checklist cấu hình và thiết kế; không thay đổi SRS hoặc nhận
nghiệm thu production bằng kết quả mock/review AI.

## Nhóm chuẩn bị trên Google Cloud

1. Chọn project do nhóm kiểm soát; cấu hình Google Auth Platform/consent screen
   với tên ứng dụng, email hỗ trợ, audience External/Testing và tài khoản QA.
2. Tạo OAuth Client loại **Web application**. Chỉ xin `openid email profile`;
   đăng nhập không cần quyền Gmail/Drive, offline access hoặc Google refresh token.
3. Backend repo mặc định cổng **3001**, không có prefix `/api/v1`. Đích callback
   đã chốt `http://localhost:3001/auth/google/callback` cho nhánh runtime OAuth.
   Đăng ký đúng URI trong contract,
   khớp chính xác scheme/host/port/path. Không trộn localhost và 127.0.0.1.
4. Nếu triển khai GIS trên Web, cấu hình JavaScript origin đúng origin Web
   (local thường `http://localhost:5173`). Server code flow không cần tự thêm
   Backend vào danh sách JavaScript origins nếu không có client JavaScript tại đó.
5. Client ID không phải mật khẩu; client secret chỉ nằm trong cấu hình Backend
   riêng. Không gửi secret qua chat/Git/clip, không đặt vào biến `VITE_*`.

Không cần mua dịch vụ email để tạo cấu hình đăng nhập này. Chưa tạo account,
Cloud project, credential hoặc thay đổi billing thay nhóm trong lượt QA.

## Ranh giới triển khai cần review

- Dùng thư viện Google chính thức cho code exchange/ID token verification;
  xác minh signature, issuer, audience, expiry, nonce và state. Redirect cố định,
  không đưa ID/access/refresh token vào URL hay localStorage.
- Identity khóa bằng `(provider, sub)`, không bằng email. Email trùng account
  cũ không tự đăng nhập hoặc tự liên kết; giữ login bằng mật khẩu và luồng liên
  kết có bằng chứng chủ tài khoản riêng. Tạo account mới chỉ quyền USER.
- Email Google bên thứ ba có `email_verified=true` nhưng không Gmail/Workspace
  chưa đủ để tự đánh dấu mailbox hiện tại đã xác minh. Áp dụng quy tắc mailbox
  authority theo tài liệu Google; nếu không đủ thì dùng email verification của app.
- Challenge một lần có expiry, gắn browser/session/purpose. Kiểm cookie proof
  **trước** khi cho consume; claim nguyên tử trước trao đổi code, rồi xác minh
  token và ghi nghiệp vụ bằng transaction ngắn. Không giữ User lock trong lúc
  gọi Google. Thất bại sau claim không mở lại challenge; người dùng chủ động bắt đầu mới.
- LINK cần actor/CV hiện hành và xác thực lại phù hợp; account local dùng mật
  khẩu hiện tại. Google-only cần cơ chế reauthentication Google, không yêu cầu
  một mật khẩu người dùng chưa từng đặt. Không đổi nullable passwordHash/schema
  toàn hệ thống chỉ để làm nhanh OAuth; phải review tác động riêng.

Gemini Argon Medium đã rà thiết kế độc lập. Hai nhận xét không áp nguyên văn:
consume challenge trước kiểm browser proof có thể tạo cơ hội làm chết yêu cầu;
so sánh `hash(nonce nhận được)` với digest lưu sẵn không phải lỗi “double hash”.
Logout hiện tại chỉ thu hồi session, không mặc nhiên tăng CV; test LINK phải
kiểm session còn hiệu lực, không giả định logout làm CV đổi. Review AI chỉ là
đầu vào đối chiếu, không thay kiểm chứng protocol và test.

## Kiểm thử bắt buộc trước nghiệm thu

Sai/thiếu cookie/state/nonce; audience/issuer/expiry sai; hai callback đồng
thời; code replay; Google mất kết nối; email trùng; sub giữ nguyên nhưng email
đổi; account khóa/role/CV/session đổi giữa luồng; link sang User khác; redirect
ngoài danh sách; không lộ token/secret; không tự cấp Seller/Admin. Cuối cùng
kiểm Chrome với OAuth Client thật và tài khoản QA được nhóm cho phép.

Nguồn chính thức đã kiểm 27/10/2026:
[OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect),
[Verify Google ID token](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token).
