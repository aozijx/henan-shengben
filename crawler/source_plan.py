"""Pure annual seed validation and execution-plan derivation."""
from __future__ import annotations

from pathlib import Path, PureWindowsPath

from crawler.source_rules import CrawlTarget, is_official_url
from pipeline_io import read_json


class AnnualSourceError(ValueError):
    pass


SOURCE_ROLES = {
    'scoreSegments': ('分数段统计表', '一分一段'),
    'scorelines': ('录取控制分数线', '控制分数线'),
    'plans': ('招生计划',),
    'mappingCodeTable': ('专业代号对照', '代号对照表', '专业与考试科目对照表'),
    'mappingOverview': ('专业对照一览', '专业对照表', '可报本科专业', '专业对照及考试科目一览表'),
    'master': ('招生高校及专业总表', '招生高校及专业'),
}
PDF_MARKERS = {
    'scoreSegments': ('分数', '人数'), 'scorelines': ('分数线', '控制分数'),
    'plans': ('招生计划', '计划人数'), 'mappingCodeTable': ('代号', '考试科目'),
    'mappingOverview': ('专科专业', '本科专业'),
    'master': ('招生高校及专业总表',),
}

TABLE_PDF_PATHS = {
    'mappingCodeTable': '专业对照/原始PDF/专业代号对照_{year}.pdf',
    'mappingOverview': '专业对照/原始PDF/专业对照一览_{year}.pdf',
    'master': '招生高校及专业/原始PDF/招生高校及专业_{year}.pdf',
    'plans': '招生计划/原始PDF/招生计划_{year}.pdf',
    'scorelines': '省控线/原始PDF/省控线_{year}.pdf',
}
TABLE_SOURCE_SPECS = (
    ('mappingCodeTable', ('mappingCodeTable',), '专业对照/专业代号对照_{year}.json'),
    ('mapping', ('mappingCodeTable', 'mappingOverview'), '专业对照/专业对照_{year}.json'),
    ('master', ('master',), '招生高校及专业/招生高校及专业_{year}.json'),
    ('plans', ('plans',), '招生计划/招生计划_{year}.json'),
    ('scorelines', ('scorelines',), '省控线/省控线_{year}.json'),
)


def _table_rows(year: int, declared: dict):
    for parser, roles, output in TABLE_SOURCE_SPECS:
        paths = [declared.get(role, {}).get('localPath') or TABLE_PDF_PATHS[role].format(year=year)
                 for role in roles]
        yield parser, roles, output.format(year=year), paths


def load_year_links(path: Path) -> dict:
    seed = read_json(path)
    year = seed.get('year')
    if not isinstance(year, int) or year < 2000 or year > 2200:
        raise AnnualSourceError('year-links must contain a valid integer year')
    if seed.get('searchPageUrl') and not is_official_url(seed['searchPageUrl']):
        raise AnnualSourceError('searchPageUrl must use an official HTTPS host')
    sources = seed.get('sources')
    if not isinstance(sources, dict):
        raise AnnualSourceError('sources must be an object keyed by source role')
    for role, item in sources.items():
        if role not in SOURCE_ROLES or not isinstance(item, dict):
            raise AnnualSourceError(f'unknown source role: {role}')
        for key in ('pageUrl', 'attachmentUrl'):
            url = item.get(key)
            if url and not is_official_url(url):
                raise AnnualSourceError(f'{role}.{key} must use an official HTTPS host')
        if 'localPath' in item:
            local_path = item['localPath']
            if not isinstance(local_path, str) or not local_path.strip():
                raise AnnualSourceError(f'{role}.localPath must be a safe relative PDF path')
            normalized_path = Path(str(local_path).replace('\\', '/'))
            if (PureWindowsPath(local_path).is_absolute() or normalized_path.is_absolute()
                    or '..' in normalized_path.parts
                    or normalized_path.suffix.lower() != '.pdf'):
                raise AnnualSourceError(f'{role}.localPath must be a safe relative PDF path')
    return seed


def score_segment_target_for_seed(seed: dict, *, resolved_page_url: str | None = None) -> CrawlTarget | None:
    """Derive the optional score-segment target only when that role is declared."""
    year = int(seed['year'])
    score_segments = seed.get('sources', {}).get('scoreSegments')
    if score_segments is None:
        return None
    segment_page = resolved_page_url or score_segments.get('pageUrl')
    discovery_url = segment_page or seed.get('searchPageUrl')
    if not discovery_url:
        return None
    if not is_official_url(discovery_url):
        raise AnnualSourceError(f'{year} scoreSegments: pageUrl/searchPageUrl must use an official HTTPS host')
    return CrawlTarget(
        dataset='score-segments',
        year=year,
        source_page_url=segment_page or discovery_url,
        discovery_url=discovery_url,
        manifest_path=f'来源清单/来源清单_{year}.json',
        download_directory=f'一分一段/原始PDF/{year}',
        normalized_path=f'一分一段/一分一段_{year}.json',
        conversion_report_path=f'reports/转换报告_{year}.json',
        parser='score-segments',
    )


def crawl_target_record(seed: dict) -> dict | None:
    target = score_segment_target_for_seed(seed)
    if target is None:
        return None
    return {
        'dataset': target.dataset,
        'year': target.year,
        'sourcePageUrl': target.source_page_url,
        'discoveryUrl': target.discovery_url,
        'manifestPath': target.manifest_path,
        'downloadDirectory': target.download_directory,
        'normalizedPath': target.normalized_path,
        'conversionReportPath': target.conversion_report_path,
        'parser': target.parser,
    }


def source_rows_for_seed(seed: dict, data_root: Path) -> list[dict]:
    """Derive tabular parser inputs from a seed and conventional local files."""
    year = int(seed['year'])
    data_root = Path(data_root)
    rows = []
    declared = seed.get('sources', {})
    for parser, roles, output_path, pdf_paths in _table_rows(year, declared):
        if parser == 'mapping':
            # A complete mapping needs both official roles in the year's seed.
            # A leftover JSON or PDF alone must not become the latest mapping.
            inputs_available = all(role in declared for role in roles)
        else:
            inputs_available = roles[0] in declared or (data_root / pdf_paths[0]).is_file()
        available = (inputs_available if parser == 'mapping'
                     else (data_root / output_path).is_file() or inputs_available)
        if not available:
            continue
        row = {'outputPath': output_path, 'pdfPaths': pdf_paths, 'parser': parser, 'year': year}
        output = data_root / output_path
        if output.is_file():
            value = read_json(output)
            if isinstance(value, list):
                row['expectedCount'] = len(value)
        rows.append(row)
    return rows


def seed_paths_in(data_root: Path) -> list[Path]:
    """List the numeric year seeds, skipping non-year files such as template.json."""
    data_root = Path(data_root)
    return [path for path in sorted((data_root / 'year-links').glob('*.json')) if path.stem.isdigit()]


def build_data_plan(data_root: Path, years: set[int] | None = None,
                    seed_paths: list[Path] | None = None) -> dict:
    data_root = Path(data_root)
    seeds = []
    seen_years = set()
    for path in seed_paths if seed_paths is not None else seed_paths_in(data_root):
        seed = load_year_links(path)
        if path.stem != str(seed['year']):
            raise AnnualSourceError(f'year-links filename/year mismatch: {path.name}')
        if seed['year'] in seen_years:
            raise AnnualSourceError(f'duplicate year-links seed: {seed["year"]}')
        seen_years.add(seed['year'])
        if years is None or int(seed['year']) in years:
            seeds.append(seed)
    rows = [row for seed in seeds for row in source_rows_for_seed(seed, data_root)]
    targets = []
    for seed in seeds:
        target = crawl_target_record(seed)
        if target is not None:
            targets.append(target)
    return {
        'seeds': seeds,
        'sources': sorted(rows, key=lambda row: (int(row['year']), row['parser'])),
        'targets': sorted(targets, key=lambda target: (target['dataset'], int(target['year']))),
    }


def execution_rows_from_resolved(resolved: dict) -> tuple[list[dict], dict | None]:
    """Turn verified page and attachment records into parser and crawl inputs."""
    year = resolved['year']
    attachments = resolved['attachments']
    selected = {role: items[0] for role, items in attachments.items() if role in TABLE_PDF_PATHS}
    sources = []
    for parser, roles, output_path, pdf_paths in _table_rows(year, selected):
        if all(role in selected for role in roles):
            sources.append({
                'outputPath': output_path, 'pdfPaths': pdf_paths,
                'pdfUrls': [selected[role]['url'] for role in roles],
                'pageUrls': [resolved['pages'][role] for role in roles],
                'parser': parser, 'year': year,
            })
    crawl = None
    segment_page = resolved['pages'].get('scoreSegments')
    if segment_page:
        crawl = crawl_target_record({
            'year': year, 'sources': {'scoreSegments': {'pageUrl': segment_page}},
        })
    return sources, crawl
