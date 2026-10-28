import tempfile
import unittest
from pathlib import Path

from convert.common import read_json, write_json


class JsonWritingTest(unittest.TestCase):
    def test_pretty_json_is_utf8_and_unchanged_content_is_not_rewritten(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'nested' / 'report.json'
            value = {'年份': 2027, 'sources': ['专业对照']}
            write_json(path, value, indent=2)
            content = path.read_bytes()
            self.assertIn(b'\n  "sources": [', content)
            self.assertEqual(read_json(path), value)
            write_json(path, value, indent=2)
            self.assertEqual(path.read_bytes(), content)
            self.assertFalse(path.with_name(path.name + '.new').exists())


if __name__ == '__main__':
    unittest.main()
