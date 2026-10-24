import unittest
import subprocess
import sys
from pathlib import Path

from crawler.discover import DiscoveryBlockedError, discover_year
from crawler.year_sources import (
    SourceResolutionError,
    crawl_target_for_seed,
    load_seed_targets,
    load_year_links,
    resolve_score_segment_target,
)


class Response:
    def __init__(self, text):
        self.text = text

    def raise_for_status(self):
        return None


class Session:
    def __init__(self, pages):
        self.pages = pages

    def get(self, url, timeout=60):
        return Response(self.pages[url])


class DiscoverTest(unittest.TestCase):
    def test_script_entrypoint_loads_package_imports(self):
        result = subprocess.run(
            [sys.executable, 'crawler/discover.py', '--help'],
            capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_loads_targets_from_year_seeds_and_filters_non_contiguous_years(self):
        targets = load_seed_targets(Path('data/year-links').glob('*.json'), {2024, 2026})
        self.assertEqual([(target.dataset, target.year) for target in targets],
                         [('score-segments', 2024), ('score-segments', 2026)])

    def test_seed_target_uses_only_official_seed_urls(self):
        seed = load_year_links(Path('data/year-links/2025.json'))
        target = crawl_target_for_seed(seed)
        self.assertEqual((target.dataset, target.year), ('score-segments', 2025))
        self.assertTrue(target.discovery_url.startswith('https://www.haeea.cn/'))

    def test_missing_segment_page_resolves_one_official_search_candidate(self):
        seed = {'year': 2027, 'searchPageUrl': 'https://www.haeea.cn/search', 'sources': {}}
        candidate = 'https://www.haeea.cn/a/segments-2027.shtml'
        session = Session({'https://www.haeea.cn/search':
            f'<div><a href="{candidate}">2027年专升本分数段统计表</a></div>'})

        target = resolve_score_segment_target(seed, session)

        self.assertEqual(target.source_page_url, candidate)
        self.assertEqual(target.discovery_url, candidate)

    def test_missing_segment_page_rejects_ambiguous_search_candidates(self):
        seed = {'year': 2027, 'searchPageUrl': 'https://www.haeea.cn/search', 'sources': {}}
        session = Session({'https://www.haeea.cn/search':
            '<a href="/a/one">2027 分数段统计表</a><a href="/a/two">2027 分数段统计表</a>'})
        with self.assertRaisesRegex(SourceResolutionError, 'found 2'):
            resolve_score_segment_target(seed, session)

    def test_discovers_unique_official_pdfs_sorted_by_major_code(self):
        target = crawl_target_for_seed(load_year_links(Path('data/year-links/2025.json')))
        html = '''
        <h1>2025年专升本分数段统计表</h1>
        <a href="https://news.haeea.cn:8168/attach/file/x/表(U6大数据管理与应用).pdf">U6</a>
        <a href="/attach/file/x/表(01经济学).pdf">01</a>
        <a href="/attach/file/x/表(01经济学).pdf">重复</a>
        <a href="https://example.com/fake.pdf">非官方</a>
        '''
        entries = discover_year(target, html)
        self.assertEqual([entry.major_code for entry in entries], ['01', 'U6'])
        self.assertTrue(all('haeea.cn' in entry.pdf_url for entry in entries))

    def test_rejects_antibot_or_empty_pages(self):
        target = crawl_target_for_seed(load_year_links(Path('data/year-links/2025.json')))
        with self.assertRaises(DiscoveryBlockedError):
            discover_year(target, '<script>window.location.reload()</script>')

    def test_rejects_pdf_page_for_the_wrong_year(self):
        target = crawl_target_for_seed(load_year_links(Path('data/year-links/2025.json')))
        with self.assertRaisesRegex(DiscoveryBlockedError, '年份或类型'):
            discover_year(target, '<h1>2024年专升本分数段统计表</h1><a href="/a/(01经济学).pdf">下载</a>')


if __name__ == '__main__':
    unittest.main()
