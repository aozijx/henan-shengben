import unittest

from convert.pdf_tables import RawPdfRow
from convert.score_segments import parse_score_segments


class ParseScoreSegmentsTest(unittest.TestCase):
    def test_ignores_repeated_headers_and_normalizes_spaced_numbers(self):
        rows = [
            RawPdfRow(1, ("分数", "考生人数", "分数", "考生人数")),
            RawPdfRow(1, ("2 3 2", "1", "159", "3 2")),
            RawPdfRow(2, ("分数", "考生人数", "分数", "考生人数")),
            RawPdfRow(2, ("231", "2", "156", "33")),
        ]

        segments, issues = parse_score_segments(rows)

        self.assertEqual([(232, 1), (231, 2), (159, 32), (156, 33)], [(x.score, x.cumulative_count) for x in segments])
        self.assertEqual([], issues)

    def test_unrecognized_row_is_reported(self):
        segments, issues = parse_score_segments([RawPdfRow(1, ("水印", "", "", ""))])
        self.assertEqual([], segments)
        self.assertEqual("unrecognized-row", issues[0].code)

    def test_empty_input_is_reported(self):
        segments, issues = parse_score_segments([])
        self.assertEqual([], segments)
        self.assertEqual("no-segments", issues[0].code)

    def test_duplicate_score_rejects_all_segments(self):
        rows = [RawPdfRow(1, ("200", "3")), RawPdfRow(1, ("200", "4"))]
        segments, issues = parse_score_segments(rows)
        self.assertEqual([], segments)
        self.assertIn("duplicate-score", {issue.code for issue in issues})

    def test_cumulative_count_must_not_decrease_as_score_decreases(self):
        rows = [RawPdfRow(1, ("200", "10")), RawPdfRow(1, ("199", "9"))]
        segments, issues = parse_score_segments(rows)
        self.assertEqual([], segments)
        self.assertIn("non-monotonic-count", {issue.code for issue in issues})


if __name__ == "__main__":
    unittest.main()
