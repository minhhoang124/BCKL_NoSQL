"""Tạo tập con điện tử cân bằng từ Amazon Berkeley Objects (ABO)."""

from __future__ import annotations

import argparse
import csv
import gzip
import json
import random
from collections import Counter, defaultdict
from pathlib import Path

CATEGORY_BY_PRODUCT_TYPE = {
    "audio": {
        "AUDIO_OR_VIDEO", "CAR_AUDIO_OR_THEATER", "COMPUTER_SPEAKER",
        "HEADPHONES", "MICROPHONE", "PORTABLE_AUDIO", "SPEAKERS",
    },
    "camera": {
        "CAMERA_BAGS_AND_CASES", "CAMERA_FLASH", "CAMERA_LENS_FILTERS",
        "CAMERA_OTHER_ACCESSORIES", "CAMERA_SUPPORT", "CAMERA_TRIPOD",
        "SECURITY_CAMERA", "VEHICLE_SAFETY_CAMERA",
    },
    "computer": {
        "COMPUTER", "COMPUTER_ADD_ON", "COMPUTER_COMPONENT",
        "COMPUTER_COOLING_DEVICE", "COMPUTER_DRIVE_OR_STORAGE",
        "COMPUTER_INPUT_DEVICE", "COMPUTER_INPUT_DEVICE_ACCESSORY",
        "FLASH_DRIVE", "FLASH_MEMORY", "INPUT_MOUSE", "KEYBOARDS",
        "MEMORY_READER", "MONITOR", "NOTEBOOK_COMPUTER", "PERSONAL_COMPUTER",
    },
    "mobile_accessory": {
        "AMAZON_TABLET_ACCESSORY", "CELLULAR_PHONE_CASE", "ELECTRONIC_DEVICE_DOCKING_STATION",
        "PHONE", "PHONE_ACCESSORY", "PORTABLE_ELECTRONIC_DEVICE_COVER",
        "PORTABLE_ELECTRONIC_DEVICE_MOUNT", "PORTABLE_ELECTRONIC_DEVICE_STAND",
        "WIRELESS_ACCESSORY",
    },
    "network_security": {
        "CAR_ELECTRONICS", "NETWORK_INTERFACE_CONTROLLER_ADAPTER",
        "NETWORKING_DEVICE", "NETWORKING_ROUTER", "SECURITY_ELECTRONICS",
    },
    "office_display": {
        "CONSUMER_ELECTRONICS", "OFFICE_ELECTRONICS", "PRINTER",
        "TELEVISION", "VIDEO_PROJECTOR",
    },
    "power_adapter": {
        "BATTERY", "CHARGING_ADAPTER", "ELECTRONIC_ADAPTER", "ELECTRONIC_CABLE",
    },
}

DEFAULT_LIMITS = {
    "audio": 300,
    "camera": 200,
    "computer": 500,
    "mobile_accessory": 300,
    "network_security": 150,
    "office_display": 300,
    "power_adapter": 400,
}


def localized_value(values: list[dict], preferred_prefix: str = "en_") -> str:
    for item in values or []:
        if str(item.get("language_tag", "")).startswith(preferred_prefix):
            return " ".join(str(item.get("value", "")).split())
    return ""


def plain_value(values: list[dict]) -> str:
    for item in values or []:
        value = " ".join(str(item.get("value", "")).split())
        if value:
            return value
    return ""


def category_for(product_type: str) -> str | None:
    for category, product_types in CATEGORY_BY_PRODUCT_TYPE.items():
        if product_type in product_types:
            return category
    return None


def load_image_paths(image_root: Path, image_metadata: Path) -> dict[str, Path]:
    paths: dict[str, Path] = {}
    with gzip.open(image_metadata, "rt", encoding="utf-8", newline="") as file:
        for row in csv.DictReader(file):
            path = image_root / row["path"]
            if path.is_file():
                paths[row["image_id"]] = path.resolve()
    return paths


def main() -> None:
    parser = argparse.ArgumentParser(description="Lọc dataset đồ điện tử từ ABO")
    parser.add_argument("--listings-dir", type=Path, required=True)
    parser.add_argument("--images-dir", type=Path, required=True)
    parser.add_argument(
        "--image-metadata",
        type=Path,
        help="Mặc định: <images-dir>/../metadata/images.csv.gz",
    )
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--target", type=int, default=2000)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    image_metadata = args.image_metadata or args.images_dir.parent / "metadata/images.csv.gz"
    if not image_metadata.is_file():
        raise ValueError(f"Không tìm thấy metadata ảnh: {image_metadata}")
    image_paths = load_image_paths(args.images_dir, image_metadata)
    if not image_paths:
        raise ValueError(f"Không tìm thấy ảnh trong {args.images_dir}")

    candidates: dict[str, list[dict]] = defaultdict(list)
    scanned = 0
    rejected = Counter()
    seen_external_ids: set[str] = set()
    seen_image_ids: set[str] = set()

    for source in sorted(args.listings_dir.glob("*.json.gz")):
        with gzip.open(source, "rt", encoding="utf-8") as file:
            for line in file:
                scanned += 1
                item = json.loads(line)
                product_type = plain_value(item.get("product_type", [])).upper()
                category = category_for(product_type)
                if not category:
                    rejected["not_electronics"] += 1
                    continue

                name = localized_value(item.get("item_name", []))
                if not name:
                    rejected["no_english_name"] += 1
                    continue

                image_id = str(item.get("main_image_id", "")).strip()
                image_path = image_paths.get(image_id)
                if not image_path:
                    rejected["image_missing"] += 1
                    continue

                external_id = str(item.get("item_id", "")).strip()
                if not external_id or external_id in seen_external_ids:
                    rejected["duplicate_external_id"] += 1
                    continue
                if image_id in seen_image_ids:
                    rejected["duplicate_main_image"] += 1
                    continue

                description_parts = [
                    " ".join(str(value.get("value", "")).split())
                    for value in item.get("bullet_point", [])
                    if str(value.get("language_tag", "")).startswith("en_")
                    and str(value.get("value", "")).strip()
                ]
                nodes = [
                    str(node.get("node_name") or node.get("path") or "").strip()
                    for node in item.get("node", [])
                ]
                candidates[category].append({
                    "externalId": external_id,
                    "name": name,
                    "description": " ".join(description_parts[:3]),
                    "category": category,
                    "productType": product_type,
                    "brand": localized_value(item.get("brand", [])),
                    "color": localized_value(item.get("color", [])),
                    "sourceCategory": nodes[0] if nodes else "",
                    "imageId": image_id,
                    "image_path": str(image_path),
                    "source": "Amazon Berkeley Objects (ABO)",
                })
                seen_external_ids.add(external_id)
                seen_image_ids.add(image_id)

    rng = random.Random(args.seed)
    selected: list[dict] = []
    for category, limit in DEFAULT_LIMITS.items():
        rows = candidates.get(category, [])
        rng.shuffle(rows)
        selected.extend(rows[:limit])

    rng.shuffle(selected)
    selected = selected[: args.target]
    selected.sort(key=lambda row: (row["category"], row["externalId"]))
    for product_id, row in enumerate(selected, start=1):
        row["productId"] = product_id  # ID tạm cho prototype; Backend sẽ ánh xạ lại.

    args.output.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = [
        "productId", "externalId", "name", "description", "category",
        "productType", "brand", "color", "sourceCategory", "imageId",
        "image_path", "source",
    ]
    with args.output.open("w", encoding="utf-8", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(selected)

    selected_counts = Counter(row["category"] for row in selected)
    report = {
        "source": "Amazon Berkeley Objects (ABO)",
        "license": "CC BY 4.0",
        "scannedListings": scanned,
        "availableImages": len(image_paths),
        "eligibleByCategory": {key: len(value) for key, value in sorted(candidates.items())},
        "selectedByCategory": dict(sorted(selected_counts.items())),
        "selectedTotal": len(selected),
        "requestedTarget": args.target,
        "rejected": dict(rejected),
        "seed": args.seed,
        "note": "productId là số tạm khi prototype; externalId là item_id gốc của ABO.",
    }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))

    if len(selected) < 1000:
        raise ValueError(f"Chỉ chọn được {len(selected)} sản phẩm; chưa đạt yêu cầu 1.000")


if __name__ == "__main__":
    main()
