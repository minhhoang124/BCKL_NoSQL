import argparse
import json
import time

import faiss
from PIL import Image
from sentence_transformers import SentenceTransformer


def main():
    parser = argparse.ArgumentParser(description="Tìm sản phẩm tương tự bằng ảnh")
    parser.add_argument("--image", required=True)
    parser.add_argument("--index", required=True)
    parser.add_argument("--mapping", required=True)
    parser.add_argument("--top-k", type=int, default=10)
    parser.add_argument("--model", default="sentence-transformers/clip-ViT-B-32")
    args = parser.parse_args()

    index = faiss.read_index(args.index)
    with open(args.mapping, encoding="utf-8") as file:
        mapping = json.load(file)

    product_ids = {int(item["productId"]) for item in mapping["items"]}
    if len(product_ids) != index.ntotal:
        raise ValueError("Mapping không khớp số vector trong FAISS")

    model = SentenceTransformer(args.model)
    image = Image.open(args.image).convert("RGB")

    start_time = time.perf_counter()
    query_embedding = model.encode(
        [image],
        convert_to_numpy=True,
        normalize_embeddings=True
    ).astype("float32")
    scores, result_ids = index.search(query_embedding, k=min(args.top_k, index.ntotal))
    response_time_ms = (time.perf_counter() - start_time) * 1000

    items = []
    for rank, (product_id, score) in enumerate(
        zip(result_ids[0], scores[0], strict=True), start=1
    ):
        if product_id < 0:
            continue
        items.append({
            "productId": int(product_id),
            "rank": rank,
            "score": round(float(score), 6)
        })

    print(json.dumps({
        "items": items,
        "responseTimeMs": round(response_time_ms, 2)
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
