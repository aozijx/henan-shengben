from __future__ import annotations

import argparse
from concurrent.futures import ProcessPoolExecutor
import json
from pathlib import Path
import sys
from typing import Any

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from convert.pdf_tables import extract_rows
from convert.score_segments import parse_score_segments


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATA_ROOT = REPO_ROOT / "data"
DEFAULT_REGISTRY = DEFAULT_DATA_ROOT / "source-registry.json"


def _read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _convert_entry(arguments: tuple[dict[str, Any], Path]) -> dict[str, Any]:
    entry, data_root = arguments
    pdf_path = data_root / entry["localPath"]
    try:
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
    manifest = _read_json(data_root / target["manifestPath"])
    entries = [entry for entry in manifest["entries"] if not major_codes or entry["majorCode"] in major_codes]
    arguments = [(entry, data_root) for entry in entries]
    if workers > 1 and len(entries) > 1:
        with ProcessPoolExecutor(max_workers=workers) as executor:
            majors = list(executor.map(_convert_entry, arguments))
    else:
        majors = [_convert_entry(item) for item in arguments]
    for position, item in enumerate(majors, start=1):
        print(f"[{target['year']}] {position}/{len(majors)} {item['majorCode']} {item['status']}", flush=True)
    output_path = data_root / target["extractionPath"]
    if major_codes and output_path.exists():
        existing = _read_json(output_path)
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
    _write_json(output_path, result)
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="批量抽取官方一分一段 PDF")
    parser.add_argument("--dataset", default="score-segments")
    parser.add_argument("--year", dest="years", action="append", type=int)
    parser.add_argument("--major", dest="major_codes", action="append")
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--registry", type=Path, default=DEFAULT_REGISTRY)
    args = parser.parse_args()

    registry = _read_json(args.registry)
    data_root = args.registry.resolve().parent
    targets = [
        item for item in registry["crawlTargets"]
        if item["dataset"] == args.dataset and (not args.years or item["year"] in args.years)
    ]
    if not targets:
        parser.error("注册表中没有匹配的数据集/年份")
    for target in targets:
        result = convert_target(target, data_root, set(args.major_codes or []), max(1, args.workers))
        print(f"{result['year']}: {result['summary']['ok']} ok, {result['summary']['needsReview']} needs review")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
