from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

import faiss
import numpy as np
import pytest
from PIL import Image

from scripts.rebuild_faiss_from_abo import (
    MAX_FAISS_ID,
    build_faiss_index,
    load_csv_mapping,
    load_dataset_products,
    load_jsonl_mapping,
    load_mapping,
    load_qa_rejected_ids,
    rebuild_abo_faiss,
)


class DummyClipModel:
    """Mock model CLIP không cần tải weight thật, sinh vector trực giao chuẩn hóa."""

    def __init__(self, dimension: int = 4) -> None:
        self.dimension = dimension

    def encode(
        self,
        images: list[Image.Image],
        batch_size: int = 32,
        show_progress_bar: bool = False,
        convert_to_numpy: bool = True,
        normalize_embeddings: bool = True,
    ) -> np.ndarray:
        vectors: list[np.ndarray] = []
        for i, _ in enumerate(images):
            vec = np.zeros(self.dimension, dtype="float32")
            vec[i % self.dimension] = 1.0
            vectors.append(vec)
        matrix = np.vstack(vectors).astype("float32")
        if normalize_embeddings:
            faiss.normalize_L2(matrix)
        return matrix


def create_dummy_image(path: Path, color: str = "red") -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    img = Image.new("RGB", (32, 32), color=color)
    img.save(path)
    return path


def setup_sample_dataset(base_dir: Path) -> tuple[Path, Path]:
    images_dir = base_dir / "images"
    create_dummy_image(images_dir / "PROD_A" / "01.jpg", color="blue")
    create_dummy_image(images_dir / "PROD_B" / "01.jpg", color="green")

    jsonl_path = base_dir / "products.jsonl"
    lines = [
        json.dumps(
            {
                "schemaVersion": 1,
                "externalId": "abo:PROD_A",
                "name": "Product Alpha",
                "images": [{"sourcePath": "images/PROD_A/01.jpg", "isPrimary": True}],
            }
        ),
        json.dumps(
            {
                "schemaVersion": 1,
                "externalId": "abo:PROD_B",
                "name": "Product Beta",
                "images": [{"sourcePath": "images/PROD_B/01.jpg", "isPrimary": True}],
            }
        ),
    ]
    jsonl_path.write_text("\n".join(lines), encoding="utf-8")
    return jsonl_path, images_dir


def test_rebuild_success_and_verifies_faiss_search_productId(tmp_path: Path) -> None:
    jsonl_path, images_dir = setup_sample_dataset(tmp_path)
    mapping_path = tmp_path / "mapping.csv"
    mapping_path.write_text(
        "externalId,productId\n"
        "abo:PROD_A,900001\n"
        "abo:PROD_B,900002\n",
        encoding="utf-8",
    )

    index_out = tmp_path / "output.faiss"
    metadata_out = tmp_path / "output_meta.json"

    meta = rebuild_abo_faiss(
        products_jsonl=jsonl_path,
        images_dir=images_dir,
        mapping_csv=mapping_path,
        index_out=index_out,
        metadata_out=metadata_out,
        model_override=DummyClipModel(dimension=4),
    )

    assert index_out.is_file()
    assert metadata_out.is_file()
    assert meta["count"] == 2
    assert meta["isProduction"] is False
    assert meta["status"] == "SMOKE_NON_PRODUCTION"
    assert meta["warning"] is not None
    assert [item["productId"] for item in meta["items"]] == [900001, 900002]

    loaded_index = faiss.read_index(str(index_out))
    assert loaded_index.ntotal == 2

    query = np.array([[0.0, 1.0, 0.0, 0.0]], dtype="float32")
    scores, ids = loaded_index.search(query, 1)

    assert ids[0][0] == 900002
    assert scores[0][0] == pytest.approx(1.0, abs=1e-4)


def test_production_mode_is_locked_and_qa_unapproved_cannot_make_production(tmp_path: Path) -> None:
    jsonl_path, images_dir = setup_sample_dataset(tmp_path)
    mapping_path = tmp_path / "mapping.csv"
    mapping_path.write_text(
        "externalId,productId\n"
        "abo:PROD_A,900001\n"
        "abo:PROD_B,900002\n",
        encoding="utf-8",
    )

    # 1. Gọi is_production=True bị từ chối rõ ràng vì chế độ production bị khóa
    with pytest.raises(ValueError, match="Chế độ production hiện bị khóa"):
        rebuild_abo_faiss(
            products_jsonl=jsonl_path,
            images_dir=images_dir,
            mapping_csv=mapping_path,
            index_out=tmp_path / "p1.faiss",
            metadata_out=tmp_path / "p1_meta.json",
            model_override=DummyClipModel(dimension=4),
            is_production=True,
        )

    # 2. File QA có publicationApproved=false và có danh sách LOẠI
    qa_file = tmp_path / "qa_review.csv"
    qa_file.write_text(
        "# publicationApproved=false\n"
        "externalId,status\n"
        "abo:PROD_B,LOẠI\n",
        encoding="utf-8",
    )

    meta = rebuild_abo_faiss(
        products_jsonl=jsonl_path,
        images_dir=images_dir,
        mapping_csv=mapping_path,
        index_out=tmp_path / "p2.faiss",
        metadata_out=tmp_path / "p2_meta.json",
        model_override=DummyClipModel(dimension=4),
        qa_feedback_file=qa_file,
    )

    # Khẳng định: PROD_B bị loại, nhưng artifact VẪN LUÔN mang nhãn non-production
    assert meta["count"] == 1
    assert [item["externalId"] for item in meta["items"]] == ["abo:PROD_A"]
    assert meta["isProduction"] is False
    assert meta["status"] == "SMOKE_NON_PRODUCTION"
    assert "NON-PRODUCTION" in meta["warning"]


def test_source_path_rejects_absolute_path(tmp_path: Path) -> None:
    jsonl_path = tmp_path / "products.jsonl"
    jsonl_path.write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "externalId": "abo:ABS",
                "name": "Abs Item",
                "images": [{"sourcePath": "/tmp/absolute/01.jpg", "isPrimary": True}],
            }
        ),
        encoding="utf-8",
    )
    mapping = {"abo:ABS": 900001}
    with pytest.raises(ValueError, match="không được là đường dẫn tuyệt đối"):
        load_dataset_products(jsonl_path, mapping, tmp_path)


def test_source_path_rejects_parent_traversal(tmp_path: Path) -> None:
    jsonl_path = tmp_path / "products.jsonl"
    jsonl_path.write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "externalId": "abo:TRAV",
                "name": "Traversal Item",
                "images": [{"sourcePath": "images/../../secret.jpg", "isPrimary": True}],
            }
        ),
        encoding="utf-8",
    )
    mapping = {"abo:TRAV": 900001}
    with pytest.raises(ValueError, match="thoát thư mục gốc"):
        load_dataset_products(jsonl_path, mapping, tmp_path)


def test_source_path_rejects_symlink_pointing_outside(tmp_path: Path) -> None:
    outside_dir = tmp_path / "outside"
    outside_dir.mkdir()
    outside_img = create_dummy_image(outside_dir / "target.jpg")

    dataset_dir = tmp_path / "dataset"
    images_dir = dataset_dir / "images" / "PROD_SYM"
    images_dir.mkdir(parents=True)
    symlink_img = images_dir / "01.jpg"
    symlink_img.symlink_to(outside_img)

    jsonl_path = dataset_dir / "products.jsonl"
    jsonl_path.write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "externalId": "abo:SYM",
                "name": "Symlink Item",
                "images": [{"sourcePath": "images/PROD_SYM/01.jpg", "isPrimary": True}],
            }
        ),
        encoding="utf-8",
    )
    mapping = {"abo:SYM": 900001}
    with pytest.raises(ValueError, match="trỏ ra ngoài thư mục dataset"):
        load_dataset_products(jsonl_path, mapping, dataset_dir)


def test_load_dataset_detects_duplicate_external_id_with_line_number(tmp_path: Path) -> None:
    dataset_dir = tmp_path / "dataset"
    dataset_dir.mkdir()
    jsonl_path = dataset_dir / "products.jsonl"
    jsonl_path.write_text(
        json.dumps({"schemaVersion": 1, "externalId": "abo:DUP", "images": []})
        + "\n"
        + json.dumps({"schemaVersion": 1, "externalId": "abo:OTHER", "images": []})
        + "\n"
        + json.dumps({"schemaVersion": 1, "externalId": "abo:DUP", "images": []})
        + "\n",
        encoding="utf-8",
    )
    mapping = {"abo:DUP": 900001}
    with pytest.raises(ValueError, match=r"Dòng 3.*Trùng lặp externalId 'abo:DUP'.*dòng 1"):
        load_dataset_products(jsonl_path, mapping, dataset_dir)


def test_load_mapping_rejects_int64_overflow(tmp_path: Path) -> None:
    overflow_id = MAX_FAISS_ID + 1
    mapping_file = tmp_path / "overflow.csv"
    mapping_file.write_text(
        f"externalId,productId\nabo:P1,{overflow_id}\n", encoding="utf-8"
    )
    with pytest.raises(ValueError, match="vượt quá giới hạn int64"):
        load_mapping(mapping_file)


def test_persist_cleans_up_on_failure_and_leaves_no_skewed_outputs(tmp_path: Path) -> None:
    jsonl_path, images_dir = setup_sample_dataset(tmp_path)
    mapping_path = tmp_path / "mapping.csv"
    mapping_path.write_text("externalId,productId\nabo:PROD_A,900001\n", encoding="utf-8")

    index_out = tmp_path / "fail_out.faiss"
    metadata_out = tmp_path / "fail_out_meta.json"

    # Giả lập lỗi khi serialize JSON
    with patch("json.dumps", side_effect=TypeError("Forced JSON dump error")):
        with pytest.raises(RuntimeError, match="Lỗi khi lưu tệp đầu ra"):
            rebuild_abo_faiss(
                products_jsonl=jsonl_path,
                images_dir=images_dir,
                mapping_csv=mapping_path,
                index_out=index_out,
                metadata_out=metadata_out,
                model_override=DummyClipModel(dimension=4),
            )

    # Khẳng định không để lại index_out một mình khi metadata bị lỗi
    assert not index_out.exists()
    assert not metadata_out.exists()


def test_refuses_to_overwrite_existing_files(tmp_path: Path) -> None:
    jsonl_path, images_dir = setup_sample_dataset(tmp_path)
    mapping_path = tmp_path / "mapping.csv"
    mapping_path.write_text("externalId,productId\nabo:PROD_A,900001\n", encoding="utf-8")

    existing_index = tmp_path / "existing.faiss"
    existing_index.write_text("do not touch")
    existing_meta = tmp_path / "existing_meta.json"

    with pytest.raises(FileExistsError, match="Tệp index đầu ra đã tồn tại"):
        rebuild_abo_faiss(
            products_jsonl=jsonl_path,
            images_dir=images_dir,
            mapping_csv=mapping_path,
            index_out=existing_index,
            metadata_out=existing_meta,
            model_override=DummyClipModel(dimension=4),
        )

    # Tệp cũ không hề bị chạm tới
    assert existing_index.read_text() == "do not touch"


def test_rejects_same_path_for_index_and_metadata(tmp_path: Path) -> None:
    jsonl_path, images_dir = setup_sample_dataset(tmp_path)
    mapping_path = tmp_path / "mapping.csv"
    mapping_path.write_text("externalId,productId\nabo:PROD_A,900001\n", encoding="utf-8")
    output_path = tmp_path / "same-output"

    with pytest.raises(ValueError, match="phải khác nhau"):
        rebuild_abo_faiss(
            products_jsonl=jsonl_path,
            images_dir=images_dir,
            mapping_csv=mapping_path,
            index_out=output_path,
            metadata_out=output_path,
            model_override=DummyClipModel(),
        )


def test_load_mapping_rejects_duplicate_productId(tmp_path: Path) -> None:
    mapping_file = tmp_path / "dup_prod_id.csv"
    mapping_file.write_text(
        "externalId,productId\n"
        "abo:PROD_A,900001\n"
        "abo:PROD_B,900001\n",
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="Trùng lặp productId"):
        load_mapping(mapping_file)


def test_load_mapping_rejects_duplicate_externalId(tmp_path: Path) -> None:
    mapping_file = tmp_path / "dup_ext_id.csv"
    mapping_file.write_text(
        "externalId,productId\n"
        "abo:PROD_A,900001\n"
        "abo:PROD_A,900002\n",
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="Trùng lặp externalId"):
        load_mapping(mapping_file)


def test_load_mapping_rejects_non_positive_or_invalid_productId(tmp_path: Path) -> None:
    mapping_zero = tmp_path / "zero_id.csv"
    mapping_zero.write_text("externalId,productId\nabo:P1,0\n", encoding="utf-8")
    with pytest.raises(ValueError, match="phải là số nguyên dương"):
        load_mapping(mapping_zero)

    mapping_neg = tmp_path / "neg_id.csv"
    mapping_neg.write_text("externalId,productId\nabo:P1,-12\n", encoding="utf-8")
    with pytest.raises(ValueError, match="phải là số nguyên dương"):
        load_mapping(mapping_neg)

    mapping_str = tmp_path / "str_id.csv"
    mapping_str.write_text("externalId,productId\nabo:P1,abc\n", encoding="utf-8")
    with pytest.raises(ValueError, match="không phải số nguyên hợp lệ"):
        load_mapping(mapping_str)


def test_load_mapping_rejects_missing_columns_and_empty_values(tmp_path: Path) -> None:
    missing_col = tmp_path / "missing_col.csv"
    missing_col.write_text("id,externalId\n1,abo:P1\n", encoding="utf-8")
    with pytest.raises(ValueError, match="thiếu cột bắt buộc"):
        load_mapping(missing_col)

    empty_val = tmp_path / "empty_val.csv"
    empty_val.write_text("externalId,productId\nabo:P1, \n", encoding="utf-8")
    with pytest.raises(ValueError, match="không được để trống"):
        load_mapping(empty_val)


def test_load_mapping_accepts_header_whitespace(tmp_path: Path) -> None:
    mapping_file = tmp_path / "mapping.csv"
    mapping_file.write_text(" externalId , productId \nabo:P1,125\n", encoding="utf-8")
    assert load_mapping(mapping_file) == {"abo:P1": 125}
    assert load_csv_mapping(mapping_file) == {"abo:P1": 125}


def test_load_mapping_accepts_utf8_bom(tmp_path: Path) -> None:
    mapping_file = tmp_path / "mapping_bom.csv"
    mapping_file.write_text("externalId,productId\nabo:P1,125\n", encoding="utf-8-sig")
    assert load_mapping(mapping_file) == {"abo:P1": 125}


def test_qa_feedback_requires_status_column(tmp_path: Path) -> None:
    qa_file = tmp_path / "qa.csv"
    qa_file.write_text("externalId\nabo:PROD_A\n", encoding="utf-8")
    with pytest.raises(ValueError, match="phải có cột externalId"):
        load_qa_rejected_ids(qa_file)


def test_qa_feedback_parses_csv_and_comments(tmp_path: Path) -> None:
    qa_file = tmp_path / "qa.csv"
    qa_file.write_text(
        "# publicationApproved=false\nexternalId,status,reason\n"
        'abo:PROD_A,GIỮ,"Tên, ảnh hợp lệ"\n'
        'abo:PROD_B,LOẠI,"Tên, ảnh lệch"\n',
        encoding="utf-8",
    )
    assert load_qa_rejected_ids(qa_file) == {"abo:PROD_B"}


def test_load_dataset_rejects_mapping_not_in_dataset(tmp_path: Path) -> None:
    jsonl_path, images_dir = setup_sample_dataset(tmp_path)
    mapping = {"abo:PROD_A": 900001, "abo:NOT_IN_DATASET": 900099}

    with pytest.raises(ValueError, match="Mapping không khớp dataset"):
        load_dataset_products(jsonl_path, mapping, images_dir)


def test_resolve_image_path_fails_on_missing_or_corrupt_image(tmp_path: Path) -> None:
    jsonl_path = tmp_path / "products.jsonl"
    jsonl_path.write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "externalId": "abo:MISSING_IMG",
                "name": "Missing Image Item",
                "images": [{"sourcePath": "images/NON_EXISTENT/01.jpg", "isPrimary": True}],
            }
        ),
        encoding="utf-8",
    )
    mapping = {"abo:MISSING_IMG": 900001}
    with pytest.raises(FileNotFoundError, match="Không tìm thấy file ảnh"):
        load_dataset_products(jsonl_path, mapping, tmp_path)

    corrupt_file = tmp_path / "images" / "CORRUPT" / "01.jpg"
    corrupt_file.parent.mkdir(parents=True, exist_ok=True)
    corrupt_file.write_bytes(b"not an image file data garbage")

    jsonl_corrupt = tmp_path / "corrupt_products.jsonl"
    jsonl_corrupt.write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "externalId": "abo:CORRUPT",
                "name": "Corrupt Item",
                "images": [{"sourcePath": "images/CORRUPT/01.jpg", "isPrimary": True}],
            }
        ),
        encoding="utf-8",
    )
    with pytest.raises(OSError, match="File ảnh hỏng hoặc không đọc được"):
        load_dataset_products(jsonl_corrupt, {"abo:CORRUPT": 900002}, tmp_path)


def test_build_faiss_index_validates_dimension_and_duplicates() -> None:
    vectors = np.array([[1.0, 0.0], [0.0, 1.0]], dtype="float32")
    with pytest.raises(ValueError, match="Số lượng vector.*khác số lượng productId"):
        build_faiss_index(vectors, [1])

    with pytest.raises(ValueError, match="trùng lặp"):
        build_faiss_index(vectors, [100, 100])

    with pytest.raises(ValueError, match="vector zero"):
        build_faiss_index(np.array([[0.0, 0.0]], dtype="float32"), [100])

    with pytest.raises(ValueError, match="NaN"):
        build_faiss_index(np.array([[np.nan, 1.0]], dtype="float32"), [100])


def test_rebuild_success_with_jsonl_mapping(tmp_path: Path) -> None:
    jsonl_path, images_dir = setup_sample_dataset(tmp_path)
    mapping_path = tmp_path / "mapping.jsonl"
    mapping_path.write_text(
        json.dumps({"externalId": "abo:PROD_A", "productId": 900001}) + "\n"
        + json.dumps({"externalId": "abo:PROD_B", "productId": 900002}) + "\n",
        encoding="utf-8",
    )

    index_out = tmp_path / "output_jsonl.faiss"
    metadata_out = tmp_path / "output_jsonl_meta.json"

    meta = rebuild_abo_faiss(
        products_jsonl=jsonl_path,
        images_dir=images_dir,
        mapping_jsonl=mapping_path,
        index_out=index_out,
        metadata_out=metadata_out,
        model_override=DummyClipModel(dimension=4),
    )

    assert index_out.is_file()
    assert metadata_out.is_file()
    assert meta["count"] == 2
    assert meta["isProduction"] is False
    assert meta["status"] == "SMOKE_NON_PRODUCTION"
    assert [item["productId"] for item in meta["items"]] == [900001, 900002]

    loaded_index = faiss.read_index(str(index_out))
    assert loaded_index.ntotal == 2

    query = np.array([[1.0, 0.0, 0.0, 0.0]], dtype="float32")
    scores, ids = loaded_index.search(query, 1)
    assert ids[0][0] == 900001
    assert scores[0][0] == pytest.approx(1.0, abs=1e-4)


def test_load_jsonl_mapping_valid_and_auto_detect(tmp_path: Path) -> None:
    mapping_file = tmp_path / "valid.jsonl"
    mapping_file.write_text(
        "\n"
        + json.dumps({"externalId": "abo:P1", "productId": 125}) + "\n"
        + "\n"
        + json.dumps({"externalId": "abo:P2", "productId": 126}) + "\n",
        encoding="utf-8",
    )
    expected = {"abo:P1": 125, "abo:P2": 126}
    assert load_jsonl_mapping(mapping_file) == expected
    assert load_mapping(mapping_file) == expected


def test_load_jsonl_mapping_rejects_invalid_json(tmp_path: Path) -> None:
    bad_file = tmp_path / "corrupt.jsonl"
    bad_file.write_text(
        json.dumps({"externalId": "abo:P1", "productId": 125}) + "\n"
        + '{"externalId": "abo:P2", broken\n',
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match=r"Dòng 2.*không phải JSON hợp lệ"):
        load_jsonl_mapping(bad_file)


def test_load_jsonl_mapping_rejects_non_dict(tmp_path: Path) -> None:
    bad_file = tmp_path / "non_dict.jsonl"
    bad_file.write_text(
        '["not", "a", "dict"]\n',
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match=r"Dòng 1.*JSON object.*list"):
        load_jsonl_mapping(bad_file)


def test_load_jsonl_mapping_rejects_missing_fields(tmp_path: Path) -> None:
    no_prod = tmp_path / "no_prod.jsonl"
    no_prod.write_text(json.dumps({"externalId": "abo:P1"}) + "\n", encoding="utf-8")
    with pytest.raises(ValueError, match=r"Dòng 1.*thiếu trường bắt buộc"):
        load_jsonl_mapping(no_prod)

    no_ext = tmp_path / "no_ext.jsonl"
    no_ext.write_text(json.dumps({"productId": 100}) + "\n", encoding="utf-8")
    with pytest.raises(ValueError, match=r"Dòng 1.*thiếu trường bắt buộc"):
        load_jsonl_mapping(no_ext)


def test_load_jsonl_mapping_rejects_empty_or_invalid_externalId(tmp_path: Path) -> None:
    empty_ext = tmp_path / "empty_ext.jsonl"
    empty_ext.write_text(
        json.dumps({"externalId": "   ", "productId": 100}) + "\n",
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match=r"Dòng 1.*externalId không được để trống"):
        load_jsonl_mapping(empty_ext)

    non_str_ext = tmp_path / "non_str_ext.jsonl"
    non_str_ext.write_text(
        json.dumps({"externalId": 12345, "productId": 100}) + "\n",
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match=r"Dòng 1.*externalId không được để trống hoặc sai kiểu"):
        load_jsonl_mapping(non_str_ext)


def test_load_jsonl_mapping_rejects_invalid_productId(tmp_path: Path) -> None:
    zero_file = tmp_path / "zero.jsonl"
    zero_file.write_text(
        json.dumps({"externalId": "abo:P1", "productId": 0}) + "\n",
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match=r"Dòng 1.*phải là số nguyên dương"):
        load_jsonl_mapping(zero_file)

    neg_file = tmp_path / "neg.jsonl"
    neg_file.write_text(
        json.dumps({"externalId": "abo:P1", "productId": -10}) + "\n",
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match=r"Dòng 1.*phải là số nguyên dương"):
        load_jsonl_mapping(neg_file)

    str_invalid = tmp_path / "str_invalid.jsonl"
    str_invalid.write_text(
        json.dumps({"externalId": "abo:P1", "productId": "abc"}) + "\n",
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match=r"Dòng 1.*không phải số nguyên hợp lệ"):
        load_jsonl_mapping(str_invalid)

    bool_file = tmp_path / "bool.jsonl"
    bool_file.write_text(
        json.dumps({"externalId": "abo:P1", "productId": True}) + "\n",
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match=r"Dòng 1.*không phải số nguyên hợp lệ"):
        load_jsonl_mapping(bool_file)

    float_file = tmp_path / "float.jsonl"
    float_file.write_text(
        json.dumps({"externalId": "abo:P1", "productId": 58.5}) + "\n",
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match=r"Dòng 1.*không phải số nguyên hợp lệ"):
        load_jsonl_mapping(float_file)

    overflow_file = tmp_path / "overflow.jsonl"
    overflow_file.write_text(
        json.dumps({"externalId": "abo:P1", "productId": MAX_FAISS_ID + 1}) + "\n",
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match=r"Dòng 1.*vượt quá giới hạn int64"):
        load_jsonl_mapping(overflow_file)


def test_load_jsonl_mapping_rejects_duplicates(tmp_path: Path) -> None:
    dup_ext = tmp_path / "dup_ext.jsonl"
    dup_ext.write_text(
        json.dumps({"externalId": "abo:P1", "productId": 100}) + "\n"
        + json.dumps({"externalId": "abo:P1", "productId": 101}) + "\n",
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match=r"Dòng 2.*Trùng lặp externalId 'abo:P1'"):
        load_jsonl_mapping(dup_ext)

    dup_prod = tmp_path / "dup_prod.jsonl"
    dup_prod.write_text(
        json.dumps({"externalId": "abo:P1", "productId": 100}) + "\n"
        + json.dumps({"externalId": "abo:P2", "productId": 100}) + "\n",
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match=r"Dòng 2.*Trùng lặp productId '100'"):
        load_jsonl_mapping(dup_prod)


def test_load_jsonl_mapping_rejects_empty_file(tmp_path: Path) -> None:
    empty_file = tmp_path / "empty.jsonl"
    empty_file.write_text("\n   \n", encoding="utf-8")
    with pytest.raises(ValueError, match="không chứa dòng dữ liệu nào"):
        load_jsonl_mapping(empty_file)
