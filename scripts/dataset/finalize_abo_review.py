#!/usr/bin/env python3
"""Apply reviewed decisions to the automated ABO quality report.

The input dataset is read-only. This script only writes review artifacts.
"""

from __future__ import annotations

import argparse
import csv
import json
from collections import Counter
from pathlib import Path


OUT_OF_SCOPE = {
    "abo:B00870ZHCQ": "Ống nhòm dùng ngoài trời, không thuộc phạm vi điện tử/phụ kiện điện tử đã chốt.",
    "abo:B00CTFMD1S": "Gối ôm và vỏ gối, không thuộc phạm vi điện tử.",
    "abo:B075X3S2Z6": "Đèn cây trang trí nội thất, không thuộc phạm vi bộ dữ liệu đã chốt.",
    "abo:B07Q2NBNF5": "Sản phẩm cà phê, không thuộc phạm vi điện tử.",
    "abo:B01LYTIU1W": "Vòng tay/trang sức, không thuộc phạm vi điện tử.",
    "abo:B07D52SHTY": "Thảm yoga/Pilates, không thuộc phạm vi điện tử.",
    "abo:B07VDBBTFY": "Khung thành bóng đá, không thuộc phạm vi điện tử.",
    "abo:B07JMB83Q3": "Két ngụy trang dạng sách không có chức năng điện tử rõ ràng.",
    "abo:B07H9QFF82": "Cuộn sợi TPU là vật tư tiêu hao cho máy in 3D, ngoài phạm vi thiết bị điện tử/phụ kiện điện tử của bộ dữ liệu.",
}

IMAGE_MISMATCH = {
    "abo:B07TVRZZWB": "Ảnh chỉ hiển thị logo AmazonBasics, không thể hiện tai nghe trong tên sản phẩm.",
    "abo:B07GB3SGSF": "Ảnh chỉ hiển thị logo AmazonBasics, không thể hiện cáp USB trong tên sản phẩm.",
}

# Giữ bản ghi bên trái và loại bản ghi bên phải của từng cặp trùng rõ ràng.
DUPLICATE_OF = {
    "abo:B00EZMZTBO": "abo:B001TH7GUK",
    "abo:B01BSVLUBW": "abo:B015IKVKGE",
    "abo:B01HTRCWX4": "abo:B01F2O1CFK",
    "abo:B01B7RV2SI": "abo:B00LBPUBUC",
    "abo:B01ICRR8AW": "abo:B01ICR8H66",
    "abo:B07HH3J9WR": "abo:B075QMLS5J",
    "abo:B07HHM23QF": "abo:B07CWJR6YB",
    "abo:B01NBH855Y": "abo:B01MQSNS0R",
    "abo:B01MXUT9Z0": "abo:B01MQSNTDL",
    "abo:B01NBH83SI": "abo:B01MRU1PLL",
    "abo:B07WBS8ML1": "abo:B07W4CLC92",
    "abo:B07WV5WN7B": "abo:B0787G1YFG",
}

CATEGORY_FIXES = {
    "abo:B07TPLLSJG": "power_adapter",
    "abo:B07TPMH44Q": "power_adapter",
}

# The remaining 20 prior suggestions need a real Category leaf, not a forced match
# to one of the seven prototype buckets. Keep proposal blank until agreed.
CATEGORY_PENDING_REVIEW = {
    "abo:B000UW91EY": "cảm biến chuyển động Gira Observer 70; chờ xác minh mã listing và nhóm sensor/lighting",
    "abo:B06XT2FR5Q": "cáp USB-C; cần nhóm cable",
    "abo:B07674HN3M": "dây nối điện; cần nhóm electrical/cable",
    "abo:B07674HN3P": "dây nối điện; cần nhóm electrical/cable",
    "abo:B07676NXCH": "dây nối điện; cần nhóm electrical/cable",
    "abo:B07677TJ3G": "dây nối điện; cần nhóm electrical/cable",
    "abo:B076783WZZ": "dây nối điện; cần nhóm electrical/cable",
    "abo:B07678VMLW": "dây nối điện; cần nhóm electrical/cable",
    "abo:B07678VMM1": "dây nối điện; cần nhóm electrical/cable",
    "abo:B0767B356W": "dây nối điện; cần nhóm electrical/cable",
    "abo:B07KGKJLB4": "giá đỡ; cần xác minh thiết bị tương thích và nhóm mount",
    "abo:B07KGKW4Q8": "giá đỡ; cần xác minh thiết bị tương thích và nhóm mount",
    "abo:B07KGKZ7XP": "giá đỡ; cần xác minh thiết bị tương thích và nhóm mount",
    "abo:B07KGN19LQ": "giá đỡ; cần xác minh thiết bị tương thích và nhóm mount",
    "abo:B07QWSGQK7": "bóng LED; cần nhóm lighting",
    "abo:B07QWSHH1N": "bóng LED; cần nhóm lighting",
    "abo:B07QYTNK1M": "bóng LED; cần nhóm lighting",
    "abo:B07QYTR5GF": "bóng LED; cần nhóm lighting",
    "abo:B07QZYDYHN": "bóng LED; cần nhóm lighting",
    "abo:B07W42KQ3M": "dây nối điện; cần nhóm electrical/cable",
}

IMAGE_REVIEW = {
    "abo:B07Z4FGN78": "Hai listing 14.1 và 15.6 inch dùng cùng một ảnh; cần xác minh/đổi ảnh đúng kích thước.",
    "abo:B081VRJBX8": "Hai listing 14.1 và 15.6 inch dùng cùng một ảnh; cần xác minh/đổi ảnh đúng kích thước.",
}

DESCRIPTION_QA_HOLDS = {
    "abo:B00LLJ55XG": "Mô tả nguồn nói về đệm hỗ trợ lưng trong khi tên và ảnh là loa Bluetooth; không đưa mô tả này vào Product.",
    "abo:B00TTC9164": "Mô tả nguồn chỉ có câu 'An Amazon Brand', không có nội dung đặc tả sản phẩm; giữ null để xác minh.",
    "abo:B01FSGT9D4": "Mô tả nguồn lẫn AA/AAA và thông số bộ sạc chưa được xác minh đúng model; giữ null để rà lại.",
}

BRAND_PREFIXES = [
    ("amazon brand: eono", "Eono"),
    ("amazon brand - eono", "Eono"),
    ("amazon eono", "Eono"),
    ("eono by amazon", "Eono"),
    ("eono essentials", "Eono"),
    ("umi. essentials", "UMI"),
    ("umi. by amazon", "UMI"),
    ("amazoncommercial", "AmazonCommercial"),
    ("amazonbasics", "AmazonBasics"),
    ("amazon basics", "AmazonBasics"),
    ("amazon basic", "AmazonBasics"),
    ("western digital", "Western Digital"),
    ("wd ", "Western Digital"),
    ("seagate", "Seagate"),
    ("toshiba", "Toshiba"),
    ("transcend", "Transcend"),
    ("intenso", "Intenso"),
    ("maxtor", "Maxtor"),
    ("logitech", "Logitech"),
    ("dymo", "DYMO"),
    ("technoline", "Technoline"),
    ("wicked chili", "Wicked Chili"),
    ("xoro", "XORO"),
    ("dididiar", "DIDIDIAR"),
    ("danboard", "Danboard"),
]


def infer_brand(name: str) -> str:
    normalized = name.strip().lower().lstrip("'\"")
    if "dididiar" in normalized:
        return "DIDIDIAR"
    for prefix, brand in BRAND_PREFIXES:
        if normalized.startswith(prefix):
            return brand
    return ""


def split_codes(value: str) -> list[str]:
    return [item.strip() for item in value.split(";") if item.strip()]


def split_reasons(value: str) -> list[str]:
    return [item.strip() for item in value.split(" | ") if item.strip()]


def add_fix(row: dict[str, str], code: str, reason: str) -> None:
    codes = split_codes(row["issueCodes"])
    reasons = split_reasons(row["reason"])
    if code not in codes:
        codes.append(code)
    if reason not in reasons:
        reasons.append(reason)
    row["issueCodes"] = ";".join(codes)
    row["reason"] = " | ".join(reasons)
    if row["status"] == "GIỮ":
        row["status"] = "SỬA"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("automated_csv", type=Path)
    parser.add_argument("output_dir", type=Path)
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)

    source_summary = json.loads(args.automated_csv.with_name('automated_summary.json').read_text(encoding='utf-8'))
    if source_summary.get('sourceProductsSha256') != '4c9ec953160e3ceb6aad72acd8a35353fd9fad7d70cf2c326e6f8c919b1a185d':
        raise ValueError('Manual decisions apply only to the reviewed ABO package; review a changed source again.')

    with args.automated_csv.open(encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))

    for row in rows:
        external_id = row["externalId"]
        row["manualImageReview"] = "ĐÃ KIỂM TRA"

        if "BRAND_MISSING" in row["issueCodes"] and not row["proposedBrand"]:
            row["proposedBrand"] = infer_brand(row["name"])

        if external_id in CATEGORY_FIXES:
            target = CATEGORY_FIXES[external_id]
            row["proposedNormalizedCategory"] = target
            add_fix(
                row,
                "CATEGORY_MISMATCH",
                f"normalizedCategory '{row['normalizedCategory']}' không phù hợp; đề xuất '{target}'.",
            )

        if external_id in CATEGORY_PENDING_REVIEW:
            row["proposedNormalizedCategory"] = ""
            add_fix(
                row,
                "CATEGORY_MAPPING_PENDING",
                f"Category nguồn không phù hợp ({CATEGORY_PENDING_REVIEW[external_id]}); chờ Hoàng/Đạt chốt Category lá; chỉ import DRAFT.",
            )

        if external_id in IMAGE_REVIEW:
            add_fix(row, "IMAGE_REUSE_NEEDS_CHECK", IMAGE_REVIEW[external_id])

        if external_id in DESCRIPTION_QA_HOLDS:
            row["proposedDescription"] = ""
            add_fix(row, "DESCRIPTION_QA_HOLD", DESCRIPTION_QA_HOLDS[external_id])

        removal_reason = OUT_OF_SCOPE.get(external_id) or IMAGE_MISMATCH.get(external_id)
        if removal_reason:
            code = "OUT_OF_SCOPE" if external_id in OUT_OF_SCOPE else "IMAGE_TEXT_MISMATCH"
            add_fix(row, code, removal_reason)
            row["status"] = "LOẠI"

        if external_id in DUPLICATE_OF:
            kept_id = DUPLICATE_OF[external_id]
            row["duplicateOf"] = kept_id
            add_fix(row, "CLEAR_DUPLICATE", f"Trùng rõ ràng với {kept_id}; giữ bản ghi {kept_id}.")
            row["status"] = "LOẠI"

        # Proposals are not approval to publish. Keep unresolved records on hold.
        if row["status"] != "LOẠI":
            if external_id not in CATEGORY_PENDING_REVIEW and (row["normalizedCategory"] in {"network_security", "office_display", "power_adapter"} or external_id in CATEGORY_FIXES):
                add_fix(row, "CATEGORY_MAPPING_PENDING", "Chờ Hoàng/Đạt chốt taxonomy và ánh xạ Category lá; chỉ import DRAFT.")
            if "renewed" in row["name"].lower():
                add_fix(row, "CONDITION_PENDING", "Listing Renewed chờ quyết định condition; không import công khai.")
        row["importDisposition"] = "EXCLUDE" if row["status"] == "LOẠI" else "DRAFT_ONLY"
        row["publicationApproved"] = "false"

    # Keep review outputs compact and suitable for version control.
    fields = [
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
        "brand",
        "externalCategory",
        "normalizedCategory",
        "productType",
        "imageSourcePath",
        "importDisposition",
        "publicationApproved",
    ]
    with (args.output_dir / "abo_review_final.csv").open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)

    actions = [row for row in rows if row["status"] != "GIỮ"]
    with (args.output_dir / "abo_review_actions.csv").open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(actions)

    status_counts = Counter(row["status"] for row in rows)
    issue_counts = Counter(code for row in rows for code in split_codes(row["issueCodes"]))
    unresolved_brands = sum(
        row["status"] != "LOẠI"
        and "BRAND_MISSING" in row["issueCodes"]
        and not row["proposedBrand"]
        for row in rows
    )
    summary = {
        "recordCount": len(rows),
        "statusCounts": dict(status_counts),
        "remainingAfterRemove": len(rows) - status_counts["LOẠI"],
        "issueCounts": dict(issue_counts.most_common()),
        "unresolvedMissingBrandCount": unresolved_brands,
        "manualImageReviewCount": sum(row["manualImageReview"] == "ĐÃ KIỂM TRA" for row in rows),
        "removeIds": [row["externalId"] for row in rows if row["status"] == "LOẠI"],
        "fixIds": [row["externalId"] for row in rows if row["status"] == "SỬA"],
    }
    kept_rows = [row for row in rows if row["status"] != "LOẠI"]
    category_counts = Counter(
        row["proposedNormalizedCategory"] or row["normalizedCategory"] for row in kept_rows
    )
    brand_counts = Counter(row["proposedBrand"] or row["brand"] or "<CHƯA CHỐT>" for row in kept_rows)
    summary["categoryCountsAfterReview"] = dict(category_counts.most_common())
    summary["brandCountsAfterReview"] = dict(brand_counts.most_common())
    (args.output_dir / "abo_review_summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    workbook_data = {
        "summary": summary,
        "rows": rows,
        "actions": actions,
        "categories": [
            {"category": key, "countAfterReview": value}
            for key, value in category_counts.most_common()
        ],
        "brands": [
            {"brand": key, "countAfterReview": value}
            for key, value in brand_counts.most_common()
        ],
        "agreements": [
            {
                "topic": "Category network_security",
                "finding": "Nguồn đang trộn thiết bị mạng, két điện tử, dây điện, bóng đèn, bộ đổi điện và giá đỡ.",
                "proposal": "Rà 23 trường hợp: 2 inverter có đề xuất power_adapter; 20 mã còn chờ Category lá; 1 mã filament đã loại vì ngoài phạm vi thiết bị/phụ kiện điện tử.",
            },
            {
                "topic": "Category office_display",
                "finding": "Nhóm còn trộn màn hình/máy chiếu với máy hủy giấy và thiết bị văn phòng.",
                "proposal": "Chốt giữ nhóm gộp hoặc tách display và office_electronics trước khi import chính thức.",
            },
            {
                "topic": "Category power_adapter",
                "finding": "Nhóm bao gồm pin, bộ sạc, cáp và phụ kiện cấp điện.",
                "proposal": "Chốt giữ nhóm gộp hoặc tách battery và cable_adapter để phục vụ lọc/tìm kiếm.",
            },
            {
                "topic": "Brand Amazon",
                "finding": "Có AmazonBasics, Amazon Basics, AMAZONBASICS, amazonbasics và AmazonBasics B2B.",
                "proposal": "Chuẩn hóa các biến thể này về AmazonBasics.",
            },
            {
                "topic": "Brand Eono và UMI",
                "finding": "Tên sản phẩm dùng Eono by Amazon/Eono Essentials và Umi. Essentials.",
                "proposal": "Chuẩn hóa lần lượt về Eono và UMI.",
            },
            {
                "topic": "Listing bundle nhiều brand",
                "finding": "Một số tên ghép sản phẩm AmazonBasics với Logitech, Xoro, Toshiba hoặc Western Digital.",
                "proposal": f"Đạt và Hiền chốt brand chính theo listing nguồn; {unresolved_brands} bản ghi chưa loại vẫn để CHƯA CHỐT.",
            },
            {
                "topic": "Listing Renewed",
                "finding": "Nhiều cặp có cùng ảnh/tên nhưng một bản ghi ghi Renewed.",
                "proposal": "Tạm giữ như biến thể tình trạng; nếu schema không lưu condition thì loại bản Renewed hoặc bổ sung condition.",
            },
        ],
    }
    (args.output_dir / "workbook_data.json").write_text(
        json.dumps(workbook_data, ensure_ascii=False), encoding="utf-8"
    )


if __name__ == "__main__":
    main()
