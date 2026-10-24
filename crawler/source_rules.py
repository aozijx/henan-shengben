from dataclasses import dataclass
from urllib.parse import urlparse


OFFICIAL_PDF_HOSTS = {'www.haeea.cn', 'haeea.cn', 'news.haeea.cn', 'www.heao.com.cn', 'xcoss.henan.gov.cn'}


@dataclass(frozen=True)
class CrawlTarget:
    dataset: str
    year: int
    source_page_url: str
    discovery_url: str
    manifest_path: str
    download_directory: str
    extraction_path: str
    normalized_path: str
    conversion_report_path: str
    parser: str


def is_official_pdf_url(url):
    parsed = urlparse(url)
    return parsed.scheme == 'https' and parsed.hostname in OFFICIAL_PDF_HOSTS and parsed.path.lower().endswith('.pdf')
