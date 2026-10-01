import hashlib
import json
from pathlib import Path

import pytest

from scripts.verify_handoff_bundle import verify_bundle


def write_bundle(tmp_path: Path, *, vector_count: int = 86) -> Path:
    artifact = tmp_path / "artifacts" / "index.faiss"
    artifact.parent.mkdir()
    artifact.write_bytes(b"faiss-smoke")
    digest = hashlib.sha256(artifact.read_bytes()).hexdigest()
    manifest = {
        "purpose": "SMOKE_NON_PRODUCTION",
        "vectorCount": vector_count,
        "files": [{"path": "artifacts/index.faiss", "sha256": digest}],
    }
    (tmp_path / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    return tmp_path


def test_verify_bundle_accepts_reviewed_manifest(tmp_path: Path) -> None:
    manifest = verify_bundle(write_bundle(tmp_path))
    assert manifest["vectorCount"] == 86


def test_verify_bundle_rejects_tampered_artifact(tmp_path: Path) -> None:
    bundle = write_bundle(tmp_path)
    (bundle / "artifacts" / "index.faiss").write_bytes(b"tampered")
    with pytest.raises(ValueError, match="SHA-256 mismatch"):
        verify_bundle(bundle)


def test_verify_bundle_rejects_unexpected_vector_count(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="86-vector"):
        verify_bundle(write_bundle(tmp_path, vector_count=85))
