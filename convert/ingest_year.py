"""Discover, convert, validate and publish one new year from official link seeds."""
from __future__ import annotations

import argparse
import json
import os
import shutil
import tempfile
from pathlib import Path
from types import SimpleNamespace

from convert.common import REPO_ROOT, read_json
from convert.convert_all import convert_target
from convert.extract_cli import extract_year_sources
from convert.refresh_catalog import refresh_catalog
from pipeline_config import REQUEST_TIMEOUT
from crawler.discover import discover_year, entry_document
from crawler.download import download_entry, download_manifest
from crawler.waf import build_session
from crawler.year_sources import (
    SourceResolutionError,
    crawl_target_record,
    load_year_links,
    execution_rows_for_year,
    resolve_year_sources,
    source_rows_for_seed,
    validate_attachment,
)


def _write(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def source_role_for_attachment(parser: str, index: int) -> str:
    """Map a derived parser row and PDF position to its source provenance role."""
    if parser == 'mapping':
        if index not in (0, 1):
            raise ValueError(f'unsupported mapping attachment index: {index}')
        return 'mappingCodeTable' if index == 0 else 'mappingOverview'
    if parser in {'scorelines', 'plans', 'master'} and index == 0:
        return parser
    raise ValueError(f'unsupported parser attachment: {parser}[{index}]')


def validate_score_segment_pdfs(entries: list[dict], data_root: Path, year: int) -> None:
    """Validate each downloaded score-segment PDF and identify failures by path."""
    for item in entries:
        relative = item['localPath']
        print(f'[{year}] 校验一分一段 PDF：{relative}', flush=True)
        try:
            validate_attachment('scoreSegments', year, (Path(data_root) / relative).read_bytes())
        except SourceResolutionError as error:
            raise SourceResolutionError(f'{relative}: {error}') from error


def publish_staged_files(staging_root: Path, data_root: Path) -> None:
    """Preflight every destination before publishing any newly staged file."""
    staged_files = [path for path in Path(staging_root).rglob('*') if path.is_file()]
    for source in staged_files:
        relative = source.relative_to(staging_root)
        target = Path(data_root) / relative
        if target.exists() and target.read_bytes() != source.read_bytes():
            raise ValueError(f'new-year publish would overwrite existing file: {relative}')
    for source in staged_files:
        relative = source.relative_to(staging_root)
        target = Path(data_root) / relative
        if target.exists():
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary_file = target.with_name(target.name + '.new')
        shutil.copy2(source, temporary_file)
        os.replace(temporary_file, target)


def _run_in_staging(seed: dict, root: Path, session, *, full_report: bool = False) -> dict:
    year = seed['year']
    prospective_rows = source_rows_for_seed(seed, root)
    prospective_target = crawl_target_record(seed)
    collision_paths = [row['outputPath'] for row in prospective_rows]
    collision_paths.extend(prospective_target[key] for key in (
        'manifestPath', 'normalizedPath', 'conversionReportPath'))
    if any((root / relative).exists() for relative in collision_paths):
        raise ValueError(f'{year} already exists; new-year publish would overwrite existing file')
    resolved = resolve_year_sources(seed, session)
    print(f'[{year}] 已解析并校验官方来源页', flush=True)
    source_rows, crawl_target = execution_rows_for_year(resolved)
    plan = {'seeds': [seed], 'sources': source_rows, 'targets': [crawl_target]}

    # Download source tables first; their final URLs and hashes are recorded in a provenance manifest.
    provenance = []
    for row in source_rows:
        for index, (relative, url) in enumerate(zip(row['pdfPaths'], row['pdfUrls'])):
            print(f'[{year}] 下载官方 PDF：{relative}', flush=True)
            result = download_entry(url, root / relative, session)
            if result['downloadStatus'] != 'downloaded':
                raise ValueError(f"{year}: failed source download {url}: {result.get('error')}")
            role = source_role_for_attachment(row['parser'], index)
            validate_attachment(role, year, (root / relative).read_bytes())
            print(f'[{year}] 校验通过：{relative}', flush=True)
            provenance.append({'year': year, 'type': role, 'sourcePageUrl': row['pageUrls'][index],
                'sourceUrl': url, **({'finalUrl': result['finalUrl']} if result.get('finalUrl') else {}),
                'localPath': relative, 'sha256': result['sha256'], 'bytes': result['bytes']})
    _write(root / f'来源清单/官方来源_{year}.json', {'schemaVersion': 1, 'year': year, 'sources': provenance})

    page = session.get(crawl_target['discoveryUrl'], timeout=REQUEST_TIMEOUT)
    page.raise_for_status()
    print(f'[{year}] 发现一分一段官方 PDF …', flush=True)
    target = SimpleNamespace(year=year, source_page_url=crawl_target['sourcePageUrl'],
                             download_directory=crawl_target['downloadDirectory'])
    entries = discover_year(target, page.content, base_url=crawl_target['sourcePageUrl'])
    print(f'[{year}] 发现 {len(entries)} 个一分一段官方 PDF', flush=True)
    manifest = {'schemaVersion': 1, 'dataset': 'score-segments', 'year': year,
                'sourcePageUrl': crawl_target['sourcePageUrl'], 'discoveryUrl': crawl_target['discoveryUrl'],
                'entries': [entry_document(item) for item in entries]}
    manifest_path = root / crawl_target['manifestPath']
    _write(manifest_path, manifest)
    counts = download_manifest(manifest_path, root, session)
    if counts['failed'] or counts['downloaded'] + counts['skipped'] != len(entries):
        raise ValueError(f'{year}: score-segment downloads incomplete: {counts}')
    segment_provenance = read_json(manifest_path)['entries']
    validate_score_segment_pdfs(segment_provenance, root, year)
    results = extract_year_sources(plan, root, year, write=True)
    print(f'[{year}] 官方表格抽取完成：{len(results)} 张', flush=True)
    if len(results) != len(source_rows) or any(item['expectedCountMismatch'] for item in results):
        raise ValueError(f'{year}: tabular source extraction incomplete or unexpected row count')
    print(f'[{year}] 抽取并归一化一分一段分数段 …', flush=True)
    segment_result = convert_target(crawl_target, root, plan=plan, full_report=full_report)
    if segment_result['summary']['needsReview']:
        raise ValueError(f'{year}: OCR requires human review before publication')
    normalization_report = read_json(root / crawl_target['conversionReportPath'])
    if normalization_report['blockingCount']:
        raise ValueError(f'{year}: normalization has unresolved blockers')
    return {'year': year, 'sources': len(source_rows), 'sourceProvenance': provenance,
            'scoreSegmentPdfs': len(entries), 'scoreSegmentProvenance': segment_provenance,
            'publishedMajors': normalization_report['publishedMajorCount'],
            'conversionReport': normalization_report}


def ingest_year(seed_path: Path, data_root: Path, template_path: Path, metadata_path: Path,
                session=None, *, check: bool = False, full_report: bool = False) -> dict:
    seed = load_year_links(seed_path)
    if Path(seed_path).stem != str(seed['year']):
        raise ValueError(f"year-links filename/year mismatch: {Path(seed_path).name}")
    session = session or build_session()
    data_root, metadata_path = Path(data_root).resolve(), Path(metadata_path).resolve()
    with tempfile.TemporaryDirectory(prefix='.ingest-year-', dir=data_root.parent) as temporary:
        print(f"[{seed['year']}] 准备暂存目录 …", flush=True)
        staging_root = Path(temporary) / 'data'
        shutil.copytree(data_root, staging_root)
        staged_seed = staging_root / 'year-links' / f"{seed['year']}.json"
        staged_seed.parent.mkdir(parents=True, exist_ok=True)
        if staged_seed.exists() and staged_seed.read_bytes() != Path(seed_path).read_bytes():
            raise ValueError(f"{seed['year']} year-links seed differs from the active data root")
        shutil.copy2(seed_path, staged_seed)
        shutil.copy2(metadata_path, Path(temporary) / 'metadata.json')
        report = _run_in_staging(seed, staging_root, session, full_report=full_report)
        staged_metadata = Path(temporary) / 'metadata.json'
        result = refresh_catalog(staging_root, template_path, staged_metadata)
        report['supportedYears'] = result['supportedYears']
        if check:
            report['metadataDiff'] = {'addedYear': seed['year'],
                                      'yearSources': result['yearSources'][str(seed['year'])],
                                      'defaultYear': result['defaultYear']}
            return report
        # Publish only new paths. Refuse every collision before copying, then replace metadata last.
        publish_staged_files(staging_root, data_root)
        staged_file = Path(temporary) / 'metadata.json'
        metadata_tmp = metadata_path.with_name(metadata_path.name + '.new')
        shutil.copy2(staged_file, metadata_tmp)
        os.replace(metadata_tmp, metadata_path)
        return report


def _summary_report(report: dict, *, check: bool) -> dict:
    conversion = report['conversionReport']
    compact_conversion = {key: conversion.get(key) for key in (
        'inputMajorCount', 'publishedMajorCount', 'officialEmptyCount', 'sourceUnavailableCount',
        'blockingCount', 'officialEmpty', 'sourceUnavailable', 'blockers', 'validationErrors')}
    summary = {
        'status': 'validated' if check else 'published',
        'year': report['year'],
        'sources': report['sources'],
        'scoreSegmentPdfs': report['scoreSegmentPdfs'],
        'publishedMajors': report['publishedMajors'],
        'supportedYears': report['supportedYears'],
        'conversionReport': compact_conversion,
    }
    if check and 'metadataDiff' in report:
        summary['metadataDiff'] = report['metadataDiff']
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description='Ingest and validate one new official data year')
    parser.add_argument('--seed', required=True, type=Path)
    parser.add_argument('--data-root', type=Path, default=REPO_ROOT / 'data')
    parser.add_argument('--template', type=Path, default=REPO_ROOT / 'metadata/school-data.template.json')
    parser.add_argument('--metadata', type=Path, default=REPO_ROOT / 'metadata/school-data.json')
    parser.add_argument('--check', action='store_true', help='validate in staging without publishing')
    parser.add_argument('--full-report', action='store_true', help='输出来源溯源和完整逐专业转换报告')
    args = parser.parse_args()
    try:
        report = ingest_year(args.seed, args.data_root, args.template, args.metadata,
                             check=args.check, full_report=args.full_report)
    except Exception as error:
        print(json.dumps({'status': 'failed', 'error': str(error)}, ensure_ascii=False, indent=2))
        return 1
    output = ({'status': 'validated' if args.check else 'published', **report}
              if args.full_report else _summary_report(report, check=args.check))
    print(json.dumps(output, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
