import tempfile
import unittest
from pathlib import Path

from convert.common import write_json
from convert.local_tables import load_local_tables, local_source_rows, record_local_tables
from convert.refresh_catalog import _source_catalog


class LocalTablesTest(unittest.TestCase):
    def test_local_mapping_and_college_tables_need_no_year_link(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            year = 2032
            paths = [root / f'专业对照/原始PDF/专业代号对照_{year}.pdf',
                     root / f'专业对照/原始PDF/专业对照一览_{year}.pdf',
                     root / f'招生高校及专业/原始PDF/招生高校及专业_{year}.pdf']
            for path in paths:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b'%PDF-1.4\nfixture')
            rows = local_source_rows(root, year)
            self.assertEqual({row['parser'] for row in rows}, {'mapping', 'master'})
            paths[1].unlink()
            self.assertEqual({row['parser'] for row in local_source_rows(root, year)},
                             {'mappingCodeTable', 'master'})
            paths[1].write_bytes(b'%PDF-1.4\nfixture')
            for row in rows:
                write_json(root / row['outputPath'], [])
            record_local_tables(root, year, rows)
            self.assertEqual(load_local_tables(root)[year]['mapping'], f'专业对照/专业对照_{year}.json')
            catalog = _source_catalog(root, {2031: {'mapping': '专业对照/专业对照_2031.json'}})
            self.assertEqual(catalog['mapping'][str(year)], f'data/专业对照/专业对照_{year}.json')
            self.assertEqual(catalog['colleges'][str(year)], f'data/招生高校及专业/招生高校及专业_{year}.json')
            paths[1].write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError, 'local table source changed'):
                load_local_tables(root)


if __name__ == '__main__':
    unittest.main()
