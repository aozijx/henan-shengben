"""Parse specialty-code and specialty-mapping PDF tables."""
from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from convert.table_rows import is_header, rows_of
from convert.text import squash


_CODE_NAME = re.compile(r"^([0-9A-Z]{6}[KT]{0,2})\s*(.+)$")


def base_name(name: str | None) -> str:
    """去除「本科层次职业教育…」括号与「试点」字样，用于对照表与代号表名称对齐。"""
    base = re.sub(r"[（(]本科层次职业[^（）()]*[）)]", "", name or "")
    return base.replace("试点", "")

def code_ref(code_table: dict[str, dict[str, str]], name: str) -> dict[str, str]:
    """按名称查代号；对照表与代号表的括号注释措辞可能不同，回退到基础名匹配。"""
    if name in code_table:
        return code_table[name]
    base = base_name(name)
    if base and base in code_table:
        return code_table[base]
    for title, ref in code_table.items():
        if base_name(title) == base:
            return ref
    return {}

def extract_code_table(pdf_path: Path) -> dict[str, dict[str, str]]:
    out: dict[str, dict[str, str]] = {}
    prev_code, prev_subject = "", ""
    for row in rows_of(pdf_path):
        if len(row) < 4 or is_header(row):
            continue
        title = squash(row[1])
        if not title:
            continue
        code_raw = squash(row[0])
        code = code_raw if re.fullmatch(r"[0-9A-Z]{1,2}", code_raw or "") else prev_code
        prev_code = code
        subject_code = squash(row[2]) or prev_subject
        prev_subject = subject_code
        out[title] = {"专业代号": code, "考试科目代码": subject_code}
    return out

def _parse_master_cell(cell: object) -> list[dict[str, str]]:
    """「020101 经济学」单元格。多行时：每行以 6 位代码开头即新的本科专业，
    否则视为上一专业名称的换行续写（如「电子商务（本科层次职 / 业技术）」）。"""
    pairs: list[dict[str, str]] = []
    for line in str(cell or "").split("\n"):
        line = line.strip()
        if not line:
            continue
        m = _CODE_NAME.match(line)
        if m:
            pairs.append({"代码6位": m.group(1), "专业名称": m.group(2).strip()})
        elif pairs:
            pairs[-1]["专业名称"] += line
    return pairs

def extract_mapping(code_table_pdf: Path, overview_pdf: Path) -> list[dict[str, Any]]:
    """修复：prev_subject 用 squash() 去掉换行，避免「音乐专业\n综合」脏值。"""
    code_table = extract_code_table(code_table_pdf)
    edges: list[tuple[str, dict[str, Any]]] = []
    current_masters: list[dict[str, str]] = []
    prev_subject = ""
    for row in rows_of(overview_pdf):
        if len(row) < 5 or is_header(row):
            continue
        seq = squash(row[0])
        subject = row[4]
        if subject is not None and squash(subject):
            prev_subject = squash(subject)  # ← 修复：squash 去换行
        if seq:
            masters = _parse_master_cell(row[1])
            if masters:
                current_masters = masters
        elif row[1] is not None and squash(row[1]) and _parse_master_cell(row[1]):
            current_masters = _parse_master_cell(row[1])
        major = squash(row[3])
        if not major or not current_masters:
            continue
        for master in current_masters:
            item = dict(master)
            item["考试科目"] = prev_subject
            edges.append((major, item))

    grouped: dict[str, list[dict[str, Any]]] = {}
    order: list[str] = []
    seen: set[tuple[str, str, str]] = set()
    for major, item in edges:
        key = (major, item["专业名称"], item["代码6位"])
        if key in seen:
            continue
        seen.add(key)
        if major not in grouped:
            grouped[major] = []
            order.append(major)
        grouped[major].append(item)

    out: list[dict[str, Any]] = []
    for major in order:
        items: list[dict[str, Any]] = []
        for item in grouped[major]:
            ref = code_ref(code_table, item["专业名称"])
            items.append({
                "专业名称": item["专业名称"],
                "专业代号": ref.get("专业代号", ""),
                "考试科目代码": ref.get("考试科目代码", ""),
                "考试科目": item["考试科目"],
                "代码6位": item["代码6位"],
            })
        out.append({"专科专业": major, "可报本科专业": items})

    # ---------- 标注共享代号 ----------
    # 官方代号对照表里会出现多个专业共用同一个代号。
    # 绝大多数是「普通本科 + 本科层次职业教育」两个方向（代码6位也不同，正常）。
    # 但也有真·合并入口（如「会计学」「财务管理」→ 99，代码6位完全不同），
    # 这需要前端/数据使用方留意——只标注这种「代码6位也互异」的情况。
    code_keys: dict[str, set[tuple[str, str]]] = {}  # code → {(专业名称, 代码6位)}
    for row in out:
        for item in row["可报本科专业"]:
            code = item["专业代号"]
            if not code:
                continue
            code_keys.setdefault(code, set()).add((item["专业名称"], item["代码6位"]))
    for row in out:
        for item in row["可报本科专业"]:
            code = item["专业代号"]
            keys = code_keys.get(code)
            if not keys or len(keys) <= 1:
                continue
            # 同一代号下如果只有一个代码6位，那只是普通/职教方向差异（正常）
            unique_codes6 = {k[1] for k in keys}
            if len(unique_codes6) <= 1:
                continue
            others = sorted({k[0] for k in keys if k[0] != item["专业名称"]})
            item["_代号备注"] = f"与 {'、'.join(others)} 共用代号 {code}"

    return out
