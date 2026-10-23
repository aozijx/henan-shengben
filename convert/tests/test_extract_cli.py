import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from convert.extract_cli import extract_registered_year


class ExtractRegisteredYearTests(unittest.TestCase):
    def test_new_year_output_is_created_only_when_write_is_enabled(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            entry = {'year': 2027, 'parser': 'plans', 'outputPath': '招生计划/招生计划_2027.json',
                     'pdfPaths': ['plan.pdf']}
            registry = {'sources': [entry]}
            output = root / entry['outputPath']
            extracted = [{'专业代号': '51', '计划人数': 10}]
            with patch('convert.extract_cli.extract_entry', return_value=extracted):
                dry_run = extract_registered_year(registry, root, 2027, write=False)
                self.assertEqual(dry_run[0]['rowCount'], 1)
                self.assertTrue(dry_run[0]['diffs'])
                self.assertFalse(output.exists())

                written = extract_registered_year(registry, root, 2027, write=True)
                self.assertEqual(written[0]['rowCount'], 1)
                self.assertEqual(json.loads(output.read_text(encoding='utf-8')), extracted)

    def test_existing_year_dry_run_reports_diff_without_mutating_json(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            entry = {'year': 2026, 'parser': 'scorelines', 'outputPath': '省控线/省控线_2026.json'}
            output = root / entry['outputPath']
            output.parent.mkdir(parents=True)
            original = [{'专业代号': '51', '专业名称': '旧名称', '分数线': 180}]
            output.write_text(json.dumps(original, ensure_ascii=False), encoding='utf-8')
            extracted = [{'专业代号': '51', '专业名称': '新名称', '分数线': 180}]
            with patch('convert.extract_cli.extract_entry', return_value=extracted):
                result = extract_registered_year({'sources': [entry]}, root, 2026, write=False)
            self.assertTrue(result[0]['diffs'])
            self.assertEqual(json.loads(output.read_text(encoding='utf-8')), original)

    def test_year_filter_ignores_other_years_and_expected_count_is_optional(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            registry = {'sources': [
                {'year': 2026, 'parser': 'plans', 'outputPath': '2026.json'},
                {'year': 2027, 'parser': 'plans', 'outputPath': '2027.json', 'expectedCount': 2},
            ]}
            extracted = [{'row': 1}]
            with patch('convert.extract_cli.extract_entry', return_value=extracted) as extract:
                results = extract_registered_year(registry, root, 2027, write=False)
            self.assertEqual(extract.call_count, 1)
            self.assertEqual(results[0]['outputPath'], '2027.json')
            self.assertTrue(results[0]['expectedCountMismatch'])
            registry['sources'][1].pop('expectedCount')
            with patch('convert.extract_cli.extract_entry', return_value=extracted):
                optional = extract_registered_year(registry, root, 2027, write=False)
            self.assertFalse(optional[0]['expectedCountMismatch'])


if __name__ == '__main__':
    unittest.main()
