from __future__ import annotations

import argparse
from pathlib import Path
from typing import Any

from .authority import SourceValue, resolve_field
from .common import DATA_ROOT, _ensure_stdout_utf8, load_data_plan, read_json, write_json
from .validate import validate_score_segment_year
from .segment_store import iter_year, write_year


def normalize_target(target: dict[str, Any], plan: dict[str, Any], data_root: Path,
                     *, full_report: bool = False) -> tuple[dict[str, Any], dict[str, Any]]:
    year = int(target["year"])
    segment_path = data_root / target["normalizedPath"]
    segment_index = read_json(segment_path)
    if segment_index.get('year') != year or segment_index.get('dataset', 'score-segments') != 'score-segments':
        raise ValueError(f'{year}: 一分一段索引年份或数据集不匹配')
    score_path = next(item["outputPath"] for item in plan["sources"] if item["parser"] == "scorelines" and int(item["year"]) == year)
    score_rows = read_json(data_root / score_path)
    scores = {item["专业代号"]: item for item in score_rows}
    plan_path = next(item["outputPath"] for item in plan["sources"] if item["parser"] == "plans" and int(item["year"]) == year)
    plan_rows = read_json(data_root / plan_path)
    plan_names: dict[str, list[str]] = {}
    for item in plan_rows:
        plan_names.setdefault(item["专业代号"], [])
        if item["专业名称"] not in plan_names[item["专业代号"]]:
            plan_names[item["专业代号"]].append(item["专业名称"])
    manifest = read_json(data_root / target["manifestPath"])
    manifest_codes = {str(item["majorCode"]) for item in manifest["entries"]}
    source_unavailable = [
        {"majorCode": code, "majorName": scores[code].get("专业名称", ""),
         "reason": "not-listed-in-official-score-segment-manifest",
         "sourcePageUrl": manifest.get("sourcePageUrl")}
        for code in sorted(set(scores) - manifest_codes)
    ]
    correction_path = data_root / "一分一段" / "人工修正.json"
    corrections = read_json(correction_path).get("corrections", []) if correction_path.exists() else []
    correction_by_code = {item["majorCode"]: item for item in corrections if int(item["year"]) == year}

    majors: list[dict[str, Any]] = []
    excluded: list[dict[str, Any]] = []
    resolutions: list[dict[str, Any]] = []
    blockers: list[dict[str, Any]] = []
    for source in iter_year(segment_path, data_root):
        code = source["majorCode"]
        correction = correction_by_code.get(code)
        if correction and correction.get("status") == "official-empty":
            excluded.append({"majorCode": code, "majorName": source["majorName"], "reason": "official-empty", "evidenceNote": correction.get("evidenceNote", "")})
            score_row = scores.get(code, {})
            sha256 = str(source.get("sourceSha256", ""))
            majors.append({**source, "controlScore": score_row.get("分数线"),
                           "sourceId": source.get("sourceId") or f"score-segments:{year}:{code}:{sha256[:12]}",
                           "status": "official-empty", "issues": []})
            continue
        if source.get("status", "ok") != "ok" or not source.get("segments"):
            issues = source.get("issues", []) or [{"code": "no-segments", "message": "未识别到有效分数段"}]
            blockers.append({"majorCode": code, "majorName": source["majorName"], "issues": issues})
            score_row = scores.get(code, {})
            majors.append({**source, "controlScore": score_row.get("分数线"),
                           "sourceId": source.get("sourceId") or f"score-segments:{year}:{code}:{str(source.get('sourceSha256', ''))[:12]}",
                           "status": "needs-review", "issues": issues})
            continue
        score_row = scores.get(code, {})
        candidates = [SourceValue(score_row.get("专业名称"), f"score-line:{year}:{code}", 100)]
        candidates.extend(SourceValue(name, f"plan:{year}:{code}", 90) for name in plan_names.get(code, []))
        candidates.append(SourceValue(source.get("majorName"), f"score-segment-pdf:{year}:{code}", 80))
        resolution = resolve_field("majorName", candidates)
        resolution_row = {
            "majorCode": code,
            "field": "majorName",
            "value": resolution.value,
            "sourceId": resolution.source_id,
            "reason": resolution.reason,
            "blocking": resolution.blocking,
        }
        if full_report or resolution.blocking:
            resolutions.append(resolution_row)
        if resolution.blocking:
            issue = {"code": resolution.reason}
            blockers.append({"majorCode": code, "majorName": source["majorName"], "issues": [issue]})
            sha256 = str(source.get("sourceSha256", ""))
            majors.append({**source, "controlScore": score_row.get("分数线"),
                           "sourceId": source.get("sourceId") or f"score-segments:{year}:{code}:{sha256[:12]}",
                           "status": "needs-review", "issues": [issue]})
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
            "status": "ok",
            "issues": [],
        })
    majors.sort(key=lambda item: item["majorCode"])
    published = [item for item in majors if item.get("status") == "ok"]
    document = {
        "schemaVersion": 1,
        "dataset": "score-segments",
        "year": year,
        "sourceManifest": target["manifestPath"],
        "majors": majors,
        "summary": {
            "total": len(majors),
            "ok": len(published),
            "needsReview": sum(item.get("status") == "needs-review" for item in majors),
            "officialEmpty": len(excluded),
        },
    }
    validation = validate_score_segment_year({**document, "majors": published}, data_root)
    report = {
        "schemaVersion": 1,
        "year": year,
        "sourceManifest": target["manifestPath"],
        "inputMajorCount": len(segment_index["majors"]),
        "publishedMajorCount": len(published),
        "officialEmptyCount": len(excluded),
        "sourceUnavailableCount": len(source_unavailable),
        "blockingCount": len(blockers) + len(validation.errors),
        "officialEmpty": excluded,
        "sourceUnavailable": source_unavailable,
        "blockers": blockers,
        "validationErrors": [
            {"code": item.code, "path": item.path, "message": item.message}
            for item in validation.errors
        ],
        "resolutions": resolutions,
    }
    return document, report


def normalize_all(data_root: Path = DATA_ROOT, years: set[int] | None = None,
                  *, full_report: bool = False) -> list[dict[str, Any]]:
    data_root = Path(data_root)
    plan = load_data_plan(data_root, years)
    reports = []
    for target in plan["targets"]:
        document, report = normalize_target(target, plan, data_root, full_report=full_report)
        write_year(data_root / target["normalizedPath"], data_root, document)
        write_json(data_root / target["conversionReportPath"], report)
        reports.append(report)
    return reports


def main() -> int:
    _ensure_stdout_utf8()
    parser = argparse.ArgumentParser(description="归一化并验证一分一段年度数据")
    parser.add_argument("--data-root", type=Path, default=DATA_ROOT)
    parser.add_argument("--years", nargs="*", type=int)
    parser.add_argument("--full-report", action="store_true", help="在转换报告中附带成功专业的逐条解析")
    args = parser.parse_args()
    reports = normalize_all(args.data_root, set(args.years) if args.years else None,
                            full_report=args.full_report)
    for report in reports:
        print(f"{report['year']}: {report['publishedMajorCount']} published, "
              f"{report['officialEmptyCount']} official empty, "
              f"{report.get('sourceUnavailableCount', 0)} without official score-segment PDF, "
              f"{report['blockingCount']} blocking")
    return 1 if any(report["blockingCount"] for report in reports) else 0


if __name__ == "__main__":
    raise SystemExit(main())
