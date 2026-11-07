from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

import faiss
import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image
from pydantic import ValidationError

from app.config import Settings
from app.main import create_app
from app.schemas.elasticsearch import ProductDocument
from app.schemas.index import SingleProductIndexRequest
from app.services.faiss_service import FaissService
from app.services.image_download_service import (
    ImageDownloadError,
    ImageUrlNotAllowedError,
)
from app.services.product_sync_service import (
    ProductSyncService,
    compute_payload_fingerprint,
)


class FakeElasticsearchService:
    def __init__(self, error: Exception | None = None) -> None:
        self.error = error
        self.indexed_docs: list[ProductDocument] = []
        self.deleted_ids: list[int] = []

    async def index_product(self, product: ProductDocument | dict[str, Any]) -> dict[str, Any]:
        if self.error is not None:
            raise self.error
        doc = ProductDocument.model_validate(product) if isinstance(product, dict) else product
        self.indexed_docs.append(doc)
        return {"productId": doc.product_id, "result": "updated", "version": doc.version}

    async def delete_product(self, product_id: int) -> bool:
        if self.error is not None:
            raise self.error
        self.deleted_ids.append(product_id)
        return True


class FakeClipService:
    def __init__(self, dimension: int = 2) -> None:
        self.dimension = dimension
        self.encode_calls = 0

    def encode_image(self, image: Image.Image) -> np.ndarray:
        self.encode_calls += 1
        return np.array([[1.0, 0.0]], dtype="float32")


class FakeImageDownloadService:
    def __init__(self, error: Exception | None = None) -> None:
        self.error = error
        self.urls: list[str] = []
        self.validate_calls: int = 0

    def _validate_url(self, image_url: str) -> None:
        self.validate_calls += 1
        if isinstance(self.error, ImageUrlNotAllowedError):
            raise self.error

    async def fetch(self, image_url: str) -> Image.Image:
        self.urls.append(image_url)
        if self.error is not None:
            raise self.error
        return Image.new("RGB", (8, 8), color="red")


def create_test_faiss_service(tmp_path: Path, dimension: int = 2) -> FaissService:
    index_path = tmp_path / "products.faiss"
    index = faiss.IndexIDMap2(faiss.IndexFlatIP(dimension))
    faiss.write_index(index, str(index_path))
    state_path = tmp_path / "faiss_state.json"
    service = FaissService(index_path, state_path)
    service.load()
    return service


def sample_single_payload(
    product_id: int = 125,
    version: int = 1,
    name: str = "Wireless Bluetooth Headphones",
    min_price: str = "1290000.00",
    max_price: str = "1590000.00",
    image_urls: list[str] | None = None,
) -> dict[str, Any]:
    return {
        "productId": product_id,
        "version": version,
        "name": name,
        "description": "Over-ear wireless headphones",
        "categoryId": 12,
        "categoryName": "Headphones",
        "categoryPathIds": [1, 5, 12],
        "brandId": 8,
        "brandName": "Sony",
        "imageUrls": (
            image_urls
            if image_urls is not None
            else [f"http://backend:3001/uploads/products/{product_id}/1.jpg"]
        ),
        "minPrice": min_price,
        "maxPrice": max_price,
        "inStock": True,
        "attributes": {
            "color": ["Black"],
            "connectivity": ["Bluetooth"],
        },
    }


TestAppTuple = tuple[
    TestClient,
    FakeElasticsearchService,
    FaissService,
    FakeClipService,
    FakeImageDownloadService,
    ProductSyncService,
]


def setup_test_app(
    tmp_path: Path,
    es_error: Exception | None = None,
    download_error: Exception | None = None,
) -> TestAppTuple:
    app = create_app(load_runtime=False)
    es_service = FakeElasticsearchService(es_error)
    faiss_service = create_test_faiss_service(tmp_path)
    clip_service = FakeClipService(dimension=2)
    download_service = FakeImageDownloadService(download_error)
    sync_service = ProductSyncService(state_path=tmp_path / "product_sync_state.json")

    app.state.elasticsearch_service = es_service
    app.state.faiss_service = faiss_service
    app.state.clip_service = clip_service
    app.state.image_download_service = download_service
    app.state.product_sync_service = sync_service

    return TestClient(app), es_service, faiss_service, clip_service, download_service, sync_service


def test_sync_product_both_succeeded(tmp_path: Path) -> None:
    client, es_service, faiss_service, clip_service, download_service, sync_service = (
        setup_test_app(tmp_path)
    )

    with client:
        response = client.post(
            "/index/product",
            json=sample_single_payload(product_id=125, version=1),
        )

    assert response.status_code == 200
    data = response.json()
    assert data["productId"] == 125
    assert data["version"] == 1
    assert data["operation"] == "UPSERT"
    assert data["outcome"] == "APPLIED"
    assert data["indexes"]["elasticsearch"] == {"status": "SUCCEEDED", "version": 1}
    assert data["indexes"]["faiss"] == {"status": "SUCCEEDED", "version": 1}

    assert len(es_service.indexed_docs) == 1
    assert faiss_service.vector_count == 1
    assert clip_service.encode_calls == 1

    # Verify persistent state file
    rec = sync_service.current_record(125)
    assert rec is not None
    assert rec.latest_version == 1
    assert rec.elasticsearch.status == "SUCCEEDED"
    assert rec.faiss.status == "SUCCEEDED"


def test_legacy_batch_cannot_bypass_dual_index_sync(tmp_path: Path) -> None:
    client, es_service, faiss_service, _, _, sync_service = setup_test_app(tmp_path)
    payload = {
        "productId": 125,
        "version": 5,
        "name": "Legacy batch item",
        "category": "audio",
        "imageUrls": ["http://backend:3001/uploads/products/125/1.jpg"],
    }

    with client:
        response = client.post("/index/products", json=[payload])

    assert response.status_code == 501
    assert response.json() == {"detail": "BATCH_INDEXING_NOT_SUPPORTED"}
    assert faiss_service.vector_count == 0
    assert es_service.indexed_docs == []
    assert sync_service.current_record(125) is None


@pytest.mark.parametrize("operation", ["UPSERT", "DELETE"])
def test_new_sync_never_claims_success_when_faiss_has_newer_version(
    tmp_path: Path, operation: str
) -> None:
    client, es_service, faiss_service, _, _, sync_service = setup_test_app(tmp_path)
    # Simulate an index written by the former FAISS-only batch endpoint.
    faiss_service.upsert(125, 5, np.array([[1.0, 0.0]], dtype="float32"))

    with client:
        if operation == "UPSERT":
            response = client.post("/index/product", json=sample_single_payload(version=4))
        else:
            response = client.delete("/index/product/125?version=4")

    assert response.status_code == 503
    data = response.json()
    assert data["outcome"] == "PARTIAL_FAILURE"
    assert data["indexes"]["faiss"]["status"] == "FAILED"
    assert data["indexes"]["faiss"]["version"] is None
    assert faiss_service.current_version(125) == 5
    record = sync_service.current_record(125)
    assert record is not None and record.faiss.status == "FAILED"
    assert record.elasticsearch.status == "SUCCEEDED"
    assert len(es_service.indexed_docs if operation == "UPSERT" else es_service.deleted_ids) == 1


def test_sync_product_noop_on_same_event(tmp_path: Path) -> None:
    client, es_service, faiss_service, clip_service, _, _ = setup_test_app(tmp_path)

    with client:
        res1 = client.post("/index/product", json=sample_single_payload(product_id=125, version=1))
        assert res1.status_code == 200
        assert res1.json()["outcome"] == "APPLIED"

        # Send same payload and version again
        res2 = client.post("/index/product", json=sample_single_payload(product_id=125, version=1))

    assert res2.status_code == 200
    data = res2.json()
    assert data["outcome"] == "NOOP"
    assert data["indexes"]["elasticsearch"] == {"status": "ALREADY_APPLIED", "version": 1}
    assert data["indexes"]["faiss"] == {"status": "ALREADY_APPLIED", "version": 1}

    # No extra calls were made
    assert len(es_service.indexed_docs) == 1
    assert clip_service.encode_calls == 1


def test_sync_product_es_failure_and_retry(tmp_path: Path) -> None:
    client, es_service, faiss_service, clip_service, _, sync_service = setup_test_app(
        tmp_path,
        es_error=RuntimeError("Elasticsearch connection refused"),
    )

    with client:
        # First call fails on ES
        res1 = client.post("/index/product", json=sample_single_payload(product_id=125, version=2))

    assert res1.status_code == 503
    data1 = res1.json()
    assert data1["outcome"] == "PARTIAL_FAILURE"
    assert data1["indexes"]["elasticsearch"] == {"status": "FAILED", "version": None}
    assert data1["indexes"]["faiss"] == {"status": "SUCCEEDED", "version": 2}

    # FAISS succeeded
    assert faiss_service.vector_count == 1
    assert clip_service.encode_calls == 1

    # Now recover ES and retry the exact same event
    es_service.error = None
    with client:
        res2 = client.post("/index/product", json=sample_single_payload(product_id=125, version=2))

    assert res2.status_code == 200
    data2 = res2.json()
    assert data2["outcome"] == "APPLIED"
    assert data2["indexes"]["elasticsearch"] == {"status": "SUCCEEDED", "version": 2}
    assert data2["indexes"]["faiss"] == {"status": "ALREADY_APPLIED", "version": 2}

    # FAISS was not re-encoded
    assert clip_service.encode_calls == 1
    assert len(es_service.indexed_docs) == 1


def test_sync_product_faiss_failure_and_retry(tmp_path: Path) -> None:
    client, es_service, faiss_service, clip_service, download_service, _ = setup_test_app(
        tmp_path,
        download_error=ImageDownloadError("Backend image server timeout"),
    )

    with client:
        res1 = client.post("/index/product", json=sample_single_payload(product_id=125, version=2))

    assert res1.status_code == 503
    data1 = res1.json()
    assert data1["outcome"] == "PARTIAL_FAILURE"
    assert data1["indexes"]["elasticsearch"] == {"status": "SUCCEEDED", "version": 2}
    assert data1["indexes"]["faiss"] == {"status": "FAILED", "version": None}

    # ES was updated once, FAISS has 0 vectors
    assert len(es_service.indexed_docs) == 1
    assert faiss_service.vector_count == 0

    # Recover image download and retry
    download_service.error = None
    with client:
        res2 = client.post("/index/product", json=sample_single_payload(product_id=125, version=2))

    assert res2.status_code == 200
    data2 = res2.json()
    assert data2["outcome"] == "APPLIED"
    assert data2["indexes"]["elasticsearch"] == {"status": "ALREADY_APPLIED", "version": 2}
    assert data2["indexes"]["faiss"] == {"status": "SUCCEEDED", "version": 2}

    # ES was not re-indexed; FAISS now has the vector
    assert len(es_service.indexed_docs) == 1
    assert faiss_service.vector_count == 1


def test_sync_product_version_conflict_different_payload(tmp_path: Path) -> None:
    client, _, _, _, _, _ = setup_test_app(tmp_path)

    with client:
        res1 = client.post(
            "/index/product",
            json=sample_single_payload(product_id=125, version=3, name="Original Name"),
        )
        assert res1.status_code == 200

        # Same version 3 but different name -> 409 VERSION_CONFLICT
        res2 = client.post(
            "/index/product",
            json=sample_single_payload(product_id=125, version=3, name="Conflicting Name"),
        )

    assert res2.status_code == 409
    assert res2.json()["detail"] == "VERSION_CONFLICT"


def test_sync_product_version_conflict_different_operation(tmp_path: Path) -> None:
    client, _, _, _, _, _ = setup_test_app(tmp_path)

    with client:
        res1 = client.post("/index/product", json=sample_single_payload(product_id=125, version=3))
        assert res1.status_code == 200

        # Same version 3 but operation DELETE -> 409 VERSION_CONFLICT
        res2 = client.delete("/index/product/125?version=3")

    assert res2.status_code == 409
    assert res2.json()["detail"] == "VERSION_CONFLICT"


def test_sync_product_stale_version_ignored(tmp_path: Path) -> None:
    client, es_service, faiss_service, clip_service, _, _ = setup_test_app(tmp_path)

    with client:
        client.post("/index/product", json=sample_single_payload(product_id=125, version=4))

        # Stale version 3 arrived
        stale_res = client.post(
            "/index/product",
            json=sample_single_payload(product_id=125, version=3),
        )

    assert stale_res.status_code == 200
    data = stale_res.json()
    assert data["outcome"] == "STALE"
    assert data["version"] == 3
    assert data["indexes"]["elasticsearch"] == {"status": "ALREADY_APPLIED", "version": 4}
    assert data["indexes"]["faiss"] == {"status": "ALREADY_APPLIED", "version": 4}

    # No additional work was done
    assert len(es_service.indexed_docs) == 1
    assert clip_service.encode_calls == 1


def test_delete_product_tombstone_blocks_stale_upsert(tmp_path: Path) -> None:
    client, es_service, faiss_service, _, _, _ = setup_test_app(tmp_path)

    with client:
        # Initial upsert at version 2
        client.post("/index/product", json=sample_single_payload(product_id=125, version=2))
        assert faiss_service.vector_count == 1

        # Delete at version 5
        del_res = client.delete("/index/product/125?version=5")
        assert del_res.status_code == 200
        del_data = del_res.json()
        assert del_data["operation"] == "DELETE"
        assert del_data["outcome"] == "APPLIED"
        assert del_data["indexes"]["elasticsearch"] == {"status": "SUCCEEDED", "version": 5}
        assert del_data["indexes"]["faiss"] == {"status": "SUCCEEDED", "version": 5}
        assert faiss_service.vector_count == 0

        # Stale upsert version 4 arriving after delete version 5 -> STALE!
        stale_upsert = client.post(
            "/index/product",
            json=sample_single_payload(product_id=125, version=4),
        )
        assert stale_upsert.status_code == 200
        assert stale_upsert.json()["outcome"] == "STALE"
        assert faiss_service.vector_count == 0  # product not revived!

        # Higher version 6 arrives -> product revived!
        revive_res = client.post(
            "/index/product",
            json=sample_single_payload(product_id=125, version=6),
        )
        assert revive_res.status_code == 200
        assert revive_res.json()["outcome"] == "APPLIED"
        assert faiss_service.vector_count == 1


def test_validation_strict_category_and_prices(tmp_path: Path) -> None:
    client, _, _, _, _, _ = setup_test_app(tmp_path)

    with client:
        # Missing categoryId
        p1 = sample_single_payload()
        del p1["categoryId"]
        assert client.post("/index/product", json=p1).status_code == 422

        # Missing categoryPathIds
        p2 = sample_single_payload()
        del p2["categoryPathIds"]
        assert client.post("/index/product", json=p2).status_code == 422

        # categoryPathIds does not end with categoryId (ends with 99 != 12)
        p3 = sample_single_payload()
        p3["categoryPathIds"] = [1, 5, 99]
        assert client.post("/index/product", json=p3).status_code == 422

        # minPrice > maxPrice
        p4 = sample_single_payload(min_price="2000.00", max_price="1000.00")
        assert client.post("/index/product", json=p4).status_code == 422

        # minPrice = "oops" (must return 422, not 500)
        p5 = sample_single_payload()
        p5["minPrice"] = "oops"
        assert client.post("/index/product", json=p5).status_code == 422

        # maxPrice = "oops" (must return 422, not 500)
        p6 = sample_single_payload()
        p6["maxPrice"] = "oops"
        assert client.post("/index/product", json=p6).status_code == 422


def test_crash_recovery_faiss_written_but_state_pending(tmp_path: Path) -> None:
    """Simulates service crash: FAISS index was mutated, but state file remained PENDING.

    On restart, retry must be idempotent without duplicate vectors or false completion.
    """
    sync_state_path = tmp_path / "product_sync_state.json"
    payload_dict = sample_single_payload(product_id=125, version=4)
    dummy_req = SingleProductIndexRequest.model_validate(payload_dict)
    fingerprint = compute_payload_fingerprint(dummy_req)

    # 1. State recorded on disk shows version 4 was attempted:
    # ES succeeded at version 4, FAISS remained PENDING on disk because crash
    # occurred before state write completed
    initial_state = {
        "schemaVersion": 1,
        "products": {
            "125": {
                "productId": 125,
                "latestVersion": 4,
                "operation": "UPSERT",
                "payloadFingerprint": fingerprint,
                "elasticsearch": {"status": "SUCCEEDED", "version": 4},
                "faiss": {"status": "PENDING", "version": None},
            }
        },
    }
    sync_state_path.write_text(json.dumps(initial_state, indent=2), encoding="utf-8")

    # 2. Add a vector to FAISS directly to simulate pre-crash write
    faiss_service = create_test_faiss_service(tmp_path)
    faiss_service.upsert(125, 4, np.array([1.0, 0.0], dtype="float32"))
    assert faiss_service.vector_count == 1

    # 3. Simulate process restart: fresh app and fresh ProductSyncService loading state from disk
    app = create_app(load_runtime=False)
    es_service = FakeElasticsearchService()
    es_service.indexed_docs.append(
        ProductDocument(
            productId=125,
            name=dummy_req.name,
            categoryId=dummy_req.category_id,
            categoryPathIds=dummy_req.category_path_ids,
            version=4,
        )
    )
    clip_service = FakeClipService(dimension=2)
    download_service = FakeImageDownloadService()
    sync_service = ProductSyncService(state_path=sync_state_path)

    app.state.elasticsearch_service = es_service
    app.state.faiss_service = faiss_service
    app.state.clip_service = clip_service
    app.state.image_download_service = download_service
    app.state.product_sync_service = sync_service

    client = TestClient(app)
    with client:
        # Retrying version 4
        res = client.post("/index/product", json=payload_dict)

    assert res.status_code == 200
    data = res.json()
    assert data["outcome"] == "APPLIED"
    assert data["indexes"]["elasticsearch"]["status"] == "ALREADY_APPLIED"
    assert data["indexes"]["faiss"]["status"] == "SUCCEEDED"

    # Verify vector count is still exactly 1 (no duplicate vector!)
    assert faiss_service.vector_count == 1

    # Restart simulated again: verify state persisted to disk
    reloaded_sync = ProductSyncService(state_path=sync_state_path)
    rec = reloaded_sync.current_record(125)
    assert rec is not None
    assert rec.latest_version == 4
    assert rec.elasticsearch.status == "SUCCEEDED"
    assert rec.faiss.status == "SUCCEEDED"


@pytest.mark.anyio
async def test_concurrent_requests_same_product(tmp_path: Path) -> None:
    """Verifies that concurrent requests for the same productId are serialized."""
    es_service = FakeElasticsearchService()
    faiss_service = create_test_faiss_service(tmp_path)
    clip_service = FakeClipService(dimension=2)
    download_service = FakeImageDownloadService()
    sync_service = ProductSyncService(state_path=tmp_path / "product_sync_state.json")

    from app.schemas.index import SingleProductIndexRequest

    payload_v1 = SingleProductIndexRequest.model_validate(
        sample_single_payload(product_id=125, version=1)
    )
    payload_v2 = SingleProductIndexRequest.model_validate(
        sample_single_payload(product_id=125, version=2)
    )

    # Run v1 and v2 concurrently
    res1, res2 = await asyncio.gather(
        sync_service.sync_product(
            payload_v1, es_service, faiss_service, clip_service, download_service
        ),
        sync_service.sync_product(
            payload_v2, es_service, faiss_service, clip_service, download_service
        ),
    )

    # One of them applied v1, the other applied v2 (or v1 was stale if v2 finished first)
    # The final persisted record must be version 2
    final_rec = sync_service.current_record(125)
    assert final_rec is not None
    assert final_rec.latest_version == 2
    assert final_rec.elasticsearch.status == "SUCCEEDED"
    assert final_rec.faiss.status == "SUCCEEDED"


def test_es_succeeded_faiss_image_failed_partial_failure_and_retry(tmp_path: Path) -> None:
    """If ES succeeds but image download/decode fails:

    - state on disk records ES SUCCEEDED and FAISS FAILED
    - response is 503 PARTIAL_FAILURE
    - on retry with image working, ES is NOT updated again (ALREADY_APPLIED)
    - FAISS succeeds and response is 200 APPLIED
    """
    app = create_app(load_runtime=False)
    es_service = FakeElasticsearchService()
    faiss_service = create_test_faiss_service(tmp_path)
    clip_service = FakeClipService(dimension=2)
    download_service = FakeImageDownloadService(
        error=ImageDownloadError("Failed to download image from CDN")
    )
    sync_state_path = tmp_path / "product_sync_state.json"
    sync_service = ProductSyncService(state_path=sync_state_path)

    app.state.elasticsearch_service = es_service
    app.state.faiss_service = faiss_service
    app.state.clip_service = clip_service
    app.state.image_download_service = download_service
    app.state.product_sync_service = sync_service

    client = TestClient(app)
    payload_dict = sample_single_payload(product_id=200, version=1)

    with client:
        # First call: image download fails
        res1 = client.post("/index/product", json=payload_dict)
        assert res1.status_code == 503
        data1 = res1.json()
        assert data1["outcome"] == "PARTIAL_FAILURE"
        assert data1["indexes"]["elasticsearch"]["status"] == "SUCCEEDED"
        assert data1["indexes"]["elasticsearch"]["version"] == 1
        assert data1["indexes"]["faiss"]["status"] == "FAILED"
        assert data1["indexes"]["faiss"]["version"] is None

        # Verify ES was indexed once
        assert len(es_service.indexed_docs) == 1
        assert es_service.indexed_docs[0].product_id == 200

        # Verify state on disk is durable and recorded partial failure
        reloaded_sync = ProductSyncService(state_path=sync_state_path)
        disk_rec = reloaded_sync.current_record(200)
        assert disk_rec is not None
        assert disk_rec.latest_version == 1
        assert disk_rec.elasticsearch.status == "SUCCEEDED"
        assert disk_rec.faiss.status == "FAILED"

        # Now fix image download and retry the same request
        download_service.error = None
        res2 = client.post("/index/product", json=payload_dict)
        assert res2.status_code == 200
        data2 = res2.json()
        assert data2["outcome"] == "APPLIED"
        # ES was NOT updated again!
        assert data2["indexes"]["elasticsearch"]["status"] == "ALREADY_APPLIED"
        assert data2["indexes"]["elasticsearch"]["version"] == 1
        assert data2["indexes"]["faiss"]["status"] == "SUCCEEDED"
        assert data2["indexes"]["faiss"]["version"] == 1

        # ES indexed_docs count is STILL 1 (never re-indexed!)
        assert len(es_service.indexed_docs) == 1

        # Final state on disk has both SUCCEEDED
        reloaded_sync_final = ProductSyncService(state_path=sync_state_path)
        final_disk_rec = reloaded_sync_final.current_record(200)
        assert final_disk_rec is not None
        assert final_disk_rec.elasticsearch.status == "SUCCEEDED"
        assert final_disk_rec.faiss.status == "SUCCEEDED"


def test_faiss_force_never_overwrites_newer_version(tmp_path: Path) -> None:
    """force=True must NEVER overwrite a newer version in FAISS."""
    faiss_service = create_test_faiss_service(tmp_path)
    # Product 10 is at version 5
    res = faiss_service.upsert(10, 5, np.array([1.0, 0.0], dtype="float32"))
    assert res.applied is True
    assert faiss_service.current_version(10) == 5

    # Attempt to overwrite with version 4 and force=True (must NOT overwrite!)
    res_stale = faiss_service.upsert(10, 4, np.array([0.0, 1.0], dtype="float32"), force=True)
    assert res_stale.applied is False
    assert res_stale.status == "ignored"
    assert faiss_service.current_version(10) == 5

    # Attempt to delete with version 4 and force=True (must NOT overwrite!)
    res_del = faiss_service.delete(10, 4, force=True)
    assert res_del.applied is False
    assert res_del.status == "ignored"
    assert faiss_service.current_version(10) == 5


def test_worker_limit_enforcement(tmp_path: Path) -> None:
    """Worker limit must be strictly enforced (max 1 worker)."""
    # 1. Config validation fails on startup if server_workers > 1
    with pytest.raises(ValidationError):
        Settings(server_workers=2)

    # 2. ProductSyncService constructor raises ValueError if server_workers != 1
    with pytest.raises(ValueError, match="server_workers=1"):
        ProductSyncService(state_path=tmp_path / "sync.json", server_workers=2)


def test_batch_does_not_corrupt_single_product_sync_state(tmp_path: Path) -> None:
    """Batch endpoint (/index/products) must not race or overwrite higher versions."""
    app = create_app(load_runtime=False)
    es_service = FakeElasticsearchService()
    faiss_service = create_test_faiss_service(tmp_path)
    clip_service = FakeClipService(dimension=2)
    download_service = FakeImageDownloadService()
    sync_state_path = tmp_path / "product_sync_state.json"
    sync_service = ProductSyncService(state_path=sync_state_path)

    app.state.elasticsearch_service = es_service
    app.state.faiss_service = faiss_service
    app.state.clip_service = clip_service
    app.state.image_download_service = download_service
    app.state.product_sync_service = sync_service

    client = TestClient(app)
    with client:
        # 1. Product 100 indexed via single-product sync at version 3
        p1 = sample_single_payload(product_id=100, version=3)
        res1 = client.post("/index/product", json=p1)
        assert res1.status_code == 200

        # 2. Batch arrives with product 100 at version 2 (older)
        batch_payload = [
            {
                "productId": 100,
                "version": 2,
                "name": "Old Batch Item",
                "description": "",
                "category": "Electronics",
                "imageUrls": ["http://backend/img.jpg"],
            }
        ]
        res_batch = client.post("/index/products", json=batch_payload)
        assert res_batch.status_code == 501
        assert res_batch.json() == {"detail": "BATCH_INDEXING_NOT_SUPPORTED"}

        # Verify sync state and FAISS version remained 3
        assert faiss_service.current_version(100) == 3
        rec = sync_service.current_record(100)
        assert rec is not None
        assert rec.latest_version == 3


def test_sync_stale_event_with_disallowed_image_returns_stale_not_422(tmp_path: Path) -> None:
    """Stale event with disallowed image URL must return STALE (200), not 422."""
    app = create_app(load_runtime=False)
    es_service = FakeElasticsearchService()
    faiss_service = create_test_faiss_service(tmp_path)
    clip_service = FakeClipService(dimension=2)
    download_service = FakeImageDownloadService()
    sync_state_path = tmp_path / "product_sync_state.json"
    sync_service = ProductSyncService(state_path=sync_state_path)

    app.state.elasticsearch_service = es_service
    app.state.faiss_service = faiss_service
    app.state.clip_service = clip_service
    app.state.image_download_service = download_service
    app.state.product_sync_service = sync_service

    client = TestClient(app)
    with client:
        # First index product at version 3 with valid URL
        res1 = client.post("/index/product", json=sample_single_payload(product_id=50, version=3))
        assert res1.status_code == 200
        assert res1.json()["outcome"] == "APPLIED"

        # Now configure download service to reject any URL not in allowlist
        download_service.error = ImageUrlNotAllowedError("host disallowed-cdn.com is not allowed")
        download_service.validate_calls = 0
        download_service.urls.clear()

        # Send stale event at version 2 with disallowed image URL
        stale_payload = sample_single_payload(
            product_id=50,
            version=2,
            image_urls=["http://disallowed-cdn.com/stale-image.jpg"],
        )
        res2 = client.post("/index/product", json=stale_payload)

        # Must return 200 STALE, never 422
        assert res2.status_code == 200
        data2 = res2.json()
        assert data2["outcome"] == "STALE"
        assert data2["version"] == 2
        assert data2["indexes"]["elasticsearch"]["status"] == "ALREADY_APPLIED"
        assert data2["indexes"]["faiss"]["status"] == "ALREADY_APPLIED"

        # Verify image was NOT validated and NOT downloaded
        assert download_service.validate_calls == 0
        assert len(download_service.urls) == 0


def test_sync_completed_same_event_returns_noop_without_validating_or_downloading(
    tmp_path: Path,
) -> None:
    """Completed same-event must return NOOP (200) without validating or downloading image."""
    app = create_app(load_runtime=False)
    es_service = FakeElasticsearchService()
    faiss_service = create_test_faiss_service(tmp_path)
    clip_service = FakeClipService(dimension=2)
    download_service = FakeImageDownloadService()
    sync_state_path = tmp_path / "product_sync_state.json"
    sync_service = ProductSyncService(state_path=sync_state_path)

    app.state.elasticsearch_service = es_service
    app.state.faiss_service = faiss_service
    app.state.clip_service = clip_service
    app.state.image_download_service = download_service
    app.state.product_sync_service = sync_service

    client = TestClient(app)
    payload = sample_single_payload(product_id=50, version=3)
    with client:
        # First index product at version 3
        res1 = client.post("/index/product", json=payload)
        assert res1.status_code == 200
        assert res1.json()["outcome"] == "APPLIED"

        # Now configure download service to fail if called
        download_service.error = ImageUrlNotAllowedError("Should not validate or fetch for NOOP")
        download_service.validate_calls = 0
        download_service.urls.clear()

        # Send same completed event again
        res2 = client.post("/index/product", json=payload)

        assert res2.status_code == 200
        data2 = res2.json()
        assert data2["outcome"] == "NOOP"
        assert data2["version"] == 3
        assert data2["indexes"]["elasticsearch"]["status"] == "ALREADY_APPLIED"
        assert data2["indexes"]["faiss"]["status"] == "ALREADY_APPLIED"

        # Verify image was NOT validated and NOT downloaded
        assert download_service.validate_calls == 0
        assert len(download_service.urls) == 0


def test_sync_same_version_different_payload_returns_409_conflict_even_with_disallowed_image(
    tmp_path: Path,
) -> None:
    """Same-version different payload returns 409 VERSION_CONFLICT, not 422,
    even with an invalid image URL.
    """
    app = create_app(load_runtime=False)
    es_service = FakeElasticsearchService()
    faiss_service = create_test_faiss_service(tmp_path)
    clip_service = FakeClipService(dimension=2)
    download_service = FakeImageDownloadService()
    sync_state_path = tmp_path / "product_sync_state.json"
    sync_service = ProductSyncService(state_path=sync_state_path)

    app.state.elasticsearch_service = es_service
    app.state.faiss_service = faiss_service
    app.state.clip_service = clip_service
    app.state.image_download_service = download_service
    app.state.product_sync_service = sync_service

    client = TestClient(app)
    with client:
        # First index product at version 3
        res1 = client.post(
            "/index/product",
            json=sample_single_payload(product_id=50, version=3, name="Headphones A"),
        )
        assert res1.status_code == 200

        # Now configure download service to raise error on disallowed host
        download_service.error = ImageUrlNotAllowedError("host malicious.com is not allowed")
        download_service.validate_calls = 0
        download_service.urls.clear()

        # Send same version 3 but conflicting payload AND invalid image URL
        conflict_payload = sample_single_payload(
            product_id=50,
            version=3,
            name="Conflicting Headphones B",
            image_urls=["http://malicious.com/hack.jpg"],
        )
        res2 = client.post("/index/product", json=conflict_payload)

        # Must return 409 VERSION_CONFLICT, not 422
        assert res2.status_code == 409
        assert res2.json()["detail"] == "VERSION_CONFLICT"

        # Verify image was NOT validated and NOT downloaded
        assert download_service.validate_calls == 0
        assert len(download_service.urls) == 0


def test_sync_retry_elasticsearch_only_does_not_validate_or_download_image_when_faiss_succeeded(
    tmp_path: Path,
) -> None:
    """Retry for ES only must NOT validate or download image when FAISS already succeeded."""
    app = create_app(load_runtime=False)
    es_service = FakeElasticsearchService(error=RuntimeError("Elasticsearch temporarily down"))
    faiss_service = create_test_faiss_service(tmp_path)
    clip_service = FakeClipService(dimension=2)
    download_service = FakeImageDownloadService()
    sync_state_path = tmp_path / "product_sync_state.json"
    sync_service = ProductSyncService(state_path=sync_state_path)

    app.state.elasticsearch_service = es_service
    app.state.faiss_service = faiss_service
    app.state.clip_service = clip_service
    app.state.image_download_service = download_service
    app.state.product_sync_service = sync_service

    client = TestClient(app)
    payload = sample_single_payload(product_id=50, version=1)

    with client:
        # First attempt: ES fails, FAISS succeeds -> PARTIAL_FAILURE (503)
        res1 = client.post("/index/product", json=payload)
        assert res1.status_code == 503
        data1 = res1.json()
        assert data1["outcome"] == "PARTIAL_FAILURE"
        assert data1["indexes"]["elasticsearch"]["status"] == "FAILED"
        assert data1["indexes"]["faiss"]["status"] == "SUCCEEDED"
        assert data1["indexes"]["faiss"]["version"] == 1
        assert len(download_service.urls) == 1

        # Now configure:
        # 1. ES recovers
        es_service.error = None
        # 2. Image URL service is configured to raise error if called
        download_service.error = ImageUrlNotAllowedError(
            "FAISS already succeeded; image service must not be invoked"
        )
        download_service.validate_calls = 0
        download_service.urls.clear()

        # Retry the exact same payload
        res2 = client.post("/index/product", json=payload)
        assert res2.status_code == 200
        data2 = res2.json()
        assert data2["outcome"] == "APPLIED"
        assert data2["indexes"]["elasticsearch"]["status"] == "SUCCEEDED"
        assert data2["indexes"]["elasticsearch"]["version"] == 1
        assert data2["indexes"]["faiss"]["status"] == "ALREADY_APPLIED"
        assert data2["indexes"]["faiss"]["version"] == 1

        # Verify image was NOT validated and NOT downloaded on retry
        assert download_service.validate_calls == 0
        assert len(download_service.urls) == 0

        # ES indexed once
        assert len(es_service.indexed_docs) == 1
