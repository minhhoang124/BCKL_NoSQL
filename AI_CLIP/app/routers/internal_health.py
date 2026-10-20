import secrets

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.schemas.search_health_contract import SearchHealthSnapshot

router = APIRouter(tags=["internal-health"])


@router.get("/internal/health/search", response_model=SearchHealthSnapshot)
async def search_health(request: Request):
    configured = request.app.state.internal_health_token
    headers = request.headers.getlist("x-internal-health-token")
    if configured is None or not configured.get_secret_value().strip():
        return JSONResponse(
            status_code=503,
            headers={"Cache-Control": "no-store"},
            content={"code": "INTERNAL_HEALTH_NOT_CONFIGURED"},
        )
    if len(headers) != 1 or not secrets.compare_digest(
        headers[0].encode(), configured.get_secret_value().encode()
    ):
        return JSONResponse(
            status_code=401,
            headers={"Cache-Control": "no-store"},
            content={"code": "INTERNAL_HEALTH_UNAUTHORIZED"},
        )
    snapshot = request.app.state.search_health_service.snapshot()
    return JSONResponse(content=snapshot.model_dump(), headers={"Cache-Control": "no-store"})
