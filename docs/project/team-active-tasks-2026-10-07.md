# Task đang giao cho Hiền và Đạt — 07/10/2026

@Hiennq44 @dungdat: Hoàng tổng hợp lại việc đang giao để nhóm làm song song, không chờ toàn bộ PR mới bắt đầu. Đây là nhắc lại phân công, **không chuyển toàn bộ Buyer UI hoặc Backend sang Hiền/Đạt**.

Theo dõi/cập nhật tiến độ tại [issue #32](https://github.com/grumhu124/BCKL_ThuongMaiDienTu/issues/32); checklist Hoàng tại [issue #33](https://github.com/grumhu124/BCKL_ThuongMaiDienTu/issues/33).

## Baseline và cách báo tiến độ

- Baseline kiểm thử lịch sử ngày 07/10 là `develop 6663fab`: Address Backend #30 và Cart Backend #31 đã merge; Hiền có thể nối API thật ngay. Cập nhật ngày 08/10: #29 đã merge vào `develop` tại `c6e0ba1`.
- #29 head đã review `6cbaeb1`: Hiền và Đạt đã approve; [review Search của Đạt](https://github.com/grumhu124/BCKL_ThuongMaiDienTu/pull/29#pullrequestreview-5439915734). Đây là thiết kế đã merge, không phải Checkout đã chạy.
- [#35](https://github.com/grumhu124/BCKL_ThuongMaiDienTu/pull/35) head `88e1c78`: Đạt đã chuẩn bị runbook/preflight, CI xanh, Hiền approve ngày 08/10; Hoàng còn review. **integrationStatus=NOT_RUN**; không dùng health/OpenAPI để nghiệm thu tích hợp Checkout.
- #25 đã approve tooling; chưa đồng nghĩa 1.032 cặp đã consensus hoặc được phép công bố Precision/Recall.
- #28 vẫn Draft, chưa nghiệm thu Admin UI.
- Nguồn phạm vi: `docs/project/implementation-scope.md`, SRS `docs/analysis/hien/srs-v3.md`; phân công chi tiết bổ sung đã merge qua [PR #29](https://github.com/grumhu124/BCKL_ThuongMaiDienTu/pull/29). Issue này cụ thể hóa việc, không thay quyết định phạm vi trong #11.

## Hiền — CODE và QA

- [ ] **Buyer Address UI:** tách PR riêng từ develop mới nhất. Dùng theme cam-trắng, Auth và API client hiện có; danh sách/thêm/sửa/xóa/default. Form giữ dữ liệu khi lỗi, chặn gửi trùng; không bỏ default qua PATCH; district nullable; tối đa 20 địa chỉ. Nối API #30 và có bằng chứng trình duyệt.
- [ ] **Buyer Cart UI:** tách PR riêng, nối API #31. Nhóm theo Store; quantity tuyệt đối 1–99, xóa, chọn dòng/Store; `lineCount`, `totalQuantity`, `purchasableSubtotal`, tổng subset đang chọn. Dòng không mua được không được chọn; Product không public chỉ dùng thông tin tối thiểu để xóa. Thêm giỏ không giữ kho. Xử lý giá/kho thay đổi và lỗi phiên đăng nhập.
- [ ] **Admin #28:** hoàn thiện luồng có API thật, loading/empty/error/success/forbidden, conflict phiên bản và chặn double-submit. Duyệt Product phải thấy ảnh/variant/thuộc tính/shipping; cập nhật danh sách sau thao tác. Feature chưa có API phải ghi blocked/TARGET, không dùng mock để báo DONE.
- [ ] **Ground truth:** cùng Đạt rà 1.032 cặp trên corpus/mapping đã khóa; giữ nhãn độc lập, giải quyết bất đồng, ghi provenance. Báo số đã gán/đã review/đồng thuận/còn treo, không lấy ảnh catalog tự khớp làm bằng chứng chất lượng.
- [ ] **Review Checkout:** sau PR Hoàng, đối chiếu Q1–Q7/CHK/QCHK, migration legacy/receipt và test cạnh tranh kho; cập nhật traceability SRS → API → test theo thiết kế đã duyệt, không sửa SRS để hợp thức hóa bug.

Phạm vi UI: page/component/style/service/type/test của Address/Cart và Admin. Phối hợp route/file dùng chung với Hoàng trước chỉnh router; không tự đổi Auth/global client/schema/contract. **Hoàng review code UI của Hiền; Hiền review nghiệp vụ và Backend của Hoàng.**

## Đạt — AI/Search và thực nghiệm

- [x] **Re-review #29 đúng head `6cbaeb1`:** Đạt đã approve tại review `5439915734`; stock → Product.version/outbox atomic, payload canonical trong transaction, một version/event mỗi Product, retry event bất biến và hydrate cùng Variant đã được chấp thuận ở mức thiết kế.
- [x] **Chuẩn bị runbook/preflight #35:** head `88e1c78`, CI xanh; Hiền đã approve. Chưa phải runner Checkout đầy đủ hoặc bằng chứng tích hợp PASS.
- [ ] **Theo dõi #25:** tooling có review, nhưng chỉ chạy metric khi gate cho phép. Phối hợp consensus 12 query × 86 Product = 1.032 cặp, không đổi corpus/mapping/model/tham số âm thầm và không báo Precision/Recall trước khi đủ nhãn.
- [ ] **Chuẩn bị test tích hợp thật CHK-S01–S03:** môi trường DB/index/artifact riêng; Checkout → SearchOutbox → worker → FastAPI → Elasticsearch + FAISS → hydrate. Chuẩn bị trước, nghiệm thu sau khi Checkout chạy. Không mock HTTP Backend–FastAPI làm bằng chứng integration.
- [ ] **Kiểm version/retry:** index lỗi một phần, event cũ STALE, không duplicate vector. Phân biệt hydrate loại kết quả sai với việc khôi phục sản phẩm bị index cũ bỏ sót; không hứa search đầy đủ tức thời.
- [ ] **CHK-S04:** hoàn kho → index khi PR Order/cancel đã chạy; chưa là acceptance của Checkout đầu tiên.
- [ ] Bàn giao kết quả thực nghiệm, lệnh tái lập, model/corpus/mapping hash, tham số, latency và hạn chế đúng phạm vi khóa luận.

Đạt không nhận CRUD Address/Cart, migration Checkout, COD hoặc UI mua hàng. Nếu cần đổi contract Backend–AI, báo Hoàng và review trước khi code.

## Checkpoint đề xuất và cách cập nhật

- **07–09/10:** Hiền mở PR nhỏ Address/Cart UI, cập nhật Admin; Đạt tiếp tục consensus và phối hợp nối harness tích hợp khi Checkout sẵn sàng. Review #29 và phần chuẩn bị runbook/preflight #35 đã xong; kiểm thử tích hợp thật chưa chạy. Mỗi người báo phần thực sự có thể bàn giao.
- **10–11/10:** thử demo tích hợp phần đã có, ghi lỗi/chưa đạt; Checkout phụ thuộc review và test. Đây là mục tiêu đề xuất, **không nhận deadline thay thành viên**.
- Nếu mốc không khả thi, comment sớm phần thiếu/dependency và mốc đề xuất, không giảm kiểm soát tồn kho hoặc ghi DONE chỉ từ CI xanh.

Mẫu comment: **Đã làm / Đang làm / Blocker / PR + commit / Test đã chạy / Việc tiếp theo / Mốc bàn giao dự kiến.** Hiền đã nhận task CODE hai màn; chỉ cần phản hồi đã nắm và cập nhật tiến độ, không phải xin xác nhận lại việc được giao.

Thuật ngữ: **contract** = thỏa thuận API/nghiệp vụ; **consensus** = thống nhất nhãn đánh giá; **hydrate** = đọc dữ liệu hiện hành PostgreSQL cho ID tìm kiếm; **outbox** = công việc đồng bộ ghi cùng giao dịch; **idempotent** = gửi lại không tạo tác dụng nghiệp vụ lần hai.
