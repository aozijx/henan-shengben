import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from convert.common import DATA_ROOT, load_data_plan


class AnnualSourcePlanTests(unittest.TestCase):
    def test_runtime_has_no_registry_or_crawl_target_configuration_reads(self):
        repo = Path(__file__).resolve().parents[2]
        runtime = list((repo / 'crawler').glob('*.py')) + list((repo / 'convert').glob('*.py'))
        for path in runtime:
            with self.subTest(path=path.relative_to(repo)):
                text = path.read_text(encoding='utf-8')
                self.assertNotIn('crawlTargets', text)
                self.assertNotIn('source-registry.json', text)
        self.assertFalse((repo / 'data/source-registry.json').exists())

    def test_repository_plan_is_derived_from_year_seeds_and_local_files(self):
        plan = load_data_plan(DATA_ROOT)
        self.assertEqual([target['year'] for target in plan['targets']], [2024, 2025, 2026])
        self.assertEqual(
            [(row['year'], row['parser']) for row in plan['sources']],
            [(2024, 'plans'), (2024, 'scorelines'),
             (2025, 'plans'), (2025, 'scorelines'),
             (2026, 'mapping'), (2026, 'master'), (2026, 'plans'), (2026, 'scorelines')],
        )
        target = plan['targets'][2]
        self.assertEqual(target['manifestPath'], '来源清单/来源清单_2026.json')
        self.assertEqual(target['conversionReportPath'], 'reports/转换报告_2026.json')

    def test_custom_root_and_non_contiguous_year_filter_ignore_legacy_registry(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            seeds = root / 'year-links'
            seeds.mkdir()
            for year in (2024, 2026, 2028):
                (seeds / f'{year}.json').write_text(json.dumps({
                    'year': year,
                    'sources': {
                        'scoreSegments': {'pageUrl': f'https://www.haeea.cn/{year}.shtml'},
                        'plans': {'pageUrl': f'https://www.haeea.cn/{year}-plans.shtml'},
                    },
                }), encoding='utf-8')
            (root / 'source-registry.json').write_text(json.dumps({
                'crawlTargets': [{'year': 2099}], 'sources': [{'year': 2099, 'parser': 'plans'}],
            }), encoding='utf-8')

            plan = load_data_plan(root, {2024, 2028})

            self.assertEqual([target['year'] for target in plan['targets']], [2024, 2028])
            self.assertEqual([(row['year'], row['parser']) for row in plan['sources']],
                             [(2024, 'plans'), (2028, 'plans')])

    def test_legacy_registry_flags_fail_with_a_migration_message(self):
        for module in ('convert.convert_all', 'convert.extract_cli', 'convert.normalize', 'convert.issue_reports'):
            with self.subTest(module=module):
                result = subprocess.run(
                    [sys.executable, '-m', module, '--registry', 'legacy.json'],
                    capture_output=True, text=True,
                )
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('year-links', result.stderr + result.stdout)


if __name__ == '__main__':
    unittest.main()
