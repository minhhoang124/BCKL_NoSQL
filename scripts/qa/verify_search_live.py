"""Verify a local Search evidence directory, not retrieval quality or Web acceptance."""

import hashlib
import json
import sys
from pathlib import Path


def read(root, name):
    return json.loads((root / (name + ".json")).read_text(encoding="utf-8"))


def verify_hashes(root):
    root = Path(root).resolve()
    hashes = read(root, "SHA256SUMS")
    assert hashes, "Empty hash manifest"
    expected = set()
    for relative, digest in hashes.items():
        target = root / relative
        assert not Path(relative).is_absolute() and ".." not in Path(relative).parts, (
            "Unsafe evidence path"
        )
        assert target.is_file() and not target.is_symlink(), (
            "Missing or symlink evidence"
        )
        assert target.resolve().is_relative_to(root), "Evidence escaped root"
        assert hashlib.sha256(target.read_bytes()).hexdigest() == digest, (
            "Evidence hash mismatch"
        )
        expected.add(relative)
    actual = {
        str(p.relative_to(root))
        for p in root.rglob("*")
        if p.is_file() and p.name != "SHA256SUMS.json"
    }
    assert actual == expected, "Unlisted evidence file"
    return len(hashes)


def verify(root):
    root = Path(root)
    count = verify_hashes(root)
    manifest = read(root, "manifest")
    summary = read(root, "qa-summary")
    fixture = read(root, "fixture")
    ids = fixture["productIds"]
    assert len(ids) == 2 and len(set(ids)) == 2
    assert manifest["result"] == summary["status"] == "PASS"
    assert summary["sourceCommit"] == manifest["sourceCommit"]
    assert summary["migrations"] == 17 and summary["roleFlags"] == "false:false:false"
    assert manifest["precisionRecallCalculated"] is False
    required = {
        "initial_outbox_to_real_dual_index",
        "checkout_sold_out_real_filter",
        "cancellation_restore_replay_and_documented_index_lag",
        "real_partial_failure_backoff_immutable_retry_no_duplicate_vector",
        "stale_event_cannot_overwrite_newer_state",
        "hidden_delete_and_tombstone_prevent_resurrection",
    }
    if manifest["imageGatewayCandidate"]:
        required |= {
            "image_jpeg_png_corrupt_mime_unavailable_zero_business_writes",
            "image_stale_candidate_removed_by_postgresql_hydrate",
        }
        for name, status in [
            ("jpeg", 200),
            ("png", 200),
            ("corrupt", 400),
            ("unsupported", 415),
            ("ai-unavailable", 503),
        ]:
            assert read(root, "image-" + name)["httpStatus"] == status
        assert read(root, "image-before-db") == read(root, "image-after-db")
        stale = read(root, "image-stale-hydrate-proof")
        assert ids[0] in [x["productId"] for x in stale["candidates"]["items"]]
        assert ids[0] not in [x["productId"] for x in stale["hydrated"]["items"]]
    assert set(manifest["checks"]) == required and len(manifest["checks"]) == len(
        required
    )
    assert read(root, "after-replay-db") == read(root, "after-cancel-db")
    for name, expected_ids in [
        ("baseline", ids),
        ("sold-out", ids),
        ("partial", ids),
        ("caught-up", ids),
        ("before-stale", ids),
        ("after-stale", ids),
        ("hidden-delete", [ids[1]]),
        ("after-tombstone-stale", [ids[1]]),
    ]:
        proof = read(root, name + "-proof")
        assert sorted(proof["faiss"]["ids"]) == sorted(expected_ids)
        assert (
            proof["faiss"]["count"] == len(expected_ids)
            and proof["faiss"]["dimension"] == 512
        )
    assert (
        read(root, "partial-proof")["hashes"]["products.faiss"]
        == read(root, "caught-up-proof")["hashes"]["products.faiss"]
    )
    assert read(root, "before-stale-proof") == read(root, "after-stale-proof")
    assert (
        read(root, "hidden-delete-proof")["hashes"]
        == read(root, "after-tombstone-stale-proof")["hashes"]
    )
    assert read(root, "hidden-delete-proof")["docs"][0]["found"] is False
    assert not read(root, "hidden-delete-search")["hydrated"]["items"]
    trace = read(root, "worker-ai-http-trace")
    retries = [
        r
        for r in trace
        if r["method"] == "POST"
        and (r.get("request") or {}).get("productId") == ids[0]
        and r["request"].get("version") == 3
    ]
    assert len(retries) == 3  # failed, retry success, then old UPSERT after DELETE
    assert (
        retries[0]["status"] == 503
        and retries[0]["response"]["outcome"] == "PARTIAL_FAILURE"
    )
    assert (
        retries[1]["status"] == 200
        and retries[1]["response"]["indexes"]["faiss"]["status"] == "ALREADY_APPLIED"
    )
    assert retries[0]["request"] == retries[1]["request"] == retries[2]["request"]
    assert retries[2]["response"]["outcome"] == "STALE"
    assert "EXIT_STATUS=0" in (root / "live-search.log").read_text()
    return {
        "status": "PASS",
        "sourceCommit": manifest["sourceCommit"],
        "checks": len(required),
        "verifiedHashes": count,
        "qualityEvaluation": False,
    }


if __name__ == "__main__":
    print(json.dumps(verify(Path(sys.argv[1])), ensure_ascii=False))
