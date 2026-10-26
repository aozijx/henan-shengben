import json
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

import requests

import crawler.waf
from crawler.waf import build_session


class FakeResponse:
    def __init__(self, status_code):
        self.status_code = status_code
        self.content = b''


class FakeChromiumOptions:
    def __init__(self):
        self.calls = []

    def auto_port(self):
        self.calls.append(('auto_port',))

    def set_browser_path(self, path):
        self.calls.append(('set_browser_path', path))

    def headless(self):
        self.calls.append(('headless',))

    def set_argument(self, argument):
        self.calls.append(('set_argument', argument))


class WafSessionTest(unittest.TestCase):
    def test_browser_options_use_explicit_headless_edge_settings(self):
        with patch.dict('os.environ', {
            'WAF_BROWSER_PATH': '/usr/bin/microsoft-edge',
            'WAF_HEADLESS': 'true',
        }, clear=False):
            options = crawler.waf._build_browser_options(FakeChromiumOptions)

        self.assertEqual(options.calls, [
            ('auto_port',),
            ('set_browser_path', '/usr/bin/microsoft-edge'),
            ('headless',),
        ])

    def test_linux_headless_browser_disables_sandbox_for_ci(self):
        with patch.dict('os.environ', {
            'WAF_BROWSER_PATH': '/usr/bin/microsoft-edge',
            'WAF_HEADLESS': 'true',
        }, clear=False), patch('sys.platform', 'linux'):
            options = crawler.waf._build_browser_options(FakeChromiumOptions)

        self.assertIn(('set_argument', '--no-sandbox'), options.calls)

    def test_linux_headed_browser_disables_sandbox_for_xvfb(self):
        with patch.dict('os.environ', {
            'WAF_BROWSER_PATH': '/usr/bin/microsoft-edge',
            'WAF_HEADLESS': 'false',
        }, clear=False), patch('sys.platform', 'linux'):
            options = crawler.waf._build_browser_options(FakeChromiumOptions)

        self.assertIn(('set_argument', '--no-sandbox'), options.calls)

    def test_short_or_blank_browser_document_is_not_accepted(self):
        self.assertFalse(crawler.waf._browser_page_ready('<html>400</html>'))
        self.assertFalse(crawler.waf._browser_page_ready(
            '<html><head></head><body></body></html>'))

    def test_challenge_document_is_not_treated_as_a_completed_challenge(self):
        html = '<html><body>$_ts challenge</body></html>' + ('x' * 256)
        self.assertFalse(crawler.waf._browser_page_ready(html))

    def test_rendered_browser_document_is_ready(self):
        html = '<html><body>' + ('official source content ' * 20) + '</body></html>'
        self.assertTrue(crawler.waf._browser_page_ready(html))

    def test_windows_prefers_installed_edge_when_browser_path_is_unset(self):
        edge_path = crawler.waf.EDGE_PATHS[0]
        with patch.dict('os.environ', {}, clear=True), \
                patch('crawler.waf.sys.platform', 'win32'), \
                patch('crawler.waf.Path.exists', return_value=True):
            options = crawler.waf._build_browser_options(FakeChromiumOptions)

        self.assertEqual(options.calls, [('auto_port',), ('set_browser_path', edge_path)])

    def test_windows_keeps_drission_default_if_edge_is_not_installed(self):
        with patch.dict('os.environ', {}, clear=True), \
                patch('crawler.waf.sys.platform', 'win32'), \
                patch('crawler.waf.Path.exists', return_value=False):
            options = crawler.waf._build_browser_options(FakeChromiumOptions)

        self.assertEqual(options.calls, [('auto_port',)])

    def test_session_without_cookie_file_keeps_default_user_agent(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(crawler.waf, 'WAF_COOKIE_FILE', Path(directory) / '.waf-cookie'):
                session = build_session()
        self.assertEqual(session.headers['User-Agent'],
                         requests.Session().headers['User-Agent'])
        self.assertNotIn('Cookie', session.headers)

    def test_raw_cookie_file_binds_cookie_only(self):
        with tempfile.TemporaryDirectory() as directory:
            cookie_file = Path(directory) / '.waf-cookie'
            cookie_file.write_text('JXQcDbC7VBRuO=fake-session-cookie', encoding='utf-8')
            with patch.object(crawler.waf, 'WAF_COOKIE_FILE', cookie_file):
                session = build_session()
        self.assertEqual(session.headers['Cookie'], 'JXQcDbC7VBRuO=fake-session-cookie')
        self.assertEqual(session.headers['User-Agent'],
                         requests.Session().headers['User-Agent'])

    def test_json_cookie_file_binds_browser_user_agent(self):
        with tempfile.TemporaryDirectory() as directory:
            cookie_file = Path(directory) / '.waf-cookie'
            stored = {'userAgent': 'Mozilla/5.0 BootstrapBrowser', 'cookie': 'a=1; b=2'}
            cookie_file.write_text(json.dumps(stored), encoding='utf-8')
            with patch.object(crawler.waf, 'WAF_COOKIE_FILE', cookie_file):
                session = build_session()
        self.assertEqual(session.headers['Cookie'], 'a=1; b=2')
        self.assertEqual(session.headers['User-Agent'], 'Mozilla/5.0 BootstrapBrowser')

    def test_blank_or_invalid_cookie_file_is_ignored(self):
        for content in ('   \n', 'not-json'):
            with tempfile.TemporaryDirectory() as directory:
                cookie_file = Path(directory) / '.waf-cookie'
                cookie_file.write_text(content, encoding='utf-8')
                with patch.object(crawler.waf, 'WAF_COOKIE_FILE', cookie_file):
                    session = build_session()
            self.assertNotIn('Cookie', session.headers)


class WafRetryTest(unittest.TestCase):
    def test_bad_request_bootstraps_once_and_retries(self):
        with tempfile.TemporaryDirectory() as directory, \
                patch.object(crawler.waf, 'WAF_COOKIE_FILE', Path(directory) / '.waf-cookie'), \
                patch.object(requests.Session, 'get', side_effect=[FakeResponse(400), FakeResponse(200)]) as get:
            with patch.object(crawler.waf, 'bootstrap_cookie', return_value={
                    'userAgent': 'Mozilla/5.0 Candidate', 'cookie': 'sid=accepted'}) as bootstrap:
                session = build_session()
                self.assertEqual(session.get('https://www.haeea.cn/a/page.shtml').status_code, 200)
        self.assertEqual(get.call_count, 2)
        self.assertEqual(bootstrap.call_count, 1)

    def test_blocked_response_bootstraps_once_and_retries(self):
        with tempfile.TemporaryDirectory() as directory, \
                patch.object(crawler.waf, 'WAF_COOKIE_FILE', Path(directory) / '.waf-cookie'), \
                patch.object(requests.Session, 'get', side_effect=[FakeResponse(412), FakeResponse(200)]) as get:
            with patch.object(crawler.waf, 'bootstrap_cookie', return_value={
                    'userAgent': 'Mozilla/5.0 Candidate', 'cookie': 'sid=accepted'}) as bootstrap:
                session = build_session()
                self.assertEqual(session.get('https://www.haeea.cn/a/page.shtml').status_code, 200)
        self.assertEqual(get.call_count, 2)
        self.assertEqual(bootstrap.call_count, 1)

    def test_bootstrap_failure_returns_blocked_response_without_retry_loop(self):
        with patch.object(requests.Session, 'get', return_value=FakeResponse(412)) as get:
            with patch.object(crawler.waf, 'bootstrap_cookie', return_value=None) as bootstrap:
                session = build_session()
                self.assertEqual(session.get('https://www.haeea.cn/a/page.shtml').status_code, 412)
                self.assertEqual(session.get('https://www.haeea.cn/a/page.shtml').status_code, 412)
        self.assertEqual(get.call_count, 2)
        self.assertEqual(bootstrap.call_count, 1)

    def test_successful_response_never_bootstraps(self):
        with patch.object(requests.Session, 'get', return_value=FakeResponse(200)) as get:
            with patch.object(crawler.waf, 'bootstrap_cookie') as bootstrap:
                session = build_session()
                session.get('https://www.haeea.cn/a/page.shtml')
        self.assertEqual(bootstrap.call_count, 0)

    def test_blocked_retry_preserves_previous_cookie_and_headers(self):
        with tempfile.TemporaryDirectory() as directory:
            cookie_file = Path(directory) / '.waf-cookie'
            previous = {'userAgent': 'Mozilla/5.0 Previous', 'cookie': 'sid=previous'}
            cookie_file.write_text(json.dumps(previous), encoding='utf-8')
            with patch.object(crawler.waf, 'WAF_COOKIE_FILE', cookie_file), \
                    patch.object(requests.Session, 'get', side_effect=[FakeResponse(412), FakeResponse(400)]):
                session = build_session()
                with patch.object(crawler.waf, 'bootstrap_cookie', return_value={
                        'userAgent': 'Mozilla/5.0 Candidate', 'cookie': 'sid=candidate'}):
                    self.assertEqual(session.get('https://www.haeea.cn/a/page.shtml').status_code, 400)
                self.assertEqual(session.headers['User-Agent'], previous['userAgent'])
                self.assertEqual(session.headers['Cookie'], previous['cookie'])
            self.assertEqual(json.loads(cookie_file.read_text(encoding='utf-8')), previous)

    def test_retry_network_error_restores_previous_cookie_and_headers(self):
        with tempfile.TemporaryDirectory() as directory:
            cookie_file = Path(directory) / '.waf-cookie'
            previous = {'userAgent': 'Mozilla/5.0 Previous', 'cookie': 'sid=previous'}
            cookie_file.write_text(json.dumps(previous), encoding='utf-8')
            with patch.object(crawler.waf, 'WAF_COOKIE_FILE', cookie_file), \
                    patch.object(requests.Session, 'get', side_effect=[FakeResponse(412), RuntimeError('network')]):
                session = build_session()
                with patch.object(crawler.waf, 'bootstrap_cookie', return_value={
                        'userAgent': 'Mozilla/5.0 Candidate', 'cookie': 'sid=candidate'}):
                    with self.assertRaisesRegex(RuntimeError, 'network'):
                        session.get('https://www.haeea.cn/a/page.shtml')
                self.assertEqual(session.headers['User-Agent'], previous['userAgent'])
                self.assertEqual(session.headers['Cookie'], previous['cookie'])
            self.assertEqual(json.loads(cookie_file.read_text(encoding='utf-8')), previous)

    def test_accepted_retry_persists_candidate_cookie(self):
        with tempfile.TemporaryDirectory() as directory:
            cookie_file = Path(directory) / '.waf-cookie'
            candidate = {'userAgent': 'Mozilla/5.0 Candidate', 'cookie': 'sid=accepted'}
            with patch.object(crawler.waf, 'WAF_COOKIE_FILE', cookie_file), \
                    patch.object(requests.Session, 'get', side_effect=[FakeResponse(412), FakeResponse(200)]):
                session = build_session()
                with patch.object(crawler.waf, 'bootstrap_cookie', return_value=candidate):
                    self.assertEqual(session.get('https://www.haeea.cn/a/page.shtml').status_code, 200)
                self.assertEqual(session.headers['User-Agent'], candidate['userAgent'])
                self.assertEqual(session.headers['Cookie'], candidate['cookie'])
            self.assertEqual(json.loads(cookie_file.read_text(encoding='utf-8')), candidate)

    def test_simultaneous_blocked_requests_share_one_bootstrap(self):
        entered_bootstrap = threading.Event()
        continue_bootstrap = threading.Event()
        call_statuses = iter([412, 200, 200])

        def fake_get(_session, _url, **_kwargs):
            return FakeResponse(next(call_statuses))

        def bootstrap(_url):
            entered_bootstrap.set()
            continue_bootstrap.wait(timeout=2)
            return {'userAgent': 'Mozilla/5.0 Candidate', 'cookie': 'sid=accepted'}

        with tempfile.TemporaryDirectory() as directory, \
                patch.object(crawler.waf, 'WAF_COOKIE_FILE', Path(directory) / '.waf-cookie'), \
                patch.object(requests.Session, 'get', fake_get), \
                patch.object(crawler.waf, 'bootstrap_cookie', side_effect=bootstrap) as mocked_bootstrap:
            session = build_session()
            first = threading.Thread(target=session.get, args=('https://www.haeea.cn/a/one.shtml',))
            second = threading.Thread(target=session.get, args=('https://www.haeea.cn/a/two.shtml',))
            first.start()
            self.assertTrue(entered_bootstrap.wait(timeout=1))
            second.start()
            time.sleep(0.05)
            continue_bootstrap.set()
            first.join(timeout=2)
            second.join(timeout=2)
        self.assertFalse(first.is_alive())
        self.assertFalse(second.is_alive())
        self.assertEqual(mocked_bootstrap.call_count, 1)


if __name__ == '__main__':
    unittest.main()
