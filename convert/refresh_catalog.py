"""Publish browser analytics and catalog metadata from canonical yearly data."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import tempfile
from pathlib import Path

from .common import DATA_ROOT, REPO_ROOT, load_data_plan, read_json
from .validate import validate_score_segment_major
from .segment_store import iter_year

CODE_RE = re.compile(r'^[A-Za-z0-9]+$')
DERIVATION_VERSION = 3


def _json(path: Path):
    if not path.is_file():
        raise ValueError(f"Missing canonical source: {path}")
    return read_json(path)


def _write_manifest(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def _source_path(data_root: Path, relative: str) -> Path:
    path = (data_root / relative).resolve()
    if not path.is_relative_to(data_root.resolve()):
        raise ValueError(f'Source escapes data root: {relative}')
    return path


def _previous_input_hashes(data_root: Path, metadata: dict) -> dict:
    """Read the prior catalog only when metadata explicitly points to it."""
    source = metadata.get('catalogSource')
    if not isinstance(source, str) or not source.startswith('data/'):
        return {}
    path = _source_path(data_root, source.removeprefix('data/'))
    if not path.is_file():
        return {}
    catalog = _json(path)
    hashes = catalog.get('inputSha256', {})
    return hashes if isinstance(hashes, dict) else {}


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
    segment_index_path = _source_path(data_root, files['score-segments'])
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
        manifest = _json(_source_path(data_root, manifest_path))
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
                _normalized_major_name(major.get('专业名称')))
    plan_names = {}
    for row in plans:
        plan_names.setdefault(str(row.get('专业代号', '')), set()).add(
            _normalized_major_name(row.get('专业名称')))
    for row in scores:
        code = str(row['专业代号'])
        expected_name = _normalized_major_name(row['专业名称'])
        if not _major_name_matches(code, expected_name, mapping_names, plan_names):
            raise ValueError(f'{year}: major name mismatch across mapping, scorelines and plans for {code}')
    if files.get('mappingReferenceYear', year) == year and not (score_codes | plan_codes) <= mapping_codes | {'A1'}:
        raise ValueError(f'{year}: yearly mapping is missing published major codes')


def _source_map(data_root: Path):
    by_year = {}
    plan = load_data_plan(data_root)
    for item in plan['sources']:
        if (data_root / item['outputPath']).is_file():
            by_year.setdefault(int(item['year']), {})[item['parser']] = item['outputPath']
    for item in plan['targets']:
        year = int(item['year'])
        if (data_root / item['normalizedPath']).is_file():
            by_year.setdefault(year, {})['score-segments'] = item['normalizedPath']
        if (data_root / item['conversionReportPath']).is_file():
            by_year.setdefault(year, {})['report'] = item['conversionReportPath']
    return by_year


def _major_rows(mapping):
    found = {}
    for item in mapping:
        for major in item.get('可报本科专业', []):
            code = str(major.get('专业代号', '')).strip()
            if code:
                found.setdefault((code, major['专业名称']), major)
    return found


def _normalized_major_name(value):
    name = ''.join(str(value or '').split()).replace('（', '(').replace('）', ')')
    return name.removesuffix('(本科层次职业教育专业)')


def _major_name_matches(code: str, expected_name: str, mapping_names: dict, plan_names: dict) -> bool:
    expected = _normalized_major_name(expected_name)
    mapped = {_normalized_major_name(name) for name in mapping_names.get(code, set())}
    planned = {_normalized_major_name(name) for name in plan_names.get(code, set())}
    if expected in mapped or mapped & planned:
        return True
    # Older years borrow the current mapping; when it has no row for a legacy
    # code, validate the scoreline against that year's plan. Current-year
    # mapping coverage is checked separately below.
    if not mapped and expected in planned:
        return True

    # The 2026 official A1 scoreline uses this qualified name, while the
    # same major is listed as 财务管理 under mapping code 99 and plan code A1.
    # Keep this as an evidence-backed exception rather than stripping arbitrary
    # parentheses or merging names across the two codes.
    return (
        code == 'A1'
        and expected == '财务管理(含大数据与财务管理)'
        and '财务管理' in planned
        and '财务管理' in {_normalized_major_name(name) for name in mapping_names.get('99', set())}
    )


def _matching_plan_rows(major, plan_by_code, plans):
    code = str(major['专业代号']).strip()
    name = _normalized_major_name(major['专业名称'])
    exact = [row for row in plans if _normalized_major_name(row.get('专业名称')) == name]
    if exact:
        same_code = [row for row in exact if str(row.get('专业代号', '')).strip() == code]
        return same_code or exact
    codes = [code]
    if code in ('99', 'A1'):
        codes.append('A1' if code == '99' else '99')
    for candidate_code in codes:
        rows = plan_by_code.get(candidate_code, [])
        if len({_normalized_major_name(row.get('专业名称')) for row in rows}) == 1:
            return rows
    return []


def _analytics(year, mapping, scores, plans):
    score_by_code = {str(row['专业代号']): row for row in scores}
    plan_by_code = {}
    for row in plans:
        plan_by_code.setdefault(str(row.get('专业代号', '')), []).append(row)
    result = []
    for (code, _name), major in sorted(_major_rows(mapping).items()):
        school_types = {}
        candidates = _matching_plan_rows(major, plan_by_code, plans)
        for label, key in [('公办', 'public'), ('民办', 'private')]:
            rows = [r for r in candidates if r.get('办学性质', '公办') == label]
            ordinary = [r for r in rows if r.get('建档立卡') != '是' and '建档立卡' not in r.get('招生类别', '')]
            poverty = [r for r in rows if r not in ordinary]
            schools = {}
            for row in rows:
                name = str(row.get('院校名称') or '').strip()
                school_code = str(row.get('院校代号') or '').strip()
                identity = (school_code, name) if school_code else ('', name)
                school = schools.setdefault(identity, {'schoolName': name, 'schoolCode': school_code,
                                                    'ordinaryPlanCount': 0,
                                                    'povertyPlanCount': 0, 'hasOrdinaryPlan': False,
                                                    'hasPovertyPlan': False})
                special = row in poverty
                school['povertyPlanCount' if special else 'ordinaryPlanCount'] += int(row.get('计划人数') or 0)
                school['hasPovertyPlan' if special else 'hasOrdinaryPlan'] = True
            school_types[key] = {
                'allSchoolCount': len(schools),
                'ordinarySchoolCount': sum(1 for school in schools.values() if school['ordinaryPlanCount'] > 0),
                'ordinaryPlanCount': sum(int(r.get('计划人数') or 0) for r in ordinary),
                'povertyPlanCount': sum(int(r.get('计划人数') or 0) for r in poverty),
                'schools': [schools[identity] for identity in sorted(schools)],
            }
        score = score_by_code.get(code)
        if score is None and code in ('99', 'A1'):
            score = score_by_code.get('A1' if code == '99' else '99')
        result.append({'majorCode': code, 'majorName': major['专业名称'],
                       'controlScore': score.get('分数线') if score else None,
                       'schoolTypes': school_types})
    return {'schemaVersion': 1, 'year': year, 'majors': result}


def refresh_catalog(data_root: Path, template_path: Path, metadata_path: Path) -> dict:
    data_root = Path(data_root)
    template = _json(Path(template_path))
    sources = _source_map(data_root)
    references = template.get('mappingReferences', {})
    for year, files in sources.items():
        if 'mapping' not in files and str(year) in references:
            reference_year = int(references[str(year)])
            files['mapping'] = f'专业对照/专业对照_{reference_year}.json'
            files['mappingReferenceYear'] = reference_year
    previous = _json(Path(metadata_path)) if Path(metadata_path).is_file() else {}
    previously_published_inputs = _previous_input_hashes(data_root, previous)
    publish = {}
    input_hashes = {}
    output = {}
    for year, files in sorted(sources.items()):
        required = ('mapping', 'scorelines', 'plans', 'score-segments')
        if any(key not in files for key in required):
            raise ValueError(f'{year}: incomplete canonical source set')
        report_path = files.get('report', f'reports/转换报告_{year}.json')
        report_file = _source_path(data_root, report_path)
        if not report_file.is_file():
            raise ValueError(f'{year}: missing conversion report')
        canonical = {key: _json(_source_path(data_root, files[key])) for key in required}
        report = _json(report_file)
        year_hashes = {key: hashlib.sha256(_source_path(data_root, files[key]).read_bytes()).hexdigest()
                       for key in required}
        year_hashes['report'] = hashlib.sha256(report_file.read_bytes()).hexdigest()
        derivation_hashes = dict(year_hashes)
        manifest_path = canonical['score-segments'].get('sourceManifest')
        if isinstance(manifest_path, str):
            year_hashes['manifest'] = hashlib.sha256(_source_path(data_root, manifest_path).read_bytes()).hexdigest()
        input_hashes[str(year)] = year_hashes
        previous_year_hashes = previously_published_inputs.get(str(year), {})
        unchanged_published_year = previous_year_hashes == year_hashes
        if not unchanged_published_year:
            validate_year_sources(year, files, canonical, report, data_root)
        version = hashlib.sha256(json.dumps({'derivationVersion': DERIVATION_VERSION,
                                             'inputs': derivation_hashes}, sort_keys=True).encode('utf-8')).hexdigest()[:16]
        prefix = f'generated/{year}/{version}'
        analytics = _analytics(year, canonical['mapping'], canonical['scorelines'], canonical['plans'])
        analytics_path = f'{prefix}/analytics.json'
        output[analytics_path] = analytics
        score_segment_directory = Path(files['score-segments']).parent / str(year)
        publish[str(year)] = {
            'mappingSource': f'data/{files["mapping"]}',
            'queryIndexSource': f'data/{files["mapping"]}',
            'scoreSource': f'data/{files["scorelines"]}',
            'planSource': f'data/{files["plans"]}',
            'scoreSegmentSource': f'data/{files["score-segments"]}',
            'analyticsSource': f'data/{analytics_path}',
            'scoreSegmentIndexSource': f'data/{files["score-segments"]}',
            'scoreSegmentShardTemplate': f'data/{score_segment_directory.as_posix()}/{{majorCode}}.json',
        }
        mapping_filename = Path(files['mapping']).stem
        mapping_year = int(mapping_filename.rsplit('_', 1)[1])
        if mapping_year != year:
            publish[str(year)]['mappingReferenceYear'] = mapping_year
        fallback = _source_path(data_root, f'招生高校及专业/招生高校及专业_{year}.json')
        if fallback.exists():
            publish[str(year)]['collegeFallbackSource'] = f'data/{fallback.relative_to(data_root).as_posix()}'
    if not publish:
        raise ValueError('No complete years to publish')
    years = [int(y) for y in publish]
    metadata = {key: value for key, value in template.items() if key not in ('mappingReferences', 'yearSources', 'supportedYears')}
    metadata.update({'schemaVersion': max(3, template.get('schemaVersion', 1)),
                'supportedYears': years, 'yearSources': publish})
    previous_years = previous.get('supportedYears') or template.get('supportedYears') or []
    previous_default = previous.get('defaultYear', metadata.get('defaultYear'))
    if previous_default not in years or (previous_years and previous_default == max(previous_years)):
        metadata['defaultYear'] = years[-1]
    else:
        metadata['defaultYear'] = previous_default
    catalog = {'schemaVersion': 1, 'derivationVersion': DERIVATION_VERSION,
               'supportedYears': years, 'yearSources': publish,
               'inputSha256': input_hashes}
    catalog_version = hashlib.sha256(json.dumps(catalog, ensure_ascii=False, sort_keys=True).encode('utf-8')).hexdigest()[:16]
    catalog_path = f'generated/catalog/{catalog_version}.json'
    output[catalog_path] = catalog
    metadata['catalogSource'] = f'data/{catalog_path}'
    # Published payloads are immutable and versioned. An interrupted run can
    # leave unreferenced files, but cannot change the files used by old metadata.
    with tempfile.TemporaryDirectory(prefix='.publish-', dir=data_root) as folder:
        staging = Path(folder)
        for relative, value in output.items():
            _write_manifest(staging / relative, value)
        for relative in output:
            target = data_root / relative
            source = staging / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            if target.exists():
                if target.read_bytes() != source.read_bytes():
                    raise ValueError(f'Immutable generated file changed: {target}')
            else:
                os.replace(source, target)
        metadata_target = Path(metadata_path)
        metadata_target.parent.mkdir(parents=True, exist_ok=True)
        temporary = staging / 'metadata.json'
        _write_manifest(temporary, metadata)
        os.replace(temporary, metadata_target)
    return metadata


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data-root', type=Path, default=DATA_ROOT)
    parser.add_argument('--template', type=Path, default=REPO_ROOT / 'metadata/school-data.template.json')
    parser.add_argument('--metadata', type=Path, default=REPO_ROOT / 'metadata/school-data.json')
    args = parser.parse_args()
    result = refresh_catalog(args.data_root, args.template, args.metadata)
    print('Published years:', ', '.join(map(str, result['supportedYears'])))


if __name__ == '__main__':
    main()
