# Attributes write protocol — SQL experiment, không phải API runtime

20/10/2026, branch `codex/admin-attribute-write-policy`. Chưa dùng schema #77
chưa merge làm nền. Không đổi controller/service runtime, migration hoặc schema
dùng chung; suite tạo các bảng fixture trong schema UUID riêng trên DB QA
`bckl_order_resolution_test_attr_protocol_1020`, loopback5549. Dọn đúng schema
do suite tạo, không đọc/ghi public/demo. Đây là proof cơ chế SQL, không phải
proof audit/SearchOutbox hoặc Seller API production đã hoàn thành.

## Phát hiện quan trọng trước triển khai

Lượt thiết kế đầu: Serializable + SELECT category FOR UPDATE + đọc definition
khác sau chờ, **5PASS/1FAIL**. Seller vẫn có thể thấy definition cũ nếu transaction
Admin chỉ đổi definition, không tạo tuple mới ở category lock row. Serializable
snapshot không tự refresh vì chờ khóa trên một row khác không thay đổi.
Không được mô tả category/advisory lock đơn thuần là đã giải quyết phantom rule.

Giữ ca counterexample riêng: hai connection thật, xác nhận waiter bằng
pg_stat_activity; database mới có required=true nhưng transaction waiter cũ
vẫn đọc false. Test PASS nghĩa tái lập rủi ro, KHÔNG nghĩa behavior đó an toàn.

Prototype thay bằng shared **write fence** (ghi trên cùng hàng Category trước
đọc cấu hình) để hai Serializable snapshot chồng phải retry khi fence đổi;
khóa theo Category → Definition, retry chỉ40001/40P01 tối đa3lượt.
Trong bảng fixture dùng UPDATE id=id, không đề xuất tự đưa thẳng câu này vào
Category production hoặc tự thêm revision Category mà chưa review.
Runtime phải chọn fence/revision protocol rõ, áp đủ Admin/Seller/submit/category
changes, đo contention và kiểm writers còn lại trước nhận là an toàn.

## Kết quả cuối

`test/attribute-write-protocol-preparation.e2e-spec.ts`: **7/7 PASS**,0.51s.

1. SELECT-only counterexample tái lập snapshot cũ.
2. Hai Admin cùng expectedRevision: một CHANGED/một STALE, đúng một fixture
   audit/job; retry stale/no-op không tạo thêm.
3. Seller trước/Admin sau: ProductValue fixture ngăn đổi type đang dùng.
4. Admin trước/Seller sau: waiter dùng snapshot mới sau retry, chặn submit
   thiếu required, không dùng state ngoài transaction.
5–6. Fault sau audit hoặc job fixture: metadata/revision/history/work rollback;
   retry sau đó chỉ lên revision2.
7. Int-max revision không wrap/reset.

Lint/typecheck/diff-check PASS. Chưa chạy full E2E nhánh policy sau bổ sung này;
không nhận7ca SQL là HTTP Admin/Seller, option-trigger deadlock, normalized DB
uniqueness hoặc Search integration. 108test policy/auditor cũ có phạm vi riêng.

## Gate triển khai

### Bổ sung option và giới hạn retry (lượt sau cùng 20/10)

Thêm bảng option fixture có FK về definition và AFTER INSERT trigger tăng
revision cha. Đây vẫn là schema fixture riêng, KHÔNG dùng migration/trigger #77
chưa merge làm bằng chứng runtime.

Ba ca mới: 5 writer đồng thời khóa cha trước FK/trigger; hai writer cùng
expectedRevision chỉ một thành công; lỗi sau INSERT rollback cả option và
revision trigger. Prototype còn có category write fence nên chưa tách riêng
hiệu quả khóa cha hoặc chứng minh actual option-trigger production không deadlock.

Lượt đầu 9PASS/1FAIL: kỳ vọng cả5writer thành công ngay không đúng với giới hạn
3retry Serializable. Không tăng retry hoặc bỏ giới hạn để né lỗi. Test mới giữ
nguyên3retry, đợi tất cả request settle; chỉ chấp nhận lỗi40001/40P01, kiểm số
option/revision đúng số request đã commit, rồi retry riêng request đã rollback
ở lượt sau. Không retry request đã thành công. Runtime tương lai cần trả failure
rõ khi hết retry, không được nhận thành công/accepted mà mất công việc.

Kết quả cuối:10/10DB tests PASS, chạy lại lần nữa10/10PASS;108policy/auditor
unit PASS; full Backend unit761PASS/30files; lint/typecheck/diff-check PASS.
Không chạy full Backend E2E hoặc HTTP Admin/Seller trong lượt bổ sung này.
Không có source runtime, schema hay migration dùng chung bị thay đổi.

#77 hiện head4cad89d: CI xanh, Đạt approve đúng head; Hiền còn COMMENT ở head
dd8e5b3. Chưa merge hoặc mở editor ghi trước gate review bản mới.

Sau #77 merge chính thức: sync lại nền, dùng cơ chế trên làm đầu vào review
lock protocol. Phải chứng minh actual writers + parent-before-child options,
revision/audit/durable job atomic và HTTP concurrency trên schema thật.
Không hạ gate vì thử nghiệm có ít connection hoặc không thấy deadlock.
