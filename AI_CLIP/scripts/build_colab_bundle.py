"""Đóng gói metadata và ảnh đã chọn để tải lên Google Drive/Colab."""

from __future__ import annotations

import argparse
import csv
import json
import shutil
from collections import Counter
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description="Tạo bundle dataset dùng trên Colab")
    parser.add_argument("--metadata", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()

    images_dir = args.output_dir / "images"
    images_dir.mkdir(parents=True, exist_ok=True)

    with args.metadata.open("r", encoding="utf-8", newline="") as file:
        rows = list(csv.DictReader(file))

    if not rows:
        raise ValueError("Metadata không có sản phẩm")

    output_rows = []
    seen_product_ids = set()
    seen_external_ids = set()
    seen_sources = set()
    categories = Counter()

    for row in rows:
        product_id = int(row["productId"])
        external_id = row["externalId"].strip()
        source_path = Path(row["image_path"])
        if product_id in seen_product_ids:
            raise ValueError(f"productId bị trùng: {product_id}")
        if external_id in seen_external_ids:
            raise ValueError(f"externalId bị trùng: {external_id}")
        if not source_path.is_file():
            raise ValueError(f"Không tìm thấy ảnh: {source_path}")
        resolved_source = source_path.resolve()
        if resolved_source in seen_sources:
            raise ValueError(f"Ảnh chính bị trùng: {resolved_source}")

        suffix = source_path.suffix.lower() or ".jpg"
        target_name = f"{product_id}{suffix}"
        target_path = images_dir / target_name
        shutil.copy2(source_path, target_path)

        output_row = dict(row)
        output_row["image_path"] = f"images/{target_name}"
        output_rows.append(output_row)
        categories[row["category"]] += 1
        seen_product_ids.add(product_id)
        seen_external_ids.add(external_id)
        seen_sources.add(resolved_source)

    metadata_path = args.output_dir / "products_metadata.csv"
    with metadata_path.open("w", encoding="utf-8", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=output_rows[0].keys())
        writer.writeheader()
        writer.writerows(output_rows)

    manifest = {
        "dataset": "ABO Electronics Subset",
        "source": "Amazon Berkeley Objects (ABO)",
        "license": "CC BY 4.0",
        "count": len(output_rows),
        "categories": dict(sorted(categories.items())),
        "metadata": "products_metadata.csv",
        "imagesDirectory": "images",
        "productIdNote": "ID số tạm của prototype; Backend sẽ cấp ID PostgreSQL chính thức.",
    }
    (args.output_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    shutil.copy2(
        Path(__file__).resolve().parents[2] / "datasets/raw/abo/LICENSE-CC-BY-4.0.txt",
        args.output_dir / "LICENSE-CC-BY-4.0.txt",
    )
    print(json.dumps(manifest, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
