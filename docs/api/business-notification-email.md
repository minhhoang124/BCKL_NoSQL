# Email thông báo nghiệp vụ

Ngày 28/10/2026. Nhánh triển khai từ `d5815d5` (#131); chỉ tính tích hợp sau merge. Phạm vi FR-NOT-01/AC-NOT-01, độc lập với email xác minh/reset mật khẩu.

## Nguồn và thông tin gửi

Worker đọc Notification IN_APP từ projector lịch sử đã commit, chỉ nguồn ORDER, STORE, PRODUCT, AFTERSALE. Không gửi email cho mỗi tin Chat hoặc sửa Review trong lát cắt này. Email và inbox là hai kênh: inbox không có cutoff; email bắt buộc người vận hành đặt `NOTIFICATION_EMAIL_START_AT` UTC canonical để không tự gửi toàn lịch sử khi bật.

Job tham chiếu một Notification đã unique event+recipient+IN_APP; bảng job là kênh EMAIL duy nhất. Không checkpoint MAX(id), nên event có ID nhỏ commit muộn vẫn được quét. Mỗi lô enqueue tối đa100, một vòng gửi tối đa10, chu kỳ15 giây và chỉ một vòng hoạt động trong mỗi process. Nhiều worker dùng khóa hàng `FOR UPDATE SKIP LOCKED`.

Nội dung chỉ báo loại cập nhật và URL cố định `<web-origin>/account/notifications`, không sao chép lý do, Chat, địa chỉ, Order snapshot, số tiền hoặc token. API inbox/đối tượng vẫn kiểm quyền hiện hành. Không có API public đọc, tạo hoặc gửi lại job email. Snapshot địa chỉ nhận chỉ nằm trong bảng riêng, không được đưa vào response inbox hoặc log.

## Quyền và bất biến

Người nhận phải đang hoạt động, có email đã xác minh và role còn thuộc audience của Notification. Kiểm khi enqueue và trước dispatch. Email/from/subject/body/provider/config fingerprint/payload hash của job bất biến; không đổi người nhận hoặc provider giữa các lần thử.

Nếu trước lần thử đầu người nhận/config không còn phù hợp, kết thúc SUPPRESSED. Nếu đã có lần thử trước chưa xác minh chắc chắn, kết thúc UNKNOWN khi không còn được thử; không dùng SUPPRESSED để khẳng định thư cũ chưa gửi. Email đã được provider nhận không thể thu hồi nếu quyền đổi sau đó; nội dung generic và API đích kiểm quyền hạn chế dữ liệu rò rỉ.

Migration `20261028100000_notification_email` chỉ thêm bảng/trigger/index, không backfill hoặc sửa dữ liệu nghiệp vụ cũ. PostgreSQL chặn thay identity/payload, chuyển trạng thái không hợp lệ và sửa/xóa terminal tombstone. Giữ tombstone để projector chạy lại không gửi trùng. Chưa có quy trình retention/redaction email snapshot; cấu hình gửi thật cần chính sách vận hành riêng, không dùng QA này để tuyên bố production.

## Gửi, retry và kết quả chưa rõ

| Trạng thái | Ý nghĩa |
|---|---|
| QUEUED / RETRY_WAIT | Chưa đến lượt hoặc đang chờ lần thử hợp lệ. |
| LEASED | Một worker có lease/token; không phải bằng chứng đã gửi. |
| ACCEPTED_BY_PROVIDER | Provider trả ID hợp lệ; chưa có nghĩa thư đã đến Gmail/inbox người nhận. |
| SUPPRESSED | Đã chặn trước dispatch đầu tiên do quyền/config không phù hợp. |
| UNKNOWN | Có thể đã nhận ở ngoài, hoặc không còn điều kiện xác minh/thử an toàn; không tự gửi lại. |
| FAILED | Từ chối chắc chắn ở lần đầu; không tái tạo job cùng event. Các lần sau có khả năng mơ hồ được giữ UNKNOWN bảo thủ. |

Lease30 giây, network deadline5 giây, tối đa5 dispatch, backoff30/60/120/240/480 giây (hàm có trần15 phút). Ghi marker `firstDispatchAt`/`attemptStartedAt` bền trước HTTP; network luôn ngoài transaction. Lease chết trước dispatch cũng có backoff; sau dispatch chỉ Resend còn trong cửa sổ an toàn được retry. Finalize so `notificationId`, LEASED, lease token và hạn lease theo giờ DB; worker cũ không ghi đè kết quả mới.

Enqueue dùng INSERT bỏ timestamp để lấy default PostgreSQL; các quyết định lease/retry/finalize dùng đồng hồ DB, không `Date.now()` host. Nếu DB wall clock lùi trong khi nhận receipt, acceptedAt được chặn dưới bởi firstDispatchAt và ghi EMAIL_CLOCK_ADJUSTED; đây là thời gian ghi nhận chuẩn hóa, không thời gian giao thư và không dùng tính tiền.

Resend dùng cùng key `notification-email-<NotificationId>` và payload qua mọi lần thử, chỉ retry dưới23 giờ từ firstDispatchAt; tài liệu provider lưu key24 giờ. Dùng tài khoản/API key riêng theo môi trường, không reset/nhân bản database sang môi trường bật cùng provider key để tránh đụng namespace. Không xoay key hoặc chuyển provider để né UNKNOWN. [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys).

Mailpit chỉ là hộp bắt thư QA loopback, không relay hoặc bằng chứng gửi ra ngoài. Sau dispatch không tự retry khi mất phản hồi, crash hoặc 429; giữ UNKNOWN/FAILED tùy kết quả. Không coi Message-ID tự đặt là provider dedupe. [Mailpit API](https://mailpit.axllent.org/docs/api-v1/).

HTTP response bị chặn redirect, deadline và body8KiB; lỗi chỉ lưu mã cố định, không ghi response/key/email vào log. ACCEPTED yêu cầu provider message ID hợp lệ. Mọi lỗi queue/network xảy ra sau transaction nghiệp vụ, không rollback Order/Payment/Stock/kiểm duyệt.

## Cấu hình

- `NOTIFICATIONS_ENABLED=true` cho nguồn inbox; `NOTIFICATION_EMAIL_ENABLED=true` và `NOTIFICATION_EMAIL_WORKER_ENABLED=true` cho scheduler email. Hai cờ email mặc địnhfalse.
- `NOTIFICATION_EMAIL_PROVIDER=resend`, `NOTIFICATION_EMAIL_FROM`, `NOTIFICATION_EMAIL_API_KEY`, `NOTIFICATION_EMAIL_WEB_ORIGIN`, `NOTIFICATION_EMAIL_START_AT` là cấu hình riêng ngoài Git. Origin không path/query/hash/credentials; production yêu cầu HTTPS. Không sao chép secret vào biến VITE.
- Mailpit dùng provider `mailpit`, `NOTIFICATION_EMAIL_LOCAL_SANDBOX_ENABLED=true`, chỉ NODE_ENV khác production và database app-role QA loopback5549. Transport pin `http://127.0.0.1:8025/api/v1/send`, không nhận origin mail tùy ý.
- Worker không khởi động nếu cấu hình sai; chỉ cảnh báo mã cố định, không chặn bootstrap/nghiệp vụ. Tắt scheduler khi chạy E2E; driver gọi worker có scope recipient riêng. Scope là điều khiển nội bộ, không endpoint hay quyền cho khách hàng.

## Kiểm thử

[Bằng chứng, giới hạn và hướng dẫn QA](../testing/business-notification-email-2026-10-28.md). Chưa nghiệm thu Resend/Gmail hoặc webhook delivered/bounce. Không coi adapter Auth email là bằng chứng cho chức năng này.

Không cam kết exactly-once giao thư. Bằng chứng hiện tại là unique queue/lease và retry trong giới hạn provider; UNKNOWN không được tự đổi thành chưa gửi hoặc tự tạo job mới.
