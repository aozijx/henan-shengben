import json
import tempfile
import unittest
from pathlib import Path

from convert.convert_all import convert_target


class ConvertAllTest(unittest.TestCase):
    def test_empty_manifest_writes_a_complete_conversion_document(self):
        with tempfile.TemporaryDirectory() as directory:
            data_root = Path(directory)
            (data_root / "manifest.json").write_text('{"entries": []}', encoding="utf-8")
            target = {
                "year": 2026,
                "dataset": "score-segments",
                "manifestPath": "manifest.json",
                "extractionPath": "output/extraction.json",
            }

            result = convert_target(target, data_root)

            self.assertEqual({"total": 0, "ok": 0, "needsReview": 0}, result["summary"])
            persisted = json.loads((data_root / "output/extraction.json").read_text(encoding="utf-8"))
            self.assertEqual(result, persisted)


if __name__ == "__main__":
    unittest.main()
