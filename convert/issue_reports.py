from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
from typing import Any

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from convert.pdf_tables import RawPdfRow, extract_rows


REPO_ROOT = Path(__file__).resolve().parents[1]


def _read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


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


def build_issue_report(
    extraction: dict[str, Any],
    data_root: Path,
    control_scores: dict[str, int],
    source_entries: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    year = int(extraction["year"])
    issues: list[dict[str, Any]] = []
    for major in extraction["majors"]:
        if major.get("status") == "ok":
            continue
        source_pdf = major["sourcePdf"]
        source_path = data_root / source_pdf
        source_entry = (source_entries or {}).get(major["majorCode"], {})
        try:
            rows = extract_rows(data_root / source_pdf, thorough=True)
            extraction_error = None
        except Exception as exc:
            rows = []
            extraction_error = str(exc)
        raw_rows, suspicious_rows = _analyze_rows(rows)
        issues.append({
            "issueId": f"{year}-{major['majorCode']}",
            "year": year,
            "majorCode": major["majorCode"],
            "majorName": major["majorName"],
            "officialControlScore": control_scores.get(major["majorCode"]),
            "sourcePdf": source_pdf,
            "officialPdfUrl": source_entry.get("pdfUrl"),
            "sourcePageUrl": source_entry.get("sourcePageUrl"),
            "sourceSha256": major.get("sourceSha256"),
            "sourceBytes": source_path.stat().st_size if source_path.is_file() else None,
            "errors": major.get("issues", []),
            "extractionError": extraction_error,
            "rawRows": raw_rows,
            "suspiciousRows": suspicious_rows,
            "reviewInstructions": "对照 sourcePdf 核对 suspiciousRows；在 data/一分一段/人工修正.json 填写修正并将 status 改为 confirmed。",
        })
    return {
        "schemaVersion": 1,
        "year": year,
        "issueCount": len(issues),
        "issues": issues,
    }


def ensure_manual_corrections(path: Path, reports: list[dict[str, Any]]) -> bool:
    if path.exists():
        return False
    corrections = []
    for report in reports:
        for issue in report["issues"]:
            corrections.append({
                "issueId": issue["issueId"],
                "year": issue["year"],
                "majorCode": issue["majorCode"],
                "majorName": issue["majorName"],
                "status": "pending",
                "cellOverrides": [],
                "replacementSegments": [],
                "evidenceNote": "",
            })
    _write_json(path, {"schemaVersion": 1, "corrections": corrections})
    return True


def apply_manual_correction(
    rows: list[RawPdfRow], correction: dict[str, Any] | None
) -> tuple[list[RawPdfRow], list[dict[str, int]] | None]:
    if not correction or correction.get("status") != "confirmed":
        return rows, None
    replacement = correction.get("replacementSegments") or []
    if replacement:
        return rows, replacement
    cells_by_row = [list(row.cells) for row in rows]
    for override in correction.get("cellOverrides") or []:
        row_index = int(override["rowIndex"])
        column_index = int(override["columnIndex"])
        if not 0 <= row_index < len(rows) or rows[row_index].page_number != int(override["pageNumber"]):
            raise ValueError(f"人工修正行不存在：page={override['pageNumber']} row={row_index}")
        if not 0 <= column_index < len(cells_by_row[row_index]):
            raise ValueError(f"人工修正列不存在：column={column_index}")
        cells_by_row[row_index][column_index] = str(override["value"])
    return [RawPdfRow(row.page_number, tuple(cells_by_row[index])) for index, row in enumerate(rows)], None


def generate_reports(registry_path: Path) -> list[dict[str, Any]]:
    data_root = registry_path.resolve().parent
    registry = _read_json(registry_path)
    score_paths = {int(item["year"]): item["outputPath"] for item in registry["sources"] if item["parser"] == "scorelines"}
    reports = []
    for target in registry["crawlTargets"]:
        extraction = _read_json(data_root / target["extractionPath"])
        controls = {row["专业代号"]: row["分数线"] for row in _read_json(data_root / score_paths[int(target["year"])])}
        manifest = _read_json(data_root / target["manifestPath"])
        source_entries = {entry["majorCode"]: entry for entry in manifest["entries"]}
        report = build_issue_report(extraction, data_root, controls, source_entries)
        _write_json(data_root / "reports" / f"异常数据_{target['year']}.json", report)
        reports.append(report)
    ensure_manual_corrections(data_root / "一分一段" / "人工修正.json", reports)
    return reports


def main() -> int:
    parser = argparse.ArgumentParser(description="生成一分一段 OCR 异常人工核对报告")
    parser.add_argument("--registry", type=Path, default=REPO_ROOT / "data" / "source-registry.json")
    args = parser.parse_args()
    reports = generate_reports(args.registry)
    for report in reports:
        print(f"{report['year']}: {report['issueCount']} issues")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
