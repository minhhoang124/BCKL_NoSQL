# #94 — portable init hook và kiểm lại nền mới, 23/10/2026

## Kiểm lại sau Buyer Web / Order race chính thức

Nhận develop `4ed07a3` tại `db1c865e4764d7a390d79d17b280797ba15afa34`.
Conflict chỉ overview, giữ đủ hai phía; BE/src/Prisma vẫn nguyên9b12b9f,
Dockerfile/init/Compose nguyênf1b1f25 đã qua hai fresh-volume proof bên dưới.
Full BE mới: **1058unit PASS/49files,25.29s**; **802E2E PASS/1SKIP/20TODO**,
45filesPASS/2SKIP,491.46s,exit0. Hai test tăng từ800 là nền Order #98, không
phải hai test Attributes mới. Negative failure logs là ca cố ý gây lỗi;
không dùng kết quả xanh này đóng409/409 lịch sử hoặc nhận20TODO là đã chạy.
Frontend nhận nguyên nền #99 đã kiểm; không đổi FE trong PR Attributes.
NativeMac reviewer và editor UI vẫn chưa được nhận là PASS.

Gói QA cập nhật phải gồm cả **Dockerfile**, không dùng zip9b12b9f cũ thiếu
file này. Bundle là overlay/runbook cho đúng checkout, không standalone source
toàn hệ thống. Không gửi credential/profile/private artifact cùng zip.

Đạt Request changes đúng9b12b9f: hook bind-mounted Git100644/host0644 trên Docker
Desktop29.8/macOSARM64 bị entrypoint chọn execute rồi lỗi126, database/role
không tạo được. Đây là blocker gói bàn giao thật, không phủ nhận chỉ vì Windows
local đãPASS. Hiền đãapprove9b12b9f nghiệp vụ; approval không bỏ qua finding này.

## Sửa tận ranh giới packaging

- Thêm Dockerfile từpostgres17, `COPY --chmod=0755 init-qa.sh` tới đúng initdir
  trong imageLinux. Compose build image, bỏ host bind-mount của init hook.
- Không phụ thuộc executable bit/ACL của máy nhận. Gitmode vẫn100644 có chủ
  đích; executable mode do image kiểm soát. HookSQL/passwordliteral giữ nguyên.
- Init/Dockerfile ép LF. Guide thêm `--build` và nhắc gửi Dockerfile, giữ volume
  lỗi để điều tra; không reset/drop/down-v hoặc xóa audit/receipt.
- Thêm3regression tests: imageCOPYmode, Composebuild/nohookbind, LF và no-reset/
  restrictedrole/passwordquoting. Không sửa Backend/schema/API hoặc migration.
- Script opt-in `scripts/test-attributes-qa-compose.mjs` dựng **hai project/volume
  mới**, secret ngẫu nhiên RAM/child env, rejectdotenv/demo/portbusy. Không tự
  stop container người khác; finally chỉstop hai project do script tạo.

## Bằng chứng mới

Source trước packaging đã nhận develop023ce96 (#95/#96) tại4c2dd8c. BE/src/
Prisma nguyên byte9b12b9f; FE/src nguyên byte nền chính thức, không nhận99chưa merge.

| Kiểm | Kết quả |
| --- | --- |
| Full BE unit sau sync | 1055PASS/48files,8.49s; chưa gồm3packaging test mới |
| Full BE E2E sau sync | 800PASS/1SKIP/20TODO;45filesPASS/2SKIP;224.39s;exit0 |
| Backend lint/typecheck/build/Prisma validate | PASS trên source sau sync |
| Packaging + guard launcher targeted | 12PASS (3mới +9guard);exit0 |
| Fresh project `bckl-attr-proof-mvjuyx57-a257cd-a` | PASS |
| Fresh project `bckl-attr-proof-mvjuyx57-a257cd-b` | PASS |

Ở **mỗi fresh volume**, Gitmode100644/Windows hostmode666, **image mode755**;
role `bckl_attributes_qa` NOSUPERUSER/**NOCREATEDB**/NOCREATEROLE, đúng DBv1;
17migration mới deploy,2seed lượt giữ dữ liệu cũ,Swagger200 và đủ4writer paths.
Không đổi hostmode bằngchmod hoặc restart volume đang lỗi để cóPASS.

Raw report local:
`artifacts/attributes-compose-proof-mvjuyx57-a257cd/results.json` trong checkout
Attributes. Logs đãredactsecrets, private fixture credentials lưu riêng theo
handoff. Chỉ chia sẻ report đã kiểm, không gửi cả folder chứa credential.
Hai project đãstop, giữ nguyên container/volume/fixture. Demo trước/sau stopped.

## Giới hạn / gate

Host kiểm là Windows/x64 với Linux containers; **native macOS/ARM64 chưa chạy
ở máy tác giả**. Mechanism không execute hostmount nữa; nhờ Đạt kiểm lại gói
mới trên nền đã tái lập. Không gọi reviewer đãapprove bản sửa khi chưa phản hồi.
Full800E2E giữ20TODO/1SKIP không gọiPASS; lỗi409/409 lịch sử vẫnOPEN. Không mới
editor/browser/loadedES–FAISS hoặc nghiệm thu toàn Admin. CI vẫnbilling failure,
không gọi xanh. Source runtime nghiệp vụ không đổi trong packagingfix này.
