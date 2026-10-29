"""Reconcile OCR text with annual source manifests and known school codes."""
from __future__ import annotations

from collections import Counter, defaultdict
from pathlib import Path
import re
from typing import Any, Callable

from convert.text import squash
from pipeline_io import read_json


def _major_key(value: object) -> str:
    return re.sub(r"[（(][^（）()]*[）)]", "", squash(value))


def major_rows(data_root: Path, year: int) -> list[dict[str, str]]:
    path = data_root / f"来源清单/来源清单_{year}.json"
    if not path.is_file():
        return []
    document = read_json(path)
    return [{"专业代号": item.get("majorCode"), "专业名称": item.get("majorName")}
            for item in document.get("entries", [])]


def major_codes(rows: list[dict[str, Any]] | None) -> dict[str, set[str]]:
    refs: dict[str, set[str]] = {}
    for row in rows or []:
        key, code = _major_key(row.get("专业名称")), squash(row.get("专业代号"))
        if key and code:
            refs.setdefault(key, set()).add(code)
    return refs


def major_names(rows: list[dict[str, Any]] | None) -> dict[str, str]:
    return {squash(row.get("专业代号")): squash(row.get("专业名称"))
            for row in rows or [] if squash(row.get("专业代号")) and squash(row.get("专业名称"))}


def canonical_major_code(code: str, title: str, references: dict[str, set[str]]) -> str:
    matches = references.get(_major_key(title), set())
    return next(iter(matches)) if len(matches) == 1 else code


def canonical_plan_major_name(value: str | None, code: str, references: dict[str, str]) -> str:
    """Remove OCR watermark text and reconcile a damaged name by major code."""
    cleaned = re.sub(r"[A-Za-z]+", "", squash(value))
    expected = references.get(code, "")
    if not cleaned or not expected:
        return cleaned or expected
    cleaned_key, expected_key = _major_key(cleaned), _major_key(expected)
    return cleaned if cleaned_key and (cleaned_key in expected_key or expected_key in cleaned_key) else expected


def school_code(value: object) -> str:
    matches = re.findall(r"\d{4}", squash(value))
    return matches[-1] if matches else ""


def school_names(data_root: Path, year: int,
                 clean_school_name: Callable[[str | None], tuple[str, str, str]]) -> dict[str, str]:
    """Use the most common known name for a code when OCR loses its school text."""
    counts: dict[str, Counter[str]] = defaultdict(Counter)
    for path in sorted((data_root / "招生计划").glob("招生计划_*.json")):
        if path.stem == f"招生计划_{year}":
            continue
        try:
            rows = read_json(path)
        except (OSError, ValueError):
            continue
        for item in rows if isinstance(rows, list) else []:
            code = school_code(item.get("院校代号"))
            name, _nature, _poor = clean_school_name(item.get("院校名称"))
            if code and name:
                counts[code][name] += 1
    return {code: min(names, key=lambda name: (-names[name], name)) for code, names in counts.items()}
