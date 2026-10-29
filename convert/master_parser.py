"""Parse the college-and-major master table."""
from __future__ import annotations

from pathlib import Path
from typing import Any

from convert.table_rows import is_header, rows_of
from convert.text import squash


def extract_master_table(pdf_path: Path) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    cur_code, cur_school = "", ""
    for row in rows_of(pdf_path):
        if len(row) < 8 or is_header(row):
            continue
        if squash(row[0]) and squash(row[1]):
            cur_code, cur_school = squash(row[0]), squash(row[1])
        major_code = squash(row[2])
        if not major_code:
            continue
        out.append({
            "院校代码": cur_code,
            "学校名称": cur_school,
            "专业代码": major_code,
            "专业名称": squash(row[3]),
            "学制": squash(row[4]),
            "师范": squash(row[5]),
            "艺术": squash(row[6]),
            "备注": squash(row[7]),
        })
    return out
