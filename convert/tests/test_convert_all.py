import json
import hashlib
import os
import tempfile
import unittest
from pathlib import Path
from contextlib import redirect_stdout
from io import StringIO
from unittest.mock import patch

from convert.convert_all import _convert_entry, convert_target, main as convert_all_main
from convert.normalize import normalize_target
from convert.segment_store import merge_year


class ConvertAllTest(unittest.TestCase):
    def test_batch_skips_years_without_scoreline_and_plan_outputs(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            targets = [
                {'year': 2023, 'dataset': 'score-segments', 'manifestPath': 'manifest-2023.json'},
                {'year': 2024, 'dataset': 'score-segments', 'manifestPath': 'manifest-2024.json'},
            ]
            sources = []
            for year in (2023, 2024):
                for parser, folder in (('scorelines', '省控线'), ('plans', '招生计划')):
                    relative = f'{folder}/{parser}_{year}.json'
                    sources.append({'year': year, 'parser': parser, 'outputPath': relative})
                    if year == 2024:
                        path = root / relative
                        path.parent.mkdir(parents=True, exist_ok=True)
                        path.write_text('[]', encoding='utf-8')
            (root / targets[1]['manifestPath']).write_text('{}', encoding='utf-8')
            plan = {'targets': targets, 'sources': sources, 'seeds': []}

            with patch('sys.argv', ['convert_all', '--data-root', str(root)]), \
                    patch('convert.convert_all._ensure_stdout_utf8'), \
                    patch('convert.convert_all.load_data_plan', return_value=plan), \
                    patch('convert.convert_all.convert_target') as convert, \
                    redirect_stdout(StringIO()) as output:
                result = convert_all_main()

            self.assertEqual(0, result)
            self.assertEqual([2024], [call.args[0]['year'] for call in convert.call_args_list])
            self.assertIn('2023', output.getvalue())
            self.assertIn('省控线/scorelines_2023.json', output.getvalue())

    def test_official_empty_manual_correction_skips_ocr(self):
        entry = {'majorCode': 'N8', 'majorName': '金融工程', 'localPath': 'N8.pdf', 'sha256': 'source'}
        correction = {'status': 'official-empty', 'evidenceNote': '官方 PDF 没有分数表'}
        with patch('convert.convert_all.extract_rows') as extract:
            result = _convert_entry((entry, Path('.'), correction))
        extract.assert_not_called()
        self.assertEqual(result['status'], 'official-empty')
        self.assertEqual(result['segments'], [])
        self.assertEqual(result['issues'], [])

    @staticmethod
    def fixture(root, year, majors):
        entries = []
        scorelines = []
        for code, name in majors:
            relative = f'{code}.pdf'
            source = root / relative
            source.write_bytes(f'fixture {code}'.encode())
            entries.append({'majorCode': code, 'majorName': name, 'localPath': relative,
                            'sha256': hashlib.sha256(source.read_bytes()).hexdigest()})
            scorelines.append({'专业代号': code, '专业名称': name, '分数线': 100})
        (root / 'manifest.json').write_text(json.dumps({'entries': entries}), encoding='utf-8')
        (root / 'scorelines.json').write_text(json.dumps(scorelines, ensure_ascii=False), encoding='utf-8')
        (root / 'plans.json').write_text('[]', encoding='utf-8')
        target = {'year': year, 'dataset': 'score-segments', 'manifestPath': 'manifest.json',
                  'normalizedPath': f'一分一段/一分一段_{year}.json',
                  'conversionReportPath': f'reports/转换报告_{year}.json'}
        plan = {'sources': [
            {'year': year, 'parser': 'scorelines', 'outputPath': 'scorelines.json'},
            {'year': year, 'parser': 'plans', 'outputPath': 'plans.json'},
        ], 'targets': [target]}
        return target, plan, {entry['majorCode']: entry for entry in entries}

    @staticmethod
    def extracted(entry, *, status='ok', segments=None, issues=None):
        return {'majorCode': entry['majorCode'], 'majorName': entry['majorName'],
                'sourcePdf': entry['localPath'], 'sourceSha256': entry['sha256'],
                'status': status, 'segments': segments if segments is not None else [
                    {'score': 101, 'cumulativeCount': 1}, {'score': 100, 'cumulativeCount': 2}],
                'issues': issues or []}

    def test_reconversion_keeps_normalized_shard_and_hash_when_source_is_unchanged(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            pdf = root / '01.pdf'
            pdf.write_bytes(b'fixture pdf')
            source_hash = hashlib.sha256(pdf.read_bytes()).hexdigest()
            (root / 'manifest.json').write_text(json.dumps({'entries': [{
                'majorCode': '01', 'majorName': '经济学', 'localPath': '01.pdf',
                'sha256': source_hash,
            }]}), encoding='utf-8')
            (root / 'scorelines.json').write_text(json.dumps([{
                '专业代号': '01', '专业名称': '经济学', '分数线': 100,
            }]), encoding='utf-8')
            (root / 'plans.json').write_text('[]', encoding='utf-8')
            target = {'year': 2027, 'dataset': 'score-segments', 'manifestPath': 'manifest.json',
                      'normalizedPath': '一分一段/一分一段_2027.json',
                      'conversionReportPath': 'reports/转换报告_2027.json'}
            plan = {'sources': [
                {'year': 2027, 'parser': 'scorelines', 'outputPath': 'scorelines.json'},
                {'year': 2027, 'parser': 'plans', 'outputPath': 'plans.json'},
            ], 'targets': [target]}
            extracted = {'majorCode': '01', 'majorName': '经济学', 'sourcePdf': '01.pdf',
                         'sourceSha256': source_hash, 'status': 'ok', 'issues': [],
                         'segments': [{'score': 101, 'cumulativeCount': 1},
                                      {'score': 100, 'cumulativeCount': 2}]}
            with patch('convert.convert_all._convert_entry', return_value=extracted), \
                 patch('convert.normalize.normalize_target', wraps=normalize_target) as normalize:
                first = convert_target(target, root, workers=1, plan=plan)
                shard = root / '一分一段/2027/01.json'
                index = root / target['normalizedPath']
                report = root / target['conversionReportPath']
                self.assertEqual(100, first['majors'][0]['controlScore'])
                self.assertTrue(first['majors'][0]['sourceId'])
                first_index_hash = json.loads(index.read_text(encoding='utf-8'))['majors'][0]['sha256']
                unchanged_time = 1_700_000_000_000_000_000
                os.utime(shard, ns=(unchanged_time, unchanged_time))
                os.utime(index, ns=(unchanged_time, unchanged_time))
                os.utime(report, ns=(unchanged_time, unchanged_time))
                second = convert_target(target, root, workers=1, plan=plan)
            self.assertEqual(2, normalize.call_count)
            self.assertEqual(first, second)
            self.assertEqual(first_index_hash, json.loads(index.read_text(encoding='utf-8'))['majors'][0]['sha256'])
            self.assertEqual(unchanged_time, shard.stat().st_mtime_ns)
            self.assertEqual(unchanged_time, index.stat().st_mtime_ns)
            self.assertEqual(unchanged_time, report.stat().st_mtime_ns)

    def test_empty_manifest_writes_a_complete_conversion_document(self):
        with tempfile.TemporaryDirectory() as directory:
            data_root = Path(directory)
            target, plan, _ = self.fixture(data_root, 2026, [])
            result = convert_target(target, data_root, plan=plan)

            self.assertEqual({"total": 0, "ok": 0, "needsReview": 0, "officialEmpty": 0}, result["summary"])
            persisted = merge_year(data_root / "一分一段/一分一段_2026.json", data_root)
            self.assertEqual(result, persisted)

    def test_retry_only_reviewed_major_and_show_name_and_issue(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target, plan, entries = self.fixture(root, 2027, [('51', '计算机'), ('53', '网络工程')])
            results = iter([
                self.extracted(entries['51']),
                self.extracted(entries['53'], status='needs-review', segments=[],
                               issues=[{'code': 'non-monotonic-count', 'message': '累计人数回退'}]),
                self.extracted(entries['53'])])
            with patch('convert.convert_all._convert_entry', side_effect=lambda item: next(results)) as convert:
                convert_target(target, root, workers=1, plan=plan)
                output = StringIO()
                with redirect_stdout(output):
                    result = convert_target(target, root, retry_review=True, workers=1, plan=plan)
            self.assertEqual(3, convert.call_count)
            self.assertEqual(2, result['summary']['ok'])
            self.assertIn('53 网络工程', output.getvalue())
            self.assertEqual(result, merge_year(root / target['normalizedPath'], root))

    def test_default_progress_hides_success_lines_and_verbose_shows_them(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target, plan, entries = self.fixture(root, 2027, [('51', '计算机')])
            with patch('convert.convert_all._convert_entry', return_value=self.extracted(entries['51'])):
                default_output = StringIO()
                with redirect_stdout(default_output):
                    convert_target(target, root, workers=1, plan=plan)
                verbose_output = StringIO()
                with redirect_stdout(verbose_output):
                    convert_target(target, root, workers=1, verbose=True, plan=plan)
            self.assertNotIn('完成 1/1 51 计算机', default_output.getvalue())
            self.assertIn('1/1 ok', default_output.getvalue())
            self.assertIn('完成 1/1 51 计算机', verbose_output.getvalue())


if __name__ == "__main__":
    unittest.main()
