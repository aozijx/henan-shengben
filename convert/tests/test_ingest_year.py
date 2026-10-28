import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from convert.ingest_year import (
    _summary_report, ingest_year, publish_staged_files,
    validate_score_segment_pdfs,
)
from convert.common import REPO_ROOT
from convert.normalize import save_normalized_target
from crawler.year_sources import SourceResolutionError


YEAR = 2027
PAGES = {
    'scoreSegments': 'https://www.haeea.cn/segments',
    'scorelines': 'https://www.haeea.cn/scorelines',
    'plans': 'https://www.haeea.cn/plans',
    'mappingCodeTable': 'https://www.haeea.cn/mapping-code',
    'mappingOverview': 'https://www.haeea.cn/mapping-overview',
    'master': 'https://www.haeea.cn/master',
}
ATTACHMENTS = {
    'scorelines': 'https://www.haeea.cn/attach/scorelines.pdf',
    'plans': 'https://www.haeea.cn/attach/plans.pdf',
    'mappingCodeTable': 'https://www.haeea.cn/attach/专业代号对照.pdf',
    'mappingOverview': 'https://www.haeea.cn/attach/专业对照一览.pdf',
    'master': 'https://xcoss.henan.gov.cn/typtfile/2027/master.pdf',
}
CANONICAL = {
    'mappingCodeTable': [{'专业名称': '计算机科学与技术', '专业代号': '51', '考试科目代码': '01'}],
    'mapping': [{'专科专业': '软件技术', '可报本科专业': [
        {'专业代号': '51', '专业名称': '计算机科学与技术'}]}],
    'scorelines': [{'专业代号': '51', '专业名称': '计算机科学与技术', '分数线': 180}],
    'plans': [{'年度': YEAR, '专业代号': '51', '专业名称': '计算机科学与技术',
        '院校名称': '甲大学', '办学性质': '公办', '招生类别': '普通专升本', '计划人数': 30}],
    'master': [{'院校代码': '12345', '院校名称': '甲大学', '专业代码': '080901',
        '专业名称': '计算机科学与技术'}],
}


class FakeResponse:
    def __init__(self, url, *, text='', content=b'', status=200):
        self.url = url
        self.text = text
        self.content = content
        self.status = status
        self.headers = {'content-type': 'application/pdf'}

    def raise_for_status(self):
        if self.status >= 400:
            raise RuntimeError(f'HTTP {self.status} for {self.url}')


class FakeSession:
    pdf_bytes = b'%PDF-1.4\nsynthetic source document\n'

    def __init__(self, *, blocked_url=None, missing_url=None):
        self.headers = {}
        self.blocked_url = blocked_url
        self.missing_url = missing_url

    def get(self, url, timeout=60):
        if url == self.blocked_url:
            return FakeResponse(url, status=412)
        if url == self.missing_url:
            return FakeResponse(url, status=404)
        page_text = {
            PAGES['scoreSegments']: f'<div>{YEAR} 分数段统计表 一分一段 '
                '<a href="/a/(51计算机科学与技术).pdf">51 下载</a></div>',
            PAGES['scorelines']: f'{YEAR} 录取控制分数线',
            PAGES['plans']: f'{YEAR} 招生计划',
            PAGES['mappingCodeTable']: f'{YEAR} 专业代号对照 考试科目',
            PAGES['mappingOverview']: f'{YEAR} 专业对照一览 专科专业 本科专业',
            PAGES['master']: f'{YEAR} 招生高校及专业总表',
        }
        if url in page_text:
            return FakeResponse(url, content=page_text[url].encode('utf-8'))
        return FakeResponse(url, content=self.pdf_bytes)


def make_seed(root: Path) -> Path:
    sources = {
        role: {'pageUrl': PAGES[role], **({'attachmentUrl': ATTACHMENTS[role]} if role in ATTACHMENTS else {})}
        for role in PAGES
    }
    path = root / 'year-links' / '2027.json'
    path.parent.mkdir(parents=True)
    path.write_text(json.dumps({'year': YEAR, 'sources': sources}, ensure_ascii=False), encoding='utf-8')
    return path


def seed_data(root: Path, *, collision=False) -> tuple[Path, Path, bytes]:
    data = root / 'data'
    data.mkdir()
    original_metadata = b'{"schemaVersion": 3, "defaultYear": 2026, "supportedYears": [2026]}\n'
    metadata = root / 'school-data.json'
    metadata.write_bytes(original_metadata)
    correction_bytes = b'{"schemaVersion":1,"corrections":[]}\n'
    (data / '一分一段' / '人工修正.json').parent.mkdir(parents=True)
    (data / '一分一段' / '人工修正.json').write_bytes(correction_bytes)
    if collision:
        path = data / '专业对照' / '专业对照_2027.json'
        path.parent.mkdir(parents=True)
        path.write_text('[{"preserve": true}]\n', encoding='utf-8')
    return data, metadata, original_metadata


def write_synthetic_tables(plan, data_root, year, *, write, parser=None):
    results = []
    for row in plan['sources']:
        if row['year'] != year or (parser and row['parser'] != parser):
            continue
        output = data_root / row['outputPath']
        output.parent.mkdir(parents=True, exist_ok=True)
        value = CANONICAL[row['parser']]
        output.write_text(json.dumps(value, ensure_ascii=False) + '\n', encoding='utf-8')
        results.append({'parser': row['parser'], 'outputPath': row['outputPath'],
            'rowCount': len(value), 'diffs': [], 'expectedCountMismatch': False})
    return results


def write_synthetic_extraction(target, data_root, plan, *, needs_review=False, full_report=False):
    manifest = json.loads((data_root / target['manifestPath']).read_text(encoding='utf-8'))
    entry = manifest['entries'][0]
    result = {'schemaVersion': 1, 'dataset': 'score-segments', 'year': YEAR,
        'sourceManifest': target['manifestPath'], 'majors': [{
            'majorCode': '51', 'majorName': '计算机科学与技术',
            'status': 'needs-review' if needs_review else 'ok',
            'sourcePdf': entry['localPath'], 'sourceSha256': entry['sha256'],
            'segments': [] if needs_review else [
                {'score': 200, 'cumulativeCount': 4}, {'score': 199, 'cumulativeCount': 7}],
            'issues': [{'code': 'ocr-review'}] if needs_review else []}],
        'summary': {'total': 1, 'ok': 0 if needs_review else 1, 'needsReview': 1 if needs_review else 0}}
    normalized, _ = save_normalized_target(target, plan, data_root, result,
                                           full_report=full_report)
    return normalized


def mocked_tabular_parsers(*, needs_review=False):
    return (
        patch('convert.ingest_year.validate_attachment'),
        patch('convert.ingest_year.extract_year_sources', side_effect=write_synthetic_tables),
        patch('convert.ingest_year.convert_target', side_effect=lambda target, root, **kwargs:
            write_synthetic_extraction(target, root, kwargs['plan'], needs_review=needs_review,
                                       full_report=kwargs.get('full_report', False))),
    )


class IngestYearTests(unittest.TestCase):
    def test_score_segment_validation_error_names_the_failing_pdf(self):
        entry = {'localPath': '一分一段/2027/51_计算机科学与技术.pdf'}
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / entry['localPath']
            path.parent.mkdir(parents=True)
            path.write_bytes(b'%PDF-')
            with patch('convert.ingest_year.validate_attachment',
                       side_effect=SourceResolutionError('source type mismatch')):
                with self.assertRaisesRegex(SourceResolutionError, '51_计算机科学与技术.pdf'):
                    validate_score_segment_pdfs([entry], Path(folder), YEAR)

    def test_default_cli_summary_omits_per_source_and_success_resolution_details(self):
        report = {
            'year': YEAR, 'sources': 6, 'scoreSegmentPdfs': 1, 'publishedMajors': 1,
            'sourceProvenance': [{'localPath': 'large.pdf'}], 'scoreSegmentProvenance': [{'majorCode': '51'}],
            'supportedYears': [YEAR], 'conversionReport': {
                'inputMajorCount': 1, 'publishedMajorCount': 1, 'officialEmptyCount': 0,
                'sourceUnavailableCount': 0, 'blockingCount': 0, 'officialEmpty': [],
                'sourceUnavailable': [], 'blockers': [], 'validationErrors': [],
                'resolutions': [{'majorCode': '51', 'reason': 'highest-priority'}]},
            'metadataDiff': {'addedYear': YEAR},
            'normalizationDeferred': ['plans: 年度计划未声明该来源'],
        }
        compact = _summary_report(report, check=True)
        self.assertNotIn('sourceProvenance', compact)
        self.assertNotIn('resolutions', compact['conversionReport'])
        self.assertEqual([YEAR], compact['supportedYears'])
        self.assertEqual(['plans: 年度计划未声明该来源'], compact['normalizationDeferred'])

    def test_publish_preflights_every_collision_before_copying_new_files(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            staging = root / 'staging'
            active = root / 'active'
            staging.mkdir()
            active.mkdir()
            (staging / 'a-new.json').write_text('new', encoding='utf-8')
            (staging / 'z-existing.json').write_text('replacement', encoding='utf-8')
            (active / 'z-existing.json').write_text('preserve', encoding='utf-8')

            with self.assertRaisesRegex(ValueError, 'overwrite existing file'):
                publish_staged_files(staging, active)

            self.assertFalse((active / 'a-new.json').exists())
            self.assertEqual((active / 'z-existing.json').read_text(encoding='utf-8'), 'preserve')

    def test_seed_filename_must_match_declared_year(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            data, metadata, old_metadata = seed_data(root)
            seed = make_seed(root)
            wrong_name = seed.with_name('2026.json')
            seed.replace(wrong_name)
            with self.assertRaisesRegex(ValueError, 'filename/year mismatch'):
                ingest_year(wrong_name, data, REPO_ROOT / 'metadata/school-data.template.json',
                            metadata, FakeSession(), check=True)
            self.assertEqual(metadata.read_bytes(), old_metadata)

    def test_check_then_publish_generates_catalog_and_shard_without_touching_inputs_first(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            data, metadata, old_metadata = seed_data(root)
            seed = make_seed(root)
            template = REPO_ROOT / 'metadata/school-data.template.json'
            corrections = data / '一分一段' / '人工修正.json'
            original_corrections = corrections.read_bytes()
            mocks = mocked_tabular_parsers()
            with mocks[0], mocks[1], mocks[2]:
                checked = ingest_year(seed, data, template, metadata, FakeSession(), check=True)
                checked_again = ingest_year(seed, data, template, metadata, FakeSession(), check=True)
                self.assertEqual(checked, checked_again)
                self.assertEqual(checked['metadataDiff']['addedYear'], YEAR)
                self.assertEqual(checked['supportedYears'], [YEAR])
                self.assertEqual(metadata.read_bytes(), old_metadata)
                self.assertFalse((data / '专业对照/专业对照_2027.json').exists())

                published = ingest_year(seed, data, template, metadata, FakeSession())
                self.assertEqual(published['year'], YEAR)
                document = json.loads(metadata.read_text(encoding='utf-8'))
                self.assertEqual(document['supportedYears'], [YEAR])
                yearly = document['yearSources'][str(YEAR)]
                self.assertEqual(yearly['collegeFallbackSource'], 'data/招生高校及专业/招生高校及专业_2027.json')
                self.assertEqual(json.loads((data / yearly['analyticsSource'].removeprefix('data/')).read_text(encoding='utf-8'))['majors'][0]['majorCode'], '51')
                index = json.loads((data / yearly['scoreSegmentIndexSource'].removeprefix('data/')).read_text(encoding='utf-8'))
                self.assertEqual([item['majorCode'] for item in index['majors']], ['51'])
                shard_path = yearly['scoreSegmentShardTemplate'].replace('{majorCode}', '51').removeprefix('data/')
                self.assertTrue((data / shard_path).is_file())
                self.assertEqual(corrections.read_bytes(), original_corrections)

                published_metadata = metadata.read_bytes()
                with self.assertRaisesRegex(ValueError, 'already published'):
                    ingest_year(seed, data, template, metadata, FakeSession())
                self.assertEqual(metadata.read_bytes(), published_metadata)

    def test_check_exports_verified_files_with_the_exact_seed_fingerprint(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            data, metadata, original_metadata = seed_data(root)
            seed = make_seed(root)
            export_dir = root / 'artifact' / str(YEAR)
            mocks = mocked_tabular_parsers()
            with mocks[0], mocks[1], mocks[2]:
                result = ingest_year(seed, data, REPO_ROOT / 'metadata/school-data.template.json',
                                     metadata, FakeSession(), check=True, export_dir=export_dir)

            manifest = json.loads((export_dir / 'manifest.json').read_text(encoding='utf-8'))
            self.assertEqual(manifest['year'], YEAR)
            self.assertEqual(manifest['seedPath'], f'data/year-links/{YEAR}.json')
            self.assertEqual(manifest['seedSha256'], hashlib.sha256(seed.read_bytes()).hexdigest())
            self.assertTrue(manifest['files'])
            self.assertTrue(all((export_dir / item['path']).is_file() for item in manifest['files']))
            self.assertEqual(metadata.read_bytes(), original_metadata)
            self.assertFalse((data / '专业对照/专业对照_2027.json').exists())
            self.assertEqual(result['year'], YEAR)

    def test_partial_seed_skips_undeclared_sources_and_exports_only_available_source(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            data, metadata, original_metadata = seed_data(root)
            seed = root / 'year-links' / '2027.json'
            seed.parent.mkdir()
            seed.write_text(json.dumps({'year': YEAR, 'sources': {
                'mappingCodeTable': {
                    'pageUrl': PAGES['mappingCodeTable'],
                    'attachmentUrl': ATTACHMENTS['mappingCodeTable'],
                },
            }}, ensure_ascii=False), encoding='utf-8')
            export_dir = root / 'artifact' / str(YEAR)

            def download(url, destination, session, expected_sha256=None):
                destination = Path(destination)
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(FakeSession.pdf_bytes)
                return {'downloadStatus': 'downloaded', 'finalUrl': None,
                        'sha256': hashlib.sha256(FakeSession.pdf_bytes).hexdigest(),
                        'bytes': len(FakeSession.pdf_bytes)}

            with patch('convert.ingest_year.validate_attachment'), \
                    patch('convert.ingest_year.download_entry', side_effect=download), \
                    patch('convert.extract_cli.extract_entry', return_value=CANONICAL['mappingCodeTable']):
                report = ingest_year(seed, data, REPO_ROOT / 'metadata/school-data.template.json',
                                     metadata, FakeSession(), check=True, export_dir=export_dir)

            self.assertFalse(report['complete'])
            self.assertIn('plans', report['missingSources'])
            self.assertIn('mappingOverview', report['missingSources'])
            self.assertNotIn('metadataDiff', report)
            self.assertEqual(metadata.read_bytes(), original_metadata)
            self.assertFalse((data / '专业对照/专业对照_2027.json').exists())
            manifest = json.loads((export_dir / 'manifest.json').read_text(encoding='utf-8'))
            self.assertFalse(manifest['complete'])
            self.assertTrue(any(item['path'].endswith('专业代号对照_2027.pdf')
                                for item in manifest['files']))

            with patch('convert.ingest_year.validate_attachment'), \
                    patch('convert.ingest_year.download_entry', side_effect=download), \
                    patch('convert.extract_cli.extract_entry', return_value=CANONICAL['mappingCodeTable']):
                ingest_year(seed, data, REPO_ROOT / 'metadata/school-data.template.json',
                            metadata, FakeSession())
                repeated = ingest_year(seed, data, REPO_ROOT / 'metadata/school-data.template.json',
                                       metadata, FakeSession(), check=True)
            self.assertFalse(repeated['complete'])
            self.assertTrue((data / f'专业对照/专业代号对照_{YEAR}.json').is_file())
            self.assertEqual(metadata.read_bytes(), original_metadata)

    def test_score_segments_without_scorelines_or_plans_are_archived_without_normalization(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            data, metadata, original_metadata = seed_data(root)
            seed = root / 'year-links' / '2027.json'
            seed.parent.mkdir()
            seed.write_text(json.dumps({'year': YEAR, 'sources': {
                'scoreSegments': {'pageUrl': PAGES['scoreSegments']},
            }}, ensure_ascii=False), encoding='utf-8')
            template = REPO_ROOT / 'metadata/school-data.template.json'

            with patch('convert.ingest_year.validate_attachment'), \
                    patch('convert.ingest_year.convert_target') as convert:
                report = ingest_year(seed, data, template, metadata, FakeSession(), check=True)

            convert.assert_not_called()
            self.assertFalse(report['complete'])
            self.assertTrue(any(item.startswith('scorelines:')
                                for item in report['normalizationDeferred']))
            self.assertTrue(any(item.startswith('plans:')
                                for item in report['normalizationDeferred']))
            self.assertEqual(original_metadata, metadata.read_bytes())

    def test_412_missing_pdf_and_ocr_review_leave_active_metadata_unchanged(self):
        for failure in ('412', 'missing-pdf', 'ocr-review'):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                data, metadata, old_metadata = seed_data(root)
                seed = make_seed(root)
                template = REPO_ROOT / 'metadata/school-data.template.json'
                session = FakeSession(
                    blocked_url=PAGES['scorelines'] if failure == '412' else None,
                    missing_url=ATTACHMENTS['scorelines'] if failure == 'missing-pdf' else None)
                mocks = mocked_tabular_parsers(needs_review=failure == 'ocr-review')
                with mocks[0], mocks[1], mocks[2]:
                    with self.assertRaises((RuntimeError, ValueError)):
                        ingest_year(seed, data, template, metadata, session)
                self.assertEqual(metadata.read_bytes(), old_metadata)
                self.assertFalse((data / '专业对照/专业对照_2027.json').exists())

    def test_existing_canonical_collision_is_preserved_and_not_published(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            data, metadata, old_metadata = seed_data(root, collision=True)
            seed = make_seed(root)
            template = REPO_ROOT / 'metadata/school-data.template.json'
            canonical = data / '专业对照/专业对照_2027.json'
            old_canonical = canonical.read_bytes()
            mocks = mocked_tabular_parsers()
            with mocks[0], mocks[1], mocks[2]:
                with self.assertRaisesRegex(ValueError, 'overwrite existing file'):
                    ingest_year(seed, data, template, metadata, FakeSession())
            self.assertEqual(canonical.read_bytes(), old_canonical)
            self.assertEqual(metadata.read_bytes(), old_metadata)


if __name__ == '__main__':
    unittest.main()
