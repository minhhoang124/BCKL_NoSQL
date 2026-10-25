"""Read-only verifier for Dat's exploratory decision; not publication v2."""
import contextlib
import copy
import hashlib
import importlib.util
import io
import json
from collections import Counter
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
PENDING = ROOT.parent / "2026-10-21-pending-57"
PILOT = ROOT.parent / "2026-10-20-seven-query"
DOCS = ROOT.parent.parent
COHORT = [f"TEXT-V1-{n:03}" for n in (1, 2, 4, 5, 6, 10, 11)]
NEW = {("TEXT-V1-012", 64): "abo:B00JZVPJD8",
       ("TEXT-V1-012", 65): "abo:B00JZVPKE6",
       ("TEXT-V1-012", 69): "abo:B00MJEYM5O"}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def derive(decision, baseline, review):
    assert decision["schemaVersion"] == 1
    assert decision["protocolId"] == "dat-ai-assisted-text-pilot-v1"
    assert decision["status"] == "DAT_AUTHORIZED_EXPLORATORY_ONLY"
    assert decision["decisionOwner"] == "Đạt"
    assert decision["annotationMethod"] == "AI_ASSISTED_DELEGATED_ADJUDICATION"
    for flag in ("independentDoubleAnnotation", "humanPerPairReviewClaimed",
                 "newHienApprovalClaimed", "groupConsensusClaimed",
                 "officialPublicationAllowed", "rerunRetrieval", "recomputedMetrics"):
        assert decision[flag] is False, flag
    assert decision["exploratoryMetricsAllowed"] is True
    assert decision["selectedQueryIds"] == COHORT
    assert decision["primaryRelevanceThreshold"] == 2
    assert decision["sensitivityRelevanceThreshold"] == 1
    assert decision["ks"] == [5, 10, 20]
    assert decision["systems"] == ["keyword", "semantic", "hybrid"]
    assert [decision[k] for k in ("totalPairs", "previousNumericLabelsPreserved",
                                 "numericLabelsAfterDecision", "unjudgedAfterDecision",
                                 "evaluatedPairs")] == [1032, 975, 978, 54, 602]
    accepted = decision["acceptedNewDecisions"]
    assert len(accepted) == 3
    keyed = {(r["queryId"], r["productId"]): r for r in accepted}
    assert len(keyed) == 3 and set(keyed) == set(NEW)
    proposed = {(r["queryId"], r["productId"]): r for r in review["rows"]}
    for key, row in keyed.items():
        source = proposed[key]
        assert type(row["productId"]) is int
        assert type(row["relevance"]) is int and row["relevance"] == 0
        assert source["proposedRelevance"] == row["relevance"]
        assert row["externalId"] == source["externalId"] == NEW[key]
        assert row["sourceRefs"] == source["sourceRefs"]
        assert source["hienConfirmed"] is False
        assert source["humanFinalConfirmation"] is False
    labels = []
    assert len(baseline) == 1032
    for prior in baseline:
        key = prior["queryId"], prior["productId"]
        assert type(prior["productId"]) is int
        old = prior["previousRelevance"]
        assert old is None or (type(old) is int and old in (0, 1, 2))
        row = dict(prior)
        row["relevance"] = old
        row["decisionStatus"] = "UNJUDGED" if old is None else "PRIOR_ACCEPTED"
        if key in keyed:
            assert old is None and prior["externalId"] == NEW[key]
            evidence = proposed[key]
            row.update(relevance=0, decisionStatus="DAT_ACCEPTED_AI_ASSISTED",
                       decisionOwner="Đạt", newHienConfirmation=False,
                       humanPerPairReviewClaimed=False,
                       annotationMethod=decision["annotationMethod"],
                       basis={k: evidence[k] for k in
                              ("sourceRefs", "evidence", "reviewFinding")})
        labels.append(row)
    validate_labels(labels, baseline)
    return labels


def validate_labels(labels, baseline):
    original = {(r["queryId"], r["productId"]): r for r in baseline}
    assert len(labels) == len(original) == 1032
    assert {(r["queryId"], r["productId"]) for r in labels} == set(original)
    pending = Counter()
    for row in labels:
        key = row["queryId"], row["productId"]
        prior = original[key]
        assert all(row.get(k) == v for k, v in prior.items()), key
        if key not in NEW:
            expected = dict(prior, relevance=prior["previousRelevance"],
                            decisionStatus="UNJUDGED" if prior["previousRelevance"] is None else "PRIOR_ACCEPTED")
            assert row == expected, key
        else:
            assert row["relevance"] == 0 and type(row["relevance"]) is int
            assert row["decisionStatus"] == "DAT_ACCEPTED_AI_ASSISTED"
            assert row["decisionOwner"] == "Đạt"
            assert row["newHienConfirmation"] is False
            assert row["humanPerPairReviewClaimed"] is False
        if row["relevance"] is None:
            pending[row["queryId"]] += 1
    assert pending == {"TEXT-V1-003": 7, "TEXT-V1-007": 21, "TEXT-V1-008": 1,
                       "TEXT-V1-009": 18, "TEXT-V1-012": 7}
    assert sum(r["relevance"] is not None for r in labels) == 978
    assert len({r["productId"] for r in labels}) == 86
    queries = {r["queryId"] for r in labels}
    assert len(queries) == 12
    assert all(sum(r["queryId"] == q for r in labels) == 86 for q in queries)
    assert sorted(queries - set(pending)) == COHORT


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    assert sys.flags.optimize == 0, "Do not disable assertions with -O"
    decision = json.loads((ROOT / "decision.json").read_text(encoding="utf-8"))
    inputs = {"baseline-labels.jsonl": PENDING / "baseline-labels.jsonl",
              "review.json": PENDING / "review.json",
              "protocol-proposal.md": PENDING / "protocol-proposal.snapshot.md",
              "evaluation-lock-v2.json": DOCS / "evaluation-lock-v2.json"}
    inputs.update({n: PILOT / n for n in
                   ("metrics-summary.csv", "metrics-per-query.csv", "provenance.json")})
    assert set(decision["inputSha256"]) == set(inputs)
    for name, path in inputs.items():
        assert digest(path) == decision["inputSha256"][name], name
    baseline = [json.loads(s) for s in inputs["baseline-labels.jsonl"].read_text(encoding="utf-8").splitlines()]
    review = json.loads(inputs["review.json"].read_text(encoding="utf-8"))
    labels = derive(decision, baseline, review)
    # These independently cross-check original labels, ranks and all 144 metric rows.
    with contextlib.redirect_stdout(io.StringIO()):
        load_module("pending_review", PENDING / "verify_review.py").main()
        load_module("pilot_review", PILOT / "verify_review_package.py").main()
    failures = 0
    for kind in ("old-label", "null-fill", "fake-hien", "independent", "cohort", "official",
                 "wrong-owner", "wrong-label", "wrong-evidence", "duplicate-decision"):
        bad_decision, bad_labels = copy.deepcopy(decision), copy.deepcopy(labels)
        if kind == "old-label":
            row = next(r for r in bad_labels if r["previousRelevance"] is not None)
            row["relevance"] = (row["relevance"] + 1) % 3
        elif kind == "null-fill":
            next(r for r in bad_labels if r["relevance"] is None)["relevance"] = 0
        elif kind == "fake-hien":
            next(r for r in bad_labels if r["decisionStatus"] == "DAT_ACCEPTED_AI_ASSISTED")["newHienConfirmation"] = True
        elif kind == "independent":
            bad_decision["independentDoubleAnnotation"] = True
        elif kind == "cohort":
            bad_decision["selectedQueryIds"].append("TEXT-V1-012")
        elif kind == "official":
            bad_decision["officialPublicationAllowed"] = True
        elif kind == "wrong-owner":
            bad_decision["decisionOwner"] = "Hiền"
        elif kind == "wrong-label":
            bad_decision["acceptedNewDecisions"][0]["relevance"] = 1
        elif kind == "wrong-evidence":
            bad_decision["acceptedNewDecisions"][0]["sourceRefs"] = ["S05"]
        else:
            bad_decision["acceptedNewDecisions"][1] = bad_decision["acceptedNewDecisions"][0]
        try:
            derive(bad_decision, baseline, review)
            validate_labels(bad_labels, baseline)
        except AssertionError:
            failures += 1
        else:
            raise AssertionError("Negative probe accepted: " + kind)
    canonical = "".join(json.dumps(r, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n" for r in labels)
    canonical_hash = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    assert canonical_hash == decision["canonicalLabelsSha256"], "Derived labels changed"
    if len(sys.argv) > 1:
        assert sys.argv[1:] == ["--labels"], "Only --labels is supported"
        # Text stdout may transcode Vietnamese or translate LF to CRLF on
        # Windows. The CLI contract is UTF-8/LF bytes regardless of codepage.
        sys.stdout.buffer.write(canonical.encode("utf-8"))
        sys.stdout.buffer.flush()
    else:
        print(json.dumps({"status": "PASS", "protocolId": decision["protocolId"],
                          "pairs": len(labels), "oldLabelsPreserved": 975,
                          "newDatAcceptedLabels": 3, "numeric": 978, "unjudged": 54,
                          "completeQueries": COHORT, "metricRowsRechecked": 144,
                          "canonicalLabelsSha256": canonical_hash,
                          "negativeProbesRejected": failures,
                          "officialPublicationAllowed": False}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
