import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import requests

import crawler.waf
from crawler.waf import WafSession, build_session


class FakeResponse:
    def __init__(self, status_code):
        self.status_code = status_code


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

    def test_browser_options_keep_local_defaults_when_environment_is_unset(self):
        with patch.dict('os.environ', {}, clear=True):
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
    def test_blocked_response_bootstraps_once_and_retries(self):
        with patch.object(requests.Session, 'get', side_effect=[FakeResponse(412), FakeResponse(200)]) as get:
            with patch.object(crawler.waf, 'bootstrap_cookie', return_value=True) as bootstrap:
                session = build_session()
                self.assertEqual(session.get('https://www.haeea.cn/a/page.shtml').status_code, 200)
        self.assertEqual(get.call_count, 2)
        self.assertEqual(bootstrap.call_count, 1)

    def test_bootstrap_failure_returns_blocked_response_without_retry_loop(self):
        with patch.object(requests.Session, 'get', return_value=FakeResponse(412)) as get:
            with patch.object(crawler.waf, 'bootstrap_cookie', return_value=False) as bootstrap:
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


if __name__ == '__main__':
    unittest.main()
