import re
import argparse
import sys
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import unquote, urljoin

from bs4 import BeautifulSoup

if __package__ in {None, ''}:
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pipeline_config import REQUEST_TIMEOUT
from crawler.source_rules import is_pdf_link
from crawler.waf import build_session
from pipeline_io import write_json


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


def discover_year(target, html, base_url=None):
    soup = BeautifulSoup(html or '', 'html.parser')
    page_text = soup.get_text(' ', strip=True)
    if str(target.year) not in page_text or not any(marker in page_text for marker in ('分数段', '一分一段')):
        raise DiscoveryBlockedError(f'{target.year} 页面年份或类型不匹配，停止发现 PDF')
    found = {}
    for link in soup.find_all('a', href=True):
        url = urljoin(base_url or target.source_page_url, link['href'])
        if not is_pdf_link(url):
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
    parser.add_argument('--seed', action='append', type=Path,
                        help='annual data/year-links/YYYY.json seed; defaults to every seed under --data-root')
    parser.add_argument('--years', nargs='*', type=int)
    parser.add_argument('--data-root', type=Path, default=Path('data'))
    args = parser.parse_args()
    from crawler.year_sources import build_data_plan, resolve_score_segment_target, seed_paths_in
    seed_paths = args.seed or seed_paths_in(args.data_root)
    plan = build_data_plan(args.data_root, set(args.years) if args.years else None, seed_paths)
    if not plan['seeds']:
        parser.error('no matching year-links seeds')
    session = build_session()
    for seed in plan['seeds']:
        year = seed['year']
        print(f'[{year}] 解析官方分数段来源页 …', flush=True)
        target = resolve_score_segment_target(seed, session)
        if target is None:
            print(f'[{year}] 没有可抓取的一分一段来源，跳过', flush=True)
            continue
        print(f'[{year}] 来源页：{target.discovery_url}', flush=True)
        response = session.get(target.discovery_url, timeout=REQUEST_TIMEOUT)
        response.raise_for_status()
        entries = discover_year(target, response.content)
        print(f'[{year}] 发现 {len(entries)} 个官方 PDF', flush=True)
        document = {'schemaVersion': 1, 'dataset': target.dataset, 'year': target.year,
                    'sourcePageUrl': target.source_page_url,
                    'discoveryUrl': target.discovery_url,
                    'entries': [entry_document(entry) for entry in entries]}
        output = args.data_root / target.manifest_path
        write_json(output, document, indent=2)
        print(f'[{target.year}] 清单已写入 {output}', flush=True)


if __name__ == '__main__':
    main()
