"""Resolve one year's official source pages from a small human-maintained seed."""
from __future__ import annotations

from pathlib import Path
from urllib.parse import urljoin, urlparse
from io import BytesIO

import pdfplumber
import requests
from bs4 import BeautifulSoup

from crawler.source_rules import is_official_pdf_url


class SourceResolutionError(ValueError):
    pass


SOURCE_ROLES = {
    'scoreSegments': ('分数段统计表', '一分一段'),
    'scorelines': ('录取控制分数线', '控制分数线'),
    'plans': ('招生计划',),
    'mappingCodeTable': ('专业代号对照', '代号对照表'),
    'mappingOverview': ('专业对照一览', '专业对照表', '可报本科专业'),
}
PDF_MARKERS = {
    'scoreSegments': ('分数', '人数'), 'scorelines': ('分数线', '控制分数'),
    'plans': ('招生计划', '计划人数'), 'mappingCodeTable': ('代号', '考试科目'),
    'mappingOverview': ('专科专业', '本科专业'),
}


def _official_page(url: str) -> bool:
    parsed = urlparse(url)
    return parsed.scheme == 'https' and parsed.hostname in {
        'www.haeea.cn', 'haeea.cn', 'news.haeea.cn', 'www.heao.com.cn'
    }


def load_year_links(path: Path) -> dict:
    import json

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
    return seed


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
    response = session.get(url, timeout=60)
    response.raise_for_status()
    soup = BeautifulSoup(response.text, 'html.parser')
    candidates: dict[str, set[str]] = {}
    for link in soup.find_all('a', href=True):
        page_url = urljoin(url, link['href'])
        if not _official_page(page_url):
            continue
        title = ' '.join(link.get_text(' ', strip=True).split())
        for role in _classify(title, seed['year']):
            candidates.setdefault(role, set()).add(page_url)
    return candidates


def _page_attachments(page_url: str, session, year: int) -> list[tuple[str, str]]:
    response = session.get(page_url, timeout=60)
    response.raise_for_status()
    soup = BeautifulSoup(response.text, 'html.parser')
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
    except Exception as error:
        raise SourceResolutionError(f'{year} {role}: attachment is not a readable PDF: {error}') from error
    markers = PDF_MARKERS[role]
    if str(year) not in text or not any(marker in text for marker in markers):
        raise SourceResolutionError(f'{year} {role}: PDF content does not confirm year and source type')


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
        response = session.get(pages[role], timeout=60)
        response.raise_for_status()
        page_text = BeautifulSoup(response.text, 'html.parser').get_text(' ', strip=True)
        if str(year) not in page_text or not any(word in page_text for word in SOURCE_ROLES[role]):
            raise SourceResolutionError(f'{year} {role}: official page title/content does not confirm the year and source type')

    attachments = {}
    for role, page_url in pages.items():
        exact = seed.get('sources', {}).get(role, {}).get('attachmentUrl')
        files = [(exact, '')] if exact else _page_attachments(page_url, session, year)
        if role == 'mappingCodeTable':
            files = [item for item in files if any(word in (item[0] + item[1]) for word in ('代号', '代码'))]
        elif role == 'mappingOverview':
            files = [item for item in files if any(word in (item[0] + item[1]) for word in ('对照', '一览'))]
        if role == 'scoreSegments':
            if not files:
                raise SourceResolutionError(f'{year} {role}: no official major PDFs found')
        elif len(files) != 1:
            raise SourceResolutionError(f'{year} {role}: expected one official PDF, found {len(files)}; add an exact attachmentUrl')
        for url, _label in files:
            if not is_official_pdf_url(url):
                raise SourceResolutionError(f'{year} {role}: attachment is not an official PDF')
        attachments[role] = [{'url': url, 'title': title} for url, title in files]
    return {'year': year, 'pages': pages, 'attachments': attachments}


def registry_rows_for_year(resolved: dict) -> tuple[list[dict], dict]:
    year = resolved['year']
    attachments = resolved['attachments']
    sources = [
        {'outputPath': f'省控线/省控线_{year}.json', 'pdfPaths': [f'省控线/原始PDF/省控线_{year}.pdf'], 'pdfUrls': [attachments['scorelines'][0]['url']], 'pageUrls': [resolved['pages']['scorelines']], 'parser': 'scorelines', 'year': year},
        {'outputPath': f'招生计划/招生计划_{year}.json', 'pdfPaths': [f'招生计划/原始PDF/招生计划_{year}.pdf'], 'pdfUrls': [attachments['plans'][0]['url']], 'pageUrls': [resolved['pages']['plans']], 'parser': 'plans', 'year': year},
        {'outputPath': f'专业对照/专业对照_{year}.json', 'pdfPaths': [f'专业对照/原始PDF/专业代号对照_{year}.pdf', f'专业对照/原始PDF/专业对照一览_{year}.pdf'], 'pdfUrls': [attachments['mappingCodeTable'][0]['url'], attachments['mappingOverview'][0]['url']], 'pageUrls': [resolved['pages']['mappingCodeTable'], resolved['pages']['mappingOverview']], 'parser': 'mapping', 'year': year},
    ]
    crawl = {
        'dataset': 'score-segments', 'year': year,
        'sourcePageUrl': resolved['pages']['scoreSegments'],
        'discoveryUrl': resolved['pages']['scoreSegments'],
        'manifestPath': f'来源清单/来源清单_{year}.json',
        'downloadDirectory': f'一分一段/原始PDF/{year}',
        'extractionPath': f'一分一段/提取结果/提取结果_{year}.json',
        'normalizedPath': f'一分一段/一分一段_{year}.json',
        'conversionReportPath': f'reports/转换报告_{year}.json', 'parser': 'score-segments',
    }
    return sources, crawl
