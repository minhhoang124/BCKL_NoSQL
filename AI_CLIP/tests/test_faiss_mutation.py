import json

import faiss
import numpy as np
import pytest

from app.services.faiss_service import FaissService


def create_service(tmp_path, dimension: int = 3) -> FaissService:
    index_path = tmp_path / "products.faiss"
    index = faiss.IndexIDMap2(faiss.IndexFlatIP(dimension))
    faiss.write_index(index, str(index_path))
    service = FaissService(index_path, tmp_path / "faiss_state.json")
    service.load()
    return service


def test_upsert_adds_replaces_and_persists_product_vector(tmp_path) -> None:
    service = create_service(tmp_path)

    first = service.upsert(125, 1, np.array([1.0, 0.0, 0.0], dtype="float32"))
    replacement = service.upsert(125, 2, np.array([0.0, 1.0, 0.0], dtype="float32"))

    assert first.applied is True
    assert replacement.applied is True
    assert service.vector_count == 1
    _, ids = service.search(np.array([[0.0, 1.0, 0.0]], dtype="float32"), 1)
    assert ids.tolist() == [125]

    reloaded = FaissService(tmp_path / "products.faiss", tmp_path / "faiss_state.json")
    reloaded.load()
    assert reloaded.vector_count == 1
    assert reloaded.current_version(125) == 2


def test_upsert_ignores_same_or_older_version_without_duplicates(tmp_path) -> None:
    service = create_service(tmp_path)
    service.upsert(125, 3, np.array([1.0, 0.0, 0.0], dtype="float32"))

    same = service.upsert(125, 3, np.array([0.0, 1.0, 0.0], dtype="float32"))
    older = service.upsert(125, 2, np.array([0.0, 0.0, 1.0], dtype="float32"))

    assert same.status == "ignored"
    assert older.status == "ignored"
    assert service.vector_count == 1
    _, ids = service.search(np.array([[1.0, 0.0, 0.0]], dtype="float32"), 1)
    assert ids.tolist() == [125]


def test_delete_removes_vector_and_tombstone_blocks_stale_reinsert(tmp_path) -> None:
    service = create_service(tmp_path)
    service.upsert(125, 1, np.array([1.0, 0.0, 0.0], dtype="float32"))

    deleted = service.delete(125, 3)
    stale = service.upsert(125, 2, np.array([0.0, 1.0, 0.0], dtype="float32"))

    assert deleted.status == "deleted"
    assert deleted.applied is True
    assert stale.status == "ignored"
    assert service.vector_count == 0
    state = json.loads((tmp_path / "faiss_state.json").read_text(encoding="utf-8"))
    assert state["products"]["125"] == {"version": 3, "deleted": True}

    reloaded = FaissService(tmp_path / "products.faiss", tmp_path / "faiss_state.json")
    reloaded.load()
    assert reloaded.current_version(125) == 3
    assert reloaded.vector_count == 0


def test_newer_version_can_restore_deleted_product(tmp_path) -> None:
    service = create_service(tmp_path)
    service.delete(125, 3)

    restored = service.upsert(125, 4, np.array([1.0, 0.0, 0.0], dtype="float32"))

    assert restored.status == "updated"
    assert service.current_version(125) == 4
    assert service.vector_count == 1


def test_batch_upsert_is_applied_as_one_index_change(tmp_path) -> None:
    service = create_service(tmp_path)

    results = service.upsert_many(
        [
            (125, 1, np.array([1.0, 0.0, 0.0], dtype="float32")),
            (126, 1, np.array([0.0, 1.0, 0.0], dtype="float32")),
        ]
    )

    assert [result.status for result in results] == ["updated", "updated"]
    assert service.vector_count == 2


def test_upsert_rejects_invalid_vector(tmp_path) -> None:
    service = create_service(tmp_path)

    with pytest.raises(ValueError, match="zero vector"):
        service.upsert(125, 1, np.zeros(3, dtype="float32"))

    with pytest.raises(ValueError, match="Embedding shape"):
        service.upsert(125, 1, np.ones(4, dtype="float32"))

    assert service.vector_count == 0
