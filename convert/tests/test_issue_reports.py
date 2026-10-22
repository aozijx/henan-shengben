import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from convert.issue_reports import apply_manual_correction, build_issue_report, ensure_manual_corrections
from convert.pdf_tables import RawPdfRow


class IssueReportTest(unittest.TestCase):
    def extraction(self):
        return {
            "year": 2026,
            "majors": [{
                "majorCode": "53",
                "majorName": "网络工程",
                "sourcePdf": "一分一段/原始PDF/2026/53_网络工程.pdf",
                "sourceSha256": "a" * 64,
                "status": "needs-review",
                "segments": [],
                "issues": [{"code": "non-monotonic-count", "pageNumber": None, "message": "累计人数回退", "cells": []}],
            }],
        }

    @patch("convert.issue_reports.extract_rows")
    def test_report_contains_traceability_raw_rows_and_suspicious_context(self, extract):
        extract.return_value = [
            RawPdfRow(1, ("240", "10", "200", "50")),
            RawPdfRow(1, ("239", "11", "805", "12")),
        ]
        report = build_issue_report(self.extraction(), Path("data"), {"53": 100})
        issue = report["issues"][0]
        self.assertEqual("2026-53", issue["issueId"])
        self.assertEqual(100, issue["officialControlScore"])
        self.assertEqual("一分一段/原始PDF/2026/53_网络工程.pdf", issue["sourcePdf"])
        self.assertEqual("a" * 64, issue["sourceSha256"])
        self.assertEqual(2, len(issue["rawRows"]))
        self.assertTrue(issue["suspiciousRows"])
        self.assertIn("score-out-of-range", issue["suspiciousRows"][0]["reasons"])
        self.assertEqual(2, len(issue["suspiciousRows"][0]["contextRows"]))

    def test_manual_correction_file_is_created_once_and_never_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "人工修正.json"
            report = {"issues": [{"issueId": "2026-53", "year": 2026, "majorCode": "53", "majorName": "网络工程"}]}
            ensure_manual_corrections(path, [report])
            created = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual("pending", created["corrections"][0]["status"])
            path.write_text('{"schemaVersion":1,"corrections":[{"issueId":"kept"}]}\n', encoding="utf-8")
            ensure_manual_corrections(path, [report])
            self.assertEqual("kept", json.loads(path.read_text(encoding="utf-8"))["corrections"][0]["issueId"])

    def test_confirmed_cell_override_changes_only_the_named_cell(self):
        rows = [RawPdfRow(2, ("107", "1232", "805", "2192"))]
        correction = {
            "status": "confirmed",
            "cellOverrides": [{"pageNumber": 2, "rowIndex": 0, "columnIndex": 2, "value": "80"}],
            "replacementSegments": [],
        }
        corrected, replacement = apply_manual_correction(rows, correction)
        self.assertIsNone(replacement)
        self.assertEqual(("107", "1232", "80", "2192"), corrected[0].cells)

    def test_pending_correction_is_not_applied(self):
        rows = [RawPdfRow(1, ("200", "1"))]
        corrected, replacement = apply_manual_correction(rows, {"status": "pending"})
        self.assertEqual(rows, corrected)
        self.assertIsNone(replacement)


if __name__ == "__main__":
    unittest.main()
