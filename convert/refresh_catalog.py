"""Publish browser analytics and catalog metadata from canonical yearly data."""
from __future__ import annotations

import argparse
import json
import os
import tempfile
from pathlib import Path

from .catalog_analytics import build_annual_analytics
from .catalog_sources import apply_source_reuse, build_source_catalog, collect_source_map
from .catalog_validation import (
    clean_report, json_content_sha256, manifest_identity_sha256, published_report,
    read_catalog_json, resolve_data_path, validate_year_sources,
)
from .paths import DATA_ROOT, REPO_ROOT
from pipeline_integrity import sha256_bytes
from pipeline_io import write_json

DERIVATION_VERSION = 3


def refresh_catalog(data_root: Path, template_path: Path, metadata_path: Path,
                    *, retain_reports: bool = False) -> dict:
    data_root = Path(data_root)
    template = read_catalog_json(Path(template_path))
    sources = collect_source_map(data_root)
    source_catalog = build_source_catalog(data_root, sources)
    mapping_years = source_catalog['mapping']
    if not mapping_years:
        raise ValueError('No complete professional mapping is available for search')
    query_mapping_year = max(map(int, mapping_years))
    query_mapping_source = mapping_years[str(query_mapping_year)]
    apply_source_reuse(sources, template.get('sourceReuse', {}))
    previous = read_catalog_json(Path(metadata_path)) if Path(metadata_path).is_file() else {}
    previously_published_years = set(previous.get('supportedYears', []))
    previously_published_inputs = _previous_input_hashes(data_root, previous)
    publish = {}
    input_hashes = {}
    output = {}
    conversion_reports = {}
    report_files_to_remove = []
    for year, files in sorted(sources.items()):
        required = ('mapping', 'scorelines', 'plans', 'score-segments')
        missing = [key for key in required if key not in files]
        if missing:
            if year in previously_published_years:
                raise ValueError(f'{year}: published year missing canonical sources: {missing}')
            continue
        canonical = {key: read_catalog_json(resolve_data_path(data_root, files[key])) for key in required}
        report_file = resolve_data_path(data_root, files['report']) if 'report' in files else None
        report = (read_catalog_json(report_file) if report_file else
                  previous.get('conversionReports', {}).get(str(year)) or
                  clean_report(year, canonical['score-segments']))
        published_report = published_report(report)
        year_hashes = {key: json_content_sha256(canonical[key]) for key in required}
        year_hashes['report'] = json_content_sha256(published_report)
        derivation_hashes = dict(year_hashes)
        manifest_path = canonical['score-segments'].get('sourceManifest')
        if isinstance(manifest_path, str):
            year_hashes['manifest'] = manifest_identity_sha256(resolve_data_path(data_root, manifest_path))
        input_hashes[str(year)] = year_hashes
        previous_year_hashes = previously_published_inputs.get(str(year), {})
        unchanged_published_year = previous_year_hashes == year_hashes and report_file is None
        if not unchanged_published_year:
            validate_year_sources(year, files, canonical, report, data_root)
        conversion_reports[str(year)] = published_report
        if report_file:
            report_files_to_remove.append(report_file)
        version = sha256_bytes(json.dumps({'derivationVersion': DERIVATION_VERSION,
                                           'inputs': derivation_hashes}, sort_keys=True).encode('utf-8'))[:16]
        prefix = f'generated/{year}/{version}'
        analytics = build_annual_analytics(year, canonical['mapping'], canonical['scorelines'], canonical['plans'])
        analytics_path = f'{prefix}/analytics.json'
        output[analytics_path] = analytics
        score_segment_directory = Path(files['score-segments']).parent / str(year)
        publish[str(year)] = {
            'mappingSource': f'data/{files["mapping"]}',
            'queryIndexSource': query_mapping_source,
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
        fallback = resolve_data_path(data_root, f'招生高校及专业/招生高校及专业_{year}.json')
        if fallback.exists():
            publish[str(year)]['collegeFallbackSource'] = f'data/{fallback.relative_to(data_root).as_posix()}'
    if not publish:
        raise ValueError('No complete years to publish')
    years = [int(y) for y in publish]
    metadata = {key: value for key, value in template.items() if key not in ('sourceReuse', 'yearSources', 'supportedYears')}
    metadata.update({'schemaVersion': max(3, template.get('schemaVersion', 1)),
                'supportedYears': years, 'yearSources': publish,
                'queryMappingYear': query_mapping_year, 'queryMappingSource': query_mapping_source,
                'sourceCatalog': source_catalog, 'conversionReports': conversion_reports})
    previous_years = previous.get('supportedYears') or template.get('supportedYears') or []
    previous_default = previous.get('defaultYear', metadata.get('defaultYear'))
    if previous_default not in years or (previous_years and previous_default == max(previous_years)):
        metadata['defaultYear'] = years[-1]
    else:
        metadata['defaultYear'] = previous_default
    catalog = {'schemaVersion': 1, 'derivationVersion': DERIVATION_VERSION,
               'supportedYears': years, 'yearSources': publish,
               'sourceCatalog': source_catalog,
               'inputSha256': input_hashes}
    catalog_version = sha256_bytes(json.dumps(catalog, ensure_ascii=False, sort_keys=True).encode('utf-8'))[:16]
    catalog_path = f'generated/catalog/{catalog_version}.json'
    output[catalog_path] = catalog
    metadata['catalogSource'] = f'data/{catalog_path}'
    # Published payloads are immutable and versioned. An interrupted run can
    # leave unreferenced files, but cannot change the files used by old metadata.
    with tempfile.TemporaryDirectory(prefix='.publish-', dir=data_root) as folder:
        staging = Path(folder)
        for relative, value in output.items():
            write_json(staging / relative, value, indent=2)
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
        write_json(temporary, metadata, indent=2)
        os.replace(temporary, metadata_target)
    if not retain_reports:
        for report_file in report_files_to_remove:
            report_file.unlink(missing_ok=True)
    return metadata


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data-root', type=Path, default=DATA_ROOT)
    parser.add_argument('--template', type=Path, default=REPO_ROOT / 'metadata/school-data.template.json')
    parser.add_argument('--metadata', type=Path, default=REPO_ROOT / 'metadata/school-data.json')
    args = parser.parse_args()
    result = refresh_catalog(args.data_root, args.template, args.metadata)
    print('Published years:', ', '.join(map(str, result['supportedYears'])))
