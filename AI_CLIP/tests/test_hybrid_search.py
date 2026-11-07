from types import SimpleNamespace

from fastapi.testclient import TestClient

from app.main import create_app
from app.services.elasticsearch_service import ElasticsearchUnavailableError
from app.services.rrf_service import reciprocal_rank_fusion


class FakeClip:
    def encode_text(self, query: str) -> str:
        assert query == "máy tính"
        return "vector"


class FakeFaiss:
    def search(self, embedding: str, top_k: int) -> tuple[list[float], list[int]]:
        assert embedding == "vector"
        assert top_k == 3
        return [0.9, 0.8, 0.7], [88, 51, -1]


class FakeElasticsearch:
    def __init__(self, *, unavailable: bool = False) -> None:
        self.calls: list[dict[str, object]] = []
        self.unavailable = unavailable

    async def search_with_meta(self, **kwargs: object) -> SimpleNamespace:
        self.calls.append(kwargs)
        if self.unavailable:
            raise ElasticsearchUnavailableError("Elasticsearch unavailable")
        ids = [125] if kwargs.get("query") else [51]
        return SimpleNamespace(items=[SimpleNamespace(product_id=product_id) for product_id in ids])


def client_with_fakes(es: FakeElasticsearch) -> TestClient:
    app = create_app(load_runtime=False)
    app.state.clip_service = FakeClip()
    app.state.faiss_service = FakeFaiss()
    app.state.elasticsearch_service = es
    return TestClient(app)


def test_rrf_combines_ranked_branches_without_double_counting_duplicate_ids() -> None:
    items = reciprocal_rank_fusion(([125, 88, 88], [88, 51]), top_k=3, rrf_k=60)
    assert [item.product_id for item in items] == [88, 125, 51]
    assert items[0].score > items[1].score


def test_hybrid_applies_same_filters_before_rrf() -> None:
    es = FakeElasticsearch()
    with client_with_fakes(es) as client:
        response = client.post(
            "/search/hybrid",
            json={
                "query": " máy tính ",
                "filters": {"brandIds": [8], "inStock": True},
                "topK": 2,
                "candidateK": 3,
            },
        )
    assert response.status_code == 200
    body = response.json()
    assert body["query"] == {"type": "hybrid_text", "text": "máy tính"}
    assert [item["productId"] for item in body["items"]] == [125, 51]
    assert 88 not in [item["productId"] for item in body["items"]]
    assert body["items"][0]["rank"] == 1
    assert body["responseTimeMs"] >= 0
    assert es.calls[0]["filters"].brand_ids == [8]
    assert es.calls[1]["restrict_product_ids"] == [88, 51]
    assert es.calls[1]["filters"].in_stock is True


def test_hybrid_without_filters_does_not_request_semantic_filtering() -> None:
    es = FakeElasticsearch()
    with client_with_fakes(es) as client:
        response = client.post(
            "/search/hybrid",
            json={"query": "máy tính", "topK": 2, "candidateK": 3},
        )
    assert response.status_code == 200
    assert [item["productId"] for item in response.json()["items"]] == [125, 88]
    assert len(es.calls) == 1


def test_hybrid_rejects_blank_query_and_invalid_candidate_k() -> None:
    with client_with_fakes(FakeElasticsearch()) as client:
        blank = client.post("/search/hybrid", json={"query": "   "})
        invalid_k = client.post(
            "/search/hybrid",
            json={"query": "máy tính", "topK": 4, "candidateK": 3},
        )
    assert blank.status_code == 422
    assert invalid_k.status_code == 422


def test_hybrid_returns_503_when_elasticsearch_unavailable() -> None:
    with client_with_fakes(FakeElasticsearch(unavailable=True)) as client:
        response = client.post(
            "/search/hybrid", json={"query": "máy tính", "topK": 2, "candidateK": 3}
        )
    assert response.status_code == 503
