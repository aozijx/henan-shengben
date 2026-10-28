"""diff 工具：抽取结果 vs 现有 JSON 的字段级比对。

diff_rows 用于大多数表（省控线/招生计划/招生总表），按行顺序比对。
diff_mapping 用于专业对照表，按「专科专业 → 本科条目集合」比对，忽略顺序。
两者都把文本字段做空白归一，避免 PDF 换行/缩进造成假差异。
"""
from __future__ import annotations

import re
from typing import Any


def _squash(text: str | None) -> str:
    if text is None:
        return ""
    return re.sub(r"\s+", "", str(text))


def norm_item(item: Any) -> Any:
    """递归归一：所有空白折叠后比对，PDF 单元格里的 /n / 空格都不算差异。"""
    if isinstance(item, dict):
        return {k: norm_item(v) for k, v in item.items()}
    if isinstance(item, list):
        return [norm_item(v) for v in item]
    if isinstance(item, str):
        return _squash(item)
    return item


def diff_rows(
    a: list[dict[str, Any]],
    b: list[dict[str, Any]],
) -> list[tuple[int, str, Any, Any]]:
    """按顺序逐条、逐字段比对。返回 [(序号, 字段, 抽取值, 现有值)]。"""
    diffs: list[tuple[int, str, Any, Any]] = []
    for i in range(max(len(a), len(b))):
        ra = a[i] if i < len(a) else None
        rb = b[i] if i < len(b) else None
        if ra is None or rb is None:
            diffs.append((i, "<行>", ra, rb))
            continue
        keys = set(ra) | set(rb)
        for k in sorted(keys):
            va, vb = norm_item(ra.get(k)), norm_item(rb.get(k))
            if va != vb:
                diffs.append((i, k, ra.get(k), rb.get(k)))
    return diffs


def diff_mapping(
    extracted: list[dict[str, Any]],
    existing: list[dict[str, Any]],
) -> list[tuple[str, str, Any, Any]]:
    """对照表按「专科专业 → 本科条目集合」比对，忽略分组顺序与条目顺序。"""
    def _key_map(rows: list[dict[str, Any]]) -> dict[str, set[tuple[Any, ...]]]:
        out: dict[str, set[tuple[Any, ...]]] = {}
        for row in rows:
            items = {
                (
                    i["专业名称"],
                    i["专业代号"],
                    i["考试科目代码"],
                    norm_item(i["考试科目"]),
                    i["代码6位"],
                )
                for i in row["可报本科专业"]
            }
            out[_squash(row["专科专业"])] = items
        return out

    a, b = _key_map(extracted), _key_map(existing)
    diffs: list[tuple[str, str, Any, Any]] = []
    for major in sorted(set(a) | set(b)):
        if major not in a:
            diffs.append((major, "<专科专业缺失于PDF>", "", b[major]))
        elif major not in b:
            diffs.append((major, "<专科专业缺失于现有JSON>", a[major], ""))
        else:
            extra, missing = a[major] - b[major], b[major] - a[major]
            for item in sorted(extra, key=repr)[:3]:
                diffs.append((major, "<多出>", item, ""))
            for item in sorted(missing, key=repr)[:3]:
                diffs.append((major, "<缺少>", "", item))
    return diffs
