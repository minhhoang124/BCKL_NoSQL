import argparse
import json

import faiss
import numpy as np
import pandas as pd


def main():
    parser = argparse.ArgumentParser(description="Tạo FAISS IndexIDMap2 và ánh xạ productId")
    parser.add_argument("--embeddings", required=True)
    parser.add_argument("--metadata", required=True)
    parser.add_argument("--index-out", default="products.faiss")
    parser.add_argument("--mapping-out", default="product_ids.json")
    args = parser.parse_args()

    embeddings = np.load(args.embeddings).astype("float32")
    metadata = pd.read_csv(args.metadata)

    if len(embeddings) != len(metadata):
        raise ValueError(
            f"Số embedding ({len(embeddings)}) khác số metadata ({len(metadata)})"
        )
    if "productId" not in metadata.columns:
        raise ValueError("Metadata thiếu cột productId")

    try:
        product_ids = metadata["productId"].astype("int64").to_numpy()
    except (TypeError, ValueError) as error:
        raise ValueError("productId phải là số nguyên để dùng với FAISS IndexIDMap2") from error
    if len(set(product_ids.tolist())) != len(product_ids):
        raise ValueError("productId bị trùng")

    faiss.normalize_L2(embeddings)
    base_index = faiss.IndexFlatIP(embeddings.shape[1])
    index = faiss.IndexIDMap2(base_index)
    index.add_with_ids(embeddings, product_ids)
    faiss.write_index(index, args.index_out)

    mapping = {
        "count": int(index.ntotal),
        "dimension": int(embeddings.shape[1]),
        "indexType": "IndexIDMap2(IndexFlatIP)",
        "items": [
            {
                "productId": int(row["productId"]),
                "externalId": str(row.get("externalId", "")),
            }
            for _, row in metadata.iterrows()
        ],
    }
    with open(args.mapping_out, "w", encoding="utf-8") as file:
        json.dump(mapping, file, ensure_ascii=False, indent=2)

    print(f"Đã tạo index với {index.ntotal} vector")
    print(f"FAISS index: {args.index_out}")
    print(f"Mapping: {args.mapping_out}")


if __name__ == "__main__":
    main()
