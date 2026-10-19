"""Export proposed schema only. Never contacts services or reads runtime secrets."""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.schemas.search_health_contract import SearchHealthSnapshot  # noqa: E402

if __name__ == "__main__":
    target = ROOT.parent / "docs/api/examples/search-health-proposed-v1.schema.json"
    target.write_text(
        json.dumps(SearchHealthSnapshot.model_json_schema(), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(target.relative_to(ROOT.parent))
