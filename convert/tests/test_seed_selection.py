import unittest

from convert.seed_selection import select_unpublished


class SeedSelectionTest(unittest.TestCase):
    def test_published_year_is_skipped_and_partial_year_is_selected(self):
        metadata = {'supportedYears': [2023, 2024, 2025, 2026],
                    'yearSources': {'2026': {}}}
        selected, skipped = select_unpublished([
            'data/year-links/2026.json', 'data/year-links/2027.json',
            'data/year-links/2027.json'], metadata)
        self.assertEqual(selected, ['data/year-links/2027.json'])
        self.assertEqual(skipped, ['data/year-links/2026.json'])

    def test_rejects_other_paths(self):
        with self.assertRaises(ValueError):
            select_unpublished(['../data/year-links/2027.json'], {})


if __name__ == '__main__':
    unittest.main()
