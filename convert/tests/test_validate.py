import hashlib
import tempfile
import unittest
from pathlib import Path

from convert.validate import validate_score_segment_year


class ScoreSegmentValidationTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        source = self.root / "01.pdf"
        source.write_bytes(b"%PDF-test")
        self.sha = hashlib.sha256(source.read_bytes()).hexdigest()

    def tearDown(self):
        self.temp.cleanup()

    def document(self):
        return {
            "schemaVersion": 1,
            "year": 2026,
            "majors": [{
                "majorCode": "01", "majorName": "经济学", "controlScore": 114,
                "sourceId": "official-2026-01", "sourcePdf": "01.pdf", "sourceSha256": self.sha,
                "segments": [{"score": 232, "cumulativeCount": 1}, {"score": 114, "cumulativeCount": 45}],
            }],
        }

    def test_accepts_traceable_monotonic_document(self):
        report = validate_score_segment_year(self.document(), self.root)
        self.assertTrue(report.valid, report.errors)

    def test_rejects_duplicate_major_empty_segments_and_bad_order(self):
        document = self.document()
        duplicate = dict(document["majors"][0])
        duplicate["segments"] = []
        document["majors"].append(duplicate)
        report = validate_score_segment_year(document, self.root)
        self.assertFalse(report.valid)
        self.assertIn("duplicate-major-code", {error.code for error in report.errors})
        self.assertIn("empty-segments", {error.code for error in report.errors})

    def test_rejects_missing_or_hash_mismatched_source(self):
        document = self.document()
        document["majors"][0]["sourceSha256"] = "0" * 64
        report = validate_score_segment_year(document, self.root)
        self.assertIn("source-hash-mismatch", {error.code for error in report.errors})

    def test_rejects_non_decreasing_scores_and_decreasing_counts(self):
        document = self.document()
        document["majors"][0]["segments"] = [
            {"score": 200, "cumulativeCount": 10},
            {"score": 201, "cumulativeCount": 9},
        ]
        report = validate_score_segment_year(document, self.root)
        codes = {error.code for error in report.errors}
        self.assertIn("score-not-descending", codes)
        self.assertIn("count-not-monotonic", codes)


if __name__ == "__main__":
    unittest.main()
