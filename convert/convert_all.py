from __future__ import annotations

import argparse
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
import sys
from typing import Any

from .common import DATA_ROOT, _ensure_stdout_utf8, load_data_plan, read_json, write_json
from .issue_reports import apply_manual_correction
from .pdf_tables import RawPdfRow, extract_rows
from .score_segments import parse_score_segments


def _convert_entry(arguments: tuple[dict[str, Any], Path, dict[str, Any] | None]) -> dict[str, Any]:
    entry, data_root, correction = arguments
    pdf_path = data_root / entry["localPath"]
    try:
        if correction and correction.get("status") == "confirmed":
            rows = extract_rows(pdf_path, thorough=True)
            rows, replacement = apply_manual_correction(rows, correction)
            if replacement:
                rows = [
                    RawPdfRow(0, (str(item["score"]), str(item["cumulativeCount"])))
                    for item in replacement
                ]
            segments, issues = parse_score_segments(rows)
        else:
            rows = extract_rows(pdf_path)
            segments, issues = parse_score_segments(rows)
            if not segments and any(issue.code in {"duplicate-score", "non-monotonic-count"} for issue in issues):
                rows = extract_rows(pdf_path, thorough=True)
                segments, issues = parse_score_segments(rows)
    except Exception as exc:  # keep a full batch running and report the source failure
        segments = []
        issues = []
        error = {"code": "extract-failed", "pageNumber": None, "message": str(exc), "cells": []}
    else:
        error = None
    issue_values = [
        {"code": issue.code, "pageNumber": issue.page_number, "message": issue.message, "cells": list(issue.cells)}
        for issue in issues
    ]
    if error:
        issue_values.append(error)
    return {
        "majorCode": entry["majorCode"],
        "majorName": entry["majorName"],
        "sourcePdf": entry["localPath"],
        "sourceSha256": entry.get("sha256"),
        "status": "ok" if segments and not issue_values else "needs-review",
        "segments": [{"score": item.score, "cumulativeCount": item.cumulative_count} for item in segments],
        "issues": issue_values,
    }


def convert_target(target: dict[str, Any], data_root: Path, major_codes: set[str] | None = None, workers: int = 1) -> dict[str, Any]:
    manifest = read_json(data_root / target["manifestPath"])
    entries = [entry for entry in manifest["entries"] if not major_codes or entry["majorCode"] in major_codes]
    correction_path = data_root / "一分一段" / "人工修正.json"
    correction_values = read_json(correction_path).get("corrections", []) if correction_path.exists() else []
    corrections = {(int(item["year"]), item["majorCode"]): item for item in correction_values}
    arguments = [(entry, data_root, corrections.get((int(target["year"]), entry["majorCode"]))) for entry in entries]
    if workers > 1 and len(entries) > 1:
        with ProcessPoolExecutor(max_workers=workers) as executor:
            majors = list(executor.map(_convert_entry, arguments))
    else:
        majors = [_convert_entry(item) for item in arguments]
    for position, item in enumerate(majors, start=1):
        print(f"[{target['year']}] {position}/{len(majors)} {item['majorCode']} {item['status']}", flush=True)
    output_path = data_root / target["extractionPath"]
    if major_codes and output_path.exists():
        existing = read_json(output_path)
        replacements = {item["majorCode"]: item for item in majors}
        majors = [replacements.get(item["majorCode"], item) for item in existing.get("majors", [])]
        known = {item["majorCode"] for item in majors}
        majors.extend(item for code, item in replacements.items() if code not in known)
    result = {
        "schemaVersion": 1,
        "dataset": target["dataset"],
        "year": target["year"],
        "sourceManifest": target["manifestPath"],
        "majors": majors,
        "summary": {
            "total": len(majors),
            "ok": sum(item["status"] == "ok" for item in majors),
            "needsReview": sum(item["status"] != "ok" for item in majors),
        },
    }
    write_json(output_path, result)
    return result


def main() -> int:
    _ensure_stdout_utf8()
    parser = argparse.ArgumentParser(description="批量抽取官方一分一段 PDF")
    parser.add_argument("--dataset", default="score-segments")
    parser.add_argument("--year", dest="years", action="append", type=int)
    parser.add_argument("--major", dest="major_codes", action="append")
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--data-root", type=Path, default=DATA_ROOT)
    parser.add_argument("--registry", type=Path, help=argparse.SUPPRESS)
    args = parser.parse_args()

    if args.registry:
        parser.error('--registry is retired; use data/year-links seeds with --data-root')
    plan = load_data_plan(args.data_root, set(args.years) if args.years else None)
    data_root = args.data_root
    targets = [
        item for item in plan["targets"]
        if item["dataset"] == args.dataset and (not args.years or item["year"] in args.years)
    ]
    if not targets:
        parser.error("year-links 中没有匹配的数据集/年份")
    for target in targets:
        result = convert_target(target, data_root, set(args.major_codes or []), max(1, args.workers))
        print(f"{result['year']}: {result['summary']['ok']} ok, {result['summary']['needsReview']} needs review")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
