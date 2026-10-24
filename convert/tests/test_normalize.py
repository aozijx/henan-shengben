import unittest
from pathlib import Path

from convert.common import load_data_plan
from convert.normalize import normalize_target


REPO_ROOT = Path(__file__).resolve().parents[2]


class NormalizeTest(unittest.TestCase):
    def test_all_years_have_no_blockers_and_official_empty_is_explicit(self):
        data_root = REPO_ROOT / "data"
        plan = load_data_plan(data_root)
        summaries = []
        for target in plan["targets"]:
            document, report = normalize_target(target, plan, data_root)
            summaries.append((report["year"], len(document["majors"]), report["officialEmptyCount"], report["blockingCount"]))
        self.assertEqual([(2024, 140, 0, 0), (2025, 172, 0, 0), (2026, 185, 1, 0)], summaries)

    def test_normalized_majors_are_sorted_and_traceable(self):
        data_root = REPO_ROOT / "data"
        plan = load_data_plan(data_root)
        document, _ = normalize_target(plan["targets"][2], plan, data_root)
        codes = [item["majorCode"] for item in document["majors"]]
        self.assertEqual(sorted(codes), codes)
        self.assertTrue(all(item["sourceId"] and item["sourceSha256"] for item in document["majors"]))
        self.assertNotIn("N8", codes)


if __name__ == "__main__":
    unittest.main()
