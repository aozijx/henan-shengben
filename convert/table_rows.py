"""Shared helpers for reading and screening rows from official PDF tables."""
from __future__ import annotations

import re
from pathlib import Path

from convert.scanned_tables import tables_of
from convert.text import squash


def to_int(text: str | None) -> int | None:
    text = squash(text)
    if not text:
        return None
    m = re.search(r"\d+", text)
    return int(m.group()) if m else None

def is_header(row: list[str | None]) -> bool:
    joined = squash("".join(c or "" for c in row[:3]))
    return "代号" in joined or "序号" in joined or "代码" in joined

def is_title(row: list[str | None]) -> bool:
    joined = squash("".join(c or "" for c in row))
    return "河南省" in joined and "代号" not in joined and len(squash(row[0] or "")) > 8

def rows_of(pdf_path: Path) -> list[list[str | None]]:
    """Flatten text or scanned tables across all pages."""
    return [row for table in tables_of(pdf_path) for row in table]
