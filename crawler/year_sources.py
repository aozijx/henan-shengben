"""Resolve one year's official source pages from a small human-maintained seed."""
from __future__ import annotations

import json
from pathlib import Path, PureWindowsPath
from urllib.parse import urljoin, urlparse
from io import BytesIO

import pdfplumber
import requests
from bs4 import BeautifulSoup

from crawler.source_rules import CrawlTarget, is_official_pdf_url
from pipeline_config import REQUEST_TIMEOUT


class SourceResolutionError(ValueError):
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


def _official_page(url: str) -> bool:
    parsed = urlparse(url)
    return parsed.scheme == 'https' and parsed.hostname in {
        'www.haeea.cn', 'haeea.cn', 'news.haeea.cn', 'www.heao.com.cn', 'gaokao.haedu.cn'
    }


def load_year_links(path: Path) -> dict:
    seed = json.loads(Path(path).read_text(encoding='utf-8'))
    year = seed.get('year')
    if not isinstance(year, int) or year < 2000 or year > 2200:
        raise SourceResolutionError('year-links must contain a valid integer year')
    if seed.get('searchPageUrl') and not _official_page(seed['searchPageUrl']):
        raise SourceResolutionError('searchPageUrl must use an official HTTPS host')
    sources = seed.get('sources')
    if not isinstance(sources, dict):
        raise SourceResolutionError('sources must be an object keyed by source role')
    for role, item in sources.items():
        if role not in SOURCE_ROLES or not isinstance(item, dict):
            raise SourceResolutionError(f'unknown source role: {role}')
        for key in ('pageUrl', 'attachmentUrl'):
            url = item.get(key)
            if url and not _official_page(url) and not is_official_pdf_url(url):
                raise SourceResolutionError(f'{role}.{key} must use an official HTTPS host')
        if 'localPath' in item:
            local_path = item['localPath']
            if not isinstance(local_path, str) or not local_path.strip():
                raise SourceResolutionError(f'{role}.localPath must be a safe relative PDF path')
            normalized_path = Path(str(local_path).replace('\\', '/'))
            if (PureWindowsPath(local_path).is_absolute() or normalized_path.is_absolute()
                    or '..' in normalized_path.parts
                    or normalized_path.suffix.lower() != '.pdf'):
                raise SourceResolutionError(f'{role}.localPath must be a safe relative PDF path')
    return seed


def crawl_target_for_seed(seed: dict) -> CrawlTarget:
    """Derive the stable score-segment execution paths from one annual seed."""
    year = int(seed['year'])
    segment_page = seed.get('sources', {}).get('scoreSegments', {}).get('pageUrl')
    discovery_url = segment_page or seed.get('searchPageUrl')
    if not discovery_url or not _official_page(discovery_url):
        raise SourceResolutionError(f'{year} scoreSegments: add an official pageUrl or searchPageUrl')
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


def load_seed_targets(seed_paths, years: set[int] | None = None) -> list[CrawlTarget]:
    targets = []
    seen = set()
    for path in seed_paths:
        seed = load_year_links(Path(path))
        year = int(seed['year'])
        if year in seen:
            raise SourceResolutionError(f'duplicate year-links seed: {year}')
        seen.add(year)
        if years is None or year in years:
            targets.append(crawl_target_for_seed(seed))
    return sorted(targets, key=lambda target: (target.dataset, target.year))


def crawl_target_record(seed: dict) -> dict:
    target = crawl_target_for_seed(seed)
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
    specs = (
        ('mapping', ('mappingCodeTable', 'mappingOverview'), f'专业对照/专业对照_{year}.json',
         (f'专业对照/原始PDF/专业代号对照_{year}.pdf', f'专业对照/原始PDF/专业对照一览_{year}.pdf')),
        ('master', ('master',), f'招生高校及专业/招生高校及专业_{year}.json',
         (f'招生高校及专业/原始PDF/招生高校及专业_{year}.pdf',)),
        ('plans', ('plans',), f'招生计划/招生计划_{year}.json',
         (f'招生计划/原始PDF/招生计划_{year}.pdf',)),
        ('scorelines', ('scorelines',), f'省控线/省控线_{year}.json',
         (f'省控线/原始PDF/省控线_{year}.pdf',)),
    )
    rows = []
    declared = seed.get('sources', {})
    for parser, roles, output_path, pdf_paths in specs:
        pdf_paths = list(pdf_paths)
        for index, role in enumerate(roles):
            local_path = declared.get(role, {}).get('localPath')
            if local_path:
                pdf_paths[index] = local_path
        available = any(role in declared for role in roles)
        available = available or (data_root / output_path).is_file()
        available = available or any((data_root / path).is_file() for path in pdf_paths)
        if not available:
            continue
        row = {'outputPath': output_path, 'pdfPaths': pdf_paths, 'parser': parser, 'year': year}
        output = data_root / output_path
        if output.is_file():
            value = json.loads(output.read_text(encoding='utf-8'))
            if isinstance(value, list):
                row['expectedCount'] = len(value)
        rows.append(row)
    return rows


def seed_paths_in(data_root: Path) -> list[Path]:
    """List the numeric year seeds, skipping non-year files such as template.json."""
    data_root = Path(data_root)
    return [path for path in sorted((data_root / 'year-links').glob('*.json')) if path.stem.isdigit()]


def build_data_plan(data_root: Path, years: set[int] | None = None) -> dict:
    data_root = Path(data_root)
    seeds = []
    for path in seed_paths_in(data_root):
        seed = load_year_links(path)
        if path.stem != str(seed['year']):
            raise SourceResolutionError(f'year-links filename/year mismatch: {path.name}')
        if years is None or int(seed['year']) in years:
            seeds.append(seed)
    rows = [row for seed in seeds for row in source_rows_for_seed(seed, data_root)]
    targets = [crawl_target_record(seed) for seed in seeds]
    return {
        'seeds': seeds,
        'sources': sorted(rows, key=lambda row: (int(row['year']), row['parser'])),
        'targets': sorted(targets, key=lambda target: (target['dataset'], int(target['year']))),
    }


def _year_title(text: str, year: int) -> bool:
    return str(year) in text


def _classify(text: str, year: int) -> list[str]:
    if not _year_title(text, year):
        return []
    return [role for role, phrases in SOURCE_ROLES.items() if any(phrase in text for phrase in phrases)]


def _search_candidates(seed: dict, session) -> dict[str, set[str]]:
    url = seed.get('searchPageUrl')
    if not url:
        return {}
    response = session.get(url, timeout=REQUEST_TIMEOUT)
    response.raise_for_status()
    soup = BeautifulSoup(response.content, 'html.parser')
    candidates: dict[str, set[str]] = {}
    for link in soup.find_all('a', href=True):
        page_url = urljoin(url, link['href'])
        if not _official_page(page_url):
            continue
        title = ' '.join(link.parent.get_text(' ', strip=True).split())
        for role in _classify(title, seed['year']):
            candidates.setdefault(role, set()).add(page_url)
    return candidates


def resolve_score_segment_target(seed: dict, session) -> CrawlTarget:
    """Resolve the one score-segment announcement needed by the crawler."""
    explicit = seed.get('sources', {}).get('scoreSegments', {}).get('pageUrl')
    if explicit:
        return crawl_target_for_seed(seed)
    candidates = _search_candidates(seed, session).get('scoreSegments', set())
    candidates = {url for url in candidates if _official_page(url)}
    if len(candidates) != 1:
        raise SourceResolutionError(
            f"{seed['year']} scoreSegments: expected one official page, found {len(candidates)}; add an exact pageUrl")
    resolved = dict(seed)
    resolved['sources'] = dict(seed.get('sources', {}))
    resolved['sources']['scoreSegments'] = {'pageUrl': next(iter(candidates))}
    return crawl_target_for_seed(resolved)


def _page_attachments(page_url: str, session, year: int) -> list[tuple[str, str]]:
    response = session.get(page_url, timeout=REQUEST_TIMEOUT)
    response.raise_for_status()
    soup = BeautifulSoup(response.content, 'html.parser')
    found = []
    for link in soup.find_all('a', href=True):
        url = urljoin(page_url, link['href'])
        if not is_official_pdf_url(url):
            continue
        label = ' '.join(link.get_text(' ', strip=True).split())
        filename = urlparse(url).path.rsplit('/', 1)[-1]
        found.append((url, label or filename))
    return found


def validate_attachment(role: str, year: int, content: bytes) -> None:
    """Confirm the downloaded PDF itself identifies the requested year and data type."""
    try:
        with pdfplumber.open(BytesIO(content)) as pdf:
            text = ' '.join((page.extract_text() or '') for page in pdf.pages[:3])
            text = _attachment_identity_evidence(text, pdf.metadata or {})
    except Exception as error:
        raise SourceResolutionError(f'{year} {role}: attachment is not a readable PDF: {error}') from error
    markers = PDF_MARKERS[role]
    if str(year) not in text or not any(marker in text for marker in markers):
        raise SourceResolutionError(f'{year} {role}: PDF content does not confirm year and source type')


def _attachment_identity_evidence(text: str, metadata: dict) -> str:
    """Include decoded PDF metadata for scanned official documents without a text layer."""
    evidence = [text]
    for value in metadata.values():
        if not isinstance(value, str):
            continue
        evidence.append(value)
        encoded = value.strip()
        if len(encoded) < 4 or not encoded.startswith('<'):
            continue
        encoded = encoded[1:-1] if encoded.endswith('>') else encoded[1:]
        if len(encoded) % 2:
            encoded += '0'
        try:
            evidence.append(bytes.fromhex(encoded).decode('gb18030', errors='ignore'))
        except ValueError:
            continue
    return ' '.join(evidence)


def resolve_year_sources(seed: dict, session=None) -> dict:
    session = session or requests.Session()
    year = seed['year']
    page_missing = any(not seed.get('sources', {}).get(role, {}).get('pageUrl') for role in SOURCE_ROLES)
    candidates = _search_candidates(seed, session) if page_missing else {}
    pages = {}
    for role in SOURCE_ROLES:
        explicit = seed.get('sources', {}).get(role, {}).get('pageUrl')
        urls = {explicit} if explicit else candidates.get(role, set())
        urls = {url for url in urls if _official_page(url)}
        if len(urls) != 1:
            raise SourceResolutionError(f'{year} {role}: expected one official page, found {len(urls)}; add an exact pageUrl')
        pages[role] = next(iter(urls))
        response = session.get(pages[role], timeout=REQUEST_TIMEOUT)
        response.raise_for_status()
        page_text = BeautifulSoup(response.content, 'html.parser').get_text(' ', strip=True)
        if str(year) not in page_text or not any(word in page_text for word in SOURCE_ROLES[role]):
            raise SourceResolutionError(f'{year} {role}: official page title/content does not confirm the year and source type')

    attachments = {}
    for role, page_url in pages.items():
        exact = seed.get('sources', {}).get(role, {}).get('attachmentUrl')
        files = [(exact, '')] if exact else _page_attachments(page_url, session, year)
        if not exact and role == 'mappingCodeTable':
            files = [item for item in files if any(word in (item[0] + item[1]) for word in ('代号', '代码'))]
        elif not exact and role == 'mappingOverview':
            files = [item for item in files if any(word in (item[0] + item[1]) for word in ('对照', '一览'))]
        elif not exact and role == 'master':
            files = [item for item in files if any(word in (item[0] + item[1]) for word in ('招生高校及专业', '高校及专业总表'))]
        if role == 'scoreSegments':
            if not files:
                raise SourceResolutionError(f'{year} {role}: no official major PDFs found')
        elif len(files) != 1:
            raise SourceResolutionError(f'{year} {role}: expected one official PDF, found {len(files)}; add an exact attachmentUrl')
        for url, _label in files:
            if not is_official_pdf_url(url):
                raise SourceResolutionError(f'{year} {role}: attachment is not an official PDF')
        local_path = seed.get('sources', {}).get(role, {}).get('localPath')
        attachments[role] = [{'url': url, 'title': title, **({'localPath': local_path} if local_path else {})}
                              for url, title in files]
    return {'year': year, 'pages': pages, 'attachments': attachments}


def execution_rows_for_year(resolved: dict) -> tuple[list[dict], dict]:
    year = resolved['year']
    attachments = resolved['attachments']
    sources = [
        {'outputPath': f'省控线/省控线_{year}.json', 'pdfPaths': [f'省控线/原始PDF/省控线_{year}.pdf'], 'pdfUrls': [attachments['scorelines'][0]['url']], 'pageUrls': [resolved['pages']['scorelines']], 'parser': 'scorelines', 'year': year},
        {'outputPath': f'招生计划/招生计划_{year}.json', 'pdfPaths': [f'招生计划/原始PDF/招生计划_{year}.pdf'], 'pdfUrls': [attachments['plans'][0]['url']], 'pageUrls': [resolved['pages']['plans']], 'parser': 'plans', 'year': year},
        {'outputPath': f'招生高校及专业/招生高校及专业_{year}.json', 'pdfPaths': [f'招生高校及专业/原始PDF/招生高校及专业_{year}.pdf'], 'pdfUrls': [attachments['master'][0]['url']], 'pageUrls': [resolved['pages']['master']], 'parser': 'master', 'year': year},
        {'outputPath': f'专业对照/专业对照_{year}.json', 'pdfPaths': [attachments['mappingCodeTable'][0].get('localPath', f'专业对照/原始PDF/专业代号对照_{year}.pdf'), attachments['mappingOverview'][0].get('localPath', f'专业对照/原始PDF/专业对照一览_{year}.pdf')], 'pdfUrls': [attachments['mappingCodeTable'][0]['url'], attachments['mappingOverview'][0]['url']], 'pageUrls': [resolved['pages']['mappingCodeTable'], resolved['pages']['mappingOverview']], 'parser': 'mapping', 'year': year},
    ]
    crawl = {
        'dataset': 'score-segments', 'year': year,
        'sourcePageUrl': resolved['pages']['scoreSegments'],
        'discoveryUrl': resolved['pages']['scoreSegments'],
        'manifestPath': f'来源清单/来源清单_{year}.json',
        'downloadDirectory': f'一分一段/原始PDF/{year}',
        'normalizedPath': f'一分一段/一分一段_{year}.json',
        'conversionReportPath': f'reports/转换报告_{year}.json', 'parser': 'score-segments',
    }
    return sources, crawl
