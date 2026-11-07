from io import BytesIO
from typing import Any

from fastapi.testclient import TestClient
from PIL import Image

from app.main import create_app
from app.services.image_service import ImageService


class FakeClipService:
    def encode_text(self, query: str) -> str:
        assert query == "máy tính"
        return "fake-embedding"

    def encode_image(self, image: Image.Image) -> str:
        assert image.mode == "RGB"
        return "fake-embedding"


class FakeFaissService:
    def __init__(
        self,
        *,
        expected_k: int = 2,
        scores: list[float] | None = None,
        product_ids: list[int] | None = None,
    ) -> None:
        self.expected_k = expected_k
        self.scores = scores if scores is not None else [0.91, 0.75]
        self.product_ids = product_ids if product_ids is not None else [125, 88]

    def search(self, embedding: Any, top_k: int) -> tuple[list[float], list[int]]:
        assert embedding == "fake-embedding"
        assert top_k == self.expected_k
        return self.scores, self.product_ids


def create_search_client(
    *,
    max_image_bytes: int = 5 * 1024 * 1024,
    max_image_pixels: int = 25_000_000,
    faiss_service: FakeFaissService | None = None,
) -> TestClient:
    app = create_app(load_runtime=False)
    app.state.clip_service = FakeClipService()
    app.state.faiss_service = faiss_service or FakeFaissService()
    app.state.image_service = ImageService(max_image_bytes, max_image_pixels)
    return TestClient(app)


def create_png() -> bytes:
    content = BytesIO()
    Image.new("RGB", (8, 8), color="blue").save(content, format="PNG")
    return content.getvalue()


def create_jpeg() -> bytes:
    content = BytesIO()
    Image.new("RGB", (8, 8), color="blue").save(content, format="JPEG")
    return content.getvalue()


def create_gif() -> bytes:
    content = BytesIO()
    Image.new("RGB", (8, 8), color="blue").save(content, format="GIF")
    return content.getvalue()


def test_text_search_returns_contract_response() -> None:
    with create_search_client() as client:
        response = client.post(
            "/search/text",
            json={"query": "máy tính", "topK": 2, "candidateK": 2},
        )

    assert response.status_code == 200
    body = response.json()
    assert body["query"] == {
        "type": "text",
        "text": "máy tính",
        "topK": 2,
        "candidateK": 2,
    }
    assert body["items"] == [
        {"productId": 125, "rank": 1, "score": 0.91},
        {"productId": 88, "rank": 2, "score": 0.75},
    ]
    assert body["responseTimeMs"] >= 0


def test_text_search_rejects_empty_query() -> None:
    with create_search_client() as client:
        response = client.post(
            "/search/text",
            json={"query": "", "topK": 2},
        )

    assert response.status_code == 422


def test_image_search_returns_contract_response() -> None:
    faiss_service = FakeFaissService(
        expected_k=6,
        scores=[0.91, 0.75, 0.62, 0.51, 0.48, 0.41],
        product_ids=[125, 88, 51, 35, 21, 13],
    )
    with create_search_client(faiss_service=faiss_service) as client:
        response = client.post(
            "/search/image",
            data={"topK": "2", "candidateK": "6"},
            files={"image": ("query.png", create_png(), "image/png")},
        )

    assert response.status_code == 200
    body = response.json()
    assert body["query"] == {
        "type": "image",
        "topK": 2,
        "candidateK": 6,
    }
    assert body["items"] == [
        {"productId": 125, "rank": 1, "score": 0.91},
        {"productId": 88, "rank": 2, "score": 0.75},
    ]
    assert body["responseTimeMs"] >= 0


def test_image_search_uses_default_candidate_k() -> None:
    faiss_service = FakeFaissService(expected_k=30)
    with create_search_client(faiss_service=faiss_service) as client:
        response = client.post(
            "/search/image",
            data={"topK": "2"},
            files={"image": ("query.png", create_png(), "image/png")},
        )

    assert response.status_code == 200
    assert response.json()["query"]["candidateK"] == 30


def test_image_search_accepts_jpeg() -> None:
    with create_search_client() as client:
        response = client.post(
            "/search/image",
            data={"topK": "2", "candidateK": "2"},
            files={"image": ("query.jpg", create_jpeg(), "image/jpeg")},
        )

    assert response.status_code == 200


def test_image_search_rejects_unsupported_content_type() -> None:
    with create_search_client() as client:
        response = client.post(
            "/search/image",
            files={"image": ("query.gif", b"not-an-image", "image/gif")},
        )

    assert response.status_code == 415


def test_image_search_rejects_corrupted_image() -> None:
    with create_search_client() as client:
        response = client.post(
            "/search/image",
            files={"image": ("query.png", b"not-an-image", "image/png")},
        )

    assert response.status_code == 400


def test_image_search_rejects_empty_image() -> None:
    with create_search_client() as client:
        response = client.post(
            "/search/image",
            files={"image": ("query.png", b"", "image/png")},
        )

    assert response.status_code == 400


def test_image_search_rejects_spoofed_unsupported_format() -> None:
    with create_search_client() as client:
        response = client.post(
            "/search/image",
            files={"image": ("query.png", create_gif(), "image/png")},
        )

    assert response.status_code == 415


def test_image_search_rejects_oversized_image() -> None:
    with create_search_client(max_image_bytes=4) as client:
        response = client.post(
            "/search/image",
            files={"image": ("query.jpg", b"12345", "image/jpeg")},
        )

    assert response.status_code == 413


def test_image_search_rejects_excessive_pixel_count() -> None:
    with create_search_client(max_image_pixels=63) as client:
        response = client.post(
            "/search/image",
            files={"image": ("query.png", create_png(), "image/png")},
        )

    assert response.status_code == 413


def test_image_search_rejects_candidate_k_below_top_k() -> None:
    with create_search_client() as client:
        response = client.post(
            "/search/image",
            data={"topK": "5", "candidateK": "2"},
            files={"image": ("query.png", create_png(), "image/png")},
        )

    assert response.status_code == 422


def test_image_search_removes_missing_and_duplicate_product_ids() -> None:
    faiss_service = FakeFaissService(
        expected_k=4,
        scores=[0.91, 0.82, 0.76, 0.65],
        product_ids=[125, 125, -1, 88],
    )
    with create_search_client(faiss_service=faiss_service) as client:
        response = client.post(
            "/search/image",
            data={"topK": "2", "candidateK": "4"},
            files={"image": ("query.png", create_png(), "image/png")},
        )

    assert response.status_code == 200
    assert response.json()["items"] == [
        {"productId": 125, "rank": 1, "score": 0.91},
        {"productId": 88, "rank": 2, "score": 0.65},
    ]


def test_text_search_limits_items_to_top_k_when_candidate_k_larger() -> None:
    faiss_service = FakeFaissService(
        expected_k=5,
        scores=[0.95, 0.90, 0.85, 0.80, 0.75],
        product_ids=[101, 102, 103, 104, 105],
    )
    with create_search_client(faiss_service=faiss_service) as client:
        response = client.post(
            "/search/text",
            json={"query": "máy tính", "topK": 2, "candidateK": 5},
        )

    assert response.status_code == 200
    body = response.json()
    assert body["query"]["topK"] == 2
    assert body["query"]["candidateK"] == 5
    items = body["items"]
    assert len(items) == 2
    assert items == [
        {"productId": 101, "rank": 1, "score": 0.95},
        {"productId": 102, "rank": 2, "score": 0.90},
    ]


def test_image_search_limits_items_to_top_k_when_candidate_k_larger() -> None:
    faiss_service = FakeFaissService(
        expected_k=6,
        scores=[0.99, 0.92, 0.88, 0.85, 0.80, 0.75],
        product_ids=[201, 202, 203, 204, 205, 206],
    )
    with create_search_client(faiss_service=faiss_service) as client:
        response = client.post(
            "/search/image",
            data={"topK": "3", "candidateK": "6"},
            files={"image": ("query.png", create_png(), "image/png")},
        )

    assert response.status_code == 200
    body = response.json()
    assert body["query"]["topK"] == 3
    assert body["query"]["candidateK"] == 6
    items = body["items"]
    assert len(items) == 3
    assert items == [
        {"productId": 201, "rank": 1, "score": 0.99},
        {"productId": 202, "rank": 2, "score": 0.92},
        {"productId": 203, "rank": 3, "score": 0.88},
    ]
