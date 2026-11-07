from __future__ import annotations

import argparse
import csv
import io
import json
import os
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

# Cùng giới hạn OpenMP như AI Service để tránh xung đột PyTorch/FAISS trên macOS.
os.environ.setdefault("OMP_NUM_THREADS", "1")

import faiss
import numpy as np
from PIL import Image

MAX_FAISS_ID = np.iinfo(np.int64).max


def load_csv_mapping(mapping_path: Path) -> dict[str, int]:
    """Đọc và kiểm tra tính hợp lệ của file CSV mapping externalId -> productId.

    Yêu cầu:
    - Có đủ cột 'externalId' và 'productId'.
    - Không có giá trị rỗng.
    - productId phải là số nguyên dương (> 0) và không vượt quá giới hạn int64.
    - Không trùng lặp externalId hoặc productId.
    """
    if not mapping_path.is_file():
        raise FileNotFoundError(f"Không tìm thấy file mapping: {mapping_path}")

    mapping: dict[str, int] = {}
    seen_product_ids: set[int] = set()

    with mapping_path.open("r", encoding="utf-8-sig") as file:
        reader = csv.DictReader(file)
        if reader.fieldnames is None:
            raise ValueError(f"File mapping rỗng hoặc sai định dạng: {mapping_path}")

        field_map = {name.strip(): name for name in reader.fieldnames}
        if "externalId" not in field_map or "productId" not in field_map:
            raise ValueError(
                "File mapping thiếu cột bắt buộc ('externalId', 'productId'), "
                f"tìm thấy: {reader.fieldnames}"
            )

        for row_idx, row in enumerate(reader, start=2):
            raw_ext_id = row.get(field_map["externalId"])
            raw_prod_id = row.get(field_map["productId"])

            if raw_ext_id is None or not raw_ext_id.strip():
                raise ValueError(f"Dòng {row_idx}: externalId không được để trống")
            if raw_prod_id is None or not raw_prod_id.strip():
                raise ValueError(f"Dòng {row_idx}: productId không được để trống")

            ext_id = raw_ext_id.strip()
            prod_id_str = raw_prod_id.strip()

            try:
                prod_id = int(prod_id_str)
            except ValueError as err:
                raise ValueError(
                    f"Dòng {row_idx}: productId '{prod_id_str}' không phải số nguyên hợp lệ"
                ) from err

            if prod_id <= 0:
                raise ValueError(
                    f"Dòng {row_idx}: productId '{prod_id}' phải là số nguyên dương (> 0)"
                )

            if prod_id > MAX_FAISS_ID:
                raise ValueError(
                    f"Dòng {row_idx}: productId '{prod_id}' vượt quá "
                    f"giới hạn int64 ({MAX_FAISS_ID})"
                )

            if ext_id in mapping:
                raise ValueError(f"Dòng {row_idx}: Trùng lặp externalId '{ext_id}' trong mapping")
            if prod_id in seen_product_ids:
                raise ValueError(f"Dòng {row_idx}: Trùng lặp productId '{prod_id}' trong mapping")

            mapping[ext_id] = prod_id
            seen_product_ids.add(prod_id)

    if not mapping:
        raise ValueError(f"File mapping không chứa dòng dữ liệu nào: {mapping_path}")

    return mapping


def load_jsonl_mapping(mapping_path: Path) -> dict[str, int]:
    """Đọc và kiểm tra tính hợp lệ của file JSONL mapping externalId -> productId.

    Yêu cầu:
    - Mỗi dòng là JSON object chứa 'externalId' và 'productId'.
    - Không có giá trị rỗng hoặc sai kiểu dữ liệu.
    - productId phải là số nguyên dương (> 0) và không vượt quá giới hạn int64.
    - Không trùng lặp externalId hoặc productId.
    - Không tự động sinh hay sửa đổi productId.
    """
    if not mapping_path.is_file():
        raise FileNotFoundError(f"Không tìm thấy file mapping: {mapping_path}")

    mapping: dict[str, int] = {}
    seen_product_ids: set[int] = set()

    with mapping_path.open("r", encoding="utf-8-sig") as file:
        for line_idx, line in enumerate(file, start=1):
            line_str = line.strip()
            if not line_str:
                continue

            try:
                record = json.loads(line_str)
            except json.JSONDecodeError as err:
                raise ValueError(
                    f"Dòng {line_idx} trong file mapping không phải JSON hợp lệ: {err}"
                ) from err

            if not isinstance(record, dict):
                raise ValueError(
                    f"Dòng {line_idx}: Dòng dữ liệu JSONL phải là một JSON object, "
                    f"tìm thấy {type(record).__name__}"
                )

            if "externalId" not in record or "productId" not in record:
                raise ValueError(
                    f"Dòng {line_idx}: File mapping thiếu trường bắt buộc "
                    "('externalId', 'productId')"
                )

            raw_ext_id = record["externalId"]
            raw_prod_id = record["productId"]

            if raw_ext_id is None or not isinstance(raw_ext_id, str) or not raw_ext_id.strip():
                raise ValueError(f"Dòng {line_idx}: externalId không được để trống hoặc sai kiểu")

            if raw_prod_id is None or isinstance(raw_prod_id, bool):
                raise ValueError(
                    f"Dòng {line_idx}: productId '{raw_prod_id}' không phải số nguyên hợp lệ"
                )

            if isinstance(raw_prod_id, int):
                prod_id = raw_prod_id
            elif isinstance(raw_prod_id, str) and raw_prod_id.strip():
                try:
                    prod_id = int(raw_prod_id.strip())
                except ValueError as err:
                    raise ValueError(
                        f"Dòng {line_idx}: productId '{raw_prod_id}' không phải số nguyên hợp lệ"
                    ) from err
            else:
                raise ValueError(
                    f"Dòng {line_idx}: productId '{raw_prod_id}' không phải số nguyên hợp lệ"
                )

            if prod_id <= 0:
                raise ValueError(
                    f"Dòng {line_idx}: productId '{prod_id}' phải là số nguyên dương (> 0)"
                )

            if prod_id > MAX_FAISS_ID:
                raise ValueError(
                    f"Dòng {line_idx}: productId '{prod_id}' vượt quá "
                    f"giới hạn int64 ({MAX_FAISS_ID})"
                )

            ext_id = raw_ext_id.strip()
            if ext_id in mapping:
                raise ValueError(f"Dòng {line_idx}: Trùng lặp externalId '{ext_id}' trong mapping")
            if prod_id in seen_product_ids:
                raise ValueError(f"Dòng {line_idx}: Trùng lặp productId '{prod_id}' trong mapping")

            mapping[ext_id] = prod_id
            seen_product_ids.add(prod_id)

    if not mapping:
        raise ValueError(f"File mapping không chứa dòng dữ liệu nào: {mapping_path}")

    return mapping


def load_mapping(mapping_path: Path) -> dict[str, int]:
    """Tự động nhận diện định dạng (.jsonl hoặc .csv) và đọc file mapping."""
    if not mapping_path.is_file():
        raise FileNotFoundError(f"Không tìm thấy file mapping: {mapping_path}")

    suffix = mapping_path.suffix.lower()
    if suffix == ".jsonl":
        return load_jsonl_mapping(mapping_path)
    if suffix == ".csv":
        return load_csv_mapping(mapping_path)

    with mapping_path.open("r", encoding="utf-8-sig") as file:
        for line in file:
            line_str = line.strip()
            if not line_str:
                continue
            if line_str.startswith("{"):
                return load_jsonl_mapping(mapping_path)
            return load_csv_mapping(mapping_path)

    raise ValueError(f"File mapping không chứa dòng dữ liệu nào: {mapping_path}")


def resolve_image_path(images_root: Path, source_path: str) -> Path:
    """Xác định và kiểm tra tính toàn vẹn của file ảnh.

    Kiểm tra an toàn:
    - Từ chối đường dẫn tuyệt đối.
    - Từ chối '..' thoát thư mục gốc.
    - Từ chối symlink trỏ ra ngoài phạm vi thư mục dataset.
    - Không âm thầm bỏ qua ảnh thiếu hoặc hỏng.
    """
    if not source_path or not source_path.strip():
        raise ValueError("sourcePath của ảnh không được để trống")

    path_obj = Path(source_path)
    if path_obj.is_absolute() or source_path.startswith("/") or source_path.startswith("\\"):
        raise ValueError(f"sourcePath không được là đường dẫn tuyệt đối: '{source_path}'")

    if ".." in path_obj.parts:
        raise ValueError(f"sourcePath không được chứa '..' thoát thư mục gốc: '{source_path}'")

    root_resolved = images_root.resolve()

    candidate_1 = images_root / source_path
    candidate_2 = (
        images_root / source_path[7:]
        if source_path.startswith("images/")
        else images_root / "images" / source_path
    )

    resolved_candidate: Path | None = None
    if candidate_1.is_file() or candidate_1.is_symlink():
        resolved_candidate = candidate_1
    elif candidate_2.is_file() or candidate_2.is_symlink():
        resolved_candidate = candidate_2

    if resolved_candidate is None:
        raise FileNotFoundError(
            f"Không tìm thấy file ảnh '{source_path}' tại '{images_root}'"
        )

    target_real = resolved_candidate.resolve()
    try:
        target_real.relative_to(root_resolved)
    except ValueError as err:
        raise ValueError(
            f"Đường dẫn hoặc symlink ảnh '{source_path}' trỏ ra ngoài "
            f"thư mục dataset: '{target_real}'"
        ) from err

    if not target_real.is_file():
        raise FileNotFoundError(
            f"File ảnh thực tế không tồn tại sau khi giải quyết symlink: '{target_real}'"
        )

    try:
        with Image.open(target_real) as img:
            img.convert("RGB")
    except Exception as err:
        raise OSError(f"File ảnh hỏng hoặc không đọc được '{target_real}': {err}") from err

    return target_real


def load_qa_rejected_ids(qa_feedback_path: Path) -> set[str]:
    """Đọc danh sách externalId bị đánh dấu LOẠI từ file QA feedback."""
    if not qa_feedback_path.is_file():
        raise FileNotFoundError(f"Không tìm thấy file QA feedback: {qa_feedback_path}")

    content = qa_feedback_path.read_text(encoding="utf-8-sig")
    rows = (
        line
        for line in content.splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    )
    reader = csv.DictReader(io.StringIO("\n".join(rows)))
    if reader.fieldnames is None:
        raise ValueError(f"File QA rỗng hoặc thiếu header: {qa_feedback_path}")
    field_map = {name.strip().lower(): name for name in reader.fieldnames}
    ext_col = field_map.get("externalid")
    decision_col = field_map.get("status") or field_map.get("decision") or field_map.get("action")
    if not ext_col or not decision_col:
        raise ValueError("File QA phải có cột externalId và status/decision/action")

    rejected_ids: set[str] = set()
    for row in reader:
        ext_id = (row.get(ext_col) or "").strip()
        decision = (row.get(decision_col) or "").strip().upper()
        if ext_id and decision in {"LOẠI", "LOAI", "REJECT", "DROP"}:
            rejected_ids.add(ext_id)
    return rejected_ids


def load_dataset_products(
    jsonl_path: Path,
    mapping: dict[str, int],
    images_root: Path,
) -> list[dict[str, Any]]:
    """Đọc products.jsonl và lọc các sản phẩm theo mapping.

    Kiểm tra nghiêm ngặt:
    - Phát hiện externalId trùng trong JSONL và báo lỗi kèm số dòng (không ghi đè).
    - Mọi externalId trong mapping phải tồn tại trong dataset.
    - Sản phẩm phải có ảnh hợp lệ và ảnh phải đọc được.
    """
    if not jsonl_path.is_file():
        raise FileNotFoundError(f"Không tìm thấy file products.jsonl: {jsonl_path}")

    seen_ext_id_lines: dict[str, int] = {}
    dataset_by_ext_id: dict[str, dict[str, Any]] = {}

    with jsonl_path.open("r", encoding="utf-8") as file:
        for line_idx, line in enumerate(file, start=1):
            line = line.strip()
            if not line:
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError as err:
                raise ValueError(
                    f"Dòng {line_idx} trong {jsonl_path} không phải JSON hợp lệ"
                ) from err

            ext_id = record.get("externalId")
            if not ext_id or not isinstance(ext_id, str) or not ext_id.strip():
                raise ValueError(
                    f"Dòng {line_idx} trong {jsonl_path}: externalId bị thiếu hoặc rỗng"
                )
            ext_id = ext_id.strip()

            if ext_id in seen_ext_id_lines:
                prev_line = seen_ext_id_lines[ext_id]
                raise ValueError(
                    f"Dòng {line_idx} trong {jsonl_path}: Trùng lặp externalId '{ext_id}' "
                    f"(đã xuất hiện tại dòng {prev_line})"
                )
            seen_ext_id_lines[ext_id] = line_idx

            if ext_id in mapping:
                dataset_by_ext_id[ext_id] = record

    missing_in_dataset = set(mapping.keys()) - set(dataset_by_ext_id.keys())
    if missing_in_dataset:
        raise ValueError(
            f"Mapping không khớp dataset: Các externalId sau có trong mapping nhưng không tìm thấy "
            f"trong dataset: {sorted(missing_in_dataset)}"
        )

    products: list[dict[str, Any]] = []
    for ext_id, prod_id in mapping.items():
        record = dataset_by_ext_id[ext_id]
        images = record.get("images") or []
        primary_image = next((img for img in images if img.get("isPrimary")), None)
        if primary_image is None and images:
            primary_image = images[0]

        if primary_image is None or not primary_image.get("sourcePath"):
            raise ValueError(f"Sản phẩm '{ext_id}' không có thông tin ảnh hợp lệ trong dataset")

        source_path = str(primary_image["sourcePath"])
        resolved_image = resolve_image_path(images_root, source_path)

        products.append(
            {
                "productId": prod_id,
                "externalId": ext_id,
                "name": record.get("name") or "",
                "sourceImagePath": source_path,
                "resolvedImagePath": resolved_image,
            }
        )

    return products


def build_faiss_index(
    embeddings: np.ndarray,
    product_ids: list[int],
) -> faiss.IndexIDMap2:
    """Tạo FAISS IndexIDMap2(IndexFlatIP) và nạp embeddings cùng product_ids dạng int64."""
    if len(embeddings) != len(product_ids):
        raise ValueError(
            f"Số lượng vector ({len(embeddings)}) khác số lượng productId ({len(product_ids)})"
        )
    if len(product_ids) != len(set(product_ids)):
        raise ValueError("Danh sách productId bị trùng lặp khi nạp vào FAISS index")

    for pid in product_ids:
        if pid <= 0 or pid > MAX_FAISS_ID:
            raise ValueError(
                f"productId {pid} vượt ngoài khoảng hợp lệ của FAISS int64 (1 đến {MAX_FAISS_ID})"
            )

    vector_data = np.asarray(embeddings, dtype="float32")
    if vector_data.ndim != 2 or vector_data.shape[0] == 0 or vector_data.shape[1] == 0:
        raise ValueError("Embeddings phải là ma trận 2 chiều không rỗng")
    if not np.isfinite(vector_data).all() or np.any(np.linalg.norm(vector_data, axis=1) == 0):
        raise ValueError("Embeddings không được chứa NaN, vô cực hoặc vector zero")
    faiss.normalize_L2(vector_data)

    dimension = vector_data.shape[1]
    base_index = faiss.IndexFlatIP(dimension)
    index = faiss.IndexIDMap2(base_index)

    ids_array = np.asarray(product_ids, dtype="int64")
    index.add_with_ids(vector_data, ids_array)

    if index.ntotal != len(product_ids):
        raise RuntimeError(
            f"Xác nhận số vector FAISS thất bại: ntotal={index.ntotal}, kỳ vọng={len(product_ids)}"
        )

    return index


def persist_outputs_safely(
    index: faiss.IndexIDMap2,
    index_out: Path,
    metadata_payload: dict[str, Any],
    metadata_out: Path,
) -> None:
    """Lưu trữ FAISS index và metadata JSON vào đường dẫn mới an toàn.

    Quy tắc an toàn cho prototype:
    - Không ghi đè: nếu một trong hai file đã tồn tại, từ chối và yêu cầu đường dẫn mới.
    - Ghi qua tệp tạm trước; nếu có bất kỳ lỗi nào, dọn sạch tệp tạm và tệp mới tạo.
    - Dọn tệp mới tạo nếu gặp lỗi Python; hai lần thay file không phải transaction
      chống mất điện/crash, nên artifact này chỉ dùng cho smoke test.
    """
    if index_out.resolve() == metadata_out.resolve():
        raise ValueError("Đường dẫn index và metadata phải khác nhau")
    if index_out.exists():
        raise FileExistsError(
            f"Tệp index đầu ra đã tồn tại: {index_out}. "
            "Để bảo vệ artifact cũ, hãy chỉ định đường dẫn mới."
        )
    if metadata_out.exists():
        raise FileExistsError(
            f"Tệp metadata đầu ra đã tồn tại: {metadata_out}. "
            "Để bảo vệ artifact cũ, hãy chỉ định đường dẫn mới."
        )

    index_out.parent.mkdir(parents=True, exist_ok=True)
    metadata_out.parent.mkdir(parents=True, exist_ok=True)

    temp_index = index_out.with_name(f".{index_out.name}.tmp")
    temp_meta = metadata_out.with_name(f".{metadata_out.name}.tmp")

    try:
        faiss.write_index(index, str(temp_index))
        temp_meta.write_text(
            json.dumps(metadata_payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        os.replace(temp_index, index_out)
        os.replace(temp_meta, metadata_out)
    except Exception as err:
        temp_index.unlink(missing_ok=True)
        temp_meta.unlink(missing_ok=True)
        index_out.unlink(missing_ok=True)
        metadata_out.unlink(missing_ok=True)
        raise RuntimeError(f"Lỗi khi lưu tệp đầu ra (đã dọn sạch tệp tạm): {err}") from err


def rebuild_abo_faiss(
    products_jsonl: Path,
    images_dir: Path,
    mapping_path: Path | None = None,
    index_out: Path | None = None,
    metadata_out: Path | None = None,
    model_name: str = "sentence-transformers/clip-ViT-B-32",
    batch_size: int = 32,
    device: str | None = None,
    qa_feedback_file: Path | None = None,
    is_production: bool = False,
    model_override: Any = None,
    *,
    mapping_csv: Path | None = None,
    mapping_jsonl: Path | None = None,
    mapping_file: Path | None = None,
) -> dict[str, Any]:
    """Điều phối toàn bộ luồng đọc dữ liệu, sinh embedding, tạo FAISS index và lưu metadata.

    LƯU Ý: Hiện tại chưa có dataset được duyệt công khai hay cách xác thực mapping production.
    Mọi artifact xuất ra đều là SMOKE / NON-PRODUCTION (isProduction=False).
    Yêu cầu is_production=True sẽ bị từ chối rõ ràng.
    """
    if is_production:
        raise ValueError(
            "Chế độ production hiện bị khóa: chưa có dataset được duyệt công khai "
            "(publicationApproved=false) hoặc cơ chế xác thực mapping production. "
            "Script chỉ được tạo artifact SMOKE/NON-PRODUCTION."
        )

    target_mapping = mapping_path or mapping_file or mapping_jsonl or mapping_csv
    if target_mapping is None:
        raise ValueError(
            "Cần cung cấp đường dẫn file mapping (mapping_path, mapping_file, "
            "mapping_jsonl hoặc mapping_csv)"
        )
    if index_out is None or metadata_out is None:
        raise ValueError("Đường dẫn index_out và metadata_out không được để trống")

    # Từ chối sớm nếu tệp đầu ra đã tồn tại
    if index_out.exists():
        raise FileExistsError(
            f"Tệp index đầu ra đã tồn tại: {index_out}. Hãy chỉ định đường dẫn mới."
        )
    if metadata_out.exists():
        raise FileExistsError(
            f"Tệp metadata đầu ra đã tồn tại: {metadata_out}. Hãy chỉ định đường dẫn mới."
        )

    print(f"-> Đọc mapping từ: {target_mapping}")
    mapping = load_mapping(target_mapping)
    print(f"   Đã đọc {len(mapping)} mục mapping hợp lệ.")

    print(f"-> Đọc dataset từ: {products_jsonl}")
    products = load_dataset_products(products_jsonl, mapping, images_dir)
    print(f"   Đã khớp và kiểm tra tính toàn vẹn của {len(products)} sản phẩm.")

    # Nếu có file QA feedback, kiểm tra publicationApproved và lọc bỏ các ID bị LOẠI
    if qa_feedback_file is not None:
        content = qa_feedback_file.read_text(encoding="utf-8").lower()
        if "publicationapproved" in content and ("false" in content or "0" in content):
            print(
                "! Ghi nhận từ file QA: publicationApproved=false "
                "(dataset chưa duyệt công khai)."
            )

        rejected_ids = load_qa_rejected_ids(qa_feedback_file)
        if rejected_ids:
            before_count = len(products)
            products = [p for p in products if p["externalId"] not in rejected_ids]
            excluded_count = before_count - len(products)
            print(f"   Đã loại bỏ {excluded_count} sản phẩm bị đánh dấu LOẠI từ QA feedback.")
            if not products:
                raise ValueError("Không còn sản phẩm nào đủ điều kiện sau khi loại bỏ theo QA.")

    print("!" * 76)
    print("! CẢNH BÁO: ĐÂY LÀ ARTIFACT SMOKE / NON-PRODUCTION.")
    print(f"! Tổng số sản phẩm xử lý: {len(products)}.")
    print("! Tuyệt đối không sử dụng làm index production.")
    print("!" * 76)

    print(f"-> Nạp model CLIP: {model_name}")
    if model_override is not None:
        model = model_override
    else:
        from sentence_transformers import SentenceTransformer

        model = SentenceTransformer(model_name, device=device)

    print(f"-> Đọc và encode {len(products)} ảnh sản phẩm...")
    pil_images = [
        Image.open(p["resolvedImagePath"]).convert("RGB")
        for p in products
    ]

    embeddings = model.encode(
        pil_images,
        batch_size=batch_size,
        show_progress_bar=len(products) > 10,
        convert_to_numpy=True,
        normalize_embeddings=True,
    ).astype("float32")

    product_ids = [p["productId"] for p in products]
    print("-> Xây dựng FAISS IndexIDMap2(IndexFlatIP)...")
    index = build_faiss_index(embeddings, product_ids)

    metadata_payload = {
        "schemaVersion": 1,
        "count": int(index.ntotal),
        "dimension": int(embeddings.shape[1]),
        "indexType": "IndexIDMap2(IndexFlatIP)",
        "isProduction": False,
        "status": "SMOKE_NON_PRODUCTION",
        "environment": "smoke-test",
        "model": model_name,
        "createdAt": datetime.now(UTC).isoformat(),
        "warning": "SMOKE TEST / NON-PRODUCTION INDEX. DO NOT USE FOR PRODUCTION.",
        "items": [
            {
                "productId": p["productId"],
                "externalId": p["externalId"],
                "name": p["name"],
                "imagePath": p["sourceImagePath"],
            }
            for p in products
        ],
    }

    persist_outputs_safely(index, index_out, metadata_payload, metadata_out)

    print("=" * 76)
    print(f"Hoàn thành! Đã tạo FAISS index với {index.ntotal} vector.")
    print(f"FAISS index : {index_out}")
    print(f"Metadata    : {metadata_out}")
    print("Trạng thái  : SMOKE TEST / NON-PRODUCTION (isProduction=False)")
    print("=" * 76)

    return metadata_payload


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Xây dựng lại FAISS IndexIDMap2 từ dataset ABO và mapping (JSONL hoặc CSV)"
    )
    parser.add_argument(
        "--products-jsonl",
        type=Path,
        required=True,
        help="Đường dẫn đến file products.jsonl của dataset ABO",
    )
    parser.add_argument(
        "--images-dir",
        type=Path,
        required=True,
        help="Đường dẫn thư mục gốc chứa ảnh dataset ABO",
    )
    parser.add_argument(
        "--mapping-jsonl",
        type=Path,
        default=None,
        help="Đường dẫn file JSONL chứa mapping externalId,productId",
    )
    parser.add_argument(
        "--mapping-csv",
        type=Path,
        default=None,
        help="Đường dẫn file CSV chứa mapping externalId,productId",
    )
    parser.add_argument(
        "--mapping-file",
        type=Path,
        default=None,
        help="Đường dẫn file mapping (.jsonl hoặc .csv) chứa mapping externalId,productId",
    )
    parser.add_argument(
        "--index-out",
        type=Path,
        required=True,
        help="Đường dẫn file FAISS index đầu ra (.faiss, phải là đường dẫn mới)",
    )
    parser.add_argument(
        "--metadata-out",
        type=Path,
        required=True,
        help="Đường dẫn file metadata JSON đầu ra (phải là đường dẫn mới)",
    )
    parser.add_argument(
        "--model",
        type=str,
        default="sentence-transformers/clip-ViT-B-32",
        help="Tên pretrained model SentenceTransformer/CLIP",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=32,
        help="Kích thước batch khi encode ảnh",
    )
    parser.add_argument(
        "--device",
        type=str,
        default=None,
        help="Thiết bị tính toán (cuda/cpu/mps)",
    )
    parser.add_argument(
        "--qa-feedback-file",
        type=Path,
        default=None,
        help="Đường dẫn file QA review để loại bỏ các sản phẩm bị 'LOẠI' (tùy chọn)",
    )
    args = parser.parse_args()

    mapping_target = args.mapping_jsonl or args.mapping_file or args.mapping_csv
    if mapping_target is None:
        parser.error(
            "Cần cung cấp file mapping qua --mapping-jsonl, --mapping-csv hoặc --mapping-file"
        )

    rebuild_abo_faiss(
        products_jsonl=args.products_jsonl.resolve(),
        images_dir=args.images_dir.resolve(),
        mapping_path=mapping_target.resolve(),
        index_out=args.index_out.resolve(),
        metadata_out=args.metadata_out.resolve(),
        model_name=args.model,
        batch_size=args.batch_size,
        device=args.device,
        qa_feedback_file=args.qa_feedback_file.resolve() if args.qa_feedback_file else None,
    )


if __name__ == "__main__":
    main()
