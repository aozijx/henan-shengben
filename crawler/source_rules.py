import json
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse


OFFICIAL_PDF_HOSTS = {'www.haeea.cn', 'haeea.cn', 'news.haeea.cn', 'www.heao.com.cn'}


@dataclass(frozen=True)
class CrawlTarget:
    dataset: str
    year: int
    source_page_url: str
    discovery_url: str
    manifest_path: str
    download_directory: str
    parser: str


def load_crawl_targets(registry_path: Path, years=None):
    document = json.loads(registry_path.read_text(encoding='utf-8'))
    targets = []
    seen = set()
    for item in document.get('crawlTargets', []):
        key = (item['dataset'], item['year'])
        if key in seen:
            raise ValueError(f'重复采集目标: {key}')
        seen.add(key)
        if years is not None and item['year'] not in years:
            continue
        targets.append(CrawlTarget(
            dataset=item['dataset'], year=item['year'],
            source_page_url=item['sourcePageUrl'], discovery_url=item['discoveryUrl'],
            manifest_path=item['manifestPath'], download_directory=item['downloadDirectory'],
            parser=item['parser']))
    return sorted(targets, key=lambda target: (target.dataset, target.year))


def is_official_pdf_url(url):
    parsed = urlparse(url)
    return parsed.scheme in {'http', 'https'} and parsed.hostname in OFFICIAL_PDF_HOSTS and parsed.path.lower().endswith('.pdf')
