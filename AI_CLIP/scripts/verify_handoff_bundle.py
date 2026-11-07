from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_bundle(bundle_dir: Path) -> dict[str, Any]:
    manifest_path = bundle_dir / "manifest.json"
    if not manifest_path.is_file():
        raise FileNotFoundError(f"Missing manifest: {manifest_path}")

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("purpose") != "SMOKE_NON_PRODUCTION":
        raise ValueError("Bundle must be explicitly marked SMOKE_NON_PRODUCTION")
    if manifest.get("vectorCount") != 86:
        raise ValueError("Expected the reviewed 86-vector handoff bundle")

    files = manifest.get("files")
    if not isinstance(files, list) or not files:
        raise ValueError("Manifest files list is missing or empty")

    for entry in files:
        relative_path = entry.get("path")
        expected_hash = entry.get("sha256")
        if not isinstance(relative_path, str) or not isinstance(expected_hash, str):
            raise ValueError("Each manifest file needs path and sha256 strings")
        target = (bundle_dir / relative_path).resolve()
        try:
            target.relative_to(bundle_dir.resolve())
        except ValueError as exc:
            raise ValueError(f"Manifest path escapes bundle: {relative_path}") from exc
        if not target.is_file():
            raise FileNotFoundError(f"Missing bundle file: {relative_path}")
        actual_hash = sha256_file(target)
        if actual_hash != expected_hash:
            raise ValueError(
                f"SHA-256 mismatch for {relative_path}: expected {expected_hash}, got {actual_hash}"
            )

    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description="Verify the FAISS 86 smoke handoff bundle")
    parser.add_argument("bundle_dir", type=Path)
    args = parser.parse_args()
    manifest = verify_bundle(args.bundle_dir.resolve())
    print(
        "Verified FAISS handoff: "
        f"{manifest['vectorCount']} vectors, purpose={manifest['purpose']}"
    )


if __name__ == "__main__":
    main()
