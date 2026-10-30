from io import BytesIO
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from pydantic import ValidationError

from app.config import Settings
from app.main import create_app
from app.routers.search import build_search_items
from app.services.image_service import ImageService


class Clip:
    def encode_text(self, query):
        return "embedding"

    def encode_image(self, image):
        return "embedding"


class Faiss:
    def __init__(self, scores):
        self.scores = scores

    def search(self, embedding, top_k):
        return self.scores, [125, 88, 51][: len(self.scores)]


class Elasticsearch:
    def __init__(self, keyword_ids=(), filtered_ids=()):
        self.keyword_ids = keyword_ids
        self.filtered_ids = filtered_ids
        self.calls = []

    async def search_with_meta(self, **kwargs):
        self.calls.append(kwargs)
        ids = self.keyword_ids if kwargs.get("query") else self.filtered_ids
        return SimpleNamespace(items=[SimpleNamespace(product_id=value) for value in ids])


def client(monkeypatch, scores, *, text=None, image=None, es=None):
    settings = Settings(
        _env_file=None,
        text_min_similarity=text,
        image_min_similarity=image,
    )
    monkeypatch.setattr("app.routers.search.get_settings", lambda: settings)
    app = create_app(load_runtime=False)
    app.state.clip_service = Clip()
    app.state.faiss_service = Faiss(scores)
    app.state.elasticsearch_service = es or Elasticsearch()
    app.state.image_service = ImageService(5 * 1024 * 1024, 25_000_000)
    return TestClient(app)


@pytest.mark.parametrize("setting", ["text_min_similarity", "image_min_similarity"])
@pytest.mark.parametrize("value", [float("nan"), float("inf"), -float("inf"), -1.01, 1.01])
def test_cutoff_rejects_non_finite_or_outside_cosine_range(setting, value):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, **{setting: value})


def test_unset_cutoffs_preserve_existing_retrieval():
    settings = Settings(_env_file=None)
    assert settings.text_min_similarity is None
    assert settings.image_min_similarity is None
    assert len(build_search_items([1, 2], [0.01, -0.1])) == 2


def test_cutoff_before_limit_keeps_boundary_and_compacts_ranks_without_padding():
    items = build_search_items(
        [1, 2, 3, 4, 5, 6, 6, -1],
        [float("nan"), float("inf"), 0.2699, 0.27, 0.5, 0.6, 0.6, 1.0],
        limit=3,
        min_similarity=0.27,
    )
    assert [(item.product_id, item.rank) for item in items] == [(4, 1), (5, 2), (6, 3)]


def test_text_below_cutoff_returns_successful_empty_response(monkeypatch):
    with client(monkeypatch, [0.26, 0.25, 0.1], text=0.27) as http:
        response = http.post(
            "/search/text",
            json={"query": "irrelevant", "topK": 3, "candidateK": 3},
        )
    assert response.status_code == 200
    assert response.json()["items"] == []
    assert response.json()["query"]["type"] == "text"


def test_text_keeps_only_matching_candidates_and_does_not_fill_top_k(monkeypatch):
    with client(monkeypatch, [0.8, 0.27, 0.269], text=0.27) as http:
        response = http.post(
            "/search/text",
            json={"query": "product", "topK": 3, "candidateK": 3},
        )
    assert response.status_code == 200
    assert [item["productId"] for item in response.json()["items"]] == [125, 88]
    assert [item["rank"] for item in response.json()["items"]] == [1, 2]


def test_image_has_its_own_cutoff(monkeypatch):
    content = BytesIO()
    Image.new("RGB", (8, 8), "white").save(content, format="PNG")
    with client(monkeypatch, [0.54, 0.3, 0.1], text=0.2, image=0.55) as http:
        response = http.post(
            "/search/image",
            data={"topK": "3", "candidateK": "3"},
            files={"image": ("query.png", content.getvalue(), "image/png")},
        )
    assert response.status_code == 200
    assert response.json()["items"] == []


def test_hybrid_rejects_weak_semantic_results_before_rrf(monkeypatch):
    with client(monkeypatch, [0.26, 0.2, 0.1], text=0.27) as http:
        response = http.post(
            "/search/hybrid",
            json={"query": "irrelevant", "topK": 3, "candidateK": 3},
        )
    assert response.status_code == 200
    assert response.json()["items"] == []


def test_hybrid_preserves_keyword_matches_independently_of_clip_cutoff(monkeypatch):
    es = Elasticsearch(keyword_ids=[125])
    with client(monkeypatch, [0.1, 0.2, 0.26], text=0.27, es=es) as http:
        response = http.post(
            "/search/hybrid",
            json={"query": "exact product name", "topK": 3, "candidateK": 3},
        )
    assert response.status_code == 200
    assert [item["productId"] for item in response.json()["items"]] == [125]
    assert response.json()["items"][0]["score"] == pytest.approx(1 / 61)


def test_hybrid_applies_metadata_filters_to_threshold_survivors(monkeypatch):
    es = Elasticsearch(filtered_ids=[88])
    with client(monkeypatch, [0.4, 0.3, 0.2], text=0.27, es=es) as http:
        response = http.post(
            "/search/hybrid",
            json={"query": "product", "filters": {"brandIds": [8]}, "topK": 3, "candidateK": 3},
        )
    assert response.status_code == 200
    assert es.calls[1]["restrict_product_ids"] == [125, 88]
    assert [item["productId"] for item in response.json()["items"]] == [88]


def test_disabled_cutoff_preserves_hybrid_union(monkeypatch):
    with client(monkeypatch, [0.1, 0.05], es=Elasticsearch(keyword_ids=[51])) as http:
        response = http.post(
            "/search/hybrid",
            json={"query": "product", "topK": 3, "candidateK": 3},
        )
    assert response.status_code == 200
    assert {item["productId"] for item in response.json()["items"]} == {125, 88, 51}
