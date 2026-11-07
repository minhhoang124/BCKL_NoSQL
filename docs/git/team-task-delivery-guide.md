# Quy trình hoàn thành task và đẩy code lên GitHub

Tài liệu này áp dụng cho cả ba thành viên. Mục tiêu là bảo đảm mỗi task được kiểm tra, đẩy đúng thư mục, đúng branch và được review trước khi tích hợp vào `develop`.

## Nguyên tắc bắt buộc

1. Không code hoặc commit trực tiếp trên `main` và `develop`.
2. Mỗi task sử dụng một branch riêng tạo từ `develop` mới nhất.
3. Chỉ thay đổi file thuộc phạm vi task; không xóa hoặc ghi đè công việc của người khác.
4. Không commit `.env`, mật khẩu, token, API key, dataset lớn, model weight, embedding, FAISS index, ảnh upload hoặc log runtime.
5. Thay đổi database phải có migration mới; không sửa migration đã merge và dùng chung.
6. Thay đổi API Backend–AI phải cập nhật contract và được Hoàng, Đạt cùng review.
7. `productId` là số nguyên do PostgreSQL sinh; mã dataset như `P001` lưu trong `externalId`.
8. Task chỉ hoàn thành khi kiểm tra liên quan chạy được và pull request đã được review.
9. Pull request của task luôn hướng vào `develop`, không hướng thẳng vào `main`.
10. AI không được tự merge pull request.

## Vị trí code

| Thành viên | Thư mục chính | Nội dung |
|---|---|---|
| Hoàng | `FE/`, `BE/`, `database/` | React, NestJS, Prisma, PostgreSQL, User/Seller và tích hợp |
| Đạt | `AI_CLIP/`, `experiments/` | CLIP, FAISS, FastAPI, Elasticsearch, RRF và đánh giá |
| Hiền | `docs/`, phần Admin và Buyer Address/Cart theo phân công | SRS, sơ đồ, test case, ground truth, Admin, CODE hai màn Buyer Address/Cart (Hoàng giao và [Hiền xác nhận 04/10](https://github.com/grumhu124/BCKL_ThuongMaiDienTu/pull/29#issuecomment-5978048696)) và kiểm thử; không gồm Buyer Checkout/Order |

File dùng chung như `docker-compose.yml`, `.env.example`, API contract hoặc schema database phải được review chéo.

## Tên branch

```text
feat/<ten>/<task>
fix/<ten>/<task>
docs/<ten>/<task>
test/<ten>/<task>
chore/<ten>/<task>
```

Ví dụ:

```text
feat/hoang/auth-jwt
feat/dat/image-search-api
feat/hien/admin-users
docs/hien/initial-erd
test/hien/order-workflow
fix/hoang/negative-stock
```

## Commit

Sử dụng `<type>(<scope>): <mô tả ngắn bằng tiếng Anh>`:

```text
feat(auth): implement JWT login
feat(product): add seller product creation
fix(order): prevent negative stock
docs(api): update product indexing contract
test(search): add image search test cases
chore(docker): add PostgreSQL service
```

Không dùng message mơ hồ như `update`, `fix bug`, `code mới`, `done` hoặc `123`.

# Cách 1 Tự thực hiện thủ công

## 1 Nhận và hiểu task

Issue cần có nội dung, người phụ trách, deadline, acceptance criteria, người review, phạm vi thư mục và dependency. Nếu chưa rõ, hỏi lại trước khi thay đổi code.

## 2 Kiểm tra working tree

```bash
git status
```

Nếu có thay đổi chưa commit của task khác, không xóa, reset hoặc ghi đè.

## 3 Cập nhật `develop`

```bash
git switch develop
git pull --ff-only origin develop
```

Nếu lệnh báo lỗi, dừng lại kiểm tra; không dùng `git reset --hard` để xử lý nhanh.

## 4 Tạo branch task

```bash
git switch -c feat/hoang/auth-jwt
```

Thay tên branch theo đúng người và task thực tế.

## 5 Code đúng phạm vi

- Hoàng đặt Frontend trong `FE/`, Backend trong `BE/`, migration trong `database/`.
- Đạt đặt AI Service và pipeline trong `AI_CLIP/`.
- Hiền đặt tài liệu, sơ đồ và test artifacts trong `docs/`.
- Nếu phải sửa file dùng chung hoặc module của người khác, ghi rõ trong pull request và yêu cầu đúng người review.

## 6 Tự kiểm tra

```bash
git status
git diff
```

Frontend hoặc Backend, chạy các lệnh đã được cấu hình:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

AI Service:

```bash
ruff check .
pytest
```

Nếu module chưa có test tự động, kiểm thử thủ công và ghi cách kiểm tra trong pull request.

## 7 Kiểm tra secret và file lớn

Không stage `.env`, secret, `node_modules`, `.venv`, dataset thô, ảnh upload, `*.npy`, `*.index`, `*.faiss`, model weight, log hoặc tài liệu cá nhân.

## 8 Commit

Ưu tiên thêm đúng file của task:

```bash
git add BE/src/auth BE/test/auth.e2e-spec.ts
git status
git commit -m "feat(auth): implement JWT login"
```

Chỉ dùng `git add .` sau khi kiểm tra chắc chắn mọi thay đổi đều thuộc task.

## 9 Đồng bộ trước khi push

```bash
git fetch origin
git rebase origin/develop
```

Nếu conflict, đọc cả hai phía, trao đổi với chủ sở hữu code nếu chưa chắc, sửa và chạy lại test. Không tự động chọn toàn bộ `ours` hoặc `theirs`.

## 10 Push branch

```bash
git push -u origin feat/hoang/auth-jwt
```

Nếu branch từng push rồi mới rebase, chỉ dùng `git push --force-with-lease`; không dùng `git push --force`.

## 11 Tạo pull request

Chọn:

```text
base: develop
compare: branch của task
```

PR cần có issue (`Closes #...`), tóm tắt, module ảnh hưởng, cách kiểm tra, kết quả test, migration/API contract nếu có, ảnh hoặc response mẫu và reviewer.

## 12 Review và merge

Reviewer kiểm tra acceptance criteria, phạm vi, phân quyền, ảnh hưởng tích hợp, migration, test, secret và file lớn. Chỉ **Squash and merge** khi CI thành công và review được chấp nhận. Xóa branch sau merge.

## 13 Cập nhật local

```bash
git switch develop
git pull --ff-only origin develop
git branch -d feat/hoang/auth-jwt
```

# Cách 2 Nhờ AI thực hiện

AI có thể hỗ trợ kiểm tra, commit, push và tạo pull request, nhưng thành viên vẫn phải đọc diff, chạy thử chức năng và chịu trách nhiệm trước khi merge.

## Prompt đầy đủ

Thay toàn bộ phần trong dấu `<...>` rồi dán cho AI:

```text
Bạn đang hỗ trợ tôi hoàn thành và bàn giao một task trong repository khóa luận.

Repository local: <đường dẫn tuyệt đối>
Repository GitHub: https://github.com/grumhu124/BCKL_ThuongMaiDienTu
Task/Issue: <số issue và tên task>
Người thực hiện: <Hoàng/Đạt/Hiền>
Branch cần dùng: <ví dụ feat/hoang/auth-jwt>
Base branch của pull request: develop
Phạm vi được phép sửa: <ví dụ BE/src/auth, BE/test và docs/api>
Acceptance criteria:
- <điều kiện 1>
- <điều kiện 2>
- <điều kiện 3>

Các lệnh kiểm tra dự kiến:
- <lệnh lint/typecheck/test/build>

Hãy thực hiện theo đúng thứ tự:

1. Đọc README.md, CONTRIBUTING.md và docs/git/team-task-delivery-guide.md trước khi hành động.
2. Kiểm tra git status, branch, remote và thay đổi chưa commit. Giữ nguyên mọi thay đổi ngoài phạm vi; không xóa, reset hoặc ghi đè công việc của người khác.
3. Kiểm tra diff và code liên quan theo acceptance criteria. Sửa lỗi thuộc phạm vi, không tự mở rộng chức năng.
4. Bảo đảm staged files không có .env, secret, token, dataset lớn, ảnh upload, embedding, FAISS index, model weight, log hoặc tài liệu cá nhân.
5. Chạy lint, typecheck, test và build phù hợp. Nếu lệnh không tồn tại hoặc thất bại, chẩn đoán và sửa lỗi thuộc phạm vi; báo rõ phần không thể kiểm tra.
6. Cập nhật tài liệu, API contract hoặc migration nếu task yêu cầu. Không sửa migration đã merge; tạo migration mới.
7. Đồng bộ origin/develop an toàn. Không dùng git reset --hard, git clean -fd hoặc git push --force. Nếu phải force sau rebase, chỉ dùng --force-with-lease và giải thích.
8. Tạo hoặc chuyển sang đúng branch. Không commit trực tiếp vào main hoặc develop.
9. Stage đúng file, xem staged diff và commit theo Conventional Commits.
10. Push branch lên origin.
11. Tạo pull request vào develop với tóm tắt, issue, cách kiểm tra, kết quả test, module ảnh hưởng, migration/API contract và rủi ro còn lại.
12. Không tự merge. Trả lại URL pull request, commit SHA, file thay đổi, kết quả từng lệnh kiểm tra và điểm reviewer cần chú ý.

Quy ước tích hợp:
- productId là số nguyên do PostgreSQL sinh.
- externalId là mã chuỗi từ dataset nếu có.
- productId phải thống nhất giữa PostgreSQL, Backend, Elasticsearch và FAISS.
- Pull request của feature branch phải hướng vào develop.
- Thay đổi Backend–AI contract cần Hoàng và Đạt review.

Nếu thiếu thông tin có thể làm thay đổi kiến trúc, API hoặc dữ liệu, hãy dừng trước hành động đó và hỏi tôi một câu cụ thể. Với chi tiết nhỏ trong phạm vi, tự đưa ra giả định hợp lý, ghi lại và tiếp tục.
```

## Prompt ngắn khi code đã xong

```text
Hãy giúp tôi bàn giao task <tên/số issue> trong repository <đường dẫn local>.

Branch: <tên branch>
Base PR: develop
Phạm vi: <thư mục được phép thay đổi>
Acceptance criteria: <danh sách ngắn>
Lệnh test: <các lệnh>

Đọc CONTRIBUTING.md và docs/git/team-task-delivery-guide.md. Kiểm tra status/diff, giữ nguyên thay đổi ngoài phạm vi, rà secret và file lớn, chạy test/build, đồng bộ origin/develop an toàn, commit theo Conventional Commits, push branch và tạo PR vào develop. Không dùng reset --hard, clean -fd hoặc push --force; không tự merge PR. Cuối cùng trả URL PR, commit SHA, file thay đổi, kết quả test và lưu ý review.
```

## Thành viên phải kiểm tra sau khi AI làm

- Base branch là `develop`.
- Branch đúng tên task.
- Không có file ngoài phạm vi, secret hoặc file lớn.
- CI thành công.
- Mô tả PR đúng với diff.
- Chức năng chạy được theo hướng dẫn.
- Reviewer phù hợp đã được chọn.
- AI chưa tự merge PR.

# Checklist bàn giao

- [ ] Task có issue và acceptance criteria.
- [ ] Branch tạo từ `develop` mới nhất.
- [ ] Code nằm đúng thư mục.
- [ ] Không làm mất thay đổi của người khác.
- [ ] Đã xem diff và staged diff.
- [ ] Lint, typecheck, test và build liên quan đã chạy.
- [ ] Không có secret, dataset hoặc artifact lớn.
- [ ] Migration và API contract đã cập nhật nếu cần.
- [ ] Commit message đúng quy ước.
- [ ] Branch đã push.
- [ ] Pull request hướng vào `develop`.
- [ ] PR có cách kiểm tra và kết quả test.
- [ ] Có ít nhất một reviewer.
- [ ] Không merge khi CI hoặc review chưa đạt.

# Trường hợp đặc biệt

## Có thay đổi chưa commit của task khác

Dừng và xác định chủ sở hữu. Không dùng `reset`, `checkout --`, `restore` hoặc `clean` để xóa chúng.

## Secret đã bị commit

Không chỉ xóa secret ở commit tiếp theo. Phải thu hồi hoặc đổi secret ngay, thông báo nhóm và xử lý lịch sử Git theo kế hoạch thống nhất.

## CI thất bại

Không merge. Đọc log, tái hiện ở local, sửa trên cùng feature branch, push lại và chờ CI thành công.

## Conflict với `develop`

Trao đổi với chủ sở hữu file nếu logic không rõ. Chạy lại toàn bộ kiểm tra liên quan sau khi giải quyết conflict.

## Task cần sửa ngoài phạm vi

Ghi lý do trong issue hoặc PR và yêu cầu người phụ trách module đó review; không âm thầm sửa rộng sang module khác.
