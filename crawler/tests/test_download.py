import json
import hashlib
import tempfile
import unittest
from pathlib import Path

from crawler.download import compact_manifest_urls, download_entry, download_manifest, download_targets
from pipeline_config import DOWNLOAD_WORKERS


class Response:
    def __init__(self, content, status_code=200, content_type='application/pdf', url=None):
        self.content = content
        self.status_code = status_code
        self.headers = {'content-type': content_type}
        if url is not None:
            self.url = url

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


class CountingSession(Session):
    def __init__(self, response):
        super().__init__(response)
        self.calls = 0

    def get(self, *_args, **_kwargs):
        self.calls += 1
        return self.response


class DownloadTest(unittest.TestCase):
    def test_official_download_default_is_serial(self):
        self.assertEqual(DOWNLOAD_WORKERS, 1)

    def test_rejects_official_allowlist_escape_before_and_after_redirect(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / '01.pdf'
            target.write_bytes(b'%PDF-existing')
            unused = CountingSession(Response(b'%PDF-1.4 test'))
            result = download_entry('https://evil.example/01.pdf', target, unused)
            self.assertEqual(result['downloadStatus'], 'failed')
            self.assertEqual(unused.calls, 0)
            offsite_redirect = CountingSession(Response(
                b'%PDF-1.4 test', url='https://evil.example/01.pdf'))
            result = download_entry('https://www.haeea.cn/01.pdf', target, offsite_redirect)
            self.assertEqual(result['downloadStatus'], 'failed')
            self.assertEqual(target.read_bytes(), b'%PDF-existing')
            self.assertNotIn('sha256', result)
            self.assertNotIn('finalUrl', result)

    def test_records_final_official_redirect_url_only_for_successful_pdf(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / '01.pdf'
            response = Response(b'%PDF-1.4 test', url='https://news.haeea.cn/redirected.pdf')
            result = download_entry('https://www.haeea.cn/01.pdf', target, Session(response))
            self.assertEqual(result['downloadStatus'], 'downloaded')
            self.assertEqual(result['finalUrl'], response.url)
            self.assertEqual(result['sha256'], hashlib.sha256(response.content).hexdigest())

    def test_official_attachment_without_pdf_suffix_is_checked_by_content(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'attachment.pdf'
            url = 'https://xcoss.henan.gov.cn/attachment?id=2027'
            result = download_entry(url, target, Session(Response(b'%PDF-1.4 test', url=url)))
            self.assertEqual(result['downloadStatus'], 'downloaded')
            self.assertEqual(target.read_bytes(), b'%PDF-1.4 test')

    def test_same_final_url_is_not_repeated_in_result(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / '01.pdf'
            url = 'https://www.haeea.cn/01.pdf'
            result = download_entry(url, target, Session(Response(b'%PDF-1.4 test', url=url)))
            self.assertEqual('downloaded', result['downloadStatus'])
            self.assertNotIn('finalUrl', result)

    def test_encoded_chinese_url_is_not_treated_as_redirect(self):
        with tempfile.TemporaryDirectory() as directory:
            url = 'https://www.haeea.cn/attach/经济学.pdf'
            encoded = 'https://www.haeea.cn/attach/%E7%BB%8F%E6%B5%8E%E5%AD%A6.pdf'
            result = download_entry(url, Path(directory) / '01.pdf',
                                    Session(Response(b'%PDF-1.4 test', url=encoded)))
            self.assertNotIn('finalUrl', result)

    def test_compaction_retains_real_redirects_and_other_provenance(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'manifest.json'
            entries = [
                {'pdfUrl': 'https://www.haeea.cn/经济学.pdf',
                 'finalUrl': 'https://www.haeea.cn/%E7%BB%8F%E6%B5%8E%E5%AD%A6.pdf', 'sha256': 'a' * 64},
                {'pdfUrl': 'https://www.haeea.cn/a.pdf',
                 'finalUrl': 'https://news.haeea.cn/a.pdf', 'sha256': 'b' * 64}]
            path.write_text(json.dumps({'entries': entries}), encoding='utf-8')
            self.assertEqual(1, compact_manifest_urls(path))
            actual = json.loads(path.read_text(encoding='utf-8'))['entries']
            self.assertNotIn('finalUrl', actual[0])
            self.assertEqual(entries[1], actual[1])

    def test_manifest_rejects_traversal_and_duplicate_destinations_before_download(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'data'
            root.mkdir()
            manifest = root / 'manifest.json'
            session = CountingSession(Response(b'%PDF-1.4 test'))
            manifest.write_text(json.dumps({'entries': [
                {'majorCode': '01', 'pdfUrl': 'https://www.haeea.cn/a.pdf', 'localPath': '../outside.pdf'}]}), encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'escapes data root'):
                download_manifest(manifest, root, session)
            self.assertEqual(session.calls, 0)
            manifest.write_text(json.dumps({'entries': [
                {'majorCode': '01', 'pdfUrl': 'https://www.haeea.cn/a.pdf', 'localPath': '2027/a.pdf'},
                {'majorCode': '02', 'pdfUrl': 'https://www.haeea.cn/b.pdf', 'localPath': '2027/a.pdf'}]}), encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'duplicate manifest destination'):
                download_manifest(manifest, root, session)
            self.assertEqual(session.calls, 0)

    def test_manifest_preflights_all_urls_before_starting_any_download(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'data'
            root.mkdir()
            manifest = root / 'manifest.json'
            session = CountingSession(Response(b'%PDF-1.4 test'))
            manifest.write_text(json.dumps({'entries': [
                {'majorCode': '01', 'pdfUrl': 'https://www.haeea.cn/a.pdf', 'localPath': '2027/a.pdf'},
                {'majorCode': '02', 'pdfUrl': 'https://evil.example/b.pdf', 'localPath': '2027/b.pdf'}]}), encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'official host allowlist'):
                download_manifest(manifest, root, session)
            self.assertEqual(session.calls, 0)

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

    def test_download_targets_uses_only_the_requested_seed_year(self):
        with tempfile.TemporaryDirectory() as directory:
            data_root = Path(directory)
            seed_paths = []
            for year in (2024, 2025):
                seed = data_root / 'year-links' / f'{year}.json'
                seed.parent.mkdir(parents=True, exist_ok=True)
                seed.write_text(json.dumps({
                    'year': year,
                    'sources': {'scoreSegments': {'pageUrl': f'https://www.haeea.cn/{year}.shtml'}},
                }), encoding='utf-8')
                seed_paths.append(seed)
                manifest = {
                    'entries': [{
                        'pdfUrl': f'https://www.haeea.cn/{year}.pdf',
                    'majorCode': '01',
                        'localPath': f'一分一段/原始PDF/{year}/01.pdf',
                        'sha256': None,
                    }]
                }
                path = data_root / f'来源清单/来源清单_{year}.json'
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(json.dumps(manifest), encoding='utf-8')
            (data_root / '来源清单/来源清单_2099.json').write_text('{"entries": []}', encoding='utf-8')
            session = RecordingSession()

            counts = download_targets(seed_paths, data_root, {2025}, session)

            self.assertEqual({2025: {'downloaded': 1, 'skipped': 0, 'failed': 0}}, counts)
            self.assertEqual(['https://www.haeea.cn/2025.pdf'], session.urls)
            self.assertTrue((data_root / '一分一段/原始PDF/2025/01.pdf').is_file())
            self.assertFalse((data_root / '一分一段/原始PDF/2024/01.pdf').exists())

    def test_download_targets_skips_year_without_score_segment_source_or_manifest(self):
        with tempfile.TemporaryDirectory() as directory:
            data_root = Path(directory)
            seed = data_root / 'year-links' / '2027.json'
            seed.parent.mkdir(parents=True)
            seed.write_text(json.dumps({
                'year': 2027,
                'searchPageUrl': 'https://www.haeea.cn/search',
                'sources': {'mappingCodeTable': {'pageUrl': 'https://www.haeea.cn/mapping'}},
            }), encoding='utf-8')
            session = RecordingSession()

            counts = download_targets([seed], data_root, {2027}, session)

            self.assertEqual({}, counts)
            self.assertEqual([], session.urls)


if __name__ == '__main__':
    unittest.main()
