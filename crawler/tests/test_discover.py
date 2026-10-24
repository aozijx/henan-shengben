import unittest
import subprocess
import sys
from pathlib import Path

from crawler.discover import DiscoveryBlockedError, discover_year
from crawler.year_sources import crawl_target_for_seed, load_seed_targets, load_year_links


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

    def test_discovers_unique_official_pdfs_sorted_by_major_code(self):
        target = crawl_target_for_seed(load_year_links(Path('data/year-links/2025.json')))
        html = '''
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


if __name__ == '__main__':
    unittest.main()
