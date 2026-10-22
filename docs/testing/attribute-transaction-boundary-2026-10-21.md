# Kiểm chứng khung giao dịch Attributes — 21/10/2026

## Nhận #93 chính thức — 22/10/2026

#93 đã squash merge vào develop `966f146`. Nhánh #91 nhận commit này;
conflict chỉ tài liệu kiến trúc, giữ hai phía. Production kernel/schema/AI/FE
nguyên byte head `504eb1c`; Search E2E nhận đúng bản sửa đã được Đạt duyệt.
Không bỏ assertion backlog, purge job/audit, tăng batch hoặc sửa timeout.

Kiểm mới trên bản kết hợp, QA loopback5549/v903 đã có16migrations, demo dừng:

| Kiểm tra | Kết quả thực chạy |
| --- | --- |
| Full Backend E2E | **706 PASS /20TODO**,36files PASS/1SKIP,201.50s |
| Full Backend unit | **795 PASS**,35files,18.39s |
| Backend typecheck/lint/build/diff-check | PASS |

36 kernel và48 Search là subset của706, không cộng trùng. Bản full698PASS/8FAIL
bên dưới là lịch sử thật, không xóa. Full mới đã nhận regression21job chính
thức, không chỉ rerun source cũ. Chưa CRUD/controller/provider hoặc live index.
Chủ repo cho phép ngoại lệ CI billing ngày22/10; CI vẫn chưa chạy, không gọi
localPASS là CIxanh. Head sau sync cần reviewer kiểm lại trước merge.

## Bổ sung usage sau #86/#73 — baseline `be568e0`

Thêm `optionCount`, `activeOptionCount`, `categoryProductCount` vào context bất
biến, đọc cùng snapshot sau fence; giữ cả hai count tham chiếu hiện có. Không
schema/controller/provider hoặc ghép source #83/#87/#92 chưa merge.

| Kiểm tra lượt mới | Kết quả thực tế |
| --- | --- |
| RED ba probe mới trên source cũ | 3 FAIL do thiếu trường count |
| Kernel PostgreSQL sau sửa | 36/36 PASS, 2.47s; gồm 3 probe mới |
| Full Backend unit | 795 PASS /35files,17.25s |
| Lint/typecheck/build/Prisma validate/diff-check | PASS |
| Full Backend E2E lượt mới | 698 PASS /8 FAIL /20TODO,189.75s; KHÔNG đạt |
| Search chạy riêng sau đó | 48/48 PASS,23.09s; không thay thế full E2E |

Ba probe mới kiểm count=0/no-op bất biến; scope count gồm option inactive,
definition khác/Category khác và Product chưa có value; hai pool quan sát
`pg_blocking_pids` trước khi nhả writer rồi thấy canonical category count mới.
Không gọi harness thành Seller production hoặc kiểm thử nhiều OS process.

8 lỗi full E2E bắt đầu từ Search test giả định một `runBatch()` luôn xử lý
được job mới của Store. Worker thật chỉ lấy 20 job cũ nhất; fixture kernel giữ
job/audit hợp lệ nên hàng đợi có thể dài hơn. Test đầu để Store SUSPENDED khi
assert fail, gây 7 lỗi 403 tiếp theo. Nhánh test riêng từ develop đã tái lập
tất định với 21 job của Category rỗng: Store job vẫn PENDING/attempt0 và version
chưa tăng. Không sửa worker/bỏ batch limit, không xóa audit/job cũ để làm xanh.
Chờ bản sửa test được review rồi kiểm lại full suite #91; không lấy lần chạy
703 PASS trước đây hoặc 48 PASS riêng làm bằng chứng source cuối full-green.

## Bản cập nhật sau merge #88 và bổ sung tạo definition

Đã nhận develop `d84381a`: giữ fail-closed setup trước collection, không đọc
dotenv hoặc nới target. Conflict chỉ kiến trúc, giữ cả hai phía. Thêm internal
`createDefinition`, chưa provider/controller/HTTP/normalized uniqueness hoặc
production Seller integration. Không ghép source #83/#87 chưa merge.

DB QA riêng `bckl_order_resolution_test_attributes_20261019_v903`, role không
superuser, loopback5549. DB được tạo mới và áp16migrations hiện hành trước lượt
kiểm #83 + #88; sau đó các suite chạy tuần tự, fixture audit UUID giữ lại. Không
gọi mỗi lần chạy tiếp là một DB mới hoặc xóa audit bất biến để dọn fixture.

| Kiểm tra source mới | Kết quả |
| --- | --- |
| Unit khung giao dịch | 30/30 PASS (thêm8ca create), nằm trong full unit |
| PostgreSQL khung giao dịch | 33/33 PASS,3.60s (thêm11ca create), nằm trong full E2E |
| Full Backend unit | 795 PASS /35files,12.25s |
| Full Backend E2E | 703 PASS /20TODO,36files PASS /1SKIP,183.49s |
| Backend lint/typecheck/build/Prisma validate/diff-check | PASS |

11ca mới: revision1/audit một lần và không job vô cớ; canonical category usage
và job cùng commit; lỗi job rollback; SQL audit trigger lỗi rollback; actor
thiếu/inactive/sai role/Category thiếu; planner409 không giữ ghi dở; không cho
plan override identity/revision/timestamp; scope snapshot trước await; hai Admin
cùng slug chỉ một thành công; khác slug độc lập; internal shape/effect/reason sai.
Unique ở đây chỉ là slug constraint hiện có, KHÔNG phải normalized-name unique.
Planner test là harness tin cậy; chưa chứng minh full policy producer thực tế.
Rollback kiểm hàng nghiệp vụ/audit/job, không hứa sequence không có khoảng trống.

CLI `claude-opus-4-6-thinking` rà source-only phần create và helpers, không dùng
tool/DB hoặc xem secret. Không thấy demonstrated P1/P2 trong đoạn được cung cấp;
đầu ra kết thúc giữa giải thích return, không nhận là full independent review,
test độc lập hoặc approval thay Hiền/Đạt. Lượt gọi CLI trong sandbox không truy
cập được đăng nhập không tính là review; sau cấp quyền dùng đúng model trên.

Một lượt unit đầu bị EPERM cache Windows trước collection (0test), chạy lại
đúng thư mục BE/cấp quyền đạt30/30. Docker đã ngừng rồi khởi động lại trong đợt:
preflight từ chối trước DB connection khi engine thiếu hoặc demo đang chạy;
dừng đúng container demo, không xóa container/volume, rồi mới chạy QA. Không
khẳng định dữ liệu demo tuyệt đối bất biến từ việc container từng khởi động;
không có test nào được cho qua guard để dùng demo trong đợt này.

## Lịch sử bản trước f4eb5a5 (không thay bằng chứng bản mới)

Nền `fa85f66`; source mới độc lập, chưa controller/provider/API. Không schema
hoặc migration mới; không ghép pending #83/#87/#88/#90 làm nền chính thức.

## Môi trường an toàn

Fresh16migration trên DB mới `bckl_order_resolution_test_attributes_20261019_v902`,
cluster QA riêng loopback5549, SCRAM/role không superuser và khác demo. Checkout
không có root/BE `.env`; trước mỗi E2E chốt target QA và demo phải tắt. Bootstrap
E2E cũ vẫn theo develop; không chạy root E2E còn dotenv override, không ghi rằng
#88 đã merge. Không xuất URL/password/config/SQL log trong báo cáo hoặc prompt.

Một lượt chuẩn bị QA đầu lỗi chưa có verdict thành công; sau pg_isready chạy
lại chốt quyền/target, chỉ tạo DB mới khi chưa tồn tại. Không DROP/reset/reuse
DB cũ hoặc sửa demo. Fixture audit bất biến được giữ trên DB dùng một lần,
không tắt trigger/xóa audit để teardown. Hai PrismaService có pool độc lập.

## Kiểm tra đã chạy

| Nhóm | Kết quả |
| --- | --- |
| Fresh migration hiện có | 16/16PASS |
| Unit bounds/retry mới | 22PASS trong full unit, không cộng trùng |
| Full Backend unit source cuối | 773PASS/34files |
| Kernel PostgreSQL trước adversarial bổ sung | 18PASS; sau bổ sung20case nằm trong full690E2E |
| Hai probe audit bất nhất trước sửa | 2FAIL/20case không chọn, đúng expected: transaction đã resolve thay vì reject |
| Sau sửa audit consistency | 22/22kernel PostgreSQL PASS,2.05s |
| Full Backend E2E trước hai probe/sửa consistency | 690PASS/20TODO,176.26s; không dùng thay source cuối |
| Full Backend E2E source cuối | 692PASS/20TODO,36filesPASS/1SKIP,192.94s |
| BE lint/typecheck/build/Prisma validate/diff-check cuối | PASS |

Một lần typecheck bắt test mới bị đặt ngoài describe, đã chuyển đúng scope và
chạy lại; không tính lượt lỗi là PASS. Cảnh báo pg/negative-case logs không phải
assertion failure, không nới timeout/bỏ case để xanh.

## 22 ca PostgreSQL mới — phạm vi đã đạt

1. Metadata/revision2/audit allowlist/jobPENDING cùng commit.
2. Hai Admin cùng revision: chỉ một kết quả hợp lệ, một audit/job.
3. Hai insert option: khóa parent trước FK, chỉ một thắng, tăng một revision.
4. Usage hiện hành gồm Product DRAFT và option reference.
5. No-op giữ dữ liệu/timestamp/audit/job nghiệp vụ, vẫn có MVCC fence vật lý.
6. Scope input bị đổi trong lúc await không đổi actor/definition/revision gốc.
7. Effect/reason bị đổi sau gọi record không làm lệch audit/job.
8. Job insert lỗi rollback metadata và audit.
9. Trigger fault thực ở audit insert rollback metadata và job.
10. Actor inactive/role sai/nesting sai không gọi callback.
11. Revision cũ bị chặn kể cả no-op.
12. Ghi metadata nhưng quên audit bị rollback.
13. Hai record trong cùng tick không mint hai audit; case này rollback toàn bộ.
14. Nuốt lỗi record vẫn không commit một phần.
15. Context thoát transaction không dùng lại để ghi.
16. Revision Intmax không reset/tràn, lỗi ghi rollback.
17. Hai definition cùng Category cùng thành công qua fence/retry, giữ cả audit.
18. Value-writer harness tham gia protocol, canonical usage được đọc lại.
19. Harness giữ fence; Admin thực chờ khóa được quan sát bằng pg_blocking_pids;
    sau commit/retry thấy usage mới và chặn đổi type. Không chỉ ngủ rồi đoán race.
20. Không gắn nhầm audit CREATE_OPTION cho cập nhật một option cũ.
21. Xóa option sau record bị final signature chặn và rollback.
22. Không giấu xóa option trong audit sửa definition.

Case21/22 tái lập FAIL trước sửa, PASS sau sửa; không chỉ viết assertion tự đúng.
Fault trigger chỉ trên definition fixture trong QA, tên UUID, được gỡ đúng target.
Không sửa migration đã merge hoặc dùng database demo.

## Chưa chứng minh

Đây là integration code nội bộ→Prisma→bảng/trigger/job PostgreSQL thật. Không
HTTP/JWT/browser/Admin editor hoặc toàn bộ Seller/import/submit runtime. Callback
và effect flag trong harness không thay policy chuẩn hóa/confirmation/planner.
Chưa normalized unique migration, actual controllers, public projection hoặc
worker/ES/FAISS live. Không tính PREPARATION thành Attributes DONE.

## CLI review

Opus4.6Thinking, source-only không secret/DB/tools. Vòng đầu timeout180s, **không
verdict**, không tính approval. Vòng2 source cuối trả kết luận không có P1 có
reproduction và không có blocker trong scope preparation. Model gắn nhãnP2 cho
hai ghi chú không có hành vi sai hiện tại: JSON.stringify phụ thuộc thứ tự key
(ở đây metadata luôn dựng từ literal cùng thứ tự), và lỗi Prisma khi option
biến mất thiếu ngữ cảnh (vẫn rollback đúng). Giữ làm ghi chú bảo trì, không coi
là bằng chứng một race/bug runtime đã tái lập, không thêm dependency mù.
Không hạ model Flash hoặc gắn nhãn human approval. Các test ở trên do tác giả
chạy; model không thực thi test độc lập. Model nêu “slug/name uniqueness chưa
có” cần lọc lại: unique slug hiện đã ở DB, còn unique **tên chuẩn hóa** chưa có.

## Bàn giao các gate khác trong cùng lượt

- #83 head9a8b593:4regression target PASS mới; CI2jobSUCCESS và log thực10protocol
  cases PASS. Đã tag Đạt/Hiền xác nhận P2; chưa tự đóng Request changes.
- #75 head83e7714:FE so5831beb đã approve0diff;791PASS/6liveSKIP,48.92s;build/diffPASS.
- #84 head0e45440:FE so261ad38 đã approve0diff;752PASS/6liveSKIP,47.57s;build/diffPASS.
- Hai approval Buyer vẫn trước head đồng bộ; đã tag Hiền re-review delta. Không
  merge/activate Buyer POST hoặc lấy pending modules làm dependency chính thức.
