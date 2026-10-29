import unittest
from pathlib import Path
from unittest.mock import patch

from convert.scanned_tables import _group_scanned_table_tokens
from convert.source_references import canonical_plan_major_name, school_code
from convert.plan_parser import extract_plans
from convert.scoreline_parser import _scoreline_rows_from_table


def box(center_x: float, center_y: float):
    return [[center_x - 1, center_y - 1], [center_x + 1, center_y - 1],
            [center_x + 1, center_y + 1], [center_x - 1, center_y + 1]]


class ScannedPlanTableTests(unittest.TestCase):
    def test_ocr_tokens_are_grouped_by_detected_row_and_column_lines(self):
        boxes = [box(5, 5), box(15, 5), box(25, 5), box(15, 15), box(25, 15)]
        texts = ['01', '经济学', '29', '金融学', '20']

        rows = _group_scanned_table_tokens(boxes, texts, [0, 10, 20, 30], [0, 10, 20])

        self.assertEqual(rows, [['01', '经济学', '29'], ['', '金融学', '20']])

    def test_scoreline_parser_reads_both_side_by_side_tables_and_repairs_codes(self):
        references = {'经济学': {'01'}, '智能制造工程': {'H9'}}
        row = ['01', '经济学', '96', '', '6H', '智能制造工程', '80']

        parsed = _scoreline_rows_from_table(row, references)

        self.assertEqual(parsed, [
            {'专业代号': '01', '专业名称': '经济学', '分数线': 96},
            {'专业代号': 'H9', '专业名称': '智能制造工程', '分数线': 80},
        ])

    def test_plan_ocr_noise_uses_reference_major_name_and_school_code(self):
        self.assertEqual(school_code('HigherExam6086'), '6086')
        self.assertEqual(
            canonical_plan_major_name('学前教育High', '17', {'17': '学前教育'}),
            '学前教育',
        )
        self.assertEqual(
            canonical_plan_major_name('学前教育(师范)', '17', {'17': '学前教育'}),
            '学前教育(师范)',
        )

    def test_plan_optional_column_is_determined_by_table_width(self):
        base = ['17', '学前教育', '10', '2', '4400', '800', '6086', '某大学', '地址']
        rows = [base + ['电话', '网址'], base + ['说明', '电话', '网址']]
        with patch('convert.plan_parser.tables_of', return_value=[[row] for row in rows]):
            plans = extract_plans(Path('unused.pdf'), 2023)
        self.assertEqual([row['其他说明'] for row in plans], ['', '说明'])
        self.assertEqual([row['咨询电话'] for row in plans], ['电话', '电话'])

    def test_blank_plan_cost_and_duration_are_not_invented_as_zero(self):
        row = ['17', '学前教育', '10', '', '', '', '6086', '某大学', '地址', '电话', '网址']
        with patch('convert.plan_parser.tables_of', return_value=[[row]]):
            plans = extract_plans(Path('unused.pdf'), 2023)
        self.assertIsNone(plans[0]['学制'])
        self.assertIsNone(plans[0]['学费标准'])
        self.assertIsNone(plans[0]['最低住宿费'])


if __name__ == '__main__':
    unittest.main()
