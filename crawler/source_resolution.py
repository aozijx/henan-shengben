"""Resolve annual official pages and validate their PDF attachments."""
from __future__ import annotations

from io import BytesIO
from urllib.parse import urljoin, urlparse

import pdfplumber
import requests
from bs4 import BeautifulSoup

from crawler.source_rules import CrawlTarget, is_official_url, is_pdf_link
from crawler.source_plan import (
    PDF_MARKERS,
    SOURCE_ROLES,
    AnnualSourceError,
    score_segment_target_for_seed,
)
from pipeline_config import REQUEST_TIMEOUT


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
        if not is_official_url(page_url):
            continue
        title = ' '.join(link.parent.get_text(' ', strip=True).split())
        for role in _classify(title, seed['year']):
            candidates.setdefault(role, set()).add(page_url)
    return candidates


def resolve_score_segment_target(seed: dict, session) -> CrawlTarget | None:
    """Resolve a published score-segment announcement, or return None if absent."""
    sources = seed.get('sources', {})
    target = score_segment_target_for_seed(seed)
    if target is None:
        return None
    explicit = sources['scoreSegments'].get('pageUrl')
    if explicit:
        return target
    if not seed.get('searchPageUrl'):
        return None
    candidates = _search_candidates(seed, session).get('scoreSegments', set())
    candidates = {url for url in candidates if is_official_url(url)}
    if not candidates:
        return None
    if len(candidates) != 1:
        raise AnnualSourceError(
            f"{seed['year']} scoreSegments: expected one official page, found {len(candidates)}; add an exact pageUrl")
    return score_segment_target_for_seed(seed, resolved_page_url=next(iter(candidates)))


def _page_attachments(page_url: str, session, year: int) -> list[tuple[str, str]]:
    response = session.get(page_url, timeout=REQUEST_TIMEOUT)
    response.raise_for_status()
    soup = BeautifulSoup(response.content, 'html.parser')
    found = []
    for link in soup.find_all('a', href=True):
        url = urljoin(page_url, link['href'])
        if not is_pdf_link(url):
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
        raise AnnualSourceError(f'{year} {role}: attachment is not a readable PDF: {error}') from error
    markers = PDF_MARKERS[role]
    if str(year) not in text or not any(marker in text for marker in markers):
        raise AnnualSourceError(f'{year} {role}: PDF content does not confirm year and source type')


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
    declared = seed.get('sources', {})
    roles = [role for role in SOURCE_ROLES if role in declared]
    page_missing = any(not declared[role].get('pageUrl') for role in roles)
    candidates = _search_candidates(seed, session) if page_missing else {}
    pages = {}
    for role in roles:
        explicit = declared[role].get('pageUrl')
        urls = {explicit} if explicit else candidates.get(role, set())
        urls = {url for url in urls if is_official_url(url)}
        if len(urls) != 1:
            raise AnnualSourceError(f'{year} {role}: expected one official page, found {len(urls)}; add an exact pageUrl')
        pages[role] = next(iter(urls))
        response = session.get(pages[role], timeout=REQUEST_TIMEOUT)
        response.raise_for_status()
        page_text = BeautifulSoup(response.content, 'html.parser').get_text(' ', strip=True)
        if str(year) not in page_text or not any(word in page_text for word in SOURCE_ROLES[role]):
            raise AnnualSourceError(f'{year} {role}: official page title/content does not confirm the year and source type')

    attachments = {}
    for role, page_url in pages.items():
        exact = declared.get(role, {}).get('attachmentUrl')
        files = [(exact, '')] if exact else _page_attachments(page_url, session, year)
        if not exact and role == 'mappingCodeTable':
            files = [item for item in files if any(word in (item[0] + item[1]) for word in ('代号', '代码'))]
        elif not exact and role == 'mappingOverview':
            files = [item for item in files if any(word in (item[0] + item[1]) for word in ('对照', '一览'))]
        elif not exact and role == 'master':
            files = [item for item in files if any(word in (item[0] + item[1]) for word in ('招生高校及专业', '高校及专业总表'))]
        if role == 'scoreSegments':
            if not files:
                raise AnnualSourceError(f'{year} {role}: no official major PDFs found')
        elif len(files) != 1:
            raise AnnualSourceError(f'{year} {role}: expected one official PDF, found {len(files)}; add an exact attachmentUrl')
        for url, _label in files:
            if not is_official_url(url):
                raise AnnualSourceError(f'{year} {role}: attachment must use an official HTTPS host')
        local_path = seed.get('sources', {}).get(role, {}).get('localPath')
        attachments[role] = [{'url': url, 'title': title, **({'localPath': local_path} if local_path else {})}
                              for url, title in files]
    return {'year': year, 'pages': pages, 'attachments': attachments}
