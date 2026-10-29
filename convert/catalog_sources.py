"""Discover annual catalog inputs and apply configured cross-year reuse."""
from __future__ import annotations

from pathlib import Path

from crawler.source_plan import build_data_plan
from .local_tables import load_local_tables


def collect_source_map(data_root: Path) -> dict[int, dict[str, str | int]]:
    by_year = {}
    plan = build_data_plan(data_root)
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


def build_source_catalog(data_root: Path, annual_sources: dict[int, dict]) -> dict[str, dict[str, str]]:
    """Index each published table independently of complete annual statistics."""
    roles = {'mapping': 'mapping', 'master': 'colleges', 'plans': 'plans',
             'scorelines': 'scorelines', 'score-segments': 'scoreSegments'}
    sources = {year: dict(files) for year, files in annual_sources.items()}
    for year, files in load_local_tables(data_root).items():
        sources.setdefault(year, {}).update(files)
    catalog: dict[str, dict[str, str]] = {name: {} for name in roles.values()}
    for year, files in sorted(sources.items()):
        for parser, name in roles.items():
            if parser in files:
                catalog[name][str(year)] = f'data/{files[parser]}'
    return catalog


def apply_source_reuse(sources: dict[int, dict], policies: dict[str, str]) -> None:
    """Apply configured reuse only to source types that support cross-year validation."""
    for parser, policy in policies.items():
        if parser != 'mapping' or policy != 'latestAvailable':
            raise ValueError(f'unsupported source reuse policy: {parser}={policy}')
        available = {year: files[parser] for year, files in sources.items() if parser in files}
        if not available:
            continue
        latest = max(available)
        for files in sources.values():
            if parser not in files:
                files[parser] = available[latest]
                files['mappingReferenceYear'] = latest
