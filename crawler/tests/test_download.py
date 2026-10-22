import tempfile
import unittest
from pathlib import Path

from crawler.download import download_entry


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


if __name__ == '__main__':
    unittest.main()
