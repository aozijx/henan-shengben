"""官方数据表抽取：省控线 / 代号对照表 / 专业对照表 / 招生计划 / 招生总表。

这些表与一分一段分数段位不同：是 pdfplumber.extract_tables() 可直接解析的
规则表格，不需要 OCR。分数段位由 convert.pdf_tables + convert.score_segments
负责，本模块只处理这五张表。

所有函数接受 Path 对象，不依赖全局 DATA_ROOT，方便测试时传临时目录。
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import pdfplumber


# ---------- 通用工具 ----------

def squash(text: str | None) -> str:
    """去掉所有空白（PDF 单元格内自动换行不含语义）。"""
    if text is None:
        return ""
    return re.sub(r"\s+", "", str(text))


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


# ---------- PDF 行迭代 ----------

def rows_of(pdf_path: Path) -> list[list[str | None]]:
    """跨页拉平所有表格行。"""
    rows: list[list[str | None]] = []
    with pdfplumber.open(pdf_path) as document:
        for page in document.pages:
            for table in page.extract_tables() or []:
                rows.extend(table)
    return rows


def tables_of(pdf_path: Path) -> list[list[list[str | None]]]:
    """跨页拉平所有表格（保留 table 粒度，供 extract_plans 用）。"""
    tables: list[list[list[str | None]]] = []
    with pdfplumber.open(pdf_path) as document:
        for page in document.pages:
            for table in page.extract_tables() or []:
                tables.append(table)
    return tables


# ---------- 省控线 ----------

def extract_scorelines(pdf_path: Path) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for row in rows_of(pdf_path):
        if len(row) < 3 or is_header(row) or is_title(row):
            continue
        code, title, score = squash(row[0]), row[1], to_int(row[2])
        if not re.fullmatch(r"[0-9A-Z]{1,2}", code) or title is None or score is None:
            continue
        out.append({"专业代号": code, "专业名称": squash(title), "分数线": score})
    return out


# ---------- 代号对照表 ----------

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


# ---------- 专业对照表 ----------

_CODE_NAME = re.compile(r"^([0-9A-Z]{6}[KT]{0,2})\s*(.+)$")


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


# ---------- 招生计划 ----------

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
    twelve_cols_default: bool = True,
) -> list[dict[str, Any]]:
    """修复：跨页遍历 tables_of，不再只取第一页。"""
    out: list[dict[str, Any]] = []
    for table in tables_of(pdf_path):
        header = next((r for r in table if is_header(r)), None)
        twelve = (
            header is not None and "其他说明" in squash("".join(c or "" for c in header))
        ) or twelve_cols_default
        if header is not None and "其他说明" in squash("".join(c or "" for c in header)):
            twelve = True
        for row in table:
            if len(row) < 11 or is_header(row):
                continue
            code = squash(row[0])
            school_code = squash(row[6])
            plan = to_int(row[2])
            if (
                not re.fullmatch(r"[0-9A-Z]{1,2}", code or "")
                or not school_code
                or plan is None
            ):
                continue
            if twelve:
                addr, extra, phone, url = row[8], row[9], row[10], row[11]
            else:
                addr, extra, phone, url = row[8], "", row[9], row[10]
            school, nature, poor = _clean_school_name(row[7])
            major_raw = squash(row[1])
            if "建档立卡" in major_raw:
                poor = "是"
            category = "建档立卡专项" if poor == "是" else "普通专升本"
            out.append({
                "年度": year,
                "专业代号": code,
                "专业名称": _clean_major_name(major_raw),
                "计划人数": plan,
                "学制": to_int(row[3]) or 0,
                "学费标准": to_int(row[4]) or 0,
                "最低住宿费": to_int(row[5]) or 0,
                "院校代号": school_code,
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


# ---------- 招生总表 ----------

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


# ---------- 注册中心分派 ----------

def extract_entry(entry: dict[str, Any], data_root: Path) -> list[dict[str, Any]]:
    """统一的 parser 分派函数，extract_cli / convert_all.py 都从这里走。"""
    parser = entry["parser"]
    pdfs = [data_root / p for p in entry["pdfPaths"]]
    if parser == "scorelines":
        return extract_scorelines(pdfs[0])
    if parser == "mapping":
        return extract_mapping(pdfs[0], pdfs[1])
    if parser == "plans":
        return extract_plans(
            pdfs[0],
            int(entry["year"]),
            twelve_cols_default=int(entry["year"]) != 2024,
        )
    if parser == "master":
        return extract_master_table(pdfs[0])
    raise ValueError(f"未知 parser: {parser}")
