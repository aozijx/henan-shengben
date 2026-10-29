"""Parse province-wide scoreline tables."""
from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from convert.source_references import canonical_major_code, major_codes
from convert.table_rows import is_header, is_title, rows_of, to_int
from convert.text import squash


def _scoreline_rows_from_table(row: list[str | None], references: dict[str, set[str]]) -> list[dict[str, Any]]:
    """Parse one scoreline row from a single or side-by-side table layout."""
    offsets = (0, 4) if len(row) >= 7 else (0,)
    parsed = []
    for offset in offsets:
        cells = row[offset:offset + 3]
        if len(cells) < 3 or is_header(cells) or is_title(cells):
            continue
        code, title, score = squash(cells[0]), squash(cells[1]), to_int(cells[2])
        if not title or score is None:
            continue
        code = canonical_major_code(code, title, references)
        if re.fullmatch(r"[0-9A-Z]{1,2}", code):
            parsed.append({"专业代号": code, "专业名称": title, "分数线": score})
    return parsed

def extract_scorelines(pdf_path: Path, reference_rows: list[dict[str, Any]] | None = None
                       ) -> list[dict[str, Any]]:
    rows = rows_of(pdf_path)
    references = major_codes(reference_rows)
    return [parsed for row in rows for parsed in _scoreline_rows_from_table(row, references)]
