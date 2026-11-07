# PR134: review đối kháng bổ sung ngày 29/10/2026

## Phạm vi và kết luận của Codex

Review implementation tại commit `fb22275872e4e097565d99f6ff91d3b2b3ea16bc`,
đối chiếu middleware/parser với route/controller, DTO/service password,
transaction quota, migration mới và cách cô lập database QA.
Không phát hiện P1/P2 mới có bằng chứng trong phạm vi này.
Đây là review nội bộ bằng AI, không thay thế phê duyệt của người chịu trách nhiệm,
pentest độc lập hoặc nghiệm thu production.

CI của commit trên đạt 6/6, gồm repository-checks, AI Ruff/Pytest và bốn ca
kiểm tra portability. Các kết quả unit/full E2E trước đó được ghi tại
[báo cáo hardening](auth-session-hardening-2026-10-29.md).

## Thiếu sót trong bằng chứng kiểm thử đã sửa

Ca trước có gửi X-Forwarded-For khác nhau nhưng dùng cùng một tài khoản;
account quota vẫn đủ làm request bị chặn dù IP quota có lỗi. Vì vậy ca đó
chưa chứng minh riêng việc không tin proxy header từ client.

Bổ sung HTTP regression: ba tài khoản khác nhau, hai Nest instance, quota IP
là hai, lần lượt thay X-Forwarded-For, X-Real-IP và Forwarded. Hai lần đầu
trả 401, lần thứ ba trả 429 AUTH_RATE_LIMITED, không phát cookie. Lượt focused
sau bổ sung đạt **33/33** bằng runtime DML-only trên database QA riêng.
Không cộng ca focused vào số full E2E như thể đã chạy lại toàn bộ.

Không đổi production source trong lượt review bổ sung này. Ca bổ sung qua
oxlint và kiểm tra định dạng Prettier.

## Điều kiện chưa thể bỏ qua trước khi lên online

- Socket IP hiện bỏ qua forwarding header có chủ đích. Sau reverse proxy,
  cần cấu hình ranh giới proxy tin cậy và kiểm quota giữa nhiều người dùng;
  không tự đổi sang tin X-Forwarded-For bất kỳ.
- Mật khẩu legacy dài hơn 72 byte bị từ chối. Cần nghiệm thu recovery/email
  trước khi mở cho các tài khoản có thể chịu ảnh hưởng.
- Cần migration và quyền DML bảng rate trước rollout. DB lỗi sẽ chặn admission
  bằng 503; cần kiểm readiness và cảnh báo vận hành.
- Fixed window có burst ở ranh giới cửa sổ và quota account có thể bị dùng
  để gây chờ tối đa một phút. Không thay thế chống bot/WAF hoặc thử tải.
- Chưa nghiệm thu TLS/cookie public, proxy, provider và luồng trình duyệt xuyên
  hệ thống trên bản triển khai. PR này độc lập PR133, chưa chứng minh bản gộp.

## Tính hợp lệ của review Gemini

Các lượt trả response rỗng hoặc bị bộ lọc chặn không được tính là review đạt.
Output công cụ giữ ngoài Git trong `machine-local/hardening-20261029`.

Lượt Argon Medium phạm vi nhỏ sau đó trả kết quả thực: NO_CONFIRMED_FINDINGS
với transaction quota trong điều kiện triển khai local đã nêu. Model kiểm tra
partial commit khi account từ chối, thứ tự khóa, timeout và fixed window;
không tự chạy test. Codex đối chiếu nhận xét với source và bằng chứng QA.

Một lưu ý độ chính xác ở ranh giới thời gian: clock_timestamp() được gọi nhiều
lần trong một UPSERT. Nếu đúng lúc cửa sổ hết hạn giữa hai biểu thức CASE,
count và resetAt có thể dùng hai thời điểm khác nhau. Chưa có tái hiện động,
không phải bằng chứng vượt quota; có khả năng làm chặn nghiêm hơn ở ranh giới.
Ghi nhận cải thiện sau cho một timestamp nhất quán mỗi admission. Không tự
đổi sang statement_timestamp() mà bỏ qua thời gian chờ khóa. Khuyến nghị model
thêm composite index chỉ là tối ưu cần đo; schema đã có index resetAt và PK,
không coi thiếu index mới là lỗi đã xác nhận.
