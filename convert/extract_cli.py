"""官方数据表抽取 + 校验 + 可选写回 CLI。

用法：
  python -m convert.extract_cli            # 校验：逐文件比对，报告差异
  python -m convert.extract_cli --write    # 更新：写回 data/（仅写有差异的文件）
  python -m convert.extract_cli --year YEAR --parser mapping  # 只跑指定项

数据源由 data/year-links/YYYY.json 与约定的本地文件路径共同派生。
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any

from .common import (
    DATA_ROOT,
    _ensure_stdout_utf8,
    load_data_plan,
    read_json,
    write_json,
)
from .diff import diff_mapping, diff_rows
from .sources import extract_entry


def _diff_for(parser: str) -> Any:
    return diff_mapping if parser == "mapping" else diff_rows


def extract_year_sources(plan: dict, data_root: Path, year: int, *, write: bool, parser: str | None = None) -> list[dict]:
    """Extract declared tabular sources for a year; new targets may lack JSON outputs."""
    results = []
    for entry in plan["sources"]:
        if int(entry["year"]) != year or (parser and entry["parser"] != parser):
            continue
        pdfs = '、'.join(entry.get('pdfPaths') or [])
        print(f"[{year}] 开始抽取 {entry['parser']}：{pdfs or entry['outputPath']} …", flush=True)
        extracted = extract_entry(entry, data_root)
        output_path = data_root / entry["outputPath"]
        existing = read_json(output_path) if output_path.is_file() else []
        diffs = _diff_for(entry["parser"])(extracted, existing)
        expected = entry.get("expectedCount")
        results.append({"parser": entry["parser"], "outputPath": entry["outputPath"],
                        "rowCount": len(extracted), "diffs": diffs,
                        "expectedCountMismatch": expected is not None and len(extracted) != expected})
        if write:
            write_json(output_path, extracted)
    return results


def main() -> int:
    _ensure_stdout_utf8()

    parser = argparse.ArgumentParser(description="官方数据表：抽取校验 + 可选写回")
    parser.add_argument("--write", action="store_true", help="将重新抽取的结果写回 data/（仅写有差异的文件）")
    parser.add_argument("--year", type=int, help="只处理指定年份")
    parser.add_argument("--parser", help="只处理指定 parser (scorelines/mapping/plans/master)")
    parser.add_argument("--data-root", type=Path, default=DATA_ROOT)
    args = parser.parse_args()
    plan = load_data_plan(args.data_root, {args.year} if args.year is not None else None)

    total_bad = 0
    years = sorted({int(item["year"]) for item in plan["sources"]}) if args.year is None else [args.year]
    for year in years:
        for result in extract_year_sources(plan, args.data_root, year, write=args.write, parser=args.parser):
            label = "一致" if not result["diffs"] else f"{len(result['diffs'])} 处差异"
            count_note = "  [官方行数异常]" if result["expectedCountMismatch"] else ""
            print(f"{result['outputPath']}: 抽取 {result['rowCount']} 条 — {label}{count_note}")
            for i, key, va, vb in result["diffs"][:5]:
                total_bad += 1
                print(f"   #{i} [{key}] PDF: {va!r}  |  现有: {vb!r}")
            if result["diffs"] or result["expectedCountMismatch"]:
                total_bad += 1
            if args.write:
                print("   -> 已写回")

    print("结果：" + ("全部一致" if total_bad == 0 else f"共 {total_bad} 处异常/差异"))
    return 1 if total_bad and not args.write else 0


if __name__ == "__main__":
    raise SystemExit(main())
