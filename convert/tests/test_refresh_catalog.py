import json
import hashlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from convert.refresh_catalog import (
    _analytics, _json_content_sha256, _major_name_matches, _manifest_identity_hash, _source_map,
    refresh_catalog, validate_year_sources,
)
from convert.segment_store import merge_year, write_year


def write_year_seed(data: Path, year: int) -> None:
    path = data / 'year-links' / f'{year}.json'
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({
        'year': year,
        'sources': {'scoreSegments': {'pageUrl': f'https://www.haeea.cn/{year}.shtml'}},
    }), encoding='utf-8')


class RefreshCatalogTest(unittest.TestCase):
    def test_input_hash_is_stable_across_json_format_and_line_endings(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'input.json'
            path.write_bytes(b'{\r\n  "year": 2023,\r\n  "value": 10\r\n}')
            first = _json_content_sha256(json.loads(path.read_text(encoding='utf-8')))
            path.write_text('{"value":10,"year":2023}', encoding='utf-8')
            self.assertEqual(first, _json_content_sha256(json.loads(path.read_text(encoding='utf-8'))))

    def test_manifest_hash_ignores_download_status_and_json_formatting(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'manifest.json'
            source = {'year': 2023, 'entries': [{'majorCode': '01', 'pdfUrl': 'https://example.org/one.pdf'}]}
            path.write_text(json.dumps(source), encoding='utf-8')
            first = _manifest_identity_hash(path)
            source['entries'][0]['downloadStatus'] = 'downloaded'
            path.write_text(json.dumps(source, ensure_ascii=False, indent=2), encoding='utf-8')
            self.assertEqual(first, _manifest_identity_hash(path))
            source['entries'][0]['pdfUrl'] = 'https://example.org/two.pdf'
            path.write_text(json.dumps(source), encoding='utf-8')
            self.assertNotEqual(first, _manifest_identity_hash(path))

    def test_year_validator_is_public_for_ingestion_and_tools(self):
        self.assertTrue(callable(validate_year_sources))

    def test_special_99_a1_code_alias_accepts_official_parenthetical_name(self):
        mapping_names = {'99': {'财务管理', '会计学'}}
        plan_names = {'A1': {'财务管理'}}
        self.assertTrue(_major_name_matches(
            'A1', '财务管理（含大数据与财务管理）', mapping_names, plan_names))

    def test_special_99_a1_alias_does_not_accept_parenthetical_name_for_other_code(self):
        mapping_names = {'99': {'财务管理', '会计学'}}
        plan_names = {'A1': {'财务管理'}}
        self.assertFalse(_major_name_matches(
            '99', '财务管理（含大数据与财务管理）', mapping_names, plan_names))

    def test_special_99_a1_alias_does_not_strip_arbitrary_parenthetical_suffix(self):
        mapping_names = {'99': {'财务管理'}}
        plan_names = {'A1': {'财务管理'}}
        self.assertFalse(_major_name_matches(
            'A1', '财务管理（错配）', mapping_names, plan_names))

    def test_borrowed_mapping_missing_code_falls_back_to_scoreline_and_plan_name(self):
        self.assertTrue(_major_name_matches(
            'E4', '绘画', {}, {'E4': {'绘画'}}))
        self.assertFalse(_major_name_matches(
            'E4', '绘画', {'E4': {'油画'}}, {'E4': {'绘画'}}))

    def test_borrowed_mapping_accepts_teacher_training_direction_only(self):
        self.assertTrue(_major_name_matches(
            'R2', '书法学', {}, {'R2': {'书法学(师范)'}}))
        self.assertFalse(_major_name_matches(
            'R2', '书法学', {}, {'R2': {'书法学(错配)'}}))

    def test_discovers_seeded_new_year_canonical_files_and_ignores_unseeded_files(self):
        with tempfile.TemporaryDirectory() as folder:
            data = Path(folder)
            write_year_seed(data, 2028)
            for directory, prefix in [('专业对照', '专业对照'), ('省控线', '省控线'),
                                      ('招生计划', '招生计划'), ('一分一段', '一分一段')]:
                (data / directory).mkdir(parents=True)
                (data / directory / f'{prefix}_2028.json').write_text('{}', encoding='utf-8')
                (data / directory / f'{prefix}_2099.json').write_text('{}', encoding='utf-8')
            sources = _source_map(data)
            self.assertEqual(set(sources[2028]), {'mapping', 'scorelines', 'plans', 'score-segments'})
            self.assertEqual(sources[2028]['mapping'], '专业对照/专业对照_2028.json')
            self.assertNotIn(2099, sources)

    def test_shared_code_keeps_distinct_major_names_and_plan_totals(self):
        mapping = [{'专科专业': '会计', '可报本科专业': [
            {'专业代号': '99', '专业名称': '会计学'},
            {'专业代号': '99', '专业名称': '财务管理'}]}]
        scores = [{'专业代号': '99', '分数线': 120}]
        plans = [
            {'专业代号': '99', '专业名称': '会计学', '院校名称': '甲大学', '办学性质': '公办', '计划人数': 20},
            {'专业代号': '99', '专业名称': '财务管理', '院校名称': '乙大学', '办学性质': '公办', '计划人数': 30}]
        rows = _analytics(2027, mapping, scores, plans)['majors']
        self.assertEqual({row['majorName']: row['schoolTypes']['public']['ordinaryPlanCount'] for row in rows},
                         {'会计学': 20, '财务管理': 30})

    def test_borrowed_mapping_matches_vocational_suffix_without_code_merging(self):
        mapping = [{'专科专业': '计算机', '可报本科专业': [
            {'专业代号': '51', '专业名称': '计算机科学与技术'},
            {'专业代号': '51', '专业名称': '计算机应用工程（本科层次职业教育专业）'},
            {'专业代号': '51', '专业名称': '不存在的专业'}]}]
        plans = [
            {'专业代号': '51', '专业名称': '计算机科学与技术', '院校名称': '甲', '计划人数': 2070},
            {'专业代号': '51', '专业名称': '计算机应用工程', '院校名称': '乙', '计划人数': 150}]
        rows = _analytics(2024, mapping, [], plans)['majors']
        totals = {row['majorName']: row['schoolTypes']['public']['ordinaryPlanCount'] for row in rows}
        self.assertEqual(totals, {'计算机科学与技术': 2070,
                                  '计算机应用工程（本科层次职业教育专业）': 150,
                                  '不存在的专业': 0})

    def test_publishes_only_analytics_and_reuses_canonical_score_segment_shards(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            data = root / 'data'
            write_year_seed(data, 2027)
            for kind in ('专业对照', '省控线', '招生计划', '一分一段'):
                (data / kind).mkdir(parents=True)
            (data / '专业对照/专业对照_2027.json').write_text(json.dumps([
                {'专科专业': '软件技术', '可报本科专业': [{'专业代号': '51', '专业名称': '计算机科学与技术'}]}]), encoding='utf-8')
            (data / '省控线/省控线_2027.json').write_text(json.dumps([
                {'专业代号': '51', '专业名称': '计算机科学与技术', '分数线': 180}]), encoding='utf-8')
            (data / '招生计划/招生计划_2027.json').write_text(json.dumps([
                {'年度': 2027, '专业代号': '51', '专业名称': '计算机科学与技术', '院校名称': '甲大学', '办学性质': '公办', '招生类别': '普通专升本', '计划人数': 30},
                {'年度': 2027, '专业代号': '51', '专业名称': '计算机科学与技术', '院校名称': '甲大学', '办学性质': '公办', '招生类别': '建档立卡专项', '计划人数': 2}]), encoding='utf-8')
            (data / '一分一段/一分一段_2027.json').write_text(json.dumps({'year': 2027,
                'dataset': 'score-segments',
                'sourceManifest': '来源清单/来源清单_2027.json', 'majors': [
                {'majorCode': '51', 'majorName': '计算机科学与技术', 'controlScore': 180,
                 'sourceId': 'score-segments:2027:51', 'sourcePdf': '一分一段/原始PDF/2027/51.pdf',
                 'sourceSha256': hashlib.sha256(b'fixture').hexdigest(),
                 'status': 'ok', 'issues': [],
                 'segments': [{'score': 200, 'cumulativeCount': 4}, {'score': 199, 'cumulativeCount': 7}]}]}), encoding='utf-8')
            canonical_path = data / '一分一段/一分一段_2027.json'
            write_year(canonical_path, data, {'schemaVersion': 1, **json.loads(canonical_path.read_text(encoding='utf-8'))})
            (data / '一分一段/原始PDF/2027').mkdir(parents=True)
            (data / '一分一段/原始PDF/2027/51.pdf').write_bytes(b'fixture')
            (data / '来源清单').mkdir()
            (data / '来源清单/来源清单_2027.json').write_text(json.dumps({
                'dataset': 'score-segments', 'year': 2027,
                'entries': [{'year': 2027, 'majorCode': '51', 'localPath': '一分一段/原始PDF/2027/51.pdf'}],
            }), encoding='utf-8')
            (data / 'reports').mkdir()
            (data / 'reports/转换报告_2027.json').write_text(json.dumps({
                'year': 2027, 'inputMajorCount': 1, 'blockingCount': 0, 'publishedMajorCount': 1,
                'officialEmptyCount': 0, 'officialEmpty': [], 'blockers': [],
                'validationErrors': []}), encoding='utf-8')
            template = root / 'template.json'
            template.write_text(json.dumps({'schemaVersion': 2, 'defaultYear': 2026,
                'supportedYears': [2026]}), encoding='utf-8')
            metadata = root / 'metadata.json'
            result = refresh_catalog(data, template, metadata)
            self.assertEqual(result['supportedYears'], [2027])
            self.assertEqual(result['defaultYear'], 2027)
            catalog = json.loads((root / result['catalogSource']).read_text(encoding='utf-8'))
            self.assertEqual(len(catalog['inputSha256']['2027']['mapping']), 64)
            analytics = json.loads((root / result['yearSources']['2027']['analyticsSource']).read_text(encoding='utf-8'))
            self.assertEqual(analytics['majors'][0]['schoolTypes']['public']['ordinaryPlanCount'], 30)
            self.assertEqual(analytics['majors'][0]['schoolTypes']['public']['allSchoolCount'], 1)
            yearly = result['yearSources']['2027']
            self.assertEqual(yearly['scoreSegmentIndexSource'], 'data/一分一段/一分一段_2027.json')
            self.assertEqual(yearly['scoreSegmentShardTemplate'], 'data/一分一段/2027/{majorCode}.json')
            self.assertFalse(list((data / 'generated').glob('2027/*/shards')))
            first_publication = metadata.read_bytes()
            self.assertEqual(refresh_catalog(data, template, metadata), result)
            self.assertEqual(metadata.read_bytes(), first_publication)
            manifest_path = data / '来源清单/来源清单_2027.json'
            canonical_path = data / '一分一段/一分一段_2027.json'
            report_path = data / 'reports/转换报告_2027.json'
            valid_manifest = manifest_path.read_text(encoding='utf-8')
            valid_segments = canonical_path.read_text(encoding='utf-8')
            valid_report = report_path.read_text(encoding='utf-8')
            manifest = json.loads(valid_manifest)
            manifest['entries'].append(dict(manifest['entries'][0]))
            manifest_path.write_text(json.dumps(manifest), encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'duplicate manifest major code'):
                refresh_catalog(data, template, metadata)
            self.assertEqual(metadata.read_bytes(), first_publication)
            manifest_path.write_text(valid_manifest, encoding='utf-8')
            segments = merge_year(canonical_path, data)
            segments['majors'].append(dict(segments['majors'][0]))
            with self.assertRaisesRegex(ValueError, 'duplicate major code'):
                write_year(canonical_path, data, segments)
            segments = merge_year(canonical_path, data)
            segments['majors'][0]['majorCode'] = '53'
            with self.assertRaisesRegex(ValueError, 'hash mismatch|score segments contain codes absent'):
                write_year(canonical_path, data, segments)
                refresh_catalog(data, template, metadata)
            self.assertEqual(metadata.read_bytes(), first_publication)
            canonical_path.write_text(valid_segments, encoding='utf-8')
            report = json.loads(valid_report)
            report['inputMajorCount'] = 2
            report_path.write_text(json.dumps(report), encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'report inputMajorCount=2 but source manifest has 1 majors'):
                refresh_catalog(data, template, metadata)
            self.assertEqual(metadata.read_bytes(), first_publication)
            report = json.loads(valid_report)
            report['officialEmptyCount'] = 1
            report['officialEmpty'] = [{'majorCode': '99', 'reason': 'official-empty', 'evidenceNote': '未备案'}]
            report_path.write_text(json.dumps(report), encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'official-empty code absent from source manifest'):
                refresh_catalog(data, template, metadata)
            self.assertEqual(metadata.read_bytes(), first_publication)
            report_path.write_text(valid_report, encoding='utf-8')
            plan_file = data / '招生计划/招生计划_2027.json'
            plans = json.loads(plan_file.read_text(encoding='utf-8'))
            plans[0]['年度'] = 2026
            plan_file.write_text(json.dumps(plans), encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'wrong-year plan'):
                refresh_catalog(data, template, metadata)
            self.assertEqual(metadata.read_bytes(), first_publication)
            plans[0]['年度'] = 2027
            plans[0]['计划人数'] = 31
            plan_file.write_text(json.dumps(plans), encoding='utf-8')
            with patch('convert.refresh_catalog.os.replace', side_effect=OSError('interrupted publication')):
                with self.assertRaisesRegex(OSError, 'interrupted publication'):
                    refresh_catalog(data, template, metadata)
            self.assertEqual(metadata.read_bytes(), first_publication)

    def test_incomplete_year_does_not_replace_metadata(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'data').mkdir()
            write_year_seed(root / 'data', 2027)
            template = root / 'template.json'
            template.write_text('{}', encoding='utf-8')
            metadata = root / 'metadata.json'
            metadata.write_text('previous', encoding='utf-8')
            with self.assertRaises(ValueError):
                refresh_catalog(root / 'data', template, metadata)
            self.assertEqual(metadata.read_text(encoding='utf-8'), 'previous')
