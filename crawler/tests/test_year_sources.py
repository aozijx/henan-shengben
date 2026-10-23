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


class YearSourcesTests(unittest.TestCase):
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


if __name__ == '__main__':
    unittest.main()
