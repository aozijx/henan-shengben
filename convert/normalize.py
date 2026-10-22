from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
from typing import Any

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from convert.authority import SourceValue, resolve_field
from convert.validate import validate_score_segment_year


REPO_ROOT = Path(__file__).resolve().parents[1]


def _read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def normalize_target(target: dict[str, Any], registry: dict[str, Any], data_root: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    year = int(target["year"])
    extraction = _read_json(data_root / target["extractionPath"])
    manifest = _read_json(data_root / target["manifestPath"])
    manifest_by_code = {item["majorCode"]: item for item in manifest["entries"]}
    score_path = next(item["outputPath"] for item in registry["sources"] if item["parser"] == "scorelines" and int(item["year"]) == year)
    score_rows = _read_json(data_root / score_path)
    scores = {item["专业代号"]: item for item in score_rows}
    plan_path = next(item["outputPath"] for item in registry["sources"] if item["parser"] == "plans" and int(item["year"]) == year)
    plan_rows = _read_json(data_root / plan_path)
    plan_names: dict[str, list[str]] = {}
    for item in plan_rows:
        plan_names.setdefault(item["专业代号"], [])
        if item["专业名称"] not in plan_names[item["专业代号"]]:
            plan_names[item["专业代号"]].append(item["专业名称"])
    correction_path = data_root / "一分一段" / "人工修正.json"
    corrections = _read_json(correction_path).get("corrections", []) if correction_path.exists() else []
    correction_by_code = {item["majorCode"]: item for item in corrections if int(item["year"]) == year}

    majors: list[dict[str, Any]] = []
    excluded: list[dict[str, Any]] = []
    resolutions: list[dict[str, Any]] = []
    blockers: list[dict[str, Any]] = []
    for source in extraction["majors"]:
        code = source["majorCode"]
        correction = correction_by_code.get(code)
        if correction and correction.get("status") == "official-empty":
            excluded.append({"majorCode": code, "majorName": source["majorName"], "reason": "official-empty", "evidenceNote": correction.get("evidenceNote", "")})
            continue
        if source.get("status") != "ok" or not source.get("segments"):
            blockers.append({"majorCode": code, "majorName": source["majorName"], "issues": source.get("issues", [])})
            continue
        score_row = scores.get(code, {})
        candidates = [SourceValue(score_row.get("专业名称"), f"score-line:{year}:{code}", 100)]
        candidates.extend(SourceValue(name, f"plan:{year}:{code}", 90) for name in plan_names.get(code, []))
        candidates.append(SourceValue(source.get("majorName"), f"score-segment-pdf:{year}:{code}", 80))
        resolution = resolve_field("majorName", candidates)
        resolutions.append({
            "majorCode": code,
            "field": "majorName",
            "value": resolution.value,
            "sourceId": resolution.source_id,
            "reason": resolution.reason,
            "blocking": resolution.blocking,
        })
        if resolution.blocking:
            blockers.append({"majorCode": code, "majorName": source["majorName"], "issues": [{"code": resolution.reason}]})
            continue
        sha256 = source["sourceSha256"]
        majors.append({
            "majorCode": code,
            "majorName": resolution.value,
            "controlScore": score_row.get("分数线"),
            "sourceId": f"score-segments:{year}:{code}:{sha256[:12]}",
            "sourcePdf": source["sourcePdf"],
            "sourceSha256": sha256,
            "segments": source["segments"],
        })
    majors.sort(key=lambda item: item["majorCode"])
    document = {
        "schemaVersion": 1,
        "year": year,
        "sourceManifest": target["manifestPath"],
        "majors": majors,
    }
    validation = validate_score_segment_year(document, data_root)
    report = {
        "schemaVersion": 1,
        "year": year,
        "sourceManifest": target["manifestPath"],
        "inputMajorCount": len(extraction["majors"]),
        "publishedMajorCount": len(majors),
        "officialEmptyCount": len(excluded),
        "blockingCount": len(blockers) + len(validation.errors),
        "officialEmpty": excluded,
        "blockers": blockers,
        "validationErrors": [
            {"code": item.code, "path": item.path, "message": item.message}
            for item in validation.errors
        ],
        "resolutions": resolutions,
    }
    return document, report


def normalize_all(registry_path: Path, years: set[int] | None = None) -> list[dict[str, Any]]:
    registry = _read_json(registry_path)
    data_root = registry_path.resolve().parent
    reports = []
    for target in registry["crawlTargets"]:
        if years and int(target["year"]) not in years:
            continue
        document, report = normalize_target(target, registry, data_root)
        _write_json(data_root / target["normalizedPath"], document)
        _write_json(data_root / target["conversionReportPath"], report)
        reports.append(report)
    return reports


def main() -> int:
    parser = argparse.ArgumentParser(description="归一化并验证一分一段年度数据")
    parser.add_argument("--registry", type=Path, default=REPO_ROOT / "data" / "source-registry.json")
    parser.add_argument("--years", nargs="*", type=int)
    args = parser.parse_args()
    reports = normalize_all(args.registry, set(args.years or []))
    for report in reports:
        print(f"{report['year']}: {report['publishedMajorCount']} published, {report['officialEmptyCount']} official empty, {report['blockingCount']} blocking")
    return 1 if any(report["blockingCount"] for report in reports) else 0


if __name__ == "__main__":
    raise SystemExit(main())
