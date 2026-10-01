import argparse
from pathlib import Path

import numpy as np
import pandas as pd
from PIL import Image
from sentence_transformers import SentenceTransformer


def main():
    parser = argparse.ArgumentParser(description="Sinh CLIP embedding cho ảnh sản phẩm")
    parser.add_argument("--metadata", required=True, help="CSV có productId và image_path")
    parser.add_argument("--embeddings-out", default="image_embeddings.npy")
    parser.add_argument("--metadata-out", default="products_metadata_clean.csv")
    parser.add_argument("--model", default="sentence-transformers/clip-ViT-B-32")
    parser.add_argument("--batch-size", type=int, default=32)
    args = parser.parse_args()

    metadata_path = Path(args.metadata).resolve()
    metadata = pd.read_csv(metadata_path)
    required_columns = {"productId", "image_path"}
    missing = required_columns - set(metadata.columns)
    if missing:
        raise ValueError(f"Thiếu cột bắt buộc: {sorted(missing)}")

    valid_rows = []
    images = []
    for _, row in metadata.iterrows():
        image_path = Path(str(row["image_path"]))
        if not image_path.is_absolute():
            image_path = metadata_path.parent / image_path
        if not image_path.exists():
            continue
        try:
            images.append(Image.open(image_path).convert("RGB"))
            valid_rows.append(row)
        except Exception as error:
            print(f"Bỏ qua ảnh lỗi {image_path}: {error}")

    if not images:
        raise ValueError("Không tìm thấy ảnh hợp lệ")

    clean_metadata = pd.DataFrame(valid_rows).reset_index(drop=True)
    model = SentenceTransformer(args.model)
    embeddings = model.encode(
        images,
        batch_size=args.batch_size,
        show_progress_bar=True,
        convert_to_numpy=True,
        normalize_embeddings=True
    ).astype("float32")

    np.save(args.embeddings_out, embeddings)
    clean_metadata.to_csv(args.metadata_out, index=False)
    print(f"Đã sinh {len(embeddings)} embedding, số chiều {embeddings.shape[1]}")
    print(f"Embedding: {args.embeddings_out}")
    print(f"Metadata sạch: {args.metadata_out}")


if __name__ == "__main__":
    main()
