"""Validate catalog inputs and keep cross-source identity rules in one place."""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from .segment_store import iter_year
from .validate import validate_score_segment_major
from .catalog_identity import major_name_matches, normalize_major_name
from pipeline_integrity import sha256_bytes
from pipeline_io import read_json

CODE_RE = re.compile(r'^[A-Za-z0-9]+$')


def read_catalog_json(path: Path) -> Any:
    if not path.is_file():
        raise ValueError(f"Missing canonical source: {path}")
    return read_json(path)


def json_content_sha256(document: object) -> str:
    """Hash JSON values consistently across formatting and line endings."""
    encoded = json.dumps(document, ensure_ascii=False, sort_keys=True,
                         separators=(',', ':')).encode('utf-8')
    return sha256_bytes(encoded)


def resolve_data_path(data_root: Path, relative: str) -> Path:
    path = (data_root / relative).resolve()
    if not path.is_relative_to(data_root.resolve()):
        raise ValueError(f'Source escapes data root: {relative}')
    return path


def manifest_identity_sha256(path: Path) -> str:
    """Hash source identity, ignoring download bookkeeping and JSON formatting."""
    document = read_catalog_json(path)
    for entry in document.get('entries', []):
        if isinstance(entry, dict):
            entry.pop('downloadStatus', None)
    return json_content_sha256(document)


def published_report(report: dict) -> dict:
    """Retain validation facts in metadata without successful OCR detail."""
    keys = ('year', 'sourceManifest', 'inputMajorCount', 'publishedMajorCount',
            'officialEmptyCount', 'sourceUnavailableCount', 'blockingCount')
    summary = {key: report.get(key) for key in keys}
    for key in ('officialEmpty', 'sourceUnavailable', 'blockers', 'validationErrors'):
        if report.get(key):
            summary[key] = report[key]
    return summary


def clean_report(year: int, segments: dict) -> dict:
    majors = segments.get('majors', [])
    return {'year': year, 'sourceManifest': segments.get('sourceManifest'),
            'inputMajorCount': len(majors),
            'publishedMajorCount': sum(item.get('status', 'ok') == 'ok' for item in majors),
            'officialEmptyCount': 0, 'sourceUnavailableCount': 0, 'blockingCount': 0}


def validate_year_sources(year: int, files: dict, canonical: dict, report: dict, data_root: Path,
                          manifest: dict | None = None) -> None:
    for parser, directory in [('mapping', '专业对照'), ('scorelines', '省控线'),
                              ('plans', '招生计划'), ('score-segments', '一分一段')]:
        path = Path(files[parser])
        if path.parent.as_posix() != directory:
            raise ValueError(f'{year}: unexpected {parser} source directory')
        source_year = int(path.stem.rsplit('_', 1)[1]) if path.stem.rsplit('_', 1)[-1].isdigit() else None
        if source_year != (files.get('mappingReferenceYear', year) if parser == 'mapping' else year):
            raise ValueError(f'{year}: {parser} source year mismatch')
    mapping = canonical['mapping']
    scores = canonical['scorelines']
    plans = canonical['plans']
    segments = canonical['score-segments']
    if not isinstance(mapping, list) or not mapping or not isinstance(scores, list) or not isinstance(plans, list):
        raise ValueError(f'{year}: mapping, scorelines and plans must be non-empty arrays')
    mapping_codes = set()
    for entry in mapping:
        if not isinstance(entry, dict) or not isinstance(entry.get('专科专业'), str) or not isinstance(entry.get('可报本科专业'), list):
            raise ValueError(f'{year}: invalid specialty mapping')
        for major in entry['可报本科专业']:
            if not isinstance(major, dict) or not CODE_RE.fullmatch(str(major.get('专业代号', ''))) or not major.get('专业名称'):
                raise ValueError(f'{year}: invalid mapped major')
            mapping_codes.add(str(major['专业代号']))
    score_codes = set()
    for row in scores:
        code = str(row.get('专业代号', '')) if isinstance(row, dict) else ''
        if not CODE_RE.fullmatch(code) or code in score_codes or not row.get('专业名称') or not isinstance(row.get('分数线'), int):
            raise ValueError(f'{year}: invalid or duplicate scoreline code {code}')
        score_codes.add(code)
    plan_codes = set()
    for row in plans:
        code = str(row.get('专业代号', '')) if isinstance(row, dict) else ''
        if (not CODE_RE.fullmatch(code) or row.get('年度') != year or not row.get('院校名称') or
                row.get('办学性质') not in ('公办', '民办') or
                not isinstance(row.get('计划人数'), int) or row['计划人数'] < 0):
            raise ValueError(f'{year}: invalid or wrong-year plan row for {code}')
        plan_codes.add(code)
    if segments.get('year') != year:
        raise ValueError(f'{year}: score segment year mismatch')
    segment_index_path = resolve_data_path(data_root, files['score-segments'])
    segment_codes = set()
    for position, major in enumerate(iter_year(segment_index_path, data_root)):
        code = str(major['majorCode'])
        if major.get('status', 'ok') != 'ok':
            continue
        if code in segment_codes:
            raise ValueError(f'{year}: duplicate score segment code {code}')
        segment_codes.add(code)
        errors = validate_score_segment_major(major, data_root, f'majors[{position}]')
        if errors:
            issue = errors[0]
            raise ValueError(f'{year}: score segment validation failed: {issue.code} at {issue.path}')
    if report.get('year') != year:
        raise ValueError(f'{year}: conversion report year is {report.get("year")!r}')
    blockers = report.get('blockers') or []
    validation_errors = report.get('validationErrors') or []
    if report.get('blockingCount') != 0 or blockers or validation_errors:
        details = [f"{item.get('majorCode', '?')} {item.get('majorName', '')}".strip()
                   for item in blockers]
        details.extend(str(item.get('code', 'validation-error')) for item in validation_errors)
        detail_text = '、'.join(details) if details else '报告阻塞计数非零但未提供明细'
        raise ValueError(f"{year}: conversion report has {report.get('blockingCount')} blocking issue(s): {detail_text}")
    published_entries = [item for item in segments['majors'] if item.get('status', 'ok') == 'ok']
    if report.get('publishedMajorCount') != len(published_entries):
        raise ValueError(f'{year}: conversion report major count mismatch')
    if not segment_codes <= score_codes:
        raise ValueError(f'{year}: score segments contain codes absent from scorelines')
    official_empty_codes = {str(item.get('majorCode')) for item in report.get('officialEmpty', [])}
    official_empty_rows = report.get('officialEmpty', [])
    unavailable_codes: set[str] = set()
    if report.get('officialEmptyCount', len(official_empty_rows)) != len(official_empty_rows):
        raise ValueError(f'{year}: official-empty count does not match evidence records')
    for item in official_empty_rows:
        if (not CODE_RE.fullmatch(str(item.get('majorCode', ''))) or
                item.get('reason') != 'official-empty' or not str(item.get('evidenceNote', '')).strip()):
            raise ValueError(f'{year}: official-empty exception requires a code and evidence note')
    manifest_path = segments.get('sourceManifest')
    if manifest is None and isinstance(manifest_path, str):
        manifest = read_catalog_json(resolve_data_path(data_root, manifest_path))
    if manifest is not None:
        entries = manifest.get('entries')
        if manifest.get('year') != year or manifest.get('dataset') != 'score-segments' or not isinstance(entries, list):
            raise ValueError(f'{year}: invalid score segment source manifest')
        manifest_codes = [str(item.get('majorCode', '')) for item in entries if isinstance(item, dict)]
        if len(manifest_codes) != len(entries) or any(not CODE_RE.fullmatch(code) for code in manifest_codes):
            raise ValueError(f'{year}: invalid source manifest major code')
        if len(set(manifest_codes)) != len(manifest_codes):
            raise ValueError(f'{year}: duplicate manifest major code')
        if any(item.get('year') != year for item in entries):
            raise ValueError(f'{year}: source manifest year mismatch')
        unavailable_rows = report.get('sourceUnavailable', [])
        unavailable_codes = {str(item.get('majorCode')) for item in unavailable_rows}
        if report.get('sourceUnavailableCount', len(unavailable_rows)) != len(unavailable_rows):
            raise ValueError(f'{year}: source-unavailable count does not match evidence records')
        for item in unavailable_rows:
            if (not CODE_RE.fullmatch(str(item.get('majorCode', ''))) or
                    item.get('reason') != 'not-listed-in-official-score-segment-manifest' or
                    item.get('sourcePageUrl') != manifest.get('sourcePageUrl')):
                raise ValueError(f'{year}: source-unavailable exception requires matching official manifest evidence')
        expected_unavailable = set(score_codes) - set(manifest_codes)
        if unavailable_codes != expected_unavailable:
            raise ValueError(f'{year}: source-unavailable codes do not match scorelines missing from the official manifest')
        if unavailable_codes & official_empty_codes:
            raise ValueError(f'{year}: a major cannot be both source-unavailable and official-empty')
        if report.get('inputMajorCount') != len(entries):
            missing = sorted(set(manifest_codes) - segment_codes - official_empty_codes)
            raise ValueError(f"{year}: report inputMajorCount={report.get('inputMajorCount')} "
                             f"but source manifest has {len(entries)} majors; "
                             f"unpublished codes: {', '.join(missing) or 'none'}")
        if report.get('publishedMajorCount') != len(segment_codes):
            raise ValueError(f'{year}: report published major count mismatch')
        if not official_empty_codes <= set(manifest_codes):
            raise ValueError(f'{year}: official-empty code absent from source manifest')
        if set(manifest_codes) != segment_codes | official_empty_codes:
            raise ValueError(f'{year}: source manifest coverage does not match published and official-empty majors')
        canonical_codes = {str(item.get('majorCode', '')) for item in segments['majors']}
        if len(canonical_codes) != len(segments['majors']) or canonical_codes != set(manifest_codes):
            raise ValueError(f'{year}: canonical shard codes do not match source manifest')
        canonical_empty = {str(item['majorCode']) for item in segments['majors']
                           if item.get('status') == 'official-empty'}
        canonical_review = {str(item['majorCode']) for item in segments['majors']
                            if item.get('status') == 'needs-review'}
        if canonical_empty != official_empty_codes or canonical_review:
            raise ValueError(f'{year}: canonical shard statuses do not match conversion report')
    missing_segments = score_codes - segment_codes
    if missing_segments - official_empty_codes - unavailable_codes:
        score_names = {str(row['专业代号']): str(row.get('专业名称', '')) for row in scores}
        missing = '、'.join(f"{code} {score_names.get(code, '')}".strip()
                            for code in sorted(missing_segments - official_empty_codes - unavailable_codes))
        raise ValueError(f'{year}: scorelines missing score segments without official-empty evidence: {missing}')
    for row in iter_year(segment_index_path, data_root):
        if row.get('status', 'ok') != 'ok':
            continue
        matching_score = next(item['分数线'] for item in scores if str(item['专业代号']) == str(row['majorCode']))
        if row.get('controlScore') != matching_score:
            raise ValueError(f'{year}: score segment control score mismatch for {row["majorCode"]}')
    if not score_codes <= plan_codes or not plan_codes <= score_codes | {
            str(item.get('majorCode')) for item in report.get('officialEmpty', [])}:
        raise ValueError(f'{year}: scorelines and plans use inconsistent major codes')
    mapping_names = {}
    for entry in mapping:
        for major in entry.get('可报本科专业', []):
            mapping_names.setdefault(str(major.get('专业代号', '')), set()).add(
                normalize_major_name(major.get('专业名称')))
    plan_names = {}
    for row in plans:
        plan_names.setdefault(str(row.get('专业代号', '')), set()).add(
            normalize_major_name(row.get('专业名称')))
    for row in scores:
        code = str(row['专业代号'])
        expected_name = normalize_major_name(row['专业名称'])
        if not major_name_matches(code, expected_name, mapping_names, plan_names):
            raise ValueError(f'{year}: major name mismatch across mapping, scorelines and plans for {code}')
    if files.get('mappingReferenceYear', year) == year and not (score_codes | plan_codes) <= mapping_codes | {'A1'}:
        raise ValueError(f'{year}: yearly mapping is missing published major codes')
