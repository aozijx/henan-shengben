from dataclasses import dataclass
from urllib.parse import urlparse


OFFICIAL_HOSTS = {
    'www.haeea.cn', 'haeea.cn', 'news.haeea.cn', 'www.heao.com.cn',
    'gaokao.haedu.cn', 'jyt.henan.gov.cn', 'xcoss.henan.gov.cn',
}


@dataclass(frozen=True)
class CrawlTarget:
    dataset: str
    year: int
    source_page_url: str
    discovery_url: str
    manifest_path: str
    download_directory: str
    normalized_path: str
    conversion_report_path: str
    parser: str


def is_official_url(url):
    parsed = urlparse(url)
    return parsed.scheme == 'https' and parsed.hostname in OFFICIAL_HOSTS


def is_pdf_link(url):
    return is_official_url(url) and urlparse(url).path.lower().endswith('.pdf')
