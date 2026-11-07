"""Export the existing Pydantic image wire; no model/index/network/config loading."""

import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.schemas.search import SearchQuery, SearchResponse, SearchResult  # noqa: E402


def build_contract() -> dict:
    source = (ROOT / "app/schemas/search.py").read_text(encoding="utf-8")
    router = (ROOT / "app/routers/search.py").read_text(encoding="utf-8")
    return {
        "source": "AI_CLIP/app/schemas/search.py",
        "sourceSha256Lf": hashlib.sha256(source.replace("\r\n", "\n").encode()).hexdigest(),
        "routerSha256Lf": hashlib.sha256(router.replace("\r\n", "\n").encode()).hexdigest(),
        "serialization": "by_alias=True, exclude_none=True (existing image router)",
        "schema": SearchResponse.model_json_schema(by_alias=True),
        "example": SearchResponse(
            query=SearchQuery(type="image", topK=10, candidateK=30),
            items=[SearchResult(productId=125, rank=1, score=0.91)],
            responseTimeMs=1.5,
        ).model_dump(by_alias=True, exclude_none=True),
    }


if __name__ == "__main__":
    target = ROOT / "tests/fixtures/backend_contract/image_search_response.generated.json"
    target.write_text(
        json.dumps(build_contract(), ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(target.relative_to(ROOT))
