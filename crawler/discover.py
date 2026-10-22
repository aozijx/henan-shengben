import re
import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import unquote, urljoin

import requests
from bs4 import BeautifulSoup

if __package__ in {None, ''}:
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from crawler.source_rules import is_official_pdf_url


class DiscoveryBlockedError(RuntimeError):
    pass


@dataclass(frozen=True)
class SourceEntry:
    year: int
    source_page_url: str
    pdf_url: str
    local_path: str
    major_code: str
    major_name: str


MAJOR_PATTERN = re.compile(r'[（(]([0-9A-Z]{2})([^（）()]+)[）)]', re.IGNORECASE)


def discover_year(target, html):
    soup = BeautifulSoup(html or '', 'html.parser')
    found = {}
    for link in soup.find_all('a', href=True):
        url = urljoin(target.source_page_url, link['href'])
        if not is_official_pdf_url(url):
            continue
        decoded = unquote(url)
        match = MAJOR_PATTERN.search(decoded)
        if not match:
            continue
        code, name = match.group(1).upper(), match.group(2).strip()
        found[url] = SourceEntry(
            year=target.year, source_page_url=target.source_page_url, pdf_url=url,
            local_path=f'{target.download_directory}/{code}_{name}.pdf',
            major_code=code, major_name=name)
    if not found:
        raise DiscoveryBlockedError(f'{target.year} 页面未发现官方 PDF，可能被反爬拦截')
    return sorted(found.values(), key=lambda entry: (entry.major_code, entry.major_name, entry.pdf_url))


def entry_document(entry):
    return {
        'year': entry.year, 'sourcePageUrl': entry.source_page_url,
        'pdfUrl': entry.pdf_url, 'localPath': entry.local_path,
        'majorCode': entry.major_code, 'majorName': entry.major_name,
        'downloadStatus': 'pending', 'sha256': None, 'bytes': None,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--registry', default='data/source-registry.json')
    parser.add_argument('--years', nargs='*', type=int)
    parser.add_argument('--data-root', default='data')
    args = parser.parse_args()
    from crawler.source_rules import load_crawl_targets
    targets = load_crawl_targets(Path(args.registry), set(args.years) if args.years else None)
    session = requests.Session()
    session.headers['User-Agent'] = 'henan-shengben-data/1.0'
    for target in targets:
        response = session.get(target.discovery_url, timeout=60)
        response.raise_for_status()
        entries = discover_year(target, response.text)
        document = {'schemaVersion': 1, 'dataset': target.dataset, 'year': target.year,
                    'sourcePageUrl': target.source_page_url,
                    'discoveryUrl': target.discovery_url,
                    'entries': [entry_document(entry) for entry in entries]}
        output = Path(args.data_root) / target.manifest_path
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(document, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print(f'{target.year}: {len(entries)} 个官方 PDF -> {output}')


if __name__ == '__main__':
    main()
