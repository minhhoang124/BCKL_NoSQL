import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.config import get_settings
from app.routers.health import router as health_router
from app.routers.index import router as index_router
from app.routers.internal_health import router as internal_health_router
from app.routers.search import router as search_router
from app.services.clip_service import ClipService
from app.services.elasticsearch_service import ElasticsearchService
from app.services.faiss_service import FaissService
from app.services.image_download_service import ImageDownloadService
from app.services.image_service import ImageService
from app.services.product_sync_service import ProductSyncService
from app.services.runtime import runtime_state
from app.services.search_health_service import SearchHealthService

settings = get_settings()


def create_app(*, load_runtime: bool | None = None) -> FastAPI:
    should_load = (
        settings.load_runtime_on_startup if load_runtime is None else load_runtime
    )
    image_service = ImageService(
        settings.max_image_bytes,
        settings.max_image_pixels,
    )
    image_download_service = ImageDownloadService(
        image_service,
        settings.allowed_image_hosts,
        settings.image_download_timeout_seconds,
    )
    elasticsearch_service = ElasticsearchService(
        base_url=settings.elasticsearch_url,
        index_name=settings.elasticsearch_index_name,
        timeout_seconds=settings.elasticsearch_timeout_seconds,
    )
    product_sync_service = ProductSyncService(
        state_path=settings.product_sync_state_path,
        server_workers=settings.server_workers,
    )

    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncIterator[None]:
        try:
            if should_load:
                os.environ.setdefault("OMP_NUM_THREADS", str(settings.omp_num_threads))
                clip_service = ClipService(settings)
                faiss_service = FaissService(
                    settings.faiss_index_path,
                    settings.faiss_state_path,
                )

                clip_service.load(settings.device)
                faiss_service.load()
                if clip_service.embedding_dimension != faiss_service.dimension:
                    raise RuntimeError(
                        "CLIP and FAISS dimensions do not match: "
                        f"{clip_service.embedding_dimension} != {faiss_service.dimension}"
                    )

                application.state.clip_service = clip_service
                application.state.faiss_service = faiss_service
                runtime_state.update(
                    model_loaded=clip_service.is_loaded,
                    index_loaded=faiss_service.is_loaded,
                    vector_count=faiss_service.vector_count,
                )
            token = application.state.internal_health_token
            if token is not None and token.get_secret_value().strip():
                application.state.search_health_service.start()
            yield
        finally:
            await application.state.search_health_service.close()
            await image_download_service.close()
            await elasticsearch_service.close()

    application = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        description="AI Service cho tìm kiếm sản phẩm bằng hình ảnh và văn bản.",
        lifespan=lifespan,
    )
    application.include_router(health_router)
    application.include_router(search_router)
    application.include_router(index_router)
    application.include_router(internal_health_router)
    application.state.image_service = image_service
    application.state.image_download_service = image_download_service
    application.state.elasticsearch_service = elasticsearch_service
    application.state.product_sync_service = product_sync_service
    application.state.internal_health_token = settings.internal_health_token
    application.state.search_health_service = SearchHealthService(
        application, lambda: settings.rrf_k,
    )

    @application.get("/", tags=["service"])
    def root() -> dict[str, str]:
        return {
            "service": settings.app_name,
            "version": settings.app_version,
            "docs": "/docs",
        }

    return application


app = create_app()
