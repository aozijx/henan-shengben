from __future__ import annotations

import argparse
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path
import sys
from typing import Any

from .common import DATA_ROOT, _ensure_stdout_utf8, load_data_plan, read_json
from .manual_corrections import apply_manual_correction
from .normalize import save_normalized_target
from .pdf_tables import RawPdfRow, extract_rows
from .score_segments import parse_score_segments
from .segment_store import iter_year
from pipeline_config import SCORE_SEGMENT_WORKERS


def _convert_entry(arguments: tuple[dict[str, Any], Path, dict[str, Any] | None]) -> dict[str, Any]:
    entry, data_root, correction = arguments
    pdf_path = data_root / entry["localPath"]
    if correction and correction.get('status') == 'official-empty':
        return {
            "majorCode": entry["majorCode"],
            "majorName": entry["majorName"],
            "sourcePdf": entry["localPath"],
            "sourceSha256": entry.get("sha256"),
            "status": "official-empty",
            "segments": [],
            "issues": [],
        }
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


def convert_target(target: dict[str, Any], data_root: Path, major_codes: set[str] | None = None,
                   workers: int | None = None, *, plan: dict[str, Any] | None = None,
                   retry_review: bool = False,
                   verbose: bool = False, full_report: bool = False) -> dict[str, Any]:
    workers = max(1, SCORE_SEGMENT_WORKERS if workers is None else workers)
    plan = plan if plan is not None else load_data_plan(data_root, {int(target['year'])})
    manifest = read_json(data_root / target["manifestPath"])
    output_path = data_root / target["normalizedPath"]
    existing = ({item['majorCode']: item for item in iter_year(output_path, data_root)}
                if output_path.exists() else None)
    if retry_review and existing is None:
        raise ValueError('重试待审核专业需要已有的一分一段分片')
    selected = set(major_codes or ())
    if retry_review:
        selected = {code for code, item in existing.items() if item.get('status', 'ok') != 'ok'}
    if major_codes and not selected <= {item['majorCode'] for item in manifest['entries']}:
        raise ValueError(f"未知专业代号：{', '.join(sorted(selected - {item['majorCode'] for item in manifest['entries']}))}")
    entries = [entry for entry in manifest['entries'] if not (major_codes or retry_review) or entry['majorCode'] in selected]
    correction_path = data_root / "一分一段" / "人工修正.json"
    correction_values = read_json(correction_path).get("corrections", []) if correction_path.exists() else []
    corrections = {(int(item["year"]), item["majorCode"]): item for item in correction_values}
    arguments = [(entry, data_root, corrections.get((int(target["year"]), entry["majorCode"]))) for entry in entries]
    print(f"[{target['year']}] 开始抽取并更新一分一段：{target['manifestPath']}，共 {len(entries)} 个专业", flush=True)

    def _converted():
        if workers > 1 and len(entries) > 1:
            with ProcessPoolExecutor(max_workers=workers) as executor:
                futures = [executor.submit(_convert_entry, item) for item in arguments]
                for future in as_completed(futures):
                    yield future.result()
        else:
            yield from (_convert_entry(item) for item in arguments)

    majors = []
    progress_interval = max(1, (len(entries) + 19) // 20)
    for position, item in enumerate(_converted(), start=1):
        problem = '；'.join(f"{issue['code']}: {issue.get('message', '')}" for issue in item['issues'])
        if verbose or retry_review or item['status'] != 'ok':
            print(f"[{target['year']}] 完成 {position}/{len(entries)} {item['majorCode']} {item['majorName']} "
                  f"{item['status']}{' — ' + problem if problem else ''}", flush=True)
        elif position % progress_interval == 0 or position == len(entries):
            percent = position * 100 // len(entries)
            print(f"[{target['year']}] OCR 进度 {position}/{len(entries)}（{percent}%）", flush=True)
        majors.append(item)
    if (major_codes or retry_review) and existing:
        replacements = {item["majorCode"]: item for item in majors}
        majors = [replacements.get(code, item) for code, item in existing.items()]
        known = {item["majorCode"] for item in majors}
        majors.extend(item for code, item in replacements.items() if code not in known)
    manifest_order = {entry['majorCode']: position for position, entry in enumerate(manifest['entries'])}
    majors.sort(key=lambda item: manifest_order[item['majorCode']])
    result = {
        "schemaVersion": 1,
        "dataset": target["dataset"],
        "year": target["year"],
        "sourceManifest": target["manifestPath"],
        "majors": majors,
        "summary": {
            "total": len(majors),
            "ok": sum(item["status"] == "ok" for item in majors),
            "needsReview": sum(item["status"] == "needs-review" for item in majors),
        },
    }
    normalized, _ = save_normalized_target(target, plan, data_root, result, full_report=full_report)
    review = [f"{item['majorCode']} {item['majorName']}" for item in normalized['majors']
              if item['status'] == 'needs-review']
    summary = normalized['summary']
    print(f"{target['year']}: {summary['ok']}/{summary['total']} ok, "
          f"{summary['officialEmpty']} official empty, {summary['needsReview']} needs review"
          f"{' — ' + '、'.join(review) if review else ''}", flush=True)
    return normalized


def main() -> int:
    _ensure_stdout_utf8()
    parser = argparse.ArgumentParser(description="批量抽取官方一分一段 PDF")
    parser.add_argument("--dataset", default="score-segments")
    parser.add_argument("--year", dest="years", action="append", type=int)
    parser.add_argument("--major", dest="major_codes", action="append")
    parser.add_argument("--retry-review", action="store_true", help="仅重试已有分片中待审核的专业")
    parser.add_argument("--workers", type=int, default=None, help="并发进程数，默认取 pipeline_config.py 的 SCORE_SEGMENT_WORKERS")
    parser.add_argument("--verbose", action="store_true", help="打印每个专业的转换完成状态")
    parser.add_argument("--data-root", type=Path, default=DATA_ROOT)
    args = parser.parse_args()
    if args.retry_review and args.major_codes:
        parser.error('--retry-review 和 --major 不能同时使用')
    plan = load_data_plan(args.data_root, set(args.years) if args.years else None)
    data_root = args.data_root
    targets = [
        item for item in plan["targets"]
        if item["dataset"] == args.dataset and (not args.years or item["year"] in args.years)
    ]
    if not targets:
        parser.error("year-links 中没有匹配的数据集/年份")
    for target in targets:
        convert_target(target, data_root, set(args.major_codes or []), args.workers, plan=plan,
                       retry_review=args.retry_review, verbose=args.verbose)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
