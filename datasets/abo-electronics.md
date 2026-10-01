# Dataset điện tử chính thức: ABO Electronics Subset

## Quyết định

- Nguồn: Amazon Berkeley Objects (ABO).
- Trang chính thức: https://amazon-berkeley-objects.s3.us-east-1.amazonaws.com/index.html
- Giấy phép: CC BY 4.0; khi báo cáo hoặc công bố phải ghi nguồn Amazon.com và nhóm tác giả ABO.
- Phạm vi: tập con sản phẩm điện tử/phụ kiện điện tử, không sử dụng thời trang.
- Dataset mẫu Giai đoạn 1: 1.200 sản phẩm có ảnh chính, tên tiếng Anh và metadata.
- Ảnh: bản thu nhỏ tối đa 256 px, đủ cho prototype và xây AI Service.

## Vì sao chọn ABO

ABO có ảnh catalog thật, mã sản phẩm gốc, tên, thương hiệu, màu, mô tả dạng bullet,
loại sản phẩm và cây danh mục. Dữ liệu và giấy phép được phát hành trên trang chính thức,
phù hợp yêu cầu tái lập thí nghiệm hơn nguồn ảnh thu thập không rõ ràng.

## Quy ước dữ liệu

- `externalId`: `item_id` gốc của ABO.
- `productId`: số nguyên tạm 1..N trong prototype.
- Khi Hoàng import PostgreSQL, Backend sinh `productId` chính thức và xuất mapping
  `externalId -> productId`; pipeline AI sau đó xây lại IndexIDMap2 bằng ID chính thức.
- Không tự bịa giá. Giá demo thuộc dữ liệu seed của Backend vì ABO không cung cấp giá.

## Nhóm dữ liệu

- `audio`: tai nghe, loa, microphone và thiết bị âm thanh.
- `camera`: camera và phụ kiện camera.
- `computer`: máy tính, chuột, bàn phím, ổ lưu trữ và linh kiện.
- `mobile_accessory`: điện thoại, giá đỡ, vỏ và phụ kiện thiết bị di động.
- `network_security`: thiết bị mạng, router và thiết bị an ninh.
- `office_display`: máy chiếu, TV, máy in và thiết bị điện tử văn phòng.
- `power_adapter`: pin, bộ sạc, adapter và cáp điện tử.

Giới hạn theo nhóm được áp dụng để tránh hàng chục nghìn ốp điện thoại lấn át toàn bộ
dataset. Danh sách chính xác nằm trong `AI_CLIP/scripts/prepare_abo_electronics.py`.

## Tải dữ liệu

```bash
mkdir -p datasets/raw/abo

curl -L --fail --retry 3 \
  -o datasets/raw/abo/abo-listings.tar \
  https://amazon-berkeley-objects.s3.us-east-1.amazonaws.com/archives/abo-listings.tar

curl -L --fail --retry 3 \
  -o datasets/raw/abo/abo-images-small.tar \
  https://amazon-berkeley-objects.s3.us-east-1.amazonaws.com/archives/abo-images-small.tar
```

Giải nén hai archive vào `datasets/raw/abo/`. Thư mục này được `.gitignore` bỏ qua.

## Tạo tập con

```bash
python AI_CLIP/scripts/prepare_abo_electronics.py \
  --listings-dir datasets/raw/abo/listings/metadata \
  --images-dir datasets/raw/abo/images/small \
  --output datasets/processed/abo_electronics_1200.csv \
  --report datasets/processed/abo_electronics_audit.json \
  --target 1200
```

Script chỉ giữ sản phẩm có tên tiếng Anh và ảnh chính tồn tại, loại `externalId` và ảnh
chính trùng, chọn cân bằng theo nhóm, ghi báo cáo thống kê và báo lỗi nếu không đạt ít
nhất 1.000 sản phẩm.

## Những gì được đưa lên Git

- Script tải/lọc và tài liệu nguồn.
- Báo cáo thống kê không chứa ảnh.
- Một file metadata mẫu nhỏ nếu cần kiểm thử.

Không commit archive, toàn bộ ảnh, embedding hoặc FAISS index. Các file lớn phải được
tạo lại từ script hoặc lưu trong Drive của nhóm.
