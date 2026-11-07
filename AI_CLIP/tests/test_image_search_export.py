import json
from pathlib import Path

from scripts.export_image_search_contract import build_contract


def test_image_export_matches_actual_pydantic_models() -> None:
    fixture = (
        Path(__file__).parent / "fixtures/backend_contract/image_search_response.generated.json"
    )
    contract = build_contract()
    assert json.loads(fixture.read_text(encoding="utf-8")) == contract
    assert contract["example"]["query"] == {"type": "image", "topK": 10, "candidateK": 30}
    assert "text" not in contract["example"]["query"]
