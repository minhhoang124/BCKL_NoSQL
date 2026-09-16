#!/usr/bin/env python3
"""Create a reproducible first-pass quality review for an ABO JSONL package.

The script never modifies the input package. It writes candidate decisions that
must be manually checked before the cleaned dataset is published.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import html
import json
import re
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Iterable

import numpy as np
from PIL import Image, ImageDraw, ImageFont, UnidentifiedImageError


ALLOWED_IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}
ALLOWED_PRODUCT_TYPES = {
    "AUDIO_OR_VIDEO",
    "BATTERY",
    "CAMERA_BAGS_AND_CASES",
    "CAMERA_LENS_FILTERS",
    "CAMERA_OTHER_ACCESSORIES",
    "CAMERA_SUPPORT",
    "CAMERA_TRIPOD",
    "CAR_AUDIO_OR_THEATER",
    "CAR_ELECTRONICS",
    "CELLULAR_PHONE_CASE",
    "CHARGING_ADAPTER",
    "COMPUTER",
    "COMPUTER_ADD_ON",
    "COMPUTER_COMPONENT",
    "COMPUTER_COOLING_DEVICE",
    "COMPUTER_DRIVE_OR_STORAGE",
    "COMPUTER_INPUT_DEVICE",
    "COMPUTER_INPUT_DEVICE_ACCESSORY",
    "COMPUTER_SPEAKER",
    "CONSUMER_ELECTRONICS",
    "ELECTRONIC_ADAPTER",
    "ELECTRONIC_CABLE",
    "FLASH_DRIVE",
    "FLASH_MEMORY",
    "HEADPHONES",
    "INPUT_MOUSE",
    "KEYBOARDS",
    "MEMORY_READER",
    "MICROPHONE",
    "MONITOR",
    "NETWORKING_DEVICE",
    "NETWORK_INTERFACE_CONTROLLER_ADAPTER",
    "NOTEBOOK_COMPUTER",
    "OFFICE_ELECTRONICS",
    "PERSONAL_COMPUTER",
    "PORTABLE_AUDIO",
    "PORTABLE_ELECTRONIC_DEVICE_MOUNT",
    "PRINTER",
    "SECURITY_ELECTRONICS",
    "SPEAKERS",
    "TELEVISION",
    "VIDEO_PROJECTOR",
    "WIRELESS_ACCESSORY",
}
CANONICAL_BRANDS = {
    "amazon basics": "AmazonBasics",
    "amazonbasics": "AmazonBasics",
    "amazonbasics b2b": "AmazonBasics",
    "amazon brand - solimo": "Amazon Brand - Solimo",
    "solimo": "Amazon Brand - Solimo",
    "eono": "Eono",
    "umi": "UMI",
    "arkon": "ARKON",
    "exacon": "Exacon",
    "gira": "Gira",
    "warmhoming": "Warmhoming",
    "pinzon by amazon": "Pinzon by Amazon",
    "rivet": "Rivet",
    "sony": "Sony",
    "amazoncommercial": "AmazonCommercial",
}
TITLE_NOISE_PATTERNS = [
    re.compile(r"\s*\(Discontinued by Manufacturer\)\s*", re.I),
    re.compile(r"\s*\[Discontinued\]\s*", re.I),
]
DESCRIPTION_BOILERPLATE = [
    re.compile(r"\bMake sure this fits by entering your model number\.?\s*", re.I),
]
CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
HTML_RE = re.compile(r"<[^>]+>")
SPACE_RE = re.compile(r"\s+")
TOKEN_RE = re.compile(r"[a-z0-9]+", re.I)


def normalize_space(value: str | None) -> str:
    return SPACE_RE.sub(" ", html.unescape(value or "")).strip()


def normalize_key(value: str | None) -> str:
    text = unicodedata.normalize("NFKD", normalize_space(value)).casefold()
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    return " ".join(TOKEN_RE.findall(text))


def clean_title(value: str) -> str:
    result = normalize_space(value)
    for pattern in TITLE_NOISE_PATTERNS:
        result = pattern.sub(" ", result)
    return normalize_space(result)


def clean_description(value: str) -> str:
    result = normalize_space(value)
    for pattern in DESCRIPTION_BOILERPLATE:
        result = pattern.sub(" ", result)
    return normalize_space(result)


def resolve_source_path(root: Path, relative: str) -> Path:
    relative_path = Path(relative)
    if relative_path.is_absolute() or ".." in relative_path.parts:
        raise ValueError("đường dẫn ảnh không an toàn")
    resolved_root = root.resolve()
    resolved = (resolved_root / relative_path).resolve()
    if resolved != resolved_root and resolved_root not in resolved.parents:
        raise ValueError("đường dẫn ảnh vượt khỏi thư mục dataset")
    return resolved


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def phash(image: Image.Image) -> int:
    gray = image.convert("L").resize((32, 32), Image.Resampling.LANCZOS)
    pixels = np.asarray(gray, dtype=np.float64)
    n = 32
    k = np.arange(n)
    x = np.arange(n)
    basis = np.cos(np.pi * (2 * x[None, :] + 1) * k[:, None] / (2 * n))
    basis[0, :] *= 1 / np.sqrt(2)
    basis *= np.sqrt(2 / n)
    coeff = basis @ pixels @ basis.T
    low = coeff[:8, :8]
    median = np.median(low[1:, :])
    bits = (low > median).flatten()
    value = 0
    for bit in bits:
        value = (value << 1) | int(bit)
    return value


def hamming(left: int, right: int) -> int:
    return (left ^ right).bit_count()


def token_similarity(left: str, right: str) -> float:
    a, b = set(TOKEN_RE.findall(left.casefold())), set(TOKEN_RE.findall(right.casefold()))
    return len(a & b) / len(a | b) if a or b else 1.0


def canonical_brand(value: str | None) -> str | None:
    key = normalize_key(value)
    return CANONICAL_BRANDS.get(key)


def infer_brand_from_name(name: str) -> str | None:
    normalized = normalize_key(name)
    candidates = sorted(CANONICAL_BRANDS.items(), key=lambda item: len(item[0]), reverse=True)
    for prefix, brand in candidates:
        if normalized == prefix or normalized.startswith(prefix + " "):
            return brand
    return None


def add_issue(record: dict[str, Any], code: str, reason: str, severity: str = "FIX") -> None:
    record["issues"].append(code)
    record["reasons"].append(reason)
    if severity == "REMOVE":
        record["status"] = "LOẠI"
    elif record["status"] == "GIỮ":
        record["status"] = "SỬA"


def load_products(path: Path) -> list[dict[str, Any]]:
    products = []
    with path.open(encoding="utf-8") as handle:
        for line_no, line in enumerate(handle, 1):
            if not line.strip():
                continue
            item = json.loads(line)
            item["_lineNumber"] = line_no
            products.append(item)
    return products


def write_csv(path: Path, rows: Iterable[dict[str, Any]], fields: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def contact_sheets(
    rows: list[dict[str, Any]], root: Path, output_dir: Path, per_sheet: int = 30
) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    columns, tile_w, tile_h = 5, 310, 270
    rows_per_sheet = (per_sheet + columns - 1) // columns
    font = ImageFont.load_default(size=13)
    for start in range(0, len(rows), per_sheet):
        page = Image.new("RGB", (columns * tile_w, rows_per_sheet * tile_h), "white")
        draw = ImageDraw.Draw(page)
        for offset, row in enumerate(rows[start : start + per_sheet]):
            x = (offset % columns) * tile_w
            y = (offset // columns) * tile_h
            try:
                image_path = resolve_source_path(root, row["imageSourcePath"])
                with Image.open(image_path) as image:
                    thumb = image.convert("RGB")
                    thumb.thumbnail((210, 190), Image.Resampling.LANCZOS)
                    page.paste(thumb, (x + (tile_w - thumb.width) // 2, y + 5))
            except Exception:
                draw.rectangle((x + 50, y + 10, x + 260, y + 190), outline="red", width=3)
                draw.text((x + 75, y + 85), "IMAGE ERROR", fill="red", font=font)
            caption = [
                row["externalId"].removeprefix("abo:"),
                row["normalizedCategory"],
                row["name"][:42],
            ]
            draw.multiline_text((x + 8, y + 200), "\n".join(caption), fill="black", font=font, spacing=2)
        index = start // per_sheet + 1
        page.save(output_dir / f"contact_{index:02d}.jpg", quality=90)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("dataset_root", type=Path)
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("--contact-sheets", action="store_true")
    args = parser.parse_args()

    root = args.dataset_root.resolve()
    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    products_path = root / "products.jsonl"
    products = load_products(products_path)

    reviews: list[dict[str, Any]] = []
    id_occurrences: defaultdict[str, list[int]] = defaultdict(list)
    name_occurrences: defaultdict[str, list[int]] = defaultdict(list)
    file_hash_occurrences: defaultdict[str, list[int]] = defaultdict(list)
    pixel_hash_occurrences: defaultdict[str, list[int]] = defaultdict(list)
    perceptual: list[tuple[int, int]] = []

    for index, product in enumerate(products):
        external_id = normalize_space(product.get("externalId"))
        name = normalize_space(product.get("name"))
        description = normalize_space(product.get("description"))
        brand = normalize_space(product.get("brand"))
        external_category = normalize_space(product.get("externalCategory"))
        normalized_category = normalize_space(product.get("normalizedCategory"))
        source_attrs = product.get("sourceAttributes") or {}
        product_type = normalize_space(source_attrs.get("productType"))
        images = product.get("images") or []
        image_source_path = normalize_space(images[0].get("sourcePath")) if images else ""
        review: dict[str, Any] = {
            "rowNumber": product.get("_lineNumber"),
            "externalId": external_id,
            "status": "GIỮ",
            "issues": [],
            "reasons": [],
            "proposedName": "",
            "proposedDescription": "",
            "proposedBrand": "",
            "proposedNormalizedCategory": "",
            "duplicateOf": "",
            "manualImageReview": "CẦN KIỂM TRA",
            "name": name,
            "description": description,
            "brand": brand,
            "externalCategory": external_category,
            "normalizedCategory": normalized_category,
            "productType": product_type,
            "imageSourcePath": image_source_path,
            "imageWidth": "",
            "imageHeight": "",
            "imageFormat": "",
            "fileSha256": "",
            "pixelSha256": "",
            "pHash": "",
        }
        reviews.append(review)

        if product.get("schemaVersion") != 1:
            add_issue(review, "SCHEMA_VERSION_INVALID", "schemaVersion phải bằng 1", "REMOVE")
        if product.get("source") != "abo":
            add_issue(review, "SOURCE_INVALID", "source phải bằng abo", "REMOVE")
        if not re.fullmatch(r"abo:[A-Za-z0-9._-]+", external_id):
            add_issue(review, "EXTERNAL_ID_INVALID", "externalId thiếu namespace abo: hoặc có ký tự sai", "REMOVE")
        id_occurrences[external_id].append(index)

        if not name:
            add_issue(review, "NAME_MISSING", "Thiếu tên nên không thể xác định sản phẩm", "REMOVE")
        else:
            name_occurrences[normalize_key(name)].append(index)
            proposed_name = clean_title(name)
            if proposed_name != name:
                add_issue(review, "NAME_NOISE", "Tên chứa cụm trạng thái/boilerplate không thuộc tên sản phẩm")
                review["proposedName"] = proposed_name
            if CONTROL_RE.search(name) or HTML_RE.search(name):
                add_issue(review, "NAME_GARBAGE", "Tên chứa ký tự điều khiển hoặc thẻ HTML")
                review["proposedName"] = normalize_space(HTML_RE.sub(" ", CONTROL_RE.sub(" ", name)))

        if not description:
            add_issue(review, "DESCRIPTION_MISSING", "Thiếu mô tả; cần lấy lại từ nguồn, không tự suy đoán")
        else:
            proposed_description = clean_description(description)
            if proposed_description != description:
                add_issue(review, "DESCRIPTION_BOILERPLATE", "Mô tả chứa boilerplate của trang bán hàng")
                review["proposedDescription"] = proposed_description
            if CONTROL_RE.search(description) or HTML_RE.search(description):
                add_issue(review, "DESCRIPTION_GARBAGE", "Mô tả chứa ký tự điều khiển hoặc thẻ HTML")
                review["proposedDescription"] = normalize_space(
                    HTML_RE.sub(" ", CONTROL_RE.sub(" ", description))
                )

        if not brand:
            inferred = infer_brand_from_name(name)
            add_issue(review, "BRAND_MISSING", "Thiếu brand")
            if inferred:
                review["proposedBrand"] = inferred
                review["reasons"].append(f"Tên sản phẩm hỗ trợ đề xuất brand {inferred}")
            else:
                review["reasons"].append("Không đủ bằng chứng để tự điền brand")
        else:
            canonical = canonical_brand(brand)
            if canonical and canonical != brand:
                add_issue(review, "BRAND_VARIANT", "Brand dùng biến thể chữ không nhất quán")
                review["proposedBrand"] = canonical

        if not normalized_category:
            add_issue(review, "CATEGORY_MISSING", "Thiếu normalizedCategory")
        if not external_category:
            review["issues"].append("SOURCE_CATEGORY_MISSING")
            review["reasons"].append(
                "externalCategory trống; không tự điền nếu không khôi phục được từ nguồn"
            )
        if not product_type or product_type not in ALLOWED_PRODUCT_TYPES:
            add_issue(
                review,
                "OUT_OF_SCOPE_PRODUCT_TYPE",
                "productType không thuộc danh sách điện tử/phụ kiện đã thống nhất",
                "REMOVE",
            )

        if len(images) != 1:
            add_issue(review, "IMAGE_COUNT_INVALID", "Mỗi bản ghi prototype phải có đúng một ảnh chính", "REMOVE")
        elif not image_source_path:
            add_issue(review, "IMAGE_PATH_MISSING", "Thiếu images[0].sourcePath", "REMOVE")
        else:
            try:
                image_path = resolve_source_path(root, image_source_path)
                if image_path.suffix.casefold() not in ALLOWED_IMAGE_SUFFIXES:
                    raise ValueError("định dạng ảnh không nằm trong danh sách cho phép")
                if not image_path.is_file():
                    raise FileNotFoundError("không tìm thấy ảnh")
                file_hash = sha256_file(image_path)
                with Image.open(image_path) as image:
                    image.verify()
                with Image.open(image_path) as image:
                    rgb = image.convert("RGB")
                    review["imageWidth"], review["imageHeight"] = rgb.size
                    review["imageFormat"] = image.format or image_path.suffix.removeprefix(".").upper()
                    pixel_digest = hashlib.sha256(
                        f"{rgb.width}x{rgb.height}|RGB|".encode() + rgb.tobytes()
                    ).hexdigest()
                    perceptual_hash = phash(rgb)
                review["fileSha256"] = file_hash
                review["pixelSha256"] = pixel_digest
                review["pHash"] = f"{perceptual_hash:016x}"
                file_hash_occurrences[file_hash].append(index)
                pixel_hash_occurrences[pixel_digest].append(index)
                perceptual.append((index, perceptual_hash))
            except (OSError, ValueError, UnidentifiedImageError) as exc:
                add_issue(review, "IMAGE_BROKEN", f"Ảnh không đọc được: {exc}", "REMOVE")

    for external_id, indexes in id_occurrences.items():
        for index in indexes[1:]:
            add_issue(reviews[index], "EXTERNAL_ID_DUPLICATE", f"Trùng externalId {external_id}", "REMOVE")
            reviews[index]["duplicateOf"] = reviews[indexes[0]]["externalId"]

    duplicate_candidates: list[dict[str, Any]] = []
    exact_pairs: set[tuple[int, int]] = set()
    for group_type, groups in [("FILE", file_hash_occurrences), ("PIXEL", pixel_hash_occurrences)]:
        for _, indexes in groups.items():
            if len(indexes) < 2:
                continue
            first = indexes[0]
            for index in indexes[1:]:
                pair = (first, index)
                exact_pairs.add(pair)
                similarity = token_similarity(reviews[first]["name"], reviews[index]["name"])
                duplicate_candidates.append(
                    {
                        "leftExternalId": reviews[first]["externalId"],
                        "rightExternalId": reviews[index]["externalId"],
                        "matchType": f"EXACT_{group_type}",
                        "pHashDistance": 0,
                        "nameSimilarity": round(similarity, 3),
                        "leftName": reviews[first]["name"],
                        "rightName": reviews[index]["name"],
                    }
                )
                if normalize_key(reviews[first]["name"]) == normalize_key(reviews[index]["name"]):
                    add_issue(
                        reviews[index],
                        "PRODUCT_DUPLICATE_CLEAR",
                        f"Trùng tên và ảnh với {reviews[first]['externalId']}",
                        "REMOVE",
                    )
                    reviews[index]["duplicateOf"] = reviews[first]["externalId"]
                else:
                    reviews[first]["issues"].append("IMAGE_DUPLICATE_CANDIDATE")
                    reviews[index]["issues"].append("IMAGE_DUPLICATE_CANDIDATE")
                    reviews[first]["reasons"].append("Ảnh trùng bản ghi khác; cần phân biệt biến thể và sản phẩm trùng")
                    reviews[index]["reasons"].append("Ảnh trùng bản ghi khác; cần phân biệt biến thể và sản phẩm trùng")

    # Candidate near-duplicates. Only pairs with similar names are emitted to keep manual review bounded.
    for left_pos in range(len(perceptual)):
        left_index, left_hash = perceptual[left_pos]
        for right_pos in range(left_pos + 1, len(perceptual)):
            right_index, right_hash = perceptual[right_pos]
            if (left_index, right_index) in exact_pairs:
                continue
            distance = hamming(left_hash, right_hash)
            if distance > 4:
                continue
            similarity = token_similarity(reviews[left_index]["name"], reviews[right_index]["name"])
            if similarity < 0.45:
                continue
            duplicate_candidates.append(
                {
                    "leftExternalId": reviews[left_index]["externalId"],
                    "rightExternalId": reviews[right_index]["externalId"],
                    "matchType": "NEAR_PHASH",
                    "pHashDistance": distance,
                    "nameSimilarity": round(similarity, 3),
                    "leftName": reviews[left_index]["name"],
                    "rightName": reviews[right_index]["name"],
                }
            )
            for index in (left_index, right_index):
                reviews[index]["issues"].append("PRODUCT_DUPLICATE_CANDIDATE")
                reviews[index]["reasons"].append("Ảnh và tên gần giống bản ghi khác; cần kiểm tra thủ công")

    for normalized_name, indexes in name_occurrences.items():
        if normalized_name and len(indexes) > 1:
            for index in indexes:
                reviews[index]["issues"].append("NAME_DUPLICATE_CANDIDATE")
                reviews[index]["reasons"].append("Tên trùng hoàn toàn với bản ghi khác; cần so sánh biến thể")

    for review in reviews:
        review["issueCodes"] = "; ".join(dict.fromkeys(review.pop("issues")))
        review["reason"] = "; ".join(dict.fromkeys(review.pop("reasons")))

    review_fields = [
        "rowNumber",
        "externalId",
        "status",
        "issueCodes",
        "reason",
        "proposedName",
        "proposedDescription",
        "proposedBrand",
        "proposedNormalizedCategory",
        "duplicateOf",
        "manualImageReview",
        "name",
        "description",
        "brand",
        "externalCategory",
        "normalizedCategory",
        "productType",
        "imageSourcePath",
        "imageWidth",
        "imageHeight",
        "imageFormat",
        "fileSha256",
        "pixelSha256",
        "pHash",
    ]
    write_csv(output_dir / "automated_review.csv", reviews, review_fields)
    write_csv(
        output_dir / "duplicate_candidates.csv",
        duplicate_candidates,
        [
            "leftExternalId",
            "rightExternalId",
            "matchType",
            "pHashDistance",
            "nameSimilarity",
            "leftName",
            "rightName",
        ],
    )

    counts = Counter(review["status"] for review in reviews)
    issue_counts = Counter()
    for review in reviews:
        issue_counts.update(code for code in review["issueCodes"].split("; ") if code)
    category_counts = Counter(review["normalizedCategory"] or "<MISSING>" for review in reviews)
    brand_counts = Counter(review["brand"] or "<MISSING>" for review in reviews)
    summary = {
        "recordCount": len(reviews),
        "statusCounts": dict(counts),
        "remainingAfterRemove": len(reviews) - counts.get("LOẠI", 0),
        "issueCounts": dict(issue_counts.most_common()),
        "categoryCounts": dict(category_counts.most_common()),
        "brandCounts": dict(brand_counts.most_common()),
        "duplicateCandidateCount": len(duplicate_candidates),
        "sourceProductsSha256": sha256_file(products_path),
    }
    (output_dir / "automated_summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    if args.contact_sheets:
        contact_sheets(reviews, root, output_dir / "contact_sheets")

    print(json.dumps(summary, ensure_ascii=True, indent=2))


if __name__ == "__main__":
    main()
