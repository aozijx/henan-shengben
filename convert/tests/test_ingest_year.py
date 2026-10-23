import unittest

from convert.ingest_year import source_role_for_attachment


class IngestSourceRoleTests(unittest.TestCase):
    def test_source_parser_attachment_role_mapping(self):
        self.assertEqual(source_role_for_attachment('master', 0), 'master')
        self.assertEqual(source_role_for_attachment('scorelines', 0), 'scorelines')
        self.assertEqual(source_role_for_attachment('plans', 0), 'plans')
        self.assertEqual(source_role_for_attachment('mapping', 0), 'mappingCodeTable')
        self.assertEqual(source_role_for_attachment('mapping', 1), 'mappingOverview')

    def test_rejects_unknown_or_extra_attachment(self):
        with self.assertRaises(ValueError):
            source_role_for_attachment('master', 1)
        with self.assertRaises(ValueError):
            source_role_for_attachment('unknown', 0)


if __name__ == '__main__':
    unittest.main()
