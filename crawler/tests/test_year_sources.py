import json
import tempfile
import unittest
from pathlib import Path

from crawler.year_sources import (
    SOURCE_ROLES,
    SourceResolutionError,
    load_year_links,
    registry_rows_for_year,
    resolve_year_sources,
    validate_attachment,
)


class FakeResponse:
    def __init__(self, text=''):
        self.text = text

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
                         'https://www.haeea.cn/govsearch?page=1&words=%E5%88%86%E6%95%B0%E6%AE%B5%E7%BB%9F%E8%AE%A1%E8%A1%A8')
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

    def test_master_is_required_and_resolves_as_official_source(self):
        self.assertIn('master', SOURCE_ROLES)
        resolved = resolve_year_sources(self.seed, FakeSession())
        self.assertEqual(resolved['attachments']['master'][0]['url'], self.seed['sources']['master']['attachmentUrl'])

        without_master = dict(self.seed, sources={k: v for k, v in self.seed['sources'].items() if k != 'master'})
        with self.assertRaisesRegex(SourceResolutionError, 'master'):
            resolve_year_sources(without_master, FakeSession())

    def test_xcoss_host_is_allowed_but_arbitrary_pdf_host_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'year-links.json'
            path.write_text(json.dumps(self.seed), encoding='utf-8')
            load_year_links(path)
            self.seed['sources']['master']['attachmentUrl'] = 'https://mirror.example/master.pdf'
            path.write_text(json.dumps(self.seed), encoding='utf-8')
            with self.assertRaisesRegex(SourceResolutionError, 'official HTTPS host'):
                load_year_links(path)

    def test_registry_includes_master_parser_row(self):
        resolved = resolve_year_sources(self.seed, FakeSession())
        sources, _crawl = registry_rows_for_year(resolved)
        row = next(row for row in sources if row['parser'] == 'master')
        self.assertEqual(row['outputPath'], '招生高校及专业/招生高校及专业_2027.json')
        self.assertEqual(row['pdfPaths'], ['招生高校及专业/原始PDF/招生高校及专业_2027.pdf'])

    def test_master_type_marker_matches_committed_official_2026_pdf(self):
        source_pdf = Path(__file__).resolve().parents[2] / 'data/招生高校及专业/原始PDF/招生高校及专业_2026.pdf'
        validate_attachment('master', 2026, source_pdf.read_bytes())

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
        rows, _target = registry_rows_for_year(resolved)
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

    def test_rejects_missing_required_role_and_html_412(self):
        seed = dict(self.seed, sources={k: v for k, v in self.seed['sources'].items() if k != 'master'})
        with self.assertRaisesRegex(SourceResolutionError, 'master'):
            resolve_year_sources(seed, FakeSession())
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
