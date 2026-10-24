import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from convert.segment_store import iter_year, main, merge_year, write_year


class SegmentStoreTests(unittest.TestCase):
    def test_round_trip_and_single_major_update(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            path = root / '一分一段/一分一段_2027.json'
            document = {'schemaVersion': 1, 'dataset': 'score-segments', 'year': 2027,
                        'sourceManifest': '来源清单/来源清单_2027.json',
                        'majors': [
                            {'majorCode': '51', 'majorName': '计算机科学与技术', 'status': 'ok', 'segments': [1]},
                            {'majorCode': '53', 'majorName': '网络工程', 'status': 'needs-review', 'segments': []}],
                        'summary': {'total': 2, 'ok': 1, 'needsReview': 1}}
            write_year(path, root, document)
            index = json.loads(path.read_text(encoding='utf-8'))
            self.assertEqual(2, index['schemaVersion'])
            self.assertFalse(any('segments' in item for item in index['majors']))
            self.assertEqual(document, merge_year(path, root))
            untouched = root / index['majors'][0]['path']
            before = untouched.read_bytes()
            document['majors'][1]['status'] = 'ok'
            document['majors'][1]['segments'] = [2]
            document['summary'] = {'total': 2, 'ok': 2, 'needsReview': 0}
            write_year(path, root, document)
            self.assertEqual(before, untouched.read_bytes())
            self.assertEqual(document, merge_year(path, root))

    def test_rejects_path_escape_and_modified_shard(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            path = root / '一分一段/一分一段_2027.json'
            write_year(path, root, {'schemaVersion': 1, 'year': 2027,
                'sourceManifest': '来源清单/来源清单_2027.json',
                'majors': [{'majorCode': '51', 'majorName': '计算机', 'segments': [1]}]})
            index = json.loads(path.read_text(encoding='utf-8'))
            shard = root / index['majors'][0]['path']
            shard.write_text('{}', encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'hash mismatch'):
                list(iter_year(path, root))
            index['majors'][0]['path'] = '../outside.json'
            path.write_text(json.dumps(index), encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'invalid shard path'):
                list(iter_year(path, root))

    def test_duplicate_code_is_preflighted_without_writing_shards(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            path = root / '一分一段/一分一段_2027.json'
            doc = {'schemaVersion': 1, 'year': 2027, 'sourceManifest': 'manifest.json',
                   'majors': [{'majorCode': '51', 'majorName': '甲'},
                              {'majorCode': '51', 'majorName': '乙'}]}
            with self.assertRaisesRegex(ValueError, 'duplicate major code'):
                write_year(path, root, doc)
            self.assertFalse(path.exists())
            self.assertFalse((path.parent / '2027').exists())

    def test_merge_locates_canonical_index_by_year(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            seeds = root / 'year-links'
            seeds.mkdir()
            (seeds / '2027.json').write_text(json.dumps({
                'year': 2027,
                'sources': {'scoreSegments': {'pageUrl': 'https://www.haeea.cn/2027'}}
            }), encoding='utf-8')
            index = root / '一分一段/一分一段_2027.json'
            document = {'schemaVersion': 1, 'year': 2027, 'dataset': 'score-segments',
                        'majors': [{'majorCode': '51', 'majorName': '计算机', 'status': 'ok'}]}
            write_year(index, root, document)
            output = root / 'merged.json'
            with patch('sys.argv', ['segment_store', '--year', '2027',
                                    '--data-root', str(root), '--output', str(output)]):
                self.assertEqual(0, main())
            self.assertEqual(document, json.loads(output.read_text(encoding='utf-8')))
            with patch('sys.argv', ['segment_store', '--year', '2027',
                                    '--data-root', str(root), '--output', str(output)]):
                with self.assertRaises(SystemExit):
                    main()


if __name__ == '__main__':
    unittest.main()
