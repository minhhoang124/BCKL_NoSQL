"""Bind applied migrations to SQL bytes in an immutable source commit."""

import hashlib
import re
import subprocess
import sys
from pathlib import Path

if sys.flags.optimize:
    raise RuntimeError("QA safety checks require Python without -O/PYTHONOPTIMIZE")


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def sql_at_commit(checkout, head):
    assert re.fullmatch(r"[0-9a-f]{40}", head), "Full source commit required"
    checkout = Path(checkout)
    paths = subprocess.check_output(
        ["git", "ls-tree", "-r", "--name-only", head, "--", "BE/prisma/migrations"],
        cwd=checkout,
        text=True,
    ).splitlines()
    result = {}
    for path in paths:
        parts = Path(path).parts
        if len(parts) == 5 and parts[-1] == "migration.sql":
            result[parts[-2]] = subprocess.check_output(
                ["git", "show", f"{head}:{path}"], cwd=checkout
            )
    assert result, "No SQL migrations in source commit"
    return result


def allowed_checksums(raw):
    # Git LF and a clean autocrlf checkout are equivalent SQL, not arbitrary edits.
    return {digest(raw), digest(raw.replace(b"\r\n", b"\n").replace(b"\n", b"\r\n"))}


def source_inventory(checkout, head):
    sql = sql_at_commit(checkout, head)
    folder = Path(checkout) / "BE/prisma/migrations"
    actual = {p.parent.name: p for p in folder.glob("*/migration.sql")}
    assert set(actual) == set(sql), "Working migration names differ from source commit"
    for name, raw in sql.items():
        assert not actual[name].is_symlink(), "Symlink SQL refused"
        assert digest(actual[name].read_bytes()) in allowed_checksums(raw), (
            "Working SQL differs from source commit: " + name
        )
    return [{"name": name, "sha256": digest(raw)} for name, raw in sorted(sql.items())]


def verify_migrations(proof, checkout, expected_head):
    assert proof["schemaVersion"] == 1
    assert proof["sourceCommit"] == expected_head, "Migration source commit mismatch"
    sql = sql_at_commit(checkout, expected_head)
    expected = [{"name": n, "sha256": digest(raw)} for n, raw in sorted(sql.items())]
    assert proof["expected"] == expected, "SQL inventory differs from source commit"
    applied = proof["applied"]
    assert len(applied) == len(sql), "Applied migration count mismatch"
    assert len({row["name"] for row in applied}) == len(applied), "Duplicate migration"
    assert {row["name"] for row in applied} == set(sql), (
        "Applied migration names mismatch"
    )
    for row in applied:
        assert row["finished"] is True and row["rolledBack"] is False, (
            "Unfinished or rolled-back migration"
        )
        assert row["checksum"] in allowed_checksums(sql[row["name"]]), (
            "Applied SQL checksum mismatch: " + row["name"]
        )
    return len(sql)
