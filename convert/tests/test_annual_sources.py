import json
import tempfile
import unittest
from pathlib import Path

from convert.paths import DATA_ROOT
from crawler.source_plan import build_data_plan, load_year_links, seed_paths_in


class AnnualSourcePlanTests(unittest.TestCase):
    def test_repository_plan_is_derived_from_year_seeds_and_local_files(self):
        plan = build_data_plan(DATA_ROOT)
        seeds = [load_year_links(path) for path in seed_paths_in(DATA_ROOT)]
        expected_targets = [seed['year'] for seed in seeds if 'scoreSegments' in seed.get('sources', {})]
        self.assertEqual([target['year'] for target in plan['targets']], expected_targets)
        source_parsers = {(row['year'], row['parser']) for row in plan['sources']}
        for seed in seeds:
            roles = seed.get('sources', {})
            year = seed['year']
            if 'mappingCodeTable' in roles:
                self.assertIn((year, 'mappingCodeTable'), source_parsers)
            if 'mappingCodeTable' in roles and 'mappingOverview' not in roles:
                self.assertNotIn((year, 'mapping'), source_parsers)
        for target in plan['targets']:
            year = target['year']
            self.assertEqual(target['manifestPath'], f'来源清单/来源清单_{year}.json')
            self.assertEqual(target['conversionReportPath'], f'reports/转换报告_{year}.json')

    def test_custom_root_and_non_contiguous_year_filter(self):
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

            plan = build_data_plan(root, {2024, 2028})

            self.assertEqual([target['year'] for target in plan['targets']], [2024, 2028])
            self.assertEqual([(row['year'], row['parser']) for row in plan['sources']],
                             [(2024, 'plans'), (2028, 'plans')])

if __name__ == '__main__':
    unittest.main()
