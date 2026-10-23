import json
import hashlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from convert.refresh_catalog import _analytics, _source_map, refresh_catalog, validate_year_sources


class RefreshCatalogTest(unittest.TestCase):
    def test_year_validator_is_public_for_ingestion_and_tools(self):
        self.assertTrue(callable(validate_year_sources))

    def test_unchanged_published_legacy_coverage_gap_is_retained_but_changed_input_is_revalidated(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            data = root / 'data'
            for kind in ('专业对照', '省控线', '招生计划', '一分一段', 'reports', 'generated/catalog'):
                (data / kind).mkdir(parents=True, exist_ok=True)
            files = {
                'mapping': '专业对照/专业对照_2024.json',
                'scorelines': '省控线/省控线_2024.json',
                'plans': '招生计划/招生计划_2024.json',
                'score-segments': '一分一段/一分一段_2024.json',
                'report': 'reports/转换报告_2024.json',
            }
            values = {
                'mapping': [
                    {'专科专业': '软件技术', '可报本科专业': [{'专业代号': '51', '专业名称': '计算机科学与技术'}]},
                    {'专科专业': '建筑工程技术', '可报本科专业': [{'专业代号': '58', '专业名称': '建筑环境与能源应用工程'}]},
                ],
                'scorelines': [
                    {'专业代号': '51', '专业名称': '计算机科学与技术', '分数线': 180},
                    {'专业代号': '58', '专业名称': '建筑环境与能源应用工程', '分数线': 154},
                ],
                'plans': [
                    {'年度': 2024, '专业代号': code, '专业名称': name, '院校名称': '甲大学',
                     '办学性质': '公办', '计划人数': 1}
                    for code, name in [('51', '计算机科学与技术'), ('58', '建筑环境与能源应用工程')]
                ],
                'score-segments': {'schemaVersion': 1, 'year': 2024, 'sourceManifest': '来源清单/来源清单_2024.json',
                    'majors': [{'majorCode': '51', 'majorName': '计算机科学与技术', 'controlScore': 180,
                        'sourceId': 'score-segments:2024:51', 'sourcePdf': '一分一段/原始PDF/2024/51.pdf',
                        'sourceSha256': hashlib.sha256(b'fixture-pdf').hexdigest(),
                        'segments': [{'score': 200, 'cumulativeCount': 1}]}]},
                'report': {'schemaVersion': 1, 'year': 2024, 'inputMajorCount': 1, 'publishedMajorCount': 1,
                    'officialEmptyCount': 0, 'officialEmpty': [], 'blockingCount': 0, 'blockers': [],
                    'validationErrors': [], 'resolutions': []},
            }
            for key, relative in files.items():
                (data / relative).write_text(json.dumps(values[key], ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
            (data / '来源清单').mkdir(parents=True)
            (data / '来源清单/来源清单_2024.json').write_text(json.dumps({
                'dataset': 'score-segments', 'year': 2024,
                'entries': [{'year': 2024, 'majorCode': '51', 'localPath': '一分一段/原始PDF/2024/51.pdf'}],
            }), encoding='utf-8')
            (data / '一分一段/提取结果').mkdir(parents=True)
            (data / '一分一段/提取结果/提取结果_2024.json').write_text(json.dumps({
                'dataset': 'score-segments', 'year': 2024,
                'majors': [{'majorCode': '51', 'status': 'ok'}],
            }), encoding='utf-8')
            pdf = data / '一分一段/原始PDF/2024/51.pdf'
            pdf.parent.mkdir(parents=True)
            pdf.write_bytes(b'fixture-pdf')
            (data / 'source-registry.json').write_text(json.dumps({
                'sources': [
                    {'year': 2024, 'parser': 'mapping', 'outputPath': files['mapping']},
                    {'year': 2024, 'parser': 'scorelines', 'outputPath': files['scorelines']},
                    {'year': 2024, 'parser': 'plans', 'outputPath': files['plans']},
                ],
                'crawlTargets': [{'year': 2024, 'normalizedPath': files['score-segments'],
                    'conversionReportPath': files['report']}],
            }), encoding='utf-8')

            published_inputs = {key: hashlib.sha256((data / relative).read_bytes()).hexdigest()
                                for key, relative in files.items()}
            legacy_catalog_path = 'generated/catalog/legacy.json'
            (data / legacy_catalog_path).write_text(json.dumps({'inputSha256': {'2024': published_inputs}}), encoding='utf-8')
            metadata = root / 'metadata.json'
            metadata.write_text(json.dumps({'schemaVersion': 3, 'defaultYear': 2024, 'supportedYears': [2024],
                'catalogSource': f'data/{legacy_catalog_path}'}), encoding='utf-8')
            template = root / 'template.json'
            template.write_text(json.dumps({'schemaVersion': 3, 'defaultYear': 2024, 'supportedYears': [2024]}), encoding='utf-8')

            result = refresh_catalog(data, template, metadata)
            self.assertEqual(result['supportedYears'], [2024])
            stable_metadata = metadata.read_bytes()
            report_path = data / files['report']
            stable_report = report_path.read_bytes()
            report_path.write_text(report_path.read_text(encoding='utf-8') + ' ', encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'missing score segments'):
                refresh_catalog(data, template, metadata)
            self.assertEqual(metadata.read_bytes(), stable_metadata)
            report_path.write_bytes(stable_report)
            scoreline_path = data / files['scorelines']
            scorelines = json.loads(scoreline_path.read_text(encoding='utf-8'))
            scorelines[0]['分数线'] = 181
            scoreline_path.write_text(json.dumps(scorelines), encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'missing score segments'):
                refresh_catalog(data, template, metadata)
            self.assertEqual(metadata.read_bytes(), stable_metadata)

    def test_discovers_new_year_canonical_files_without_registry_edits(self):
        with tempfile.TemporaryDirectory() as folder:
            data = Path(folder)
            (data / 'source-registry.json').write_text('{"sources":[]}', encoding='utf-8')
            for directory, prefix in [('专业对照', '专业对照'), ('省控线', '省控线'),
                                      ('招生计划', '招生计划'), ('一分一段', '一分一段')]:
                (data / directory).mkdir()
                (data / directory / f'{prefix}_2028.json').write_text('{}', encoding='utf-8')
            sources = _source_map(data)
            self.assertEqual(set(sources[2028]), {'mapping', 'scorelines', 'plans', 'score-segments'})
            self.assertEqual(sources[2028]['mapping'], '专业对照/专业对照_2028.json')

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

    def test_publishes_only_complete_year_with_index_and_shards(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            data = root / 'data'
            for kind in ('专业对照', '省控线', '招生计划', '一分一段'):
                (data / kind).mkdir(parents=True)
            (data / 'source-registry.json').write_text(json.dumps({
                'sources': [
                    {'year': 2027, 'parser': 'mapping', 'outputPath': '专业对照/专业对照_2027.json'},
                    {'year': 2027, 'parser': 'scorelines', 'outputPath': '省控线/省控线_2027.json'},
                    {'year': 2027, 'parser': 'plans', 'outputPath': '招生计划/招生计划_2027.json'}],
                'crawlTargets': [{'year': 2027, 'normalizedPath': '一分一段/一分一段_2027.json',
                    'conversionReportPath': 'reports/转换报告_2027.json'}]
            }), encoding='utf-8')
            (data / '专业对照/专业对照_2027.json').write_text(json.dumps([
                {'专科专业': '软件技术', '可报本科专业': [{'专业代号': '51', '专业名称': '计算机科学与技术'}]}]), encoding='utf-8')
            (data / '省控线/省控线_2027.json').write_text(json.dumps([
                {'专业代号': '51', '专业名称': '计算机科学与技术', '分数线': 180}]), encoding='utf-8')
            (data / '招生计划/招生计划_2027.json').write_text(json.dumps([
                {'年度': 2027, '专业代号': '51', '专业名称': '计算机科学与技术', '院校名称': '甲大学', '办学性质': '公办', '招生类别': '普通专升本', '计划人数': 30},
                {'年度': 2027, '专业代号': '51', '专业名称': '计算机科学与技术', '院校名称': '甲大学', '办学性质': '公办', '招生类别': '建档立卡专项', '计划人数': 2}]), encoding='utf-8')
            (data / '一分一段/一分一段_2027.json').write_text(json.dumps({'year': 2027,
                'sourceManifest': '来源清单/来源清单_2027.json', 'majors': [
                {'majorCode': '51', 'majorName': '计算机科学与技术', 'controlScore': 180,
                 'sourceId': 'score-segments:2027:51', 'sourcePdf': '一分一段/原始PDF/2027/51.pdf',
                 'sourceSha256': hashlib.sha256(b'fixture').hexdigest(),
                 'segments': [{'score': 200, 'cumulativeCount': 4}, {'score': 199, 'cumulativeCount': 7}]}]}), encoding='utf-8')
            (data / '一分一段/原始PDF/2027').mkdir(parents=True)
            (data / '一分一段/原始PDF/2027/51.pdf').write_bytes(b'fixture')
            (data / '来源清单').mkdir()
            (data / '来源清单/来源清单_2027.json').write_text(json.dumps({
                'dataset': 'score-segments', 'year': 2027,
                'entries': [{'year': 2027, 'majorCode': '51', 'localPath': '一分一段/原始PDF/2027/51.pdf'}],
            }), encoding='utf-8')
            (data / '一分一段/提取结果').mkdir()
            (data / '一分一段/提取结果/提取结果_2027.json').write_text(json.dumps({
                'dataset': 'score-segments', 'year': 2027,
                'majors': [{'majorCode': '51', 'status': 'ok'}],
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
            shard = json.loads((root / result['yearSources']['2027']['scoreSegmentShardTemplate'].replace('{majorCode}', '51')).read_text(encoding='utf-8'))
            self.assertEqual(shard['segments'][1]['segmentCount'], 3)
            first_publication = metadata.read_bytes()
            self.assertEqual(refresh_catalog(data, template, metadata), result)
            self.assertEqual(metadata.read_bytes(), first_publication)
            manifest_path = data / '来源清单/来源清单_2027.json'
            extraction_path = data / '一分一段/提取结果/提取结果_2027.json'
            report_path = data / 'reports/转换报告_2027.json'
            valid_manifest = manifest_path.read_text(encoding='utf-8')
            valid_extraction = extraction_path.read_text(encoding='utf-8')
            valid_report = report_path.read_text(encoding='utf-8')
            manifest = json.loads(valid_manifest)
            manifest['entries'].append(dict(manifest['entries'][0]))
            manifest_path.write_text(json.dumps(manifest), encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'duplicate manifest major code'):
                refresh_catalog(data, template, metadata)
            self.assertEqual(metadata.read_bytes(), first_publication)
            manifest_path.write_text(valid_manifest, encoding='utf-8')
            extraction = json.loads(valid_extraction)
            extraction['majors'].append(dict(extraction['majors'][0]))
            extraction_path.write_text(json.dumps(extraction), encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'extraction major count mismatch'):
                refresh_catalog(data, template, metadata)
            self.assertEqual(metadata.read_bytes(), first_publication)
            extraction_path.write_text(valid_extraction, encoding='utf-8')
            report = json.loads(valid_report)
            report['inputMajorCount'] = 2
            report_path.write_text(json.dumps(report), encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'report major count mismatch'):
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
            (root / 'data/source-registry.json').write_text(json.dumps({'sources': [
                {'year': 2027, 'parser': 'plans', 'outputPath': '招生计划/招生计划_2027.json'}]}), encoding='utf-8')
            template = root / 'template.json'
            template.write_text('{}', encoding='utf-8')
            metadata = root / 'metadata.json'
            metadata.write_text('previous', encoding='utf-8')
            with self.assertRaises(ValueError):
                refresh_catalog(root / 'data', template, metadata)
            self.assertEqual(metadata.read_text(encoding='utf-8'), 'previous')
