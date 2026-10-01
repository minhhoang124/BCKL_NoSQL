import time
from collections.abc import Iterable
from typing import Annotated

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from starlette.concurrency import run_in_threadpool

from app.config import get_settings
from app.schemas.search import (
    HybridSearchQuery,
    HybridSearchRequest,
    HybridSearchResponse,
    SearchQuery,
    SearchResponse,
    SearchResult,
    TextSearchRequest,
    default_candidate_k,
)
from app.services.elasticsearch_service import ElasticsearchError
from app.services.image_service import (
    ImageTooLargeError,
    InvalidImageError,
    UnsupportedImageFormatError,
)
from app.services.rrf_service import reciprocal_rank_fusion

router = APIRouter(prefix="/search", tags=["search"])

ALLOWED_IMAGE_CONTENT_TYPES = {"image/jpeg", "image/png"}


@router.post("/hybrid", response_model=HybridSearchResponse)
async def search_hybrid(payload: HybridSearchRequest, request: Request) -> HybridSearchResponse:
    start_time = time.perf_counter()
    try:
        clip_service = request.app.state.clip_service
        faiss_service = request.app.state.faiss_service
        elasticsearch_service = request.app.state.elasticsearch_service

        keyword = await elasticsearch_service.search_with_meta(
            query=payload.query,
            filters=payload.filters,
            top_k=payload.candidate_k,
        )
        embedding = await run_in_threadpool(clip_service.encode_text, payload.query)
        scores, product_ids = await run_in_threadpool(
            faiss_service.search, embedding, payload.candidate_k
        )
        semantic_ids = [
            item.product_id
            for item in build_search_items(product_ids, scores)
        ]

        # FAISS cannot apply structured filters itself. Intersect its candidates
        # against the same Elasticsearch metadata filter before RRF.
        active_filters = any(
            value is not None and value != []
            for value in payload.filters.model_dump().values()
        )
        if active_filters and semantic_ids:
            filtered = await elasticsearch_service.search_with_meta(
                filters=payload.filters,
                top_k=len(semantic_ids),
                restrict_product_ids=semantic_ids,
            )
            allowed_ids = {item.product_id for item in filtered.items}
            semantic_ids = [product_id for product_id in semantic_ids if product_id in allowed_ids]

        items = reciprocal_rank_fusion(
            ([item.product_id for item in keyword.items], semantic_ids),
            top_k=payload.top_k,
            rrf_k=get_settings().rrf_k,
        )
        return HybridSearchResponse(
            query=HybridSearchQuery(text=payload.query),
            items=items,
            responseTimeMs=(time.perf_counter() - start_time) * 1000,
        )
    except (ElasticsearchError, RuntimeError) as error:
        raise HTTPException(status_code=503, detail=str(error)) from error


def build_search_items(
    product_ids: Iterable[object],
    scores: Iterable[object],
    limit: int | None = None,
) -> list[SearchResult]:
    items: list[SearchResult] = []
    seen_product_ids: set[int] = set()

    for product_id, score in zip(product_ids, scores, strict=True):
        if limit is not None and len(items) >= limit:
            break
        normalized_id = int(product_id)
        if normalized_id == -1 or normalized_id in seen_product_ids:
            continue
        seen_product_ids.add(normalized_id)
        items.append(
            SearchResult(
                productId=normalized_id,
                rank=len(items) + 1,
                score=float(score),
            )
        )

    return items


@router.post("/text", response_model=SearchResponse)
async def search_text(
    payload: TextSearchRequest,
    request: Request,
) -> SearchResponse:
    start_time = time.perf_counter()

    try:
        clip_service = request.app.state.clip_service
        faiss_service = request.app.state.faiss_service

        embedding = await run_in_threadpool(
            clip_service.encode_text,
            payload.query,
        )

        candidate_k = int(payload.candidate_k)
        scores, product_ids = await run_in_threadpool(
            faiss_service.search,
            embedding,
            candidate_k,
        )

        items = build_search_items(product_ids, scores, limit=payload.top_k)

        return SearchResponse(
            query=SearchQuery(
                type="text",
                text=payload.query,
                topK=payload.top_k,
                candidateK=candidate_k,
            ),
            items=items,
            responseTimeMs=(time.perf_counter() - start_time) * 1000,
        )

    except RuntimeError as error:
        raise HTTPException(
            status_code=503,
            detail=str(error),
        ) from error


@router.post(
    "/image",
    response_model=SearchResponse,
    response_model_exclude_none=True,
)
async def search_image(
    request: Request,
    image: Annotated[UploadFile, File(description="JPEG hoặc PNG, tối đa 5 MB")],
    top_k: Annotated[int, Form(alias="topK", ge=1, le=50)] = 10,
    candidate_k: Annotated[int | None, Form(alias="candidateK", ge=1, le=150)] = None,
) -> SearchResponse:
    start_time = time.perf_counter()

    if image.content_type not in ALLOWED_IMAGE_CONTENT_TYPES:
        raise HTTPException(
            status_code=415,
            detail="Only JPEG and PNG images are supported",
        )

    effective_candidate_k = candidate_k or default_candidate_k(top_k)
    if effective_candidate_k < top_k:
        raise HTTPException(
            status_code=422,
            detail="candidateK must be greater than or equal to topK",
        )

    image_service = request.app.state.image_service
    content = await image.read(image_service.max_image_bytes + 1)
    await image.close()

    try:
        decoded_image = await run_in_threadpool(image_service.decode, content)
        clip_service = request.app.state.clip_service
        faiss_service = request.app.state.faiss_service

        embedding = await run_in_threadpool(
            clip_service.encode_image,
            decoded_image,
        )
        scores, product_ids = await run_in_threadpool(
            faiss_service.search,
            embedding,
            effective_candidate_k,
        )

        return SearchResponse(
            query=SearchQuery(
                type="image",
                topK=top_k,
                candidateK=effective_candidate_k,
            ),
            items=build_search_items(product_ids, scores, limit=top_k),
            responseTimeMs=(time.perf_counter() - start_time) * 1000,
        )
    except ImageTooLargeError as error:
        raise HTTPException(status_code=413, detail=str(error)) from error
    except UnsupportedImageFormatError as error:
        raise HTTPException(status_code=415, detail=str(error)) from error
    except InvalidImageError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
