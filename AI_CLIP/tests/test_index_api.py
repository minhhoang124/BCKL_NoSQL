from pathlib import Path
from typing import Any

import numpy as np
from fastapi.testclient import TestClient
from PIL import Image

from app.main import create_app
from app.schemas.elasticsearch import ProductDocument
from app.services.faiss_service import FaissMutationResult
from app.services.image_download_service import ImageDownloadError, ImageUrlNotAllowedError
from app.services.product_sync_service import ProductSyncService


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
        return Image.new("RGB", (8, 8), color="blue")


class FakeClipService:
    def __init__(self) -> None:
        self.image_calls = 0
        self.batch_sizes: list[int] = []

    def encode_image(self, image: Image.Image) -> np.ndarray:
        self.image_calls += 1
        return np.array([[1.0, 0.0]], dtype="float32")

    def encode_images(self, images: list[Image.Image]) -> np.ndarray:
        self.batch_sizes.append(len(images))
        return np.array([[1.0, float(index)] for index in range(len(images))])


class FakeFaissService:
    def __init__(self, versions: dict[int, int] | None = None) -> None:
        self.versions = versions or {}
        self.vector_count = len(self.versions)
        self.upsert_calls: list[tuple[int, int, Any]] = []
        self.batch_calls: list[list[tuple[int, int, Any]]] = []
        self.delete_calls: list[tuple[int, int]] = []

    def current_version(self, product_id: int) -> int | None:
        return self.versions.get(product_id)

    def upsert(
        self,
        product_id: int,
        version: int,
        embedding: Any,
        force: bool = False,
    ) -> FaissMutationResult:
        self.upsert_calls.append((product_id, version, embedding))
        if product_id not in self.versions:
            self.vector_count += 1
        self.versions[product_id] = version
        return FaissMutationResult(product_id, version, True, "updated", self.vector_count)

    def upsert_many(
        self,
        products: list[tuple[int, int, Any]],
        force: bool = False,
    ) -> list[FaissMutationResult]:
        self.batch_calls.append(products)
        results = []
        for product_id, version, embedding in products:
            results.append(self.upsert(product_id, version, embedding, force=force))
        return results

    def delete(
        self,
        product_id: int,
        version: int,
        force: bool = False,
    ) -> FaissMutationResult:
        self.delete_calls.append((product_id, version))
        if product_id in self.versions:
            self.vector_count -= 1
        self.versions[product_id] = version
        return FaissMutationResult(product_id, version, True, "deleted", self.vector_count)


def batch_product_payload(product_id: int = 125, version: int = 1) -> dict[str, Any]:
    return {
        "productId": product_id,
        "externalId": "abo:B003MAJHB8",
        "name": "Wireless headphones",
        "description": "Over-ear headphones",
        "category": "audio",
        "categoryId": 7,
        "brand": "ABO Sample",
        "imageUrls": [f"http://backend:3000/uploads/products/{product_id}/1.jpg"],
        "version": version,
    }


def single_product_payload(product_id: int = 125, version: int = 1) -> dict[str, Any]:
    return {
        "productId": product_id,
        "externalId": "abo:B003MAJHB8",
        "name": "Wireless headphones",
        "description": "Over-ear headphones",
        "categoryId": 7,
        "categoryName": "audio",
        "categoryPathIds": [1, 7],
        "brandId": 8,
        "brandName": "ABO Sample",
        "imageUrls": [f"http://backend:3000/uploads/products/{product_id}/1.jpg"],
        "minPrice": "1290000.00",
        "maxPrice": "1590000.00",
        "inStock": True,
        "attributes": {"color": ["Black"]},
        "version": version,
    }


IndexClientTuple = tuple[
    TestClient,
    FakeFaissService,
    FakeClipService,
    FakeImageDownloadService,
    FakeElasticsearchService,
]


def create_index_client(
    tmp_path: Path | None = None,
    *,
    versions: dict[int, int] | None = None,
    download_error: Exception | None = None,
    es_error: Exception | None = None,
) -> IndexClientTuple:
    app = create_app(load_runtime=False)
    faiss_service = FakeFaissService(versions)
    clip_service = FakeClipService()
    download_service = FakeImageDownloadService(download_error)
    es_service = FakeElasticsearchService(es_error)

    if tmp_path is not None:
        sync_service = ProductSyncService(state_path=tmp_path / "sync_state.json")
        app.state.product_sync_service = sync_service

    app.state.faiss_service = faiss_service
    app.state.clip_service = clip_service
    app.state.image_download_service = download_service
    app.state.elasticsearch_service = es_service

    return TestClient(app), faiss_service, clip_service, download_service, es_service


def test_index_product_updates_dual_indexes(tmp_path: Path) -> None:
    client, faiss_service, clip_service, download_service, es_service = (
        create_index_client(tmp_path)
    )

    with client:
        response = client.post("/index/product", json=single_product_payload())

    assert response.status_code == 200
    assert response.json() == {
        "productId": 125,
        "version": 1,
        "operation": "UPSERT",
        "outcome": "APPLIED",
        "indexes": {
            "elasticsearch": {"status": "SUCCEEDED", "version": 1},
            "faiss": {"status": "SUCCEEDED", "version": 1},
        },
    }
    assert clip_service.image_calls == 1
    assert len(faiss_service.upsert_calls) == 1
    assert len(es_service.indexed_docs) == 1
    assert download_service.urls == [
        "http://backend:3000/uploads/products/125/1.jpg"
    ]


def test_index_product_ignores_stale_version_before_downloading_image(tmp_path: Path) -> None:
    client, faiss_service, clip_service, download_service, es_service = create_index_client(
        tmp_path,
    )

    with client:
        # First set version 3
        res1 = client.post("/index/product", json=single_product_payload(version=3))
        assert res1.status_code == 200

        # Now send stale version 2
        response = client.post("/index/product", json=single_product_payload(version=2))

    assert response.status_code == 200
    assert response.json()["outcome"] == "STALE"
    assert response.json()["indexes"]["faiss"]["status"] == "ALREADY_APPLIED"
    assert len(faiss_service.upsert_calls) == 1
    assert clip_service.image_calls == 1
    assert download_service.urls == [
        "http://backend:3000/uploads/products/125/1.jpg"
    ]


def test_index_products_refuses_faiss_only_batch_in_dual_index_mode() -> None:
    client, faiss_service, clip_service, _, _ = create_index_client(versions={125: 2})

    with client:
        response = client.post(
            "/index/products",
            json=[batch_product_payload(125, 2), batch_product_payload(126, 1)],
        )

    assert response.status_code == 501
    assert response.json() == {"detail": "BATCH_INDEXING_NOT_SUPPORTED"}
    assert clip_service.batch_sizes == []
    assert faiss_service.batch_calls == []


def test_index_products_is_not_supported_even_with_duplicate_product_id() -> None:
    client, _, _, _, _ = create_index_client()

    with client:
        response = client.post(
            "/index/products",
            json=[batch_product_payload(125, 1), batch_product_payload(125, 2)],
        )

    assert response.status_code == 501
    assert response.json() == {"detail": "BATCH_INDEXING_NOT_SUPPORTED"}


def test_delete_product_removes_vector(tmp_path: Path) -> None:
    client, faiss_service, _, _, es_service = create_index_client(tmp_path)

    with client:
        # First upsert at version 2
        client.post("/index/product", json=single_product_payload(version=2))

        # Delete at version 3
        response = client.delete("/index/product/125?version=3")

    assert response.status_code == 200
    assert response.json() == {
        "productId": 125,
        "version": 3,
        "operation": "DELETE",
        "outcome": "APPLIED",
        "indexes": {
            "elasticsearch": {"status": "SUCCEEDED", "version": 3},
            "faiss": {"status": "SUCCEEDED", "version": 3},
        },
    }
    assert (125, 3) in faiss_service.delete_calls
    assert 125 in es_service.deleted_ids


def test_delete_product_requires_version() -> None:
    client, _, _, _, _ = create_index_client()

    with client:
        response = client.delete("/index/product/125")

    assert response.status_code == 422


def test_index_product_reports_disallowed_image_url(tmp_path: Path) -> None:
    client, _, _, _, _ = create_index_client(
        tmp_path,
        download_error=ImageUrlNotAllowedError("host is not allowed"),
    )

    with client:
        response = client.post("/index/product", json=single_product_payload())

    assert response.status_code == 422


def test_index_product_reports_partial_failure_on_image_error(tmp_path: Path) -> None:
    client, _, _, _, _ = create_index_client(
        tmp_path,
        download_error=ImageDownloadError("backend unavailable"),
    )

    with client:
        response = client.post("/index/product", json=single_product_payload())

    assert response.status_code == 503
    assert response.json()["outcome"] == "PARTIAL_FAILURE"
    assert response.json()["indexes"]["faiss"]["status"] == "FAILED"
    assert response.json()["indexes"]["elasticsearch"]["status"] == "SUCCEEDED"
