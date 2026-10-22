from __future__ import annotations

from dataclasses import dataclass
import re
from typing import Iterable

from .pdf_tables import RawPdfRow


@dataclass(frozen=True)
class ScoreSegment:
    score: int
    cumulative_count: int


@dataclass(frozen=True)
class ParseIssue:
    code: str
    page_number: int | None
    message: str
    cells: tuple[str, ...] = ()


def _integer(value: str) -> int | None:
    compact = re.sub(r"\s+", "", value)
    return int(compact) if compact.isdigit() else None


def parse_score_segments(rows: Iterable[RawPdfRow]) -> tuple[list[ScoreSegment], list[ParseIssue]]:
    segments: list[ScoreSegment] = []
    issues: list[ParseIssue] = []
    for row in rows:
        cells = tuple(cell.strip() for cell in row.cells)
        if any("分数" in cell or "考生人数" in cell for cell in cells):
            continue
        parsed_on_row = 0
        for index in range(0, len(cells) - 1, 2):
            score, count = _integer(cells[index]), _integer(cells[index + 1])
            if score is None and count is None:
                continue
            if score is None or count is None:
                issues.append(ParseIssue("incomplete-pair", row.page_number, "分数与累计人数未能成对识别", cells))
                continue
            segments.append(ScoreSegment(score, count))
            parsed_on_row += 1
        if parsed_on_row == 0 and not any(issue.cells == cells for issue in issues):
            issues.append(ParseIssue("unrecognized-row", row.page_number, "无法识别分数段行", cells))

    ordered = sorted(segments, key=lambda item: item.score, reverse=True)
    if not ordered and not issues:
        issues.append(ParseIssue("no-segments", None, "未识别到任何分数段"))
    seen: set[int] = set()
    fatal: list[ParseIssue] = []
    for item in ordered:
        if item.score in seen:
            fatal.append(ParseIssue("duplicate-score", None, f"分数 {item.score} 重复"))
        seen.add(item.score)
    for previous, current in zip(ordered, ordered[1:]):
        if current.cumulative_count < previous.cumulative_count:
            fatal.append(ParseIssue("non-monotonic-count", None, f"累计人数在 {previous.score}→{current.score} 时减少"))
    if fatal:
        return [], issues + fatal
    return ordered, issues
