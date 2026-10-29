import json
import tempfile
import unittest
from pathlib import Path

from crawler.year_sources import (
    SOURCE_ROLES,
    SourceResolutionError,
    build_data_plan,
    crawl_target_record,
    load_year_links,
    execution_rows_for_year,
    resolve_year_sources,
    seed_paths_in,
    source_rows_for_seed,
    score_segment_target_for_seed,
    _attachment_identity_evidence,
    validate_attachment,
)


class FakeResponse:
    def __init__(self, text=''):
        self.text = text
        self.content = text.encode('utf-8')

    def raise_for_status(self):
        return None


class FakeSession:
    def get(self, url, timeout=60):
        pages = {
            'https://www.haeea.cn/segments': '<div>2027 分数段统计表 一分一段<a href="/a/segment.pdf">分数段统计</a></div>',
            'https://www.haeea.cn/scorelines': '2027 录取控制分数线',
            'https://www.haeea.cn/plans': '2027 招生计划',
            'https://www.haeea.cn/mapping-code': '2027 专业代号对照 考试科目',
            'https://www.haeea.cn/mapping-overview': '2027 专业对照一览 专科专业 本科专业',
            'https://www.haeea.cn/master': '2027 招生高校及专业总表',
        }
        if url in pages:
            return FakeResponse(pages[url])
        raise AssertionError(f'unexpected URL: {url}')


class SearchSession(FakeSession):
    def __init__(self, search_html, pages=None, blocked_url=None):
        self.search_html = search_html
        self.pages = pages or {}
        self.blocked_url = blocked_url

    def get(self, url, timeout=60):
        if url == 'https://www.haeea.cn/search':
            return FakeResponse(self.search_html)
        if url == self.blocked_url:
            raise RuntimeError('HTTP 412')
        if url in self.pages:
            return FakeResponse(self.pages[url])
        return super().get(url, timeout)


class YearSourcesTests(unittest.TestCase):
    def test_mapping_only_seed_has_no_score_segment_execution_target(self):
        seed = {
            'year': 2027,
            'searchPageUrl': 'https://www.haeea.cn/search',
            'sources': {'mappingCodeTable': {'pageUrl': 'https://www.haeea.cn/mapping'}},
        }
        self.assertIsNone(score_segment_target_for_seed(seed))
        self.assertIsNone(crawl_target_record(seed))

        with tempfile.TemporaryDirectory() as directory:
            data_root = Path(directory)
            year_links = data_root / 'year-links'
            year_links.mkdir()
            (year_links / '2027.json').write_text(json.dumps(seed), encoding='utf-8')
            plan = build_data_plan(data_root)
            self.assertEqual(plan['targets'], [])

    def test_shared_data_plan_rejects_duplicate_year_seeds(self):
        seed = {'year': 2027, 'sources': {}}
        with tempfile.TemporaryDirectory() as directory:
            first = Path(directory) / '2027.json'
            second = Path(directory) / 'other' / '2027.json'
            second.parent.mkdir()
            first.write_text(json.dumps(seed), encoding='utf-8')
            second.write_text(json.dumps(seed), encoding='utf-8')
            with self.assertRaisesRegex(SourceResolutionError, 'duplicate year-links seed'):
                build_data_plan(Path(directory), seed_paths=[first, second])

    def test_seed_derives_every_year_specific_execution_path(self):
        target = score_segment_target_for_seed({
            'year': 2027,
            'searchPageUrl': 'https://www.haeea.cn/search',
            'sources': {'scoreSegments': {'pageUrl': 'https://www.haeea.cn/segments'}},
        })
        self.assertEqual(target.manifest_path, '来源清单/来源清单_2027.json')
        self.assertEqual(target.download_directory, '一分一段/原始PDF/2027')
        self.assertEqual(target.normalized_path, '一分一段/一分一段_2027.json')
        self.assertEqual(target.conversion_report_path, 'reports/转换报告_2027.json')

    def test_resolved_ingest_target_matches_shared_seed_target_record(self):
        page_url = 'https://www.haeea.cn/a/segments-2027.shtml'
        _sources, resolved_target = execution_rows_for_year({
            'year': 2027, 'pages': {'scoreSegments': page_url}, 'attachments': {},
        })
        self.assertEqual(resolved_target, crawl_target_record({
            'year': 2027, 'sources': {'scoreSegments': {'pageUrl': page_url}},
        }))

    def test_historical_year_links_are_the_authoritative_seed_inputs(self):
        data_root = Path(__file__).resolve().parents[2] / 'data' / 'year-links'
        seeds = {year: load_year_links(data_root / f'{year}.json') for year in (2024, 2025, 2026)}
        self.assertEqual({year: seed['year'] for year, seed in seeds.items()},
                         {2024: 2024, 2025: 2025, 2026: 2026})
        self.assertEqual(seeds[2024]['sources']['scoreSegments']['pageUrl'],
                         'https://www.haeea.cn/a/202404/43297_fd486546.shtml')
        self.assertEqual(seeds[2024]['sources']['scorelines']['attachmentUrl'],
                         'https://www.haeea.cn/attach/file/20240419/20240419145153_4343_bed9ca9e.pdf')
        self.assertEqual(seeds[2025]['searchPageUrl'],
                         'https://www.haeea.cn/GovSearch/News/Index?words=%E6%99%AE%E9%80%9A%E9%AB%98%E6%A0%A1%E4%B8%93%E5%8D%87%E6%9C%AC&page=1')
        self.assertEqual(seeds[2025]['sources']['scorelines']['attachmentUrl'],
                         'https://www.haeea.cn/attach/file/20250402/20250402075042_5843_f6e5d888.pdf')
        self.assertEqual(seeds[2026]['sources']['scoreSegments']['pageUrl'],
                         'https://www.haeea.cn/a/202604/43664_744774c0.shtml')
        self.assertEqual(seeds[2026]['sources']['scorelines']['attachmentUrl'],
                         'https://www.haeea.cn/attach/file/20260409/20260409072504_5957_16c52a46.pdf')

    def setUp(self):
        self.seed = {
            'year': 2027,
            'sources': {
                'scoreSegments': {'pageUrl': 'https://www.haeea.cn/segments'},
                'scorelines': {'pageUrl': 'https://www.haeea.cn/scorelines', 'attachmentUrl': 'https://www.haeea.cn/a/scorelines.pdf'},
                'plans': {'pageUrl': 'https://www.haeea.cn/plans', 'attachmentUrl': 'https://www.haeea.cn/a/plans.pdf'},
                'mappingCodeTable': {'pageUrl': 'https://www.haeea.cn/mapping-code', 'attachmentUrl': 'https://www.haeea.cn/a/专业代号对照.pdf'},
                'mappingOverview': {'pageUrl': 'https://www.haeea.cn/mapping-overview', 'attachmentUrl': 'https://www.haeea.cn/a/专业对照一览.pdf'},
                'master': {'pageUrl': 'https://www.haeea.cn/master', 'attachmentUrl': 'https://xcoss.henan.gov.cn/typtfile/2027/master.pdf'},
            },
        }

    def test_seed_discovery_skips_non_year_template_files(self):
        with tempfile.TemporaryDirectory() as directory:
            year_links = Path(directory) / 'year-links'
            year_links.mkdir()
            template = {
                'year': 2027,
                'searchPageUrl': 'https://www.haeea.cn/search',
                'sources': {'scoreSegments': {'pageUrl': '一分一段统计表的官方公告页'}},
            }
            (year_links / 'template.json').write_text(json.dumps(template), encoding='utf-8')
            seed = dict(template, sources={'scoreSegments': {'pageUrl': 'https://www.haeea.cn/segments'}})
            (year_links / '2027.json').write_text(json.dumps(seed), encoding='utf-8')
            self.assertEqual([path.name for path in seed_paths_in(directory)], ['2027.json'])
            plan = build_data_plan(directory)
            self.assertEqual([target['year'] for target in plan['targets']], [2027])

    def test_master_is_optional_and_resolves_when_declared(self):
        self.assertIn('master', SOURCE_ROLES)
        resolved = resolve_year_sources(self.seed, FakeSession())
        self.assertEqual(resolved['attachments']['master'][0]['url'], self.seed['sources']['master']['attachmentUrl'])

        without_master = dict(self.seed, sources={k: v for k, v in self.seed['sources'].items() if k != 'master'})
        partial = resolve_year_sources(without_master, FakeSession())
        self.assertNotIn('master', partial['attachments'])
        rows, crawl = execution_rows_for_year(partial)
        self.assertNotIn('master', [row['parser'] for row in rows])
        self.assertIsNotNone(crawl)

    def test_seed_local_path_can_keep_distinct_official_attachment_versions(self):
        seed = dict(self.seed, sources={key: dict(value) for key, value in self.seed['sources'].items()})
        seed['sources']['mappingOverview']['localPath'] = '专业对照/原始PDF/专业对照一览_附件2_2027.pdf'
        resolved = resolve_year_sources(seed, FakeSession())
        mapping_row = next(row for row in execution_rows_for_year(resolved)[0] if row['parser'] == 'mapping')
        self.assertEqual(mapping_row['pdfPaths'][1], seed['sources']['mappingOverview']['localPath'])
        seed_row = next(row for row in source_rows_for_seed(seed, Path('data')) if row['parser'] == 'mapping')
        self.assertEqual(seed_row['pdfPaths'][1], seed['sources']['mappingOverview']['localPath'])

    def test_seed_and_resolved_sources_share_table_paths(self):
        resolved = resolve_year_sources(self.seed, FakeSession())
        with tempfile.TemporaryDirectory() as directory:
            expected = {row['parser']: (row['outputPath'], row['pdfPaths'])
                        for row in source_rows_for_seed(self.seed, Path(directory))}
            actual = {row['parser']: (row['outputPath'], row['pdfPaths'])
                      for row in execution_rows_for_year(resolved)[0]}
            self.assertEqual(actual, expected)

    def test_partial_mapping_seed_ignores_stale_complete_mapping_file(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            seed = {'year': 2031, 'sources': {
                'mappingCodeTable': {'pageUrl': 'https://www.haeea.cn/codes'}}}
            stale = root / '专业对照/专业对照_2031.json'
            stale.parent.mkdir(parents=True)
            stale.write_text('[]', encoding='utf-8')
            rows = source_rows_for_seed(seed, root)
            self.assertIn('mappingCodeTable', [row['parser'] for row in rows])
            self.assertNotIn('mapping', [row['parser'] for row in rows])

    def test_seed_rejects_unsafe_source_local_path(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / '2027.json'
            seed = dict(self.seed, sources={key: dict(value) for key, value in self.seed['sources'].items()})
            seed['sources']['mappingOverview']['localPath'] = '../outside.pdf'
            path.write_text(json.dumps(seed), encoding='utf-8')
            with self.assertRaisesRegex(SourceResolutionError, 'localPath'):
                load_year_links(path)

    def test_xcoss_host_is_allowed_but_arbitrary_pdf_host_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'year-links.json'
            path.write_text(json.dumps(self.seed), encoding='utf-8')
            load_year_links(path)
            self.seed['sources']['master']['attachmentUrl'] = 'https://mirror.example/master.pdf'
            path.write_text(json.dumps(self.seed), encoding='utf-8')
            with self.assertRaisesRegex(SourceResolutionError, 'official HTTPS host'):
                load_year_links(path)
            self.seed['sources']['master']['attachmentUrl'] = 'http://xcoss.henan.gov.cn/typtfile/2027/master.pdf'
            path.write_text(json.dumps(self.seed), encoding='utf-8')
            with self.assertRaisesRegex(SourceResolutionError, 'official HTTPS host'):
                load_year_links(path)

    def test_education_authority_hosts_are_allowed_for_official_pages(self):
        for host, page in (
            ('gaokao.haedu.cn', 'https://gaokao.haedu.cn/501/552/2026/0408/151445.html'),
            ('jyt.henan.gov.cn', 'https://jyt.henan.gov.cn/2025/10-24/3238096.html'),
        ):
            with self.subTest(host=host), tempfile.TemporaryDirectory() as directory:
                seed = dict(self.seed, sources=dict(self.seed['sources']))
                seed['sources']['plans'] = {'pageUrl': page}
                path = Path(directory) / '2027.json'
                path.write_text(json.dumps(seed), encoding='utf-8')
                self.assertEqual(load_year_links(path), seed)

    def test_execution_rows_include_master_parser(self):
        resolved = resolve_year_sources(self.seed, FakeSession())
        sources, _crawl = execution_rows_for_year(resolved)
        row = next(row for row in sources if row['parser'] == 'master')
        self.assertEqual(row['outputPath'], '招生高校及专业/招生高校及专业_2027.json')
        self.assertEqual(row['pdfPaths'], ['招生高校及专业/原始PDF/招生高校及专业_2027.pdf'])

    def test_master_type_marker_matches_committed_official_2026_pdf(self):
        source_pdf = Path(__file__).resolve().parents[2] / 'data/招生高校及专业/原始PDF/招生高校及专业_2026.pdf'
        validate_attachment('master', 2026, source_pdf.read_bytes())

    def test_scanned_pdf_title_metadata_confirms_year_and_source_type(self):
        title = '<' + 'E:\\2026年河南省普通高校专升本招生分数段统计表'.encode('gb18030').hex().upper() + '>'
        evidence = _attachment_identity_evidence('', {'Title': title})
        self.assertIn('2026年河南省普通高校专升本招生分数段统计表', evidence)
        self.assertIn('2026', evidence)

    def test_scanned_pdf_identity_can_be_read_from_truncated_hex_title(self):
        title_hex = 'E:\\2026年河南省普通高校专升本招生分数段统计表(38机械设计制造及其自动化).FRX'.encode('gb18030').hex().upper()
        evidence = _attachment_identity_evidence('', {'Title': '<' + title_hex[:-1]})
        self.assertIn('2026年河南省普通高校专升本招生分数段统计表', evidence)

    def test_accepts_the_user_supplied_2026_official_page_and_scoreline_pdf_urls(self):
        seed = {
            'year': 2026,
            'sources': {
                'scoreSegments': {'pageUrl': 'https://www.haeea.cn/a/202604/43664_744774c0.shtml'},
                'scorelines': {'attachmentUrl': 'https://www.haeea.cn/attach/file/20260409/20260409072504_5957_16c52a46.pdf'},
            },
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'year-links.json'
            path.write_text(json.dumps(seed), encoding='utf-8')
            self.assertEqual(load_year_links(path), seed)

    def test_discovers_one_unique_missing_role_and_keeps_year_specific_paths(self):
        seed = dict(self.seed, searchPageUrl='https://www.haeea.cn/search', sources=dict(self.seed['sources']))
        seed['sources']['scorelines'] = dict(seed['sources']['scorelines'])
        seed['sources']['scorelines'].pop('pageUrl')
        candidate = 'https://www.haeea.cn/a/scorelines-2027'
        session = SearchSession(
            f'<div><a href="{candidate}">2027年专升本招生录取控制分数线</a></div>',
            pages={candidate: '2027 录取控制分数线'},
        )
        resolved = resolve_year_sources(seed, session)
        rows, _target = execution_rows_for_year(resolved)
        self.assertEqual(resolved['pages']['scorelines'], candidate)
        self.assertTrue(all(row['year'] == 2027 for row in rows))
        self.assertTrue(all('_2027.' in row['outputPath'] for row in rows))

    def test_rejects_ambiguous_search_candidates_for_same_year_and_role(self):
        seed = dict(self.seed, searchPageUrl='https://www.haeea.cn/search', sources=dict(self.seed['sources']))
        seed['sources']['scorelines'] = dict(seed['sources']['scorelines'])
        seed['sources']['scorelines'].pop('pageUrl')
        html = ('<div><a href="/a/first">2027年招生录取控制分数线</a></div>'
                '<div><a href="/a/second">2027年招生录取控制分数线</a></div>')
        with self.assertRaisesRegex(SourceResolutionError, 'expected one official page, found 2'):
            resolve_year_sources(seed, SearchSession(html))

    def test_skips_undeclared_role_but_rejects_html_412_for_declared_source(self):
        seed = dict(self.seed, sources={k: v for k, v in self.seed['sources'].items() if k != 'master'})
        resolved = resolve_year_sources(seed, FakeSession())
        self.assertNotIn('master', resolved['attachments'])
        with self.assertRaisesRegex(RuntimeError, '412'):
            resolve_year_sources(self.seed, SearchSession('', blocked_url=self.seed['sources']['scorelines']['pageUrl']))

    def test_rejects_explicit_page_that_has_wrong_year_or_type(self):
        seed = dict(self.seed, sources=dict(self.seed['sources']))
        seed['sources']['scorelines'] = dict(seed['sources']['scorelines'])
        seed['sources']['scorelines']['pageUrl'] = self.seed['sources']['scoreSegments']['pageUrl']
        with self.assertRaisesRegex(SourceResolutionError, 'does not confirm the year and source type'):
            resolve_year_sources(seed, FakeSession())


if __name__ == '__main__':
    unittest.main()
