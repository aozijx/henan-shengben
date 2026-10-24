import unittest
from pathlib import Path

from convert.common import load_data_plan
from convert.normalize import normalize_target
from convert.segment_store import merge_year


REPO_ROOT = Path(__file__).resolve().parents[2]


class NormalizeTest(unittest.TestCase):
    def test_reviewed_inputs_never_become_published_majors(self):
        data_root = REPO_ROOT / "data"
        plan = load_data_plan(data_root)
        for target in plan["targets"]:
            document, report = normalize_target(target, plan, data_root)
            current = merge_year(data_root / target['normalizedPath'], data_root)
            reviewed = {item['majorCode'] for item in document['majors'] if item['status'] != 'ok'}
            published = {item['majorCode'] for item in document['majors'] if item['status'] == 'ok'}
            self.assertFalse(reviewed & published)
            self.assertEqual(len(published), report['publishedMajorCount'])
            self.assertEqual(len(current['majors']), report['inputMajorCount'])
            self.assertEqual(len(current['majors']), len(published) +
                             report['officialEmptyCount'] + len(report['blockers']))

    def test_normalized_majors_are_sorted_and_traceable(self):
        data_root = REPO_ROOT / "data"
        plan = load_data_plan(data_root)
        document, _ = normalize_target(plan["targets"][2], plan, data_root)
        codes = [item["majorCode"] for item in document["majors"] if item.get('status') == 'ok']
        self.assertEqual(sorted(codes), codes)
        self.assertTrue(all(item["sourceId"] and item["sourceSha256"] for item in document["majors"]))
        self.assertNotIn("N8", codes)

    def test_default_report_omits_success_resolutions_and_full_report_includes_them(self):
        data_root = REPO_ROOT / 'data'
        plan = load_data_plan(data_root)
        _, report = normalize_target(plan['targets'][0], plan, data_root)
        _, full_report = normalize_target(plan['targets'][0], plan, data_root, full_report=True)
        self.assertEqual([], report['resolutions'])
        self.assertTrue(full_report['resolutions'])
        self.assertEqual(full_report['blockers'], report['blockers'])


if __name__ == "__main__":
    unittest.main()
