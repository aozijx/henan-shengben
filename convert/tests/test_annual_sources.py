import json
import tempfile
import unittest
from pathlib import Path

from convert.common import DATA_ROOT, load_data_plan


class AnnualSourcePlanTests(unittest.TestCase):
    def test_repository_plan_is_derived_from_year_seeds_and_local_files(self):
        plan = load_data_plan(DATA_ROOT)
        self.assertEqual([target['year'] for target in plan['targets']], [2023, 2024, 2025, 2026])
        self.assertEqual(
            [(row['year'], row['parser']) for row in plan['sources']],
            [(2023, 'plans'), (2023, 'scorelines'),
             (2024, 'plans'), (2024, 'scorelines'),
             (2025, 'plans'), (2025, 'scorelines'),
             (2026, 'mapping'), (2026, 'master'), (2026, 'plans'), (2026, 'scorelines')],
        )
        target = plan['targets'][3]
        self.assertEqual(target['manifestPath'], '来源清单/来源清单_2026.json')
        self.assertEqual(target['conversionReportPath'], 'reports/转换报告_2026.json')

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

            plan = load_data_plan(root, {2024, 2028})

            self.assertEqual([target['year'] for target in plan['targets']], [2024, 2028])
            self.assertEqual([(row['year'], row['parser']) for row in plan['sources']],
                             [(2024, 'plans'), (2028, 'plans')])

if __name__ == '__main__':
    unittest.main()
