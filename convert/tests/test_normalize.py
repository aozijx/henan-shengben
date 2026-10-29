import unittest
import tempfile
from pathlib import Path

from crawler.source_plan import build_data_plan
from pipeline_io import read_json
from convert.normalize import normalize_target
from convert.segment_store import merge_year


REPO_ROOT = Path(__file__).resolve().parents[2]


class NormalizeTest(unittest.TestCase):
    def _published_plan(self, data_root):
        metadata = read_json(REPO_ROOT / 'metadata/school-data.json')
        return build_data_plan(data_root, set(metadata['supportedYears']))

    def test_reviewed_inputs_never_become_published_majors(self):
        data_root = REPO_ROOT / "data"
        plan = self._published_plan(data_root)
        for target in plan["targets"]:
            current = merge_year(data_root / target['normalizedPath'], data_root)
            document, report = normalize_target(target, plan, data_root, current)
            reviewed = {item['majorCode'] for item in document['majors'] if item['status'] != 'ok'}
            published = {item['majorCode'] for item in document['majors'] if item['status'] == 'ok'}
            self.assertFalse(reviewed & published)
            self.assertEqual(len(published), report['publishedMajorCount'])
            self.assertEqual(len(current['majors']), report['inputMajorCount'])
            self.assertEqual(len(current['majors']), len(published) +
                             report['officialEmptyCount'] + len(report['blockers']))

    def test_normalized_majors_are_sorted_and_traceable(self):
        data_root = REPO_ROOT / "data"
        plan = self._published_plan(data_root)
        target = next(item for item in plan["targets"] if item["year"] == 2026)
        current = merge_year(data_root / target['normalizedPath'], data_root)
        document, _ = normalize_target(target, plan, data_root, current)
        codes = [item["majorCode"] for item in document["majors"] if item.get('status') == 'ok']
        self.assertEqual(sorted(codes), codes)
        self.assertTrue(all(item["sourceId"] and item["sourceSha256"] for item in document["majors"]))
        self.assertNotIn("N8", codes)

    def test_default_report_omits_success_resolutions_and_full_report_includes_them(self):
        data_root = REPO_ROOT / 'data'
        plan = self._published_plan(data_root)
        target = plan['targets'][0]
        current = merge_year(data_root / target['normalizedPath'], data_root)
        _, report = normalize_target(target, plan, data_root, current)
        _, full_report = normalize_target(target, plan, data_root, current, full_report=True)
        self.assertEqual([], report['resolutions'])
        self.assertTrue(full_report['resolutions'])
        self.assertEqual(full_report['blockers'], report['blockers'])

    def test_missing_scoreline_or_plan_outputs_fail_with_actionable_input_paths(self):
        with tempfile.TemporaryDirectory() as directory:
            data_root = Path(directory)
            target = {
                'year': 2023,
                'dataset': 'score-segments',
                'manifestPath': '来源清单/来源清单_2023.json',
            }
            plan = {'sources': [
                {'year': 2023, 'parser': 'scorelines', 'outputPath': '省控线/省控线_2023.json'},
                {'year': 2023, 'parser': 'plans', 'outputPath': '招生计划/招生计划_2023.json'},
            ]}
            source_document = {'year': 2023, 'dataset': 'score-segments', 'majors': []}

            with self.assertRaisesRegex(ValueError, '省控线/省控线_2023.json') as error:
                normalize_target(target, plan, data_root, source_document)

            self.assertIn('招生计划/招生计划_2023.json', str(error.exception))


if __name__ == "__main__":
    unittest.main()
