"""Verify AI proposals and preservation; never finalize labels or run metrics."""
import csv
import hashlib
import importlib.util
import json
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PREVIOUS = ROOT.parent / "2026-10-20-seven-query"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def validate_records(review, baseline, old):
    by_key = {(r["queryId"], r["productId"]): r for r in baseline}
    assert len(by_key) == len(baseline) == 1032
    assert set(by_key) == set(old)
    for key, row in by_key.items():
        assert row["previousRelevance"] == old[key], ("old label changed", key)
        assert type(row["productId"]) is int and row["productId"] > 0
    assert sum(type(r["previousRelevance"]) is int for r in baseline) == 975
    per_query = defaultdict(set)
    for qid, pid in by_key:
        per_query[qid].add(pid)
    assert len(per_query) == 12
    assert all(len(ids) == 86 for ids in per_query.values())
    assert len({tuple(sorted(ids)) for ids in per_query.values()}) == 1
    pending = {key for key, row in by_key.items() if row["previousRelevance"] is None}
    rows = review["rows"]
    assert len(rows) == 57
    assert {(r["queryId"], r["productId"]) for r in rows} == pending
    source_ids = {s["id"] for s in review["sources"]}
    numeric = {}
    for row in rows:
        key = row["queryId"], row["productId"]
        assert row["externalId"] == by_key[key]["externalId"]
        assert row["name"] == by_key[key]["name"]
        assert row["previousRelevance"] is None
        label = row["proposedRelevance"]
        assert label is None or (type(label) is int and label in (0, 1, 2))
        assert row["method"] == "AI-assisted evidence review"
        assert row["hienConfirmed"] is False
        assert row["humanFinalConfirmation"] is False
        assert row["evidence"] and row["reviewFinding"]
        assert row["sourceRefs"] and set(row["sourceRefs"]) <= source_ids
        assert row["catalogIdentity"]
        for identity in row["catalogIdentity"]:
            assert "abo:" + identity["asin"] == row["externalId"]
        if label is None:
            assert row["status"] == "UNJUDGED" and row["missingEvidence"]
        else:
            assert row["status"] == "AI_PROPOSAL"
            assert not row["missingEvidence"]
            numeric[key] = label
    assert numeric == {("TEXT-V1-012", 64): 0, ("TEXT-V1-012", 65): 0, ("TEXT-V1-012", 69): 0}
    assert review["status"] == "AI_ASSISTED_REVIEW_NOT_FINAL_CONSENSUS"
    for flag in ("independentAnnotation", "officialPublicationGateChanged", "retrievalRerun", "metricsRecomputed"):
        assert review[flag] is False
    assert review["previousLabelsChanged"] == review["hienApprovalsCreated"] == 0
    assert review["newNumericProposals"] == 3
    assert review["remainingUnjudgedAfterProposals"] == 54
    return by_key, numeric


def main():
    spec = importlib.util.spec_from_file_location("prior_package", PREVIOUS / "verify_review_package.py")
    reader = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(reader)
    review = json.loads((ROOT / "review.json").read_text(encoding="utf-8"))
    baseline = [json.loads(line) for line in (ROOT / "baseline-labels.jsonl").read_text(encoding="utf-8").splitlines()]
    source = reader.read_xlsx(PREVIOUS / "results.xlsx")["Nhãn"]
    old = {(source[f"B{n}"], source[f"D{n}"]): source.get(f"G{n}") for n in range(2, 1034)}
    by_key, proposed = validate_records(review, baseline, old)
    assert digest(PREVIOUS / "results.xlsx") == review["sourceSnapshotSha256"]
    protocol = ROOT / "protocol-proposal.snapshot.md"
    assert digest(protocol) == review["protocolProposalSha256"]
    csv_rows = list(csv.DictReader((ROOT / "review.csv").open(encoding="utf-8", newline="")))
    assert len(csv_rows) == 57
    assert [(r["queryId"], int(r["productId"])) for r in csv_rows] == [(r["queryId"], r["productId"]) for r in review["rows"]]
    for csv_row, row in zip(csv_rows, review["rows"]):
        assert csv_row["proposedRelevance"] == ("" if row["proposedRelevance"] is None else str(row["proposedRelevance"]))
        assert csv_row["externalId"] == row["externalId"]
        assert csv_row["evidence"] == row["evidence"]
    workbook = reader.read_xlsx(ROOT / "ground-truth-57-cap-AI-ra-soat-2026-10-21.xlsx")
    labels = workbook["Nhãn gốc 1032"]
    for n, row in enumerate(baseline, 2):
        key = row["queryId"], row["productId"]
        assert (labels[f"A{n}"], labels[f"B{n}"]) == key
        assert labels.get(f"E{n}") == old[key]
        assert labels.get(f"G{n}") == proposed.get(key)
        expected = old[key] if old[key] is not None else proposed.get(key)
        actual = labels.get(f"H{n}")
        assert actual == expected or (expected is None and actual == "")
    detail = workbook["Rà 57 cặp"]
    assert [detail[f"B{n}"] for n in (4, 5, 6, 7, 8)] == [975, 57, 3, 54, 0]
    for n, row in enumerate(review["rows"], 13):
        assert (detail[f"A{n}"], detail[f"B{n}"]) == (row["queryId"], row["productId"])
        assert detail.get(f"E{n}") == row["proposedRelevance"]
        assert detail[f"K{n}"] == "Không"
    hashes = (ROOT / "SHA256SUMS").read_text(encoding="utf-8").splitlines()
    assert len(hashes) == 6
    for line in hashes:
        checksum, name = line.split("  ", 1)
        assert Path(name).name == name
        assert digest(ROOT / name) == checksum, name
    # Negative probes: the verifier must reject a changed old label, blank->0,
    # or an invented Hien approval. This does not judge product relevance.
    import copy
    negatives = 0
    for kind in ("old-label", "blank-to-zero", "fake-approval"):
        bad_review, bad_baseline = copy.deepcopy(review), copy.deepcopy(baseline)
        if kind == "old-label":
            row = next(r for r in bad_baseline if r["previousRelevance"] is not None)
            row["previousRelevance"] = (row["previousRelevance"] + 1) % 3
        elif kind == "blank-to-zero":
            row = next(r for r in bad_review["rows"] if r["proposedRelevance"] is None)
            row["proposedRelevance"] = 0
        else:
            bad_review["rows"][0]["hienConfirmed"] = True
        try:
            validate_records(bad_review, bad_baseline, old)
        except AssertionError:
            negatives += 1
        else:
            raise AssertionError("Negative probe accepted: " + kind)
    print(json.dumps({"status": "PASS", "previousLabelsPreserved": 975, "pairs": len(by_key), "pendingReviewed": 57, "newAIProposals": len(proposed), "stillUnjudged": 54, "queryCounts": dict(Counter(r["queryId"] for r in review["rows"] if r["proposedRelevance"] is None)), "packageHashes": len(hashes), "negativeProbesRejected": negatives, "officialGateExecuted": False}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
