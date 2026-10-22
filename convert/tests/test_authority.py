import unittest

from convert.authority import SourceValue, resolve_field


class AuthorityResolutionTest(unittest.TestCase):
    def test_uses_highest_priority_official_source_and_records_reason(self):
        result = resolve_field("majorName", [
            SourceValue("经济学", "manifest:score-line", 100),
            SourceValue("经济学类", "manifest:ocr", 50),
        ])
        self.assertEqual("经济学", result.value)
        self.assertEqual("manifest:score-line", result.source_id)
        self.assertEqual("highest-priority", result.reason)
        self.assertFalse(result.blocking)

    def test_falls_back_when_higher_priority_value_is_empty(self):
        result = resolve_field("planCount", [
            SourceValue(None, "manifest:master", 100),
            SourceValue(20, "manifest:plan", 80),
        ])
        self.assertEqual(20, result.value)
        self.assertEqual("fallback-nonempty", result.reason)

    def test_equal_priority_conflict_blocks_publication(self):
        result = resolve_field("cumulativeCount", [
            SourceValue(88, "manifest:pdf-a", 100),
            SourceValue(68, "manifest:pdf-b", 100),
        ])
        self.assertTrue(result.blocking)
        self.assertEqual("unresolved-conflict", result.reason)
        self.assertIsNone(result.value)


if __name__ == "__main__":
    unittest.main()
