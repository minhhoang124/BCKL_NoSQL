"""Verify this preliminary review snapshot, not the official publication gate.

Standard library only. Reads existing files; never edits labels or locks and
never sets exhaustive/consensus. External corpus/model/index are not bundled.
"""

import csv
import hashlib
import itertools
import json
import math
from pathlib import Path, PurePosixPath
import statistics
import xml.etree.ElementTree as ET
from zipfile import ZipFile


ROOT = Path(__file__).resolve().parent
NS = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
QUERIES = [f"TEXT-V1-{n:03}" for n in (1, 2, 4, 5, 6, 10, 11)]
SYSTEMS = ("keyword", "semantic", "hybrid")
KS = (5, 10, 20)


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_xlsx(path):
    """Read cached scalar values; do not claim a new native Excel recalculation."""
    with ZipFile(path) as archive:
        assert archive.testzip() is None, "Corrupt XLSX"
        shared = []
        if "xl/sharedStrings.xml" in archive.namelist():
            root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
            shared = [
                "".join(t.text or "" for t in si.findall(".//s:t", NS))
                for si in root.findall("s:si", NS)
            ]
        rels = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
        targets = {rel.get("Id"): rel.get("Target") for rel in rels}
        workbook = ET.fromstring(archive.read("xl/workbook.xml"))
        sheets = {}
        for sheet in workbook.findall("s:sheets/s:sheet", NS):
            target = targets[sheet.get(f"{{{REL_NS}}}id")]
            location = target.lstrip("/") if target.startswith("/") else f"xl/{target}"
            assert ".." not in PurePosixPath(location).parts
            cells = {}
            xml = ET.fromstring(archive.read(location))
            for cell in xml.findall("s:sheetData/s:row/s:c", NS):
                typ = cell.get("t")
                value = cell.find("s:v", NS)
                assert typ != "e", f"Formula error at {sheet.get('name')}!{cell.get('r')}"
                if typ == "inlineStr":
                    result = "".join(t.text or "" for t in cell.findall(".//s:t", NS))
                elif value is None or value.text is None:
                    result = None
                elif typ == "s":
                    result = shared[int(value.text)]
                elif typ in ("str", "d"):
                    result = value.text
                elif typ == "b":
                    result = value.text == "1"
                else:
                    result = float(value.text)
                    if result.is_integer():
                        result = int(result)
                cells[cell.get("r")] = result
            sheets[sheet.get("name")] = cells
        return sheets


def equal(actual, expected):
    if expected is None:
        return actual in (None, "", "n.a.")
    return math.isclose(float(actual), expected, rel_tol=0, abs_tol=1e-12)


def main():
    for line in (ROOT / "SHA256SUMS").read_text(encoding="utf-8").splitlines():
        expected, name = line.split(None, 1)
        target = (ROOT / name).resolve()
        assert target.parent == ROOT, "Unexpected checksum path"
        assert sha256(target) == expected, f"Hash mismatch: {name}"
    provenance = json.loads((ROOT / "provenance.json").read_text(encoding="utf-8"))
    assert provenance["status"] == "PRELIMINARY_INTERNAL_REVIEW_ONLY"
    assert provenance["eligibleForOfficialPublication"] is False
    assert provenance["officialPublicationGateExecuted"] is False
    assert provenance["officialPublicationLockChanged"] is False
    assert provenance["independentDoubleAnnotation"] is False
    assert sha256(ROOT / "results.xlsx") == provenance["sharedWorkbookSha256"]
    book = read_xlsx(ROOT / "results.xlsx")
    labels = {}
    mapping = {}
    for r in range(2, 1034):
        row = book["Nhãn"]
        key, qid, pid = row[f"A{r}"], row[f"B{r}"], row[f"D{r}"]
        eid, label = row[f"E{r}"], row.get(f"G{r}")
        assert key == f"{qid}|{pid}" and key not in labels
        assert type(pid) is int and pid > 0
        assert label is None or (type(label) is int and label in (0, 1, 2))
        labels[key] = label
        assert pid not in mapping or mapping[pid] == eid
        mapping[pid] = eid
    assert len(labels) == 1032 and len(mapping) == len(set(mapping.values())) == 86
    assert sum(x is None for x in labels.values()) == 57
    assert sum(x is not None for x in labels.values()) == 975
    all_queries = sorted({key.split("|")[0] for key in labels})
    assert len(all_queries) == 12
    by_query = {
        q: {pid: labels[f"{q}|{pid}"] for pid in mapping}
        for q in all_queries
    }
    complete = [q for q in all_queries if all(v is not None for v in by_query[q].values())]
    assert complete == QUERIES == provenance["selectedQueryIds"]
    runs = {(q, system): [] for q, system in itertools.product(QUERIES, SYSTEMS)}
    for r in range(2, 375):
        row = book["Xếp hạng"]
        key, qid, system = row[f"A{r}"], row[f"B{r}"], row[f"C{r}"]
        rank, pid, score = row[f"D{r}"], row[f"E{r}"], row[f"F{r}"]
        assert (qid, system) in runs and key == f"{qid}|{pid}"
        assert row[f"G{r}"] == labels[key] and labels[key] is not None
        assert type(rank) is int and math.isfinite(score)
        runs[(qid, system)].append((rank, pid))
    for hits in runs.values():
        assert len(hits) <= 20
        assert [x[0] for x in hits] == list(range(1, len(hits) + 1))
        assert len({x[1] for x in hits}) == len(hits)
    expected_detail = {}
    for threshold, qid, system, k in itertools.product((2, 1), QUERIES, SYSTEMS, KS):
        relevant = {pid for pid, label in by_query[qid].items() if label >= threshold}
        returned = {pid for rank, pid in runs[(qid, system)] if rank <= k}
        count = len(returned & relevant)
        expected_detail[(threshold, qid, system, k)] = {
            "returnedAtK": len(returned),
            "relevantInCorpus": len(relevant),
            "hitsAtK": count,
            "precision": count / k,
            "recall": count / len(relevant) if relevant else None,
        }
    with (ROOT / "metrics-per-query.csv").open(encoding="utf-8-sig", newline="") as stream:
        detail = list(csv.DictReader(stream))
    assert len(detail) == 126
    seen = set()
    for i, row in enumerate(detail, 2):
        key = (int(row["threshold"]), row["queryId"], row["system"], int(row["k"]))
        assert key not in seen
        seen.add(key)
        expected = expected_detail[key]
        for field, value in expected.items():
            assert equal(row[field], value), (key, field)
        cached = book["Chi tiết"]
        assert [cached[f"{c}{i}"] for c in "ABCD"] == list(key)
        assert [cached[f"{c}{i}"] for c in "EFG"] == [
            expected["returnedAtK"], expected["relevantInCorpus"], expected["hitsAtK"]
        ]
        assert equal(cached[f"H{i}"], expected["precision"])
        assert equal(cached[f"I{i}"], expected["recall"])
        assert cached[f"J{i}"] == 86
    assert seen == set(expected_detail)
    with (ROOT / "metrics-summary.csv").open(encoding="utf-8-sig", newline="") as stream:
        summary = list(csv.DictReader(stream))
    assert len(summary) == 18
    seen = set()
    for i, row in enumerate(summary, 6):
        threshold, system, k = int(row["threshold"]), row["system"], int(row["k"])
        assert (threshold, system, k) not in seen
        seen.add((threshold, system, k))
        values = [expected_detail[(threshold, q, system, k)] for q in QUERIES]
        recalls = [v["recall"] for v in values if v["recall"] is not None]
        p = statistics.mean(v["precision"] for v in values)
        recall = statistics.mean(recalls) if recalls else None
        assert equal(row["precision"], p) and equal(row["recall"], recall)
        counts = [7, len(recalls), sum(v["returnedAtK"] < k for v in values)]
        assert [int(row[c]) for c in ("queryCount", "recallQueryCount", "shortReturnQueryCount")] == counts
        cached = book["Kết quả"]
        assert [cached[f"{c}{i}"] for c in "ABC"] == [threshold, system, k]
        assert equal(cached[f"D{i}"], p) and equal(cached[f"E{i}"], recall)
        assert [cached[f"{c}{i}"] for c in "FGH"] == counts
    assert seen == set(itertools.product((2, 1), SYSTEMS, KS))
    print(json.dumps({
        "reviewPackage": "PASS",
        "cachedXlsxChecked": True,
        "numericLabels": 975,
        "unjudgedPreserved": 57,
        "queryCount": 7,
        "rankLabelJoins": 373,
        "perQueryMetricRows": 126,
        "macroRows": 18,
        "externalRawArtifactsRechecked": False,
        "officialPublicationGateExecuted": False,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
