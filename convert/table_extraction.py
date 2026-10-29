"""Dispatch each annual table source to its focused PDF parser."""
from __future__ import annotations

from pathlib import Path
from typing import Any

from convert.mapping_parser import extract_code_table, extract_mapping
from convert.master_parser import extract_master_table
from convert.plan_parser import _clean_school_name, extract_plans
from convert.scoreline_parser import extract_scorelines
from convert.source_references import major_rows, school_names


def extract_entry(entry: dict[str, Any], data_root: Path) -> list[dict[str, Any]]:
    """统一的 parser 分派函数，extract_cli / convert_all.py 都从这里走。"""
    parser = entry["parser"]
    pdfs = [data_root / p for p in entry["pdfPaths"]]
    manifest_rows = major_rows(data_root, int(entry["year"]))
    if parser == "scorelines":
        return extract_scorelines(pdfs[0], manifest_rows)
    if parser == "mappingCodeTable":
        return [{"专业名称": name, **fields} for name, fields in extract_code_table(pdfs[0]).items()]
    if parser == "mapping":
        return extract_mapping(pdfs[0], pdfs[1])
    if parser == "plans":
        reference_school_names = school_names(data_root, int(entry["year"]), _clean_school_name)
        return extract_plans(
            pdfs[0],
            int(entry["year"]),
            reference_rows=manifest_rows,
            reference_school_names=reference_school_names,
        )
    if parser == "master":
        return extract_master_table(pdfs[0])
    raise ValueError(f"未知 parser: {parser}")
