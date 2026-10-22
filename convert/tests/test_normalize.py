import json
import unittest
from pathlib import Path

from convert.normalize import normalize_target


REPO_ROOT = Path(__file__).resolve().parents[2]


class NormalizeTest(unittest.TestCase):
    def test_all_years_have_no_blockers_and_official_empty_is_explicit(self):
        data_root = REPO_ROOT / "data"
        registry = json.loads((data_root / "source-registry.json").read_text(encoding="utf-8"))
        summaries = []
        for target in registry["crawlTargets"]:
            document, report = normalize_target(target, registry, data_root)
            summaries.append((report["year"], len(document["majors"]), report["officialEmptyCount"], report["blockingCount"]))
        self.assertEqual([(2024, 140, 0, 0), (2025, 172, 0, 0), (2026, 185, 1, 0)], summaries)

    def test_normalized_majors_are_sorted_and_traceable(self):
        data_root = REPO_ROOT / "data"
        registry = json.loads((data_root / "source-registry.json").read_text(encoding="utf-8"))
        document, _ = normalize_target(registry["crawlTargets"][2], registry, data_root)
        codes = [item["majorCode"] for item in document["majors"]]
        self.assertEqual(sorted(codes), codes)
        self.assertTrue(all(item["sourceId"] and item["sourceSha256"] for item in document["majors"]))
        self.assertNotIn("N8", codes)


if __name__ == "__main__":
    unittest.main()
