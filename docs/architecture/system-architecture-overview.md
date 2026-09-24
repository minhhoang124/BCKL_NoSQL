# Tổng quan kiến trúc và trạng thái hệ thống

Tài liệu này là điểm bắt đầu để thành viên và AI hiểu hệ thống trước khi đọc code hoặc sửa một chức năng. Nội dung trả lời bốn câu hỏi: hệ thống đang giải quyết bài toán gì, các thành phần phối hợp như thế nào, phần nào đã chạy thật, và cần đọc đâu để tiếp tục công việc mà không suy đoán.

Ảnh chụp trạng thái trong tài liệu được đối chiếu với nhánh `develop` và các pull request vào ngày **23/09/2026**. Kiến trúc và quyết định bền vững được duy trì tại đây; trạng thái PR mới nhất vẫn phải kiểm tra trên GitHub.

## 1. Cách đọc và nguồn chuẩn

Khi tài liệu mâu thuẫn, dùng thứ tự ưu tiên sau:

1. `AGENTS.md` và quy tắc an toàn repository.
2. `docs/project/implementation-scope.md` cho phạm vi P0, P1, P2 và Definition of Done.
3. Tài liệu thiết kế miền tương ứng trong `docs/architecture/`.
4. Contract API đã được các bên sở hữu cùng review.
5. Migration, code và test đã merge trên `develop` để xác định trạng thái triển khai thật.
6. Pull request mở để hiểu phần đang phát triển, chưa được xem là chức năng đã hoàn thành.

Các nhãn trạng thái trong tài liệu:

| Nhãn | Ý nghĩa | Có được báo cáo là đã hoàn thành không |
|---|---|---|
| `CURRENT` | Đã merge vào `develop`; có code hoặc tài liệu làm bằng chứng | Chỉ khi luồng tích hợp và điều kiện Definition of Done đã đạt |
| `IN_PROGRESS` | Đang ở branch, PR, prototype hoặc thiếu một lớp trong luồng | Không |
| `TARGET` | Đã chốt yêu cầu/thiết kế nhưng chưa có đủ code | Không |
| `P2` | Hướng mở rộng sau phạm vi khóa luận hiện tại | Không |

Một schema, endpoint Swagger, màn hình Figma hoặc test đơn lẻ không đủ để biến một release gate thành `DONE`.

## 2. Mục tiêu và ranh giới hệ thống

Hệ thống là sàn thương mại điện tử nhiều người bán và đa ngành hàng. Người dùng có thể mua hàng; sau quy trình mở Store và được duyệt, cùng tài khoản đó phải có khả năng bán hàng trong kiến trúc đích. Seller quản lý Store, sản phẩm, biến thể, ảnh, giá và tồn kho. Admin quản lý danh mục, duyệt Store và sản phẩm. User tìm sản phẩm bằng từ khóa, văn bản ngữ nghĩa hoặc hình ảnh, sau đó mua hàng, theo dõi đơn, chat và sử dụng các nghiệp vụ hậu mãi trong phạm vi khóa luận.

Dataset ABO Electronics chỉ là dữ liệu seed và corpus thực nghiệm. Nó không giới hạn hệ thống ở ngành điện tử và không quyết định schema nghiệp vụ.

```mermaid
flowchart LR
    User[User]
    Seller[Seller]
    Admin[Admin]
    Web[React Web]
    API[NestJS Backend]
    DB[(PostgreSQL)]
    Search[FastAPI Search Service]
    ES[(Elasticsearch)]
    Vector[(CLIP and FAISS)]

    User --> Web
    Seller --> Web
    Admin --> Web
    Web -->|REST JWT cookie| API
    API -->|Nguồn dữ liệu nghiệp vụ| DB
    API -->|Index and search contract| Search
    Search --> ES
    Search --> Vector
    Search -->|productId and rank| API
    API -->|Hydrate and filter| DB
    API -->|Dữ liệu công khai hiện hành| Web
```

## 3. Kiến trúc chạy và trách nhiệm thành phần

### 3.1 Frontend React

Thư mục `FE/` chứa ứng dụng React, TypeScript và Vite. React Router điều hướng các trang public, account, Seller và Admin. `AuthProvider` giữ phiên đăng nhập trong bộ nhớ, gọi refresh session khi tải lại trang và dùng `apiClient` làm điểm gọi Backend thống nhất.

Frontend không được tự quyết định quyền, giá, tồn kho, trạng thái duyệt hay trạng thái đơn. Nó hiển thị dữ liệu và gửi command; Backend xác thực lại mọi quy tắc nghiệp vụ.

### 3.2 Backend NestJS

Thư mục `BE/` là modular monolith NestJS. Mỗi miền có controller, service, DTO, guard và test riêng nhưng chạy trong cùng một ứng dụng:

```text
HTTP request
→ Controller nhận DTO
→ ValidationPipe loại hoặc từ chối trường không hợp lệ
→ JWT and role guard xác thực actor
→ Service kiểm tra ownership và trạng thái
→ Prisma transaction đọc hoặc ghi PostgreSQL
→ Response DTO hoặc lỗi HTTP có cấu trúc
```

NestJS là lớp điều phối nghiệp vụ. Client không gọi trực tiếp PostgreSQL, Elasticsearch hoặc FAISS.

### 3.3 PostgreSQL và Prisma

PostgreSQL là nguồn dữ liệu chuẩn cho tài khoản, Store, catalog, sản phẩm, giá, tồn kho và các miền giao dịch sẽ được bổ sung. Prisma cung cấp schema, migration và client truy cập dữ liệu.

Mọi thay đổi database phải tạo migration mới. Không sửa migration đã merge. Những quy tắc có thể biểu diễn bằng foreign key, unique key và check constraint nên được bảo vệ ở database; ownership, state transition và quy tắc liên bảng phức tạp được kiểm tra trong service/transaction và phải có test.

### 3.4 FastAPI Search Service

Thư mục `AI_CLIP/` là ranh giới của Search Service. Kiến trúc đích giao cho FastAPI quản lý:

- Elasticsearch cho keyword search và filter.
- CLIP cho embedding ảnh và văn bản ngữ nghĩa.
- FAISS cho nearest-neighbor vector search.
- Reciprocal Rank Fusion để hợp nhất danh sách xếp hạng.

FastAPI chỉ trả `productId`, điểm và thứ hạng. NestJS phải đọc lại PostgreSQL, loại Product không còn công khai và hydrate dữ liệu hiển thị. Vì vậy index chậm không được làm sản phẩm đã ẩn xuất hiện công khai.

### 3.5 Docker và CI

Docker Compose trên `develop` hiện khởi động PostgreSQL. Frontend, Backend và Search Service chưa được đóng gói đầy đủ trong Compose chung.

Workflow `repository-checks` hiện kiểm tra fresh install bằng pnpm, whitespace, Docker Compose config, Prisma schema/migration/seed, lint, unit test và build của các workspace Node/Frontend/Backend, cùng Backend E2E trên PostgreSQL. Workflow này chưa cài Python và chưa chạy Ruff hoặc Pytest cho `AI_CLIP/`; vì vậy CI xanh hiện tại không phải bằng chứng quality gate của Search Service. CI xanh là điều kiện cần nhưng không thay thế kiểm thử luồng người dùng.

## 4. Bản đồ repository

| Vị trí | Trách nhiệm | Đọc khi nào |
|---|---|---|
| `FE/src/` | React UI, route, auth context và API client | Khi sửa màn hình hoặc luồng trình duyệt |
| `BE/src/` | NestJS controller, service, DTO, guard | Khi sửa API hoặc nghiệp vụ |
| `BE/prisma/` | Prisma schema, migration và seed | Khi thay đổi dữ liệu hoặc ràng buộc |
| `BE/test/` | E2E cho Auth, schema Product, Store/Catalog và seed | Khi xác minh hành vi tích hợp |
| `AI_CLIP/` | FastAPI, CLIP, FAISS, Elasticsearch và RRF | Khi sửa Search Service hoặc thực nghiệm |
| `docs/api/` | Contract giữa các dịch vụ | Trước khi đổi request/response |
| `docs/architecture/` | Quyết định kiến trúc theo miền | Trước khi sửa schema hoặc luồng chính |
| `docs/project/` | Phạm vi, phân công và release gate | Trước khi nhận task |
| `docs/analysis/` | Cơ sở nghiệp vụ và nguồn tham khảo | Khi viết SRS, ERD, Use Case hoặc báo cáo |
| `docs/testing/` | Ground truth, query và test artifact | Khi đánh giá Search hoặc nghiệm thu |
| `docs/data-quality/` | Quyết định làm sạch dataset | Khi import hoặc thay đổi metadata |

## 5. Quy tắc dữ liệu xuyên suốt

### 5.1 ID sản phẩm

- `productId` là số nguyên do PostgreSQL sinh và là ID dùng trong Backend, Elasticsearch và FAISS.
- `externalId` là mã truy vết tùy chọn của dữ liệu import, có dạng `<source>:<source-id>` như `abo:B07ABC123`.
- Prefix phụ thuộc nguồn. `abo:` không gắn vào sản phẩm từ nguồn khác; sản phẩm Seller tạo trực tiếp có `externalId = null`.
- Mapping gửi pipeline AI có dạng `{"externalId":"abo:B07ABC123","productId":125}`.

### 5.2 Product và Variant

`Product` giữ thông tin chung như tên, mô tả, Store, Category, Brand và trạng thái. `ProductVariant` giữ SKU, giá, tồn kho và trạng thái bán. Sản phẩm không có phân loại vẫn cần một variant mặc định để Cart và Order chỉ xử lý một mô hình.

Không thêm các cột cố định như `color`, `size`, `ram` vào Product. Thuộc tính mô tả theo Category và option tạo Variant là hai khái niệm khác nhau.

### 5.3 Nguồn chuẩn và index phụ trợ

```text
PostgreSQL commit thành công
→ tạo SearchOutbox cùng transaction
→ worker gửi productId and version tới FastAPI
→ FastAPI cập nhật Elasticsearch and FAISS
→ tìm kiếm trả productId
→ NestJS hydrate and filter bằng PostgreSQL
```

Elasticsearch và FAISS có thể xây lại. Không dùng chúng làm nguồn chuẩn cho giá, tồn kho, quyền sở hữu hoặc trạng thái công khai.

## 6. Trạng thái triển khai tại ngày 23/09/2026

| Miền | Trạng thái | Bằng chứng chính trên `develop` hoặc PR đang mở | Khoảng trống tiếp theo |
|---|---|---|---|
| Nền móng workspace và PostgreSQL | `CURRENT` | PR #3; pnpm workspace, NestJS, React, migration, Docker PostgreSQL | Compose toàn hệ thống và hướng dẫn demo hoàn chỉnh |
| Auth email and password | `CURRENT` | PR #4; register, login, refresh rotation, logout, `/auth/me`, JWT/RBAC test | Profile/address, verify/reset, OAuth, OTP và multi-role mục tiêu |
| Frontend shell | `CURRENT` | PR #13; router, layout, auth context, route guard, trang khung | Màn hình nghiệp vụ thật cho Store, Product, Cart, Order, Search |
| Product database schema | `CURRENT` | PR #10; Store, Category, Brand, Product, attribute, option, variant, image, shipping, outbox | API Product và worker search chưa nằm trên `develop` |
| Store and Catalog API | `CURRENT` | PR #15; Seller Store lifecycle, Admin review, Category/Brand API, ownership và E2E | Store address/profile đầy đủ và UI Seller/Admin |
| CI quality gates | `CURRENT` | PR #16, PR #17 và PR #19; seed E2E có timeout phù hợp với fresh CI; workflow kiểm tra các workspace pnpm/FE/BE và Backend E2E | Bổ sung quality gate Python tái lập được cho Search Service gồm Ruff và toàn bộ Pytest; tiếp tục theo dõi độ ổn định khi bộ test tăng |
| Product draft API and importer | `IN_PROGRESS` | PR #18; draft API, image ingest và JSONL importer idempotent. Lượt smoke trên branch/máy Hoàng đã import 86 Product ở trạng thái DRAFT và xuất mapping 86 cặp `externalId → productId` cho FAISS | Review và merge PR #18; sau đó tái kiểm tra importer trên môi trường tích hợp sạch. 86 Product smoke chưa phải Public Product |
| FastAPI Search Service | `IN_PROGRESS` | Draft PR #8; FAISS 86 vector dùng mapping PostgreSQL đã chạy trên máy Hoàng; Elasticsearch 8.19.21, RRF hybrid, dual-index, version/idempotency và retry lỗi một phần đã được smoke test thật | Backend outbox gọi FastAPI, Backend hydrate/filter PostgreSQL trên Web và đánh giá bằng ground truth độc lập |
| SRS, Use Case and ERD | `IN_PROGRESS` | PR #5 head `3fcca0e`; SRS v3 giữ 37 mã FR, có 13 Use Case và 60 test case ở trạng thái thiết kế; CURRENT/TARGET đã được đối chiếu với schema/API hiện có. D01–D10 đã được Hoàng xác nhận ngày 23/09/2026 tại [phản hồi PR #5](https://github.com/grumhu124/BCKL_ThuongMaiDienTu/pull/5#issuecomment-5795865249) | Hiền cập nhật quyết định vào SRS; Đạt xác nhận phần Search/filter/ảnh ở D04 và D09; không ghi test thiết kế là PASS; cập nhật XMI/VPP/ERD nếu cần, sau đó review và merge PR #5 |
| Public Product and moderation | `TARGET` | Thiết kế Product đã merge | Controller/service, submit/review/public query, outbox worker và UI |
| Cart, Order, COD and inventory transaction | `TARGET` | Phạm vi và phân tích nghiệp vụ | Schema, migration, API, FE và E2E transaction |
| Chat User and Seller | `TARGET` | `chat-domain-design.md` | Schema, REST/WebSocket, UI và E2E quyền/reconnect |
| Review, Admin dashboard and notification | `TARGET` | Phạm vi P0 | Schema/API/UI/test |
| Verify/reset, OAuth, OTP, payment sandbox and returns | `TARGET P1` | `implementation-scope.md` | Chỉ triển khai sau dependency P0 tương ứng ổn định |

Trạng thái này không tự cập nhật. Khi một PR được merge, người phụ trách phải sửa dòng liên quan, cập nhật ngày ảnh chụp và dẫn chứng test. Không xóa khoảng trống còn tồn tại chỉ vì một lớp riêng lẻ đã có code.

## 7. Các luồng cần hiểu

### 7.1 Auth hiện tại

```mermaid
sequenceDiagram
    participant FE as React
    participant BE as NestJS Auth
    participant DB as PostgreSQL
    FE->>BE: POST auth login
    BE->>DB: Tìm User và kiểm tra password hash
    DB-->>BE: User
    BE->>DB: Lưu hash refresh token
    BE-->>FE: Access token and HttpOnly refresh cookie
    FE->>BE: API với Bearer access token
    FE->>BE: POST auth refresh khi access token hết hạn
    BE->>DB: Thu hồi token cũ và tạo token mới trong transaction
    BE-->>FE: Phiên mới
```

Trạng thái hiện tại vẫn dùng một `Role` cho mỗi User. Yêu cầu cùng tài khoản vừa mua vừa bán là `TARGET` và cần migration/Auth/UI/test riêng; không được mô tả là đã hoạt động.

### 7.2 Store hiện tại

Seller tạo một Store ở `PENDING`. Admin có thể chuyển `PENDING` sang `ACTIVE` hoặc `REJECTED`; Store bị từ chối được Seller sửa và nộp lại trên cùng bản ghi. Admin có thể chuyển `ACTIVE` sang `SUSPENDED` và khôi phục lại. Mỗi thay đổi ghi `StoreStatusHistory`; service dùng cập nhật có điều kiện để chống hai request ghi đè trạng thái của nhau.

### 7.3 Product và import dataset

```text
products.jsonl plus image folder
→ dry-run validate schema, externalId, category and safe relative paths
→ upsert by externalId without overwriting unrelated business edits
→ PostgreSQL assigns productId
→ ingest valid image into managed storage
→ keep incomplete Product as DRAFT
→ export externalId to productId mapping
→ rebuild FAISS and Elasticsearch with official productId
```

Tại thời điểm ảnh chụp, code luồng này nằm ở PR #18 và chưa được xem là `CURRENT` trên `develop`. Một lượt smoke trên branch/máy Hoàng đã import 86 Product DRAFT, kiểm tra PostgreSQL và xuất mapping 86 cặp cho Đạt rebuild FAISS. Bằng chứng đó xác nhận contract kỹ thuật của importer/mapping, không biến Product thành dữ liệu công khai và không thay thế review/merge PR #18.

### 7.4 Tìm kiếm đích

```mermaid
sequenceDiagram
    participant FE as React
    participant BE as NestJS
    participant AI as FastAPI
    participant ES as Elasticsearch
    participant F as CLIP and FAISS
    participant DB as PostgreSQL
    FE->>BE: Search text or image plus filters
    BE->>AI: POST search hybrid
    par Keyword and filter
        AI->>ES: Search
    and Semantic and image
        AI->>F: Embed and nearest neighbors
    end
    AI->>AI: RRF merge
    AI-->>BE: Ordered productId list
    BE->>DB: Hydrate and enforce public rules
    DB-->>BE: Current public Product data
    BE-->>FE: Results preserving valid rank order
```

Hoàng và Đạt đã thống nhất version, UPSERT/DELETE, filter, image URL theo môi trường, lỗi và retry trong `docs/api/ai-service-contract.md` thuộc Draft PR #8. Endpoint đơn, đồng bộ Elasticsearch–FAISS và tìm kiếm hybrid đã được triển khai và smoke test độc lập, nhưng chưa merge vào `develop`. Phần chưa đạt là E2E `Backend SearchOutbox → FastAPI Search Service → PostgreSQL hydrate/filter → React Web` và đánh giá chất lượng bằng bộ ground truth độc lập.

### 7.5 Checkout đích

Cart tham chiếu `variantId`. Khi checkout, Backend phải đọc lại Product/Variant, giá và tồn kho; tạo Order và OrderItem snapshot, trừ kho và ghi lịch sử trong transaction. Client không gửi giá cuối cùng để Backend tin trực tiếp. Giỏ nhiều Store được tách thành Order theo Store. Đây là `TARGET`, chưa có trên `develop`.

### 7.6 Chat đích

Một Conversation duy nhất cho cặp User-Store; Product chỉ là ngữ cảnh tùy chọn. Tin nhắn được commit vào PostgreSQL trước khi phát WebSocket. `clientMessageId` chống gửi trùng, read state chỉ tiến về phía trước và Backend kiểm tra membership ở cả REST lẫn socket. Đây là `TARGET`; chi tiết ở `chat-domain-design.md`.

## 8. Cách lần theo một chức năng trong code

Khi không hiểu AI đã làm gì, không đọc ngẫu nhiên toàn repo. Dùng trình tự sau:

1. Đọc dòng trạng thái của miền trong mục 6.
2. Đọc tài liệu thiết kế miền và contract liên quan.
3. Xem PR/commit được dẫn làm bằng chứng và đọc phần Files changed.
4. Tìm route bằng `rg -n "@(Controller|Get|Post|Patch|Delete)" BE/src`.
5. Từ controller đi tới service, DTO, guard rồi Prisma model/migration.
6. Tìm test bằng tên route, service hoặc model trong `BE/test`, `BE/src` và `FE/src`.
7. Đối chiếu Frontend route, page, context và `apiClient` nếu luồng đã có UI.
8. Chạy đúng test/lint/build được ghi trong PR; không chỉ tin tóm tắt của AI.

Ví dụ Store:

```text
BE/src/store/store.controller.ts
→ BE/src/store/store.service.ts
→ BE/prisma/schema.prisma models Store and StoreStatusHistory
→ BE/prisma/migrations/20260918160000_store_onboarding_lifecycle
→ BE/test/store-catalog.e2e-spec.ts
```

## 9. Quy tắc ghi lại công việc của AI

Mỗi PR chức năng phải để người khác trả lời được các câu hỏi sau mà không cần lịch sử chat của AI:

- Chức năng và actor nào đang được xử lý?
- Trạng thái trước và sau thay đổi là gì?
- File, schema, migration, endpoint và màn hình nào bị ảnh hưởng?
- Quy tắc ownership, validation, transaction và idempotency nằm ở đâu?
- Test nào chứng minh happy path, sai quyền, trạng thái lỗi và request lặp?
- Contract hoặc tài liệu kiến trúc nào được cập nhật?
- Phần nào vẫn chưa làm và PR tiếp theo phụ thuộc điều gì?

PR description là nhật ký của task đang làm. Sau khi merge, kiến thức bền vững phải được chuyển về tài liệu miền và cập nhật bảng trạng thái trong file này. Không dùng một file `task_on_progress` lâu dài làm nguồn chuẩn vì nó dễ lỗi thời sau merge.

Nếu task kéo dài qua nhiều phiên AI, branch có thể dùng file tạm không commit để ghi:

```text
Mục tiêu
Đã đọc
Đã thay đổi
Đã kiểm tra
Đang vướng
Bước tiếp theo
Rủi ro và giả định
```

Trước khi bàn giao, đưa nội dung cần giữ vào PR/tài liệu chính thức và xóa file tạm khỏi staged files.

## 10. Definition of Done rút gọn

Một chức năng chỉ được gọi là hoàn thành khi có đủ phần cần thiết trong luồng: migration/database, Backend, Frontend, phân quyền, validation, lỗi, test, tài liệu và bằng chứng chạy trên nhánh tích hợp. Với đồng bộ tìm kiếm, tồn kho, thanh toán, hậu mãi và notification, phải có test request lặp và lỗi dịch vụ phụ trợ.

Các lệnh kiểm tra cơ sở:

```powershell
pnpm install --frozen-lockfile
pnpm prisma:validate
pnpm lint
pnpm test
pnpm build
pnpm --dir BE test:e2e
docker compose config --quiet
```

Với thay đổi trong Search Service, chạy thêm từ thư mục `AI_CLIP/`:

```powershell
ruff check app tests
pytest
```

Hai lệnh Python trên hiện chưa được workflow GitHub Actions thực thi. Cho tới khi PR liên quan bổ sung quality gate Python, người bàn giao phải ghi bằng chứng chạy local và không dùng check xanh của `repository-checks` để kết luận code `AI_CLIP/` đã được kiểm tra. Chỉ chạy các lệnh phù hợp với task, nhưng phải ghi rõ lệnh nào chưa chạy và lý do.

## 11. Chỉ mục tài liệu chi tiết

- Phạm vi và release gate: [`../project/implementation-scope.md`](../project/implementation-scope.md)
- Phân công: [`../project/work-assignment.md`](../project/work-assignment.md)
- Nghiệp vụ sàn: [`../analysis/marketplace-business-processes.md`](../analysis/marketplace-business-processes.md)
- Product domain: [`product-domain-design.md`](product-domain-design.md)
- Kế hoạch triển khai Product: [`product-implementation-plan.md`](product-implementation-plan.md)
- Chat domain: [`chat-domain-design.md`](chat-domain-design.md)
- Backend and AI contract: [`../api/ai-service-contract.md`](../api/ai-service-contract.md)
- Quy trình Git: [`../git/team-task-delivery-guide.md`](../git/team-task-delivery-guide.md)
- Dataset QA: [`../data-quality/README.md`](../data-quality/README.md)
- Test and ground truth: [`../testing/README.md`](../testing/README.md)

## 12. Quy tắc duy trì tài liệu

- Thay đổi ranh giới thành phần hoặc nguồn dữ liệu phải cập nhật mục 3 và sơ đồ.
- Thay đổi ID, payload hoặc endpoint liên dịch vụ phải cập nhật contract tương ứng và có đúng reviewer.
- Migration mới phải cập nhật mô hình dữ liệu và trạng thái miền.
- PR merge làm thay đổi mức triển khai phải cập nhật mục 6 trong cùng PR hoặc PR docs ngay sau đó.
- Tài liệu `TARGET` không được tự đổi thành `CURRENT`; phải có link commit/PR, test và kết quả tích hợp.
- Các ví dụ dữ liệu không được chứa secret, đường dẫn máy cá nhân hoặc dataset lớn.
