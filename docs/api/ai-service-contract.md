# AI Service API Contract

Đây là contract tối thiểu giữa Backend và AI Service. Mọi thay đổi phải được Hoàng và Đạt cùng review.

## Health check

`GET /health`

## Lập chỉ mục sản phẩm

`POST /index/product`

```json
{
  "productId": 125,
  "name": "Áo hoodie nam màu đen",
  "description": "Áo nỉ có mũ phong cách thể thao",
  "category": "Hoodie",
  "brand": "Local Brand",
  "imageUrls": ["http://backend:3000/uploads/products/125/1.jpg"]
}
```

## Kết quả tìm kiếm

Áp dụng cho `POST /search/image` và `POST /search/text`.

```json
{
  "items": [
    {
      "productId": 125,
      "rank": 1,
      "score": 0.91
    }
  ],
  "responseTimeMs": 132
}
```

`productId` là khóa số nguyên của bảng Product trong PostgreSQL và được dùng làm ID tương ứng trong Elasticsearch và FAISS.

