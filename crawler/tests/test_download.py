import json
import tempfile
import unittest
from pathlib import Path

from crawler.download import download_entry, download_targets


class Response:
    def __init__(self, content, status_code=200, content_type='application/pdf'):
        self.content = content
        self.status_code = status_code
        self.headers = {'content-type': content_type}

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(str(self.status_code))


class Session:
    def __init__(self, response):
        self.response = response

    def get(self, *_args, **_kwargs):
        return self.response


class RecordingSession:
    def __init__(self):
        self.urls = []

    def get(self, url, *_args, **_kwargs):
        self.urls.append(url)
        return Response(b'%PDF-1.4 test')


class DownloadTest(unittest.TestCase):
    def test_downloads_pdf_atomically_and_skips_matching_hash(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / '01.pdf'
            first = download_entry('https://www.haeea.cn/01.pdf', target, Session(Response(b'%PDF-1.4 test')))
            second = download_entry('https://www.haeea.cn/01.pdf', target, Session(Response(b'%PDF-1.4 test')), first['sha256'])
            self.assertEqual(first['downloadStatus'], 'downloaded')
            self.assertEqual(second['downloadStatus'], 'skipped')
            self.assertFalse(target.with_suffix('.pdf.part').exists())

    def test_rejects_non_pdf_without_overwriting_existing_file(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / '01.pdf'
            target.write_bytes(b'%PDF-old')
            result = download_entry('https://www.haeea.cn/01.pdf', target, Session(Response(b'<html>', content_type='text/html')))
            self.assertEqual(result['downloadStatus'], 'failed')
            self.assertEqual(target.read_bytes(), b'%PDF-old')

    def test_download_targets_uses_only_the_requested_registry_year(self):
        with tempfile.TemporaryDirectory() as directory:
            data_root = Path(directory)
            registry = data_root / 'source-registry.json'
            targets = []
            for year in (2024, 2025):
                targets.append({
                    'dataset': 'score-segments', 'year': year,
                    'sourcePageUrl': f'https://www.haeea.cn/{year}.shtml',
                    'discoveryUrl': f'https://www.haeea.cn/{year}/discover.shtml',
                    'manifestPath': f'来源清单/来源清单_{year}.json',
                    'downloadDirectory': f'一分一段/原始PDF/{year}',
                    'parser': 'score-segments',
                })
                manifest = {
                    'entries': [{
                        'pdfUrl': f'https://www.haeea.cn/{year}.pdf',
                        'localPath': f'一分一段/原始PDF/{year}/01.pdf',
                        'sha256': None,
                    }]
                }
                path = data_root / targets[-1]['manifestPath']
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(json.dumps(manifest), encoding='utf-8')
            (data_root / '来源清单/来源清单_2099.json').write_text('{"entries": []}', encoding='utf-8')
            registry.write_text(json.dumps({'crawlTargets': targets}), encoding='utf-8')
            session = RecordingSession()

            counts = download_targets(registry, data_root, {2025}, session)

            self.assertEqual({2025: {'downloaded': 1, 'skipped': 0, 'failed': 0}}, counts)
            self.assertEqual(['https://www.haeea.cn/2025.pdf'], session.urls)
            self.assertTrue((data_root / '一分一段/原始PDF/2025/01.pdf').is_file())
            self.assertFalse((data_root / '一分一段/原始PDF/2024/01.pdf').exists())


if __name__ == '__main__':
    unittest.main()
