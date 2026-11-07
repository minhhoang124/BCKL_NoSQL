from collections.abc import Iterable

from app.schemas.search import SearchResult


def reciprocal_rank_fusion(
    ranked_branches: Iterable[Iterable[int]],
    *,
    top_k: int,
    rrf_k: int = 60,
) -> list[SearchResult]:
    """Fuse ordered product IDs; scores are RRF values, not cosine similarity."""
    if top_k < 1 or rrf_k < 1:
        raise ValueError("top_k and rrf_k must be positive")

    scores: dict[int, float] = {}
    first_seen: dict[int, int] = {}
    for branch in ranked_branches:
        branch_seen: set[int] = set()
        for position, product_id in enumerate(branch, start=1):
            if product_id <= 0 or product_id in branch_seen:
                continue
            branch_seen.add(product_id)
            first_seen.setdefault(product_id, len(first_seen))
            scores[product_id] = scores.get(product_id, 0.0) + 1.0 / (rrf_k + position)

    ranked = sorted(scores, key=lambda product_id: (-scores[product_id], first_seen[product_id]))
    return [
        SearchResult(productId=product_id, rank=rank, score=scores[product_id])
        for rank, product_id in enumerate(ranked[:top_k], start=1)
    ]
