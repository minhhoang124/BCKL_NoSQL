from fastapi import APIRouter, Request

from app.schemas.health import HealthResponse
from app.services.runtime import runtime_state

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
def health(request: Request) -> HealthResponse:
    response = runtime_state.health_response()
    faiss_service = getattr(request.app.state, "faiss_service", None)
    if faiss_service is not None:
        response.vector_count = faiss_service.vector_count
    return response
