from typing import Annotated, NoReturn

from fastapi import APIRouter, HTTPException, Path, Query, Request
from fastapi.responses import JSONResponse

from app.schemas.index import (
    ProductSyncResponse,
    SingleProductIndexRequest,
)
from app.services.image_download_service import (
    ImageDownloadError,
    ImageUrlNotAllowedError,
)
from app.services.image_service import (
    ImageTooLargeError,
    InvalidImageError,
    UnsupportedImageFormatError,
)
from app.services.product_sync_service import VersionConflictError

router = APIRouter(prefix="/index", tags=["index"])

def raise_index_http_error(error: Exception) -> NoReturn:
    if isinstance(error, VersionConflictError):
        raise HTTPException(status_code=409, detail="VERSION_CONFLICT") from error
    if isinstance(error, ImageTooLargeError):
        raise HTTPException(status_code=413, detail=str(error)) from error
    if isinstance(error, UnsupportedImageFormatError):
        raise HTTPException(status_code=415, detail=str(error)) from error
    if isinstance(error, (InvalidImageError, ImageUrlNotAllowedError, ValueError)):
        raise HTTPException(status_code=422, detail=str(error)) from error
    if isinstance(error, ImageDownloadError):
        raise HTTPException(status_code=502, detail=str(error)) from error
    if isinstance(error, RuntimeError):
        raise HTTPException(status_code=503, detail=str(error)) from error
    raise error


@router.post(
    "/product",
    response_model=ProductSyncResponse,
    responses={
        200: {"model": ProductSyncResponse},
        409: {"description": "Version Conflict"},
        503: {"model": ProductSyncResponse, "description": "Partial Failure"},
    },
)
async def index_product(
    payload: SingleProductIndexRequest,
    request: Request,
) -> ProductSyncResponse | JSONResponse:
    sync_service = request.app.state.product_sync_service
    elasticsearch_service = request.app.state.elasticsearch_service
    faiss_service = request.app.state.faiss_service
    clip_service = request.app.state.clip_service
    image_download_service = request.app.state.image_download_service

    try:
        result = await sync_service.sync_product(
            payload=payload,
            elasticsearch_service=elasticsearch_service,
            faiss_service=faiss_service,
            clip_service=clip_service,
            image_download_service=image_download_service,
        )
        if result.outcome == "PARTIAL_FAILURE":
            return JSONResponse(
                status_code=503,
                content=result.model_dump(by_alias=True),
            )
        return result
    except Exception as error:
        raise_index_http_error(error)


@router.post(
    "/products",
    response_model=None,
    responses={501: {"description": "Batch indexing is not supported"}},
)
async def index_products() -> NoReturn:
    # The former implementation mutated FAISS without Elasticsearch or sync state.
    # Do not expose that path while the two-index batch contract remains undecided.
    raise HTTPException(status_code=501, detail="BATCH_INDEXING_NOT_SUPPORTED")


@router.delete(
    "/product/{productId}",
    response_model=ProductSyncResponse,
    responses={
        200: {"model": ProductSyncResponse},
        409: {"description": "Version Conflict"},
        503: {"model": ProductSyncResponse, "description": "Partial Failure"},
    },
)
async def delete_product(
    request: Request,
    product_id: Annotated[int, Path(alias="productId", ge=1)],
    version: Annotated[int, Query(ge=1)],
) -> ProductSyncResponse | JSONResponse:
    sync_service = request.app.state.product_sync_service
    elasticsearch_service = request.app.state.elasticsearch_service
    faiss_service = request.app.state.faiss_service

    try:
        result = await sync_service.delete_product(
            product_id=product_id,
            version=version,
            elasticsearch_service=elasticsearch_service,
            faiss_service=faiss_service,
        )
        if result.outcome == "PARTIAL_FAILURE":
            return JSONResponse(
                status_code=503,
                content=result.model_dump(by_alias=True),
            )
        return result
    except Exception as error:
        raise_index_http_error(error)
