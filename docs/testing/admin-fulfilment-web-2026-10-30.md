# Khép CI137 và nghiệm thu giao hàng qua Web —30/10/2026

## CI sau merge137

Develop `23096fa3a43f82998507d45a8efa7d17b2bface1` đã kiểm lại **6/6 success**,
gồm repository-checks job123822590570,AI và4 evaluation-byte jobs.
Đây là CI sau merge137, không thay bằng CI head fe2ed43 trước merge.

## Phạm vi bổ sung

Trước lượt này Admin chưa có UI giao hàng; driver cũ gọi API trực tiếp.
Bổ sung `/admin/fulfilment`, hai GET projection tối thiểu và nối các lệnh
delivery/returned đã có. Không đổi transaction tiền/kho hoặc schema/migration.
[Contract và giới hạn phục hồi](../api/admin-fulfilment-web.md).
Giữ quyết định owner: MoMo chuyển hướng mở rộng, bản nộp giữ COD/VNPay.

## Các nhánh nghiệm thu và ledger

Catalog/actor/địa chỉ tổng hợp; Checkout và Seller chuẩn bị gọi HTTP thật.
Admin và Buyer dùng Chrome thật qua route production; không mock thành công.
Mỗi fixture mua2 món giá10000, kho ban đầu5, sau Checkout còn3.

|Nhánh|Kết quả phải đối chiếu|
|---|---|
|Admin ship→delivered→Buyer complete|COMPLETED/PAID;kho3,một decrement,1lần giao|
|Giao thất bại→giao lại→delivered→Buyer complete|COMPLETED/PAID;kho3,2lần giao;callback attempt1 khi đang attempt2 bị409 không ghi thêm|
|Hàng giao thất bại quay về, nhập lại|CANCELLED/Payment CANCELLED;kho5,một CANCELLATION_RESTORE +2|
|Hàng hoàn hỏng|CANCELLED/Payment CANCELLED;kho3,không restore|
|Thất lạc|CANCELLED/Payment CANCELLED;kho3,không restore|
|Bốn lần giao thất bại|DELIVERY_FAILED/UNPAID;4attempt,kho3;UI không có giao lại lần5|
|Hai Admin nhận hoàn đồng thời —HTTP/PG|200/409;chỉ một restore và một transition;không tính đây là hai browser tab|
|Buyer hủy trước xác nhận —Chrome|CANCELLED/Payment CANCELLED;kho5,một CANCELLATION_RESTORE +2;Buyer/Seller không truy cập được route Admin|

Hàng giao thất bại quay về rồi hủy dùng CANCELLATION_RESTORE theo contract
OrderReturned hiện có;RETURN_RESTORE thuộc luồng hậu mãi sau giao. Không gộp
hai vòng đời này khi viết báo cáo hoặc tính số ca.

Các lệnh mô phỏng không phải giao vận/thu tiền thật. Stock,Payment,history,
command count và DeliveryAttempt được kiểm DB, không chỉ dựa toast/trạng thái Web.

## Đối kháng và hồi quy

- FE tập trung **27 PASS**:10 ca mới và17 Admin hiện có. Bấm đôi chỉ một flight;
  journal metadata không PII;đổi payload khi pending không gửi;reload phải
  xác nhận lại;replay429 giữ intent;phiên cũ không xóa journal phiên mới;
  response cũ không thay đơn mới;đổi đơn xóa reason/receipt/consent cũ.
- HTTP/PG cuối **50 PASS**:5 Admin read,24 delivery,21 returned. Bộ đầy đủ
  chạy bằng QA migrator vì4 ca rollback chủ động CREATE FUNCTION/TRIGGER.
  App-role không được cấp DDL. Lượt DML trước đạt45/49,4 fail vì thiếu quyền
  dựng fault;giữ log và không cộng45+50 thành95. Browser chạy DML app-role.
- Reader kiểm Buyer/Seller403,unauth401,query/body/ID sai400,missing404,
  credential cũ401;projection không PII và Decimal canonical;đọc không sửa
  nghiệp vụ. Test khóa actor xác nhận fail503 trong giới hạn,không lộ SQL.
- Chrome kiểm lost-response sau commit→reload→nhập lại đúng body→replay cùng
  key trả biên nhận cũ;không có thêm restock/command. Replay ship sau Order
  đã COMPLETED vẫn trả receipt SHIPPING gốc,replayed=true và không sửa đơn.
- Desktop light và mobile dark preference được kiểm;surface Admin giữ theme
  sáng hiện tại. Không nhận đã kiểm Safari/thiết bị vật lý hoặc nhiều instance.

## Review và các lỗi đã sửa trước tích hợp

Argon Medium review source chọn lọc,phản hồi thực được giữ cùng snapshot/hash.
Codex đối chiếu các giả thuyết bằng code và runtime;không gọi model review là
human approval hoặc chứng nhận ASVS/pentest.

Chrome/typecheck phát hiện và đã sửa:Decimal JSON thiếu phần `.00` ở GET mới;
tên truy cập select/textarea;reason/receipt đơn trước còn trong form khi đổi
đơn. Codex bổ sung fence cho lỗi401 của phiên cũ để không xóa journal phiên mới.
Theo góp ý review,bổ sung timeout503 và kiểm replay sau transition/race hai Admin.

Các lỗi harness giữ riêng:URL địa chỉ `/addresses` thay vì `/me/addresses`;
chuẩn bị nhiều Checkout vượt5intent/phút;cwd runner,fixture thiếu checkoutId;
test dùng option `exact` của Playwright trong Testing Library;assertion ban
đầu nhầm RETURN_RESTORE với CANCELLATION_RESTORE của contract giao thất bại;Node WebCrypto
test cần annotation theo quy ước browser tsconfig của repo. Không hạ validation
hoặc nâng quyền runtime để làm test xanh. QA riêng dùng checkout60/command200
nhằm chạy fixture nhanh,không phải bằng chứng quota production.

## Phần chưa được gọi hoàn thành

- Seller hủy sớm và Seller tự nhận hàng quay về vẫn có affordance disabled
  trong OrderPanels hiện hành;không gộp vào các ca Admin PASS hoặc gọi toàn bộ
  G-FULFILMENT DONE. Buyer hủy sớm có workspace riêng;nghiệm thu bổ sung ghi
  cùng artifact cuối nếu đã chạy.
- Admin pending chưa có abandon/close endpoint;nếu quên body cần đối chiếu
  vận hành. Không hướng dẫn xóa journal hoặc tạo key mới để né bất định.
- HTTPS/staging,provider QC và logistics thật giữ nguyên giới hạn trước đó.
- Đây là nghiệm thu local trên nhánh mới;CI137 không thay CI head mới của PR.

Artifact ngoài Git: `machine-local/priority-20261030/`,các thư mục
`admin-browser-*`,`fulfilment-http-*`,`fulfilment-ddl-*`,`review-admin-*`.
Lượt cuối `admin-browser-1793325404129`:7 nhóm Chrome PASS (6 nhánh Admin,
Buyer hủy sớm và route Admin bị từ chối),1 race HTTP giữa hai Admin;8 Order
được đối chiếu ledger. `fulfilment-ddl-1793324625892`:50 HTTP/PG PASS.
`machine-local/admin-fulfilment-20261030/focused-web.json`:27 FE PASS.
Argon Medium cuối `review-admin-1793325028235` không xác nhận P1/P2 trong
source đã gửi;Codex kiểm lại giả thuyết và phạm vi trước commit.
Driver cuối ghi source SHA256 và chặn nếu file thay đổi khi đang chạy.
Ảnh,fixture chứa token,password tổng hợp,dump và log không được commit.
