import json
import hashlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from convert.issue_reports import _issue_detail, generate_reports
from convert.manual_corrections import apply_manual_correction, ensure_manual_corrections
from convert.pdf_tables import RawPdfRow
from convert.segment_store import merge_year, write_year


class IssueReportTest(unittest.TestCase):
    def test_confirmed_correction_writes_only_final_normalized_shard(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            pdf = root / '01.pdf'
            pdf.write_bytes(b'fixture pdf')
            source_hash = hashlib.sha256(pdf.read_bytes()).hexdigest()
            manifest = {'entries': [{'majorCode': '01', 'majorName': '经济学',
                                     'localPath': '01.pdf', 'sha256': source_hash}]}
            (root / 'manifest.json').write_text(json.dumps(manifest), encoding='utf-8')
            (root / 'scorelines.json').write_text(json.dumps([{
                '专业代号': '01', '专业名称': '经济学', '分数线': 100,
            }]), encoding='utf-8')
            (root / 'plans.json').write_text('[]', encoding='utf-8')
            correction_path = root / '一分一段/人工修正.json'
            correction_path.parent.mkdir(parents=True)
            correction_path.write_text(json.dumps({'corrections': [{
                'year': 2027, 'majorCode': '01', 'status': 'confirmed',
                'replacementSegments': [{'score': 101, 'cumulativeCount': 1},
                                        {'score': 100, 'cumulativeCount': 2}],
            }]}), encoding='utf-8')
            target = {'year': 2027, 'dataset': 'score-segments', 'manifestPath': 'manifest.json',
                      'normalizedPath': '一分一段/一分一段_2027.json',
                      'conversionReportPath': 'reports/转换报告_2027.json'}
            plan = {'sources': [
                {'year': 2027, 'parser': 'scorelines', 'outputPath': 'scorelines.json'},
                {'year': 2027, 'parser': 'plans', 'outputPath': 'plans.json'},
            ], 'targets': [target]}
            index_path = root / target['normalizedPath']
            write_year(index_path, root, {'year': 2027, 'dataset': 'score-segments',
                'sourceManifest': 'manifest.json', 'majors': [{
                    'majorCode': '01', 'majorName': '经济学', 'sourcePdf': '01.pdf',
                    'sourceSha256': source_hash, 'status': 'needs-review', 'issues': [],
                    'segments': [],
                }]})
            stale_report = root / 'reports/异常数据_2027.json'
            stale_report.parent.mkdir(parents=True, exist_ok=True)
            stale_report.write_text('{"issueCount":0,"issues":[]}', encoding='utf-8')
            with patch('convert.issue_reports.build_data_plan', return_value=plan), \
                 patch('convert.issue_reports.extract_rows', return_value=[]), \
                 patch('convert.normalize.write_year', wraps=write_year) as write:
                reports = generate_reports(root, {2027})
            self.assertEqual(1, write.call_count)
            self.assertEqual(0, reports[0]['issueCount'])
            self.assertFalse((root / 'reports/异常数据_2027.json').exists())
            major = merge_year(index_path, root)['majors'][0]
            self.assertEqual('ok', major['status'])
            self.assertEqual(100, major['controlScore'])

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

    def test_default_report_is_compact_but_keeps_traceability_and_suspicious_context(self):
        rows = [
            RawPdfRow(1, ("240", "10", "200", "50")),
            RawPdfRow(1, ("239", "11", "805", "12")),
        ]
        issue = _issue_detail(self.extraction()["majors"][0], rows, Path("data"),
                              {"53": 100}, {}, full_report=False, year=2026)
        self.assertEqual("2026-53", issue["issueId"])
        self.assertEqual(100, issue["officialControlScore"])
        self.assertEqual("一分一段/原始PDF/2026/53_网络工程.pdf", issue["sourcePdf"])
        self.assertEqual("a" * 64, issue["sourceSha256"])
        self.assertNotIn("rawRows", issue)
        self.assertTrue(issue["suspiciousRows"])
        self.assertIn("score-out-of-range", issue["suspiciousRows"][0]["reasons"])
        self.assertEqual(2, len(issue["suspiciousRows"][0]["contextRows"]))

    def test_full_report_includes_full_ocr_rows(self):
        rows = [RawPdfRow(1, ('239', '11', '805', '12'))]
        issue = _issue_detail(self.extraction()["majors"][0], rows, Path('data'),
                              {'53': 100}, {}, full_report=True, year=2026)
        self.assertEqual(1, len(issue['rawRows']))
        self.assertEqual(['239', '11', '805', '12'], issue['suspiciousRows'][0]['cells'])

    def test_manual_correction_file_is_created_once_and_never_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "人工修正.json"
            self.assertFalse(ensure_manual_corrections(path, [{"issues": []}]))
            self.assertFalse(path.exists())
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
