import unittest
from pathlib import Path

from tools import convert


class SourceRegistryTest(unittest.TestCase):
    def test_registry_is_the_single_source_of_file_paths_and_counts(self):
        entries = convert.SOURCE_REGISTRY
        outputs = [entry.output_path for entry in entries]

        self.assertEqual(len(outputs), len(set(outputs)))
        self.assertEqual(convert.EXPECTED_COUNTS, {
            entry.output_path: entry.expected_count for entry in entries
        })
        self.assertEqual(convert.SOURCES, [
            (entry.output_path, entry.extract) for entry in entries
        ])
        for entry in entries:
            for pdf_path in entry.pdf_paths:
                self.assertTrue((convert.DATA / pdf_path).is_file(), pdf_path)


if __name__ == '__main__':
    unittest.main()
