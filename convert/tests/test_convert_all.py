import json
import tempfile
import unittest
from pathlib import Path
from contextlib import redirect_stdout
from io import StringIO
from unittest.mock import patch

from convert.convert_all import convert_target
from convert.segment_store import merge_year


class ConvertAllTest(unittest.TestCase):
    def test_empty_manifest_writes_a_complete_conversion_document(self):
        with tempfile.TemporaryDirectory() as directory:
            data_root = Path(directory)
            (data_root / "manifest.json").write_text('{"entries": []}', encoding="utf-8")
            target = {
                "year": 2026,
                "dataset": "score-segments",
                "manifestPath": "manifest.json",
                "normalizedPath": "一分一段/一分一段_2026.json",
            }

            result = convert_target(target, data_root)

            self.assertEqual({"total": 0, "ok": 0, "needsReview": 0}, result["summary"])
            persisted = merge_year(data_root / "一分一段/一分一段_2026.json", data_root)
            self.assertEqual(result, persisted)

    def test_retry_only_reviewed_major_and_show_name_and_issue(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'manifest.json').write_text(json.dumps({'entries': [
                {'majorCode': '51', 'majorName': '计算机', 'localPath': '51.pdf'},
                {'majorCode': '53', 'majorName': '网络工程', 'localPath': '53.pdf'}]}), encoding='utf-8')
            target = {'year': 2027, 'dataset': 'score-segments', 'manifestPath': 'manifest.json',
                      'normalizedPath': '一分一段/一分一段_2027.json'}
            results = iter([
                {'majorCode': '51', 'majorName': '计算机', 'status': 'ok', 'segments': [1], 'issues': []},
                {'majorCode': '53', 'majorName': '网络工程', 'status': 'needs-review', 'segments': [],
                 'issues': [{'code': 'non-monotonic-count', 'message': '累计人数回退'}]},
                {'majorCode': '53', 'majorName': '网络工程', 'status': 'ok', 'segments': [2], 'issues': []}])
            with patch('convert.convert_all._convert_entry', side_effect=lambda item: next(results)) as convert:
                convert_target(target, root, workers=1)
                output = StringIO()
                with redirect_stdout(output):
                    result = convert_target(target, root, retry_review=True, workers=1)
            self.assertEqual(3, convert.call_count)
            self.assertEqual(2, result['summary']['ok'])
            self.assertIn('53 网络工程', output.getvalue())
            self.assertEqual(result, merge_year(root / target['normalizedPath'], root))

    def test_default_progress_hides_success_lines_and_verbose_shows_them(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'manifest.json').write_text(json.dumps({'entries': [
                {'majorCode': '51', 'majorName': '计算机', 'localPath': '51.pdf'}]}), encoding='utf-8')
            target = {'year': 2027, 'dataset': 'score-segments', 'manifestPath': 'manifest.json',
                      'normalizedPath': '一分一段/一分一段_2027.json'}
            with patch('convert.convert_all._convert_entry', return_value={
                    'majorCode': '51', 'majorName': '计算机', 'status': 'ok', 'segments': [1], 'issues': []}):
                default_output = StringIO()
                with redirect_stdout(default_output):
                    convert_target(target, root, workers=1)
                verbose_output = StringIO()
                with redirect_stdout(verbose_output):
                    convert_target(target, root, workers=1, verbose=True)
            self.assertNotIn('完成 1/1 51 计算机', default_output.getvalue())
            self.assertIn('1/1 ok', default_output.getvalue())
            self.assertIn('完成 1/1 51 计算机', verbose_output.getvalue())


if __name__ == "__main__":
    unittest.main()
