from __future__ import annotations

import argparse
from pathlib import Path
from typing import Any, Iterable

from .common import DATA_ROOT, _ensure_stdout_utf8, load_data_plan, read_json, write_json
from .manual_corrections import apply_manual_correction, ensure_manual_corrections
from .normalize import normalize_target
from .pdf_tables import RawPdfRow, extract_rows
from .score_segments import parse_score_segments
from .segment_store import iter_year, write_year


def _analyze_rows(rows: list[RawPdfRow]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    raw_rows: list[dict[str, Any]] = []
    suspicious: list[dict[str, Any]] = []
    for row_index, row in enumerate(rows):
        reasons: list[str] = []
        cells = list(row.cells)
        for column in (0, 2):
            if column + 1 >= len(cells):
                continue
            score_text = cells[column].replace(" ", "")
            count_text = cells[column + 1].replace(" ", "")
            if bool(score_text) != bool(count_text) or (score_text and (not score_text.isdigit() or not count_text.isdigit())):
                reasons.append("incomplete-pair")
            if score_text.isdigit() and not 0 <= int(score_text) <= 750:
                reasons.append("score-out-of-range")
        item = {"pageNumber": row.page_number, "rowIndex": row_index, "cells": cells}
        raw_rows.append(item)
        if reasons:
            suspicious.append({**item, "reasons": sorted(set(reasons))})
    for item in suspicious:
        index = item["rowIndex"]
        item["contextRows"] = raw_rows[max(0, index - 1):index + 2]
    return raw_rows, suspicious


def _reported_errors(major: dict[str, Any], rows: list[RawPdfRow]) -> list[dict[str, Any]]:
    """Refresh monotonicity diagnostics from review OCR instead of repeating stale text."""
    errors = list(major.get("issues", []))
    if not any(item.get("code") == "non-monotonic-count" for item in errors):
        return errors

    _, parsed_issues = parse_score_segments(rows)
    current = [item for item in parsed_issues if item.code == "non-monotonic-count"]
    if current:
        refreshed = [
            {"code": item.code, "pageNumber": item.page_number,
             "message": item.message, "cells": list(item.cells)}
            for item in current
        ]
    else:
        refreshed = [{
            "code": "non-monotonic-count",
            "pageNumber": None,
            "message": "转换阶段检测到累计人数不单调；本次复核 OCR 未复现，请对照官方 PDF 和疑似行确认。",
            "cells": [],
        }]
    return [item for item in errors if item.get("code") != "non-monotonic-count"] + refreshed


def _issue_detail(
    major: dict[str, Any], rows: list[RawPdfRow], data_root: Path,
    control_scores: dict[str, int], source_entries: dict[str, dict[str, Any]],
    *, full_report: bool, year: int, extraction_error: str | None = None,
) -> dict[str, Any]:
    source_pdf = major["sourcePdf"]
    source_path = data_root / source_pdf
    raw_rows, suspicious_rows = _analyze_rows(rows)
    detail = {
        "issueId": f"{year}-{major['majorCode']}",
        "year": year,
        "majorCode": major["majorCode"],
        "majorName": major["majorName"],
        "officialControlScore": control_scores.get(major["majorCode"]),
        "sourcePdf": source_pdf,
        "officialPdfUrl": source_entries.get(major["majorCode"], {}).get("pdfUrl"),
        "sourcePageUrl": source_entries.get(major["majorCode"], {}).get("sourcePageUrl"),
        "sourceSha256": major.get("sourceSha256"),
        "sourceBytes": source_path.stat().st_size if source_path.is_file() else None,
        "errors": _reported_errors(major, rows),
        "extractionError": extraction_error,
        "suspiciousRows": suspicious_rows,
        "reviewInstructions": "对照 sourcePdf 核对 suspiciousRows；在 data/一分一段/人工修正.json 填写修正并将 status 改为 confirmed。",
    }
    if full_report:
        detail["rawRows"] = raw_rows
    return detail


def build_issue_report(
    majors: Iterable[dict[str, Any]],
    data_root: Path,
    control_scores: dict[str, int],
    source_entries: dict[str, dict[str, Any]] | None = None,
    *, full_report: bool = False,
    year: int,
) -> dict[str, Any]:
    year = int(year)
    issues: list[dict[str, Any]] = []
    issue_position = 0
    for major in majors:
        if major.get("status") == "ok":
            continue
        issue_position += 1
        print(f"[{year}] 异常复核 {issue_position}：{major['majorCode']} {major['majorName']} — 开始 OCR", flush=True)
        source_pdf = major["sourcePdf"]
        try:
            rows = extract_rows(data_root / source_pdf, thorough=True)
            extraction_error = None
        except Exception as exc:
            rows = []
            extraction_error = str(exc)
        print(f"[{year}] 异常复核 {issue_position}：{major['majorCode']} {major['majorName']} — "
              f"完成，识别 {len(rows)} 行{'，读取失败：' + extraction_error if extraction_error else ''}", flush=True)
        issues.append(_issue_detail(major, rows, data_root, control_scores, source_entries,
                                    full_report=full_report, year=year,
                                    extraction_error=extraction_error))
    return {
        "schemaVersion": 1,
        "year": year,
        "issueCount": len(issues),
        "issues": issues,
    }


def generate_reports(data_root: Path = DATA_ROOT, years: set[int] | None = None,
                     *, full_report: bool = False) -> list[dict[str, Any]]:
    data_root = Path(data_root)
    plan = load_data_plan(data_root, years)
    score_paths = {int(item["year"]): item["outputPath"] for item in plan["sources"] if item["parser"] == "scorelines"}
    correction_path = data_root / "一分一段" / "人工修正.json"
    corrections = read_json(correction_path).get("corrections", []) if correction_path.exists() else []
    official_empty = {
        (int(item["year"]), str(item["majorCode"]))
        for item in corrections if item.get("status") == "official-empty"
    }
    reports = []
    for target in plan["targets"]:
        print(f"[{target['year']}] 读取一分一段分片并生成异常报告 …", flush=True)
        segment_path = data_root / target["normalizedPath"]
        segment_index = read_json(segment_path)
        majors = list(iter_year(segment_path, data_root))
        controls = {row["专业代号"]: row["分数线"] for row in read_json(data_root / score_paths[int(target["year"])])}
        manifest = read_json(data_root / target["manifestPath"])
        source_entries = {entry["majorCode"]: entry for entry in manifest["entries"]}
        year = int(target["year"])
        corrections_by_code = {
            str(item["majorCode"]): item for item in corrections
            if int(item["year"]) == year
        }
        issues = []
        applied_codes = set()
        review_majors = [
            major for major in majors
            if major.get("status", "ok") != "ok"
            and (year, str(major["majorCode"])) not in official_empty
        ]
        for position, major in enumerate(review_majors, start=1):
            code = str(major["majorCode"])
            correction = corrections_by_code.get(code)
            print(f"[{year}] 异常复核 {position}：{code} {major['majorName']} — 开始 OCR", flush=True)
            try:
                rows = extract_rows(data_root / major["sourcePdf"], thorough=True)
                extraction_error = None
            except Exception as exc:
                rows = []
                extraction_error = str(exc)
            correction_error = None
            try:
                corrected_rows, replacement = apply_manual_correction(rows, correction)
            except Exception as exc:
                corrected_rows, replacement = rows, None
                correction_error = f"人工修正无法应用：{exc}"
            if replacement:
                corrected_rows = [RawPdfRow(0, (str(item["score"]), str(item["cumulativeCount"])))
                                  for item in replacement]
            segments, parse_issues = parse_score_segments(corrected_rows)
            print(f"[{year}] 异常复核 {position}：{code} {major['majorName']} — "
                  f"完成，识别 {len(rows)} 行{'，读取失败：' + extraction_error if extraction_error else ''}", flush=True)
            if correction and correction.get("status") == "confirmed" and segments and not parse_issues:
                major.update({
                    "status": "ok",
                    "controlScore": controls.get(code),
                    "sourceId": f"score-segments:{year}:{code}:{str(major.get('sourceSha256', ''))[:12]}",
                    "segments": [{"score": item.score, "cumulativeCount": item.cumulative_count}
                                 for item in segments],
                    "issues": [],
                })
                applied_codes.add(code)
                print(f"[{year}] 已直接应用确认修正：{code} {major['majorName']}", flush=True)
                continue
            review_major = major
            if correction and correction.get("status") == "confirmed" and parse_issues:
                review_major = {**major, "issues": [
                    {"code": item.code, "pageNumber": item.page_number,
                     "message": item.message, "cells": list(item.cells)}
                    for item in parse_issues
                ]}
            issues.append(_issue_detail(review_major, corrected_rows, data_root, controls, source_entries,
                                       full_report=full_report, year=year,
                                       extraction_error=extraction_error or correction_error))

        if applied_codes:
            summary = {
                "total": len(majors),
                "ok": sum(item.get("status") == "ok" for item in majors),
                "needsReview": sum(item.get("status") != "ok" for item in majors),
            }
            document = {key: value for key, value in segment_index.items()
                        if key not in ("schemaVersion", "majors", "summary")}
            document.update({"dataset": target["dataset"], "year": year,
                             "sourceManifest": target["manifestPath"],
                             "summary": summary, "majors": majors})
            write_year(segment_path, data_root, document)
            print(f"[{year}] 已应用 {len(applied_codes)} 条人工修正，覆盖对应规范分片", flush=True)
            normalized, conversion_report = normalize_target(target, plan, data_root)
            write_year(segment_path, data_root, normalized)
            write_json(data_root / target["conversionReportPath"], conversion_report)
            print(f"[{year}] 已在原分片完成归一化：{conversion_report['publishedMajorCount']} 个正式专业，"
                  f"{conversion_report['blockingCount']} 个待处理", flush=True)

        report = {"schemaVersion": 1, "year": year, "issueCount": len(issues), "issues": issues}
        report_path = data_root / "reports" / f"异常数据_{target['year']}.json"
        write_json(report_path, report)
        print(f"[{target['year']}] 异常报告已写入 {report_path}，共 {report['issueCount']} 项", flush=True)
        reports.append(report)
    ensure_manual_corrections(correction_path, reports)
    return reports


def main() -> int:
    parser = argparse.ArgumentParser(description="生成一分一段 OCR 异常人工核对报告")
    parser.add_argument("--data-root", type=Path, default=DATA_ROOT)
    parser.add_argument("--years", nargs="+", type=int)
    parser.add_argument("--full-report", action="store_true", help="在异常报告中附带全部 OCR 行")
    args = parser.parse_args()
    reports = generate_reports(args.data_root, set(args.years) if args.years else None,
                               full_report=args.full_report)
    for report in reports:
        print(f"{report['year']}: {report['issueCount']} issues")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

