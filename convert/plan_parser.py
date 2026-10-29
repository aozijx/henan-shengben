"""Parse annual admissions-plan tables and reconcile OCR references."""
from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from convert.scanned_tables import tables_of
from convert.source_references import (
    canonical_major_code, canonical_plan_major_name, major_codes, major_names,
    school_code,
)
from convert.table_rows import is_header, to_int
from convert.text import squash


def _clean_school_name(raw: str | None) -> tuple[str, str, str]:
    """还原院校名称并识别标注：去掉 (专升本…)、(民办) 等括号标注与换行；
    建档立卡专项标注也在该括号内（如「(专升本只招建档立卡贫困家庭考生)」）。"""
    text = squash(raw)
    poor = "是" if "建档立卡" in text else "否"
    nature = "民办" if "民办" in text else "公办"
    text = re.sub(r"[（(]专升本[^（）()]*[）)]?", "", text)
    text = re.sub(r"[（(]民办[^（）()]*[）)]?", "", text)
    text = re.sub(r"[（(]民$", "", text)
    text = re.sub(r"[（(][^（）()]*[）)]", "", text)  # 其余注释括号，如（原新乡医学院三全学院）
    return text, nature, poor

def _clean_major_name(raw: str | None) -> str:
    """专业名称及方向：剔除「建档立卡」括号标注，保留 (师范) 等方向。"""
    text = squash(raw)
    if "建档立卡" in text:
        text = re.sub(r"[（(][^（）()]*建档立卡[^（）()]*[）)]?", "", text)
    return text

def extract_plans(
    pdf_path: Path,
    year: int,
    reference_rows: list[dict[str, Any]] | None = None,
    reference_school_names: dict[str, str] | None = None,
) -> list[dict[str, Any]]:
    """Extract every page, interpreting optional columns from actual table width."""
    out: list[dict[str, Any]] = []
    references = major_codes(reference_rows)
    reference_major_names = major_names(reference_rows)
    reference_school_names = reference_school_names or {}
    for table in tables_of(pdf_path):
        for row in table:
            if len(row) < 11 or is_header(row):
                continue
            code = squash(row[0])
            school_code_value = school_code(row[6])
            plan = to_int(row[2])
            if (
                not re.fullmatch(r"[0-9A-Z]{1,2}", code or "")
                or not school_code_value
                or plan is None
            ):
                continue
            if len(row) >= 12:
                addr, extra, phone, url = row[8], row[9], row[10], row[11]
            else:
                addr, extra, phone, url = row[8], "", row[9], row[10]
            school, nature, poor = _clean_school_name(row[7])
            if not school or re.search(r"[A-Za-z]{2,}", str(row[7] or "")):
                school = reference_school_names.get(school_code_value, school)
            major_raw_ocr = squash(row[1])
            code = canonical_major_code(code, major_raw_ocr, references)
            major_raw = canonical_plan_major_name(major_raw_ocr, code, reference_major_names)
            if "建档立卡" in major_raw:
                poor = "是"
            category = "建档立卡专项" if poor == "是" else "普通专升本"
            out.append({
                "年度": year,
                "专业代号": code,
                "专业名称": _clean_major_name(major_raw),
                "计划人数": plan,
                "学制": to_int(row[3]),
                "学费标准": to_int(row[4]),
                "最低住宿费": to_int(row[5]),
                "院校代号": school_code_value,
                "院校名称": school,
                "办学性质": nature,
                "招生类别": category,
                "建档立卡": poor,
                "通信地址": squash(addr),
                "其他说明": squash(extra),
                "咨询电话": squash(phone),
                "招生章程网址": squash(url),
            })
    return out
