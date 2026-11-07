import argparse
import json
import shutil
from collections import defaultdict
from pathlib import Path

import pandas as pd


def clean_optional(value: object) -> str | None:
    if pd.isna(value):
        return None
    text = str(value).strip()
    return text or None


def select_balanced_rows(data: pd.DataFrame, limit: int) -> list[pd.Series]:
    groups: dict[str, list[pd.Series]] = defaultdict(list)
    for _, row in data.iterrows():
        groups[str(row["category"])].append(row)

    selected: list[pd.Series] = []
    offset = 0
    categories = sorted(groups)
    while len(selected) < limit:
        added = False
        for category in categories:
            rows = groups[category]
            if offset < len(rows):
                selected.append(rows[offset])
                added = True
                if len(selected) == limit:
                    break
        if not added:
            break
        offset += 1
    return selected


def main() -> None:
    parser = argparse.ArgumentParser(description="Xuất gói JSONL và ảnh mẫu cho Backend")
    parser.add_argument("--metadata", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--limit", type=int, default=10)
    args = parser.parse_args()

    metadata = pd.read_csv(args.metadata)
    output_dir = Path(args.output_dir)
    images_dir = output_dir / "images"
    output_dir.mkdir(parents=True, exist_ok=True)

    rows = select_balanced_rows(metadata, args.limit)
    if len(rows) != args.limit:
        raise ValueError(f"Chỉ chọn được {len(rows)}/{args.limit} sản phẩm")

    jsonl_path = output_dir / "products.jsonl"
    with jsonl_path.open("w", encoding="utf-8") as output:
        for row in rows:
            original_id = str(row["externalId"]).strip()
            source_image = Path(str(row["image_path"]))
            if not source_image.is_file():
                raise FileNotFoundError(source_image)

            relative_image = Path("images") / original_id / "01.jpg"
            destination_image = output_dir / relative_image
            destination_image.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source_image, destination_image)

            source_attributes = {
                key: value
                for key, value in {
                    "productType": clean_optional(row.get("productType")),
                    "color": clean_optional(row.get("color")),
                    "imageId": clean_optional(row.get("imageId")),
                }.items()
                if value is not None
            }
            record = {
                "schemaVersion": 1,
                "source": "abo",
                "externalId": f"abo:{original_id}",
                "name": str(row["name"]).strip(),
                "description": clean_optional(row.get("description")),
                "brand": clean_optional(row.get("brand")),
                "externalCategory": clean_optional(row.get("sourceCategory")),
                "normalizedCategory": str(row["category"]).strip(),
                "images": [
                    {
                        "sourcePath": relative_image.as_posix(),
                        "sortOrder": 0,
                        "isPrimary": True,
                    }
                ],
                "sourceAttributes": source_attributes,
            }
            output.write(json.dumps(record, ensure_ascii=False) + "\n")

    print(f"Đã xuất {len(rows)} sản phẩm: {jsonl_path}")
    print(f"Thư mục ảnh: {images_dir}")


if __name__ == "__main__":
    main()
