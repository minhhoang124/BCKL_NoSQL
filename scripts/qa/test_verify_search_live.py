import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from verify_search_live import verify_hashes


class HashGuardTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / "sample.json").write_bytes(b"{}\n")
        self.digest = hashlib.sha256(b"{}\n").hexdigest()
        self.manifest({"sample.json": self.digest})

    def manifest(self, value):
        (self.root / "SHA256SUMS.json").write_text(json.dumps(value))

    def test_valid_bytes(self):
        self.assertEqual(verify_hashes(self.root), 1)

    def test_portable_nested_posix_paths(self):
        (self.root / "runtime").mkdir()
        (self.root / "runtime" / "nested.json").write_bytes(b"{}\n")
        self.manifest({"sample.json": self.digest, "runtime/nested.json": self.digest})
        self.assertEqual(verify_hashes(self.root), 2)

    def test_portable_manifest_rejects_backslash(self):
        (self.root / "runtime").mkdir()
        (self.root / "runtime" / "nested.json").write_bytes(b"{}\n")
        self.manifest({"sample.json": self.digest, "runtime\\nested.json": self.digest})
        with self.assertRaises(AssertionError):
            verify_hashes(self.root)

    def test_changed_bytes_fail(self):
        (self.root / "sample.json").write_text('{"changed":true}\n')
        with self.assertRaises(AssertionError):
            verify_hashes(self.root)

    def test_unlisted_file_fails(self):
        (self.root / "extra.json").write_text("{}")
        with self.assertRaises(AssertionError):
            verify_hashes(self.root)

    def test_missing_file_fails(self):
        self.manifest({"missing.json": self.digest})
        with self.assertRaises(AssertionError):
            verify_hashes(self.root)

    def test_traversal_fails(self):
        self.manifest({"../sample.json": self.digest})
        with self.assertRaises(AssertionError):
            verify_hashes(self.root)

    def test_symlink_fails(self):
        (self.root / "linked.json").symlink_to(self.root / "sample.json")
        self.manifest({"sample.json": self.digest, "linked.json": self.digest})
        with self.assertRaises(AssertionError):
            verify_hashes(self.root)

    def test_empty_manifest_fails(self):
        self.manifest({})
        with self.assertRaises(AssertionError):
            verify_hashes(self.root)


if __name__ == "__main__":
    unittest.main()
