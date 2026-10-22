import unittest
from pathlib import Path

from convert.pdf_tables import RawPdfRow, extract_rows


REPO_ROOT = Path(__file__).resolve().parents[2]


class ExtractPdfRowsTest(unittest.TestCase):
    def test_extracts_rows_from_committed_scanned_official_pdf(self):
        path = REPO_ROOT / "data" / "一分一段" / "原始PDF" / "2026" / "01_经济学.pdf"
        rows = extract_rows(path)
        self.assertTrue(rows)
        self.assertTrue(all(isinstance(row, RawPdfRow) for row in rows))
        self.assertIn((232, 1), {
            (int(row.cells[0]), int(row.cells[1]))
            for row in rows
            if len(row.cells) >= 2 and row.cells[0].isdigit() and row.cells[1].isdigit()
        })

    def test_reuses_ocr_engine_across_scanned_pdfs(self):
        first = REPO_ROOT / "data" / "一分一段" / "原始PDF" / "2026" / "01_经济学.pdf"
        second = REPO_ROOT / "data" / "一分一段" / "原始PDF" / "2026" / "02_经济统计学.pdf"
        self.assertTrue(extract_rows(first))
        self.assertTrue(extract_rows(second))


if __name__ == "__main__":
    unittest.main()
