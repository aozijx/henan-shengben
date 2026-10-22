"""官方数据表抽取 + 校验 + 可选写回 CLI。

用法：
  python -m convert.extract_cli            # 校验：逐文件比对，报告差异
  python -m convert.extract_cli --write    # 更新：写回 data/（仅写有差异的文件）
  python -m convert.extract_cli --year 2026 --parser mapping  # 只跑指定项

数据源声明统一在 data/source-registry.json 的 sources[] 数组里。
替代了旧的 tools/convert.py（该单体脚本已删除）。
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any

from .common import (
    DATA_ROOT,
    REGISTRY_PATH,
    _ensure_stdout_utf8,
    load_registry,
    read_json,
    write_json,
)
from .diff import diff_mapping, diff_rows
from .sources import extract_entry


def _diff_for(parser: str) -> Any:
    return diff_mapping if parser == "mapping" else diff_rows


def main() -> int:
    _ensure_stdout_utf8()

    parser = argparse.ArgumentParser(description="官方数据表：抽取校验 + 可选写回")
    parser.add_argument("--write", action="store_true", help="将重新抽取的结果写回 data/（仅写有差异的文件）")
    parser.add_argument("--year", type=int, help="只处理指定年份")
    parser.add_argument("--parser", help="只处理指定 parser (scorelines/mapping/plans/master)")
    args = parser.parse_args()

    registry = load_registry(REGISTRY_PATH)

    total_bad = 0
    for entry in registry["sources"]:
        if args.year and int(entry["year"]) != args.year:
            continue
        if args.parser and entry["parser"] != args.parser:
            continue

        extracted = extract_entry(entry, DATA_ROOT)
        output_path = DATA_ROOT / entry["outputPath"]
        existing = read_json(output_path)

        expected = entry.get("expectedCount")
        count_note = ""
        if expected is not None and len(extracted) != expected:
            count_note = f"  [行数异常: 抽取 {len(extracted)} != 官方 {expected}]"
            total_bad += 1

        diffs = _diff_for(entry["parser"])(extracted, existing)

        label = "一致" if not diffs else f"{len(diffs)} 处差异"
        if len(extracted) != len(existing):
            total_bad += 1

        print(
            f"{entry['outputPath']}: 抽取 {len(extracted)} 条 / 现有 {len(existing)} 条 — {label}{count_note}"
        )
        for i, key, va, vb in diffs[:5]:
            total_bad += 1
            print(f"   #{i} [{key}] PDF: {va!r}  |  现有: {vb!r}")

        if diffs:
            total_bad += 1
        if args.write:
            # --write 无条件覆盖：抽取逻辑本身（如 squash 考试科目）
            # 可能已经和旧 JSON 有差异，但 diff 工具做了 norm 容错检测不到。
            write_json(output_path, extracted)
            print("   -> 已写回")

    print("结果：" + ("全部一致" if total_bad == 0 else f"共 {total_bad} 处异常/差异"))
    return 1 if total_bad and not args.write else 0


if __name__ == "__main__":
    raise SystemExit(main())
