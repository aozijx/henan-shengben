"""官方站会话构建与瑞数 WAF 自动引导。

官方站公告页和部分 PDF 附件会被瑞数动态安全 WAF 拦截，可能返回 400/403/412；
纯 HTTP 客户端无法解出挑战。两种通过方式：

1. 自动引导：首次遇到 400/403/412 时用 DrissionPage 驱动真实 Chromium 打开
   目标页，挑战通过后把 Cookie 与 UA 写回 .waf-cookie 并原地重试一次。
2. 手动借用：在真浏览器打开任一公告页，把请求头 Cookie 保存到仓库根
   .waf-cookie（纯字符串，或 {'userAgent','cookie'} JSON，已 gitignore）。

注意瑞数会校验 Cookie 与 User-Agent 的绑定关系，会话 UA 一律跟随
.waf-cookie 内的浏览器 UA；无 Cookie 文件时保持 requests 默认 UA，
首个被拦请求会触发自动引导补全。
"""
from __future__ import annotations

import json
import os
import sys
import threading
import time
from pathlib import Path

import requests

from pipeline_config import WAF_AUTO_BOOTSTRAP

WAF_COOKIE_FILE = Path(__file__).resolve().parent.parent / '.waf-cookie'
WAF_BLOCKED_STATUS = {400, 403, 412}
EDGE_PATHS = (
    r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    r'C:\Program Files\Microsoft\Edge\Application\msedge.exe',
)


def _configured_browser_path() -> str:
    """Return an explicit browser path or the first installed Windows Edge."""
    browser_path = os.getenv('WAF_BROWSER_PATH', '').strip()
    if browser_path or not sys.platform.startswith('win'):
        return browser_path
    return next((edge for edge in EDGE_PATHS if Path(edge).exists()), '')


def _build_browser_options(options_type):
    """Build options using an explicit browser path or installed Windows Edge."""
    options = options_type()
    options.auto_port()
    browser_path = _configured_browser_path()
    if browser_path:
        options.set_browser_path(browser_path)
    headless = os.getenv('WAF_HEADLESS', '').strip().lower() in {'1', 'true', 'yes', 'on'}
    if headless:
        options.headless()
    if sys.platform.startswith('linux'):
        options.set_argument('--no-sandbox')
    return options


def _browser_page_ready(html: str | None) -> bool:
    """Reject blank error pages and active WAF challenges as completed loads."""
    html = (html or '').strip()
    return len(html) > 128 and '$_ts' not in html


def _load_waf_session() -> dict:
    """读取 .waf-cookie；兼容纯 Cookie 字符串与 {'userAgent','cookie'} JSON。"""
    if not WAF_COOKIE_FILE.is_file():
        return {}
    text = WAF_COOKIE_FILE.read_text(encoding='utf-8').strip()
    if not text:
        return {}
    try:
        stored = json.loads(text)
    except ValueError:
        return {'cookie': text, 'userAgent': ''} if '=' in text else {}
    if isinstance(stored, dict) and stored.get('cookie'):
        return {'cookie': str(stored['cookie']), 'userAgent': str(stored.get('userAgent') or '')}
    return {}


def build_session() -> requests.Session:
    """创建统一会话：UA 与 Cookie 均取自 .waf-cookie，缺省时交给自动引导。"""
    session = WafSession()
    stored = _load_waf_session()
    if stored.get('userAgent'):
        session.headers['User-Agent'] = stored['userAgent']
    if stored.get('cookie'):
        session.headers['Cookie'] = stored['cookie']
    return session


def bootstrap_cookie(url: str) -> dict | None:
    """用 DrissionPage 驱动真实 Chromium 过瑞数挑战，返回待验证凭据。"""
    try:
        from DrissionPage import ChromiumOptions, ChromiumPage
    except ImportError:
        print('[WAF] 未安装 DrissionPage（pip install DrissionPage），无法自动过 WAF；'
              '可改用手动 .waf-cookie 方式（见 crawler/README.md）', flush=True)
        return None
    options = _build_browser_options(ChromiumOptions)
    browser_path = _configured_browser_path()
    print(f'[WAF] 浏览器：{browser_path or "DrissionPage 默认 Chromium"}', flush=True)
    browser = None
    try:
        try:
            browser = ChromiumPage(options)
        except Exception:
            for edge in EDGE_PATHS:
                if Path(edge).exists():
                    options.set_browser_path(edge)
                    break
            browser = ChromiumPage(options)
        print(f'[WAF] 启动真实浏览器通过官方站挑战：{url}', flush=True)
        browser.get(url)
        page_html = ''
        for _ in range(30):  # 等待公告正文出现或挑战脚本消失
            page_html = browser.html or ''
            if _browser_page_ready(page_html):
                break
            time.sleep(1)
        if not _browser_page_ready(page_html):
            print(f'[WAF] 浏览器未加载有效页面（html={len(page_html)}），不保存挑战 Cookie', flush=True)
            return None
        cookie_header = '; '.join(f"{item['name']}={item['value']}" for item in browser.cookies())
        if not cookie_header:
            print('[WAF] 未取到官方站 Cookie，引导失败', flush=True)
            return None
        return {'userAgent': browser.user_agent, 'cookie': cookie_header}
    finally:
        if browser is not None:
            browser.quit()


class WafSession(requests.Session):
    """官方站会话：串行执行请求，并只持久化通过 HTTP 重试的 WAF Cookie。"""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._waf_bootstrapped = False
        self._request_lock = threading.RLock()

    @staticmethod
    def _persist_cookie(credentials: dict) -> None:
        WAF_COOKIE_FILE.parent.mkdir(parents=True, exist_ok=True)
        temporary = WAF_COOKIE_FILE.with_name(WAF_COOKIE_FILE.name + '.new')
        try:
            temporary.write_text(json.dumps(credentials, ensure_ascii=False), encoding='utf-8')
            os.replace(temporary, WAF_COOKIE_FILE)
        finally:
            if temporary.exists():
                temporary.unlink()

    def get(self, url, **kwargs):
        with self._request_lock:
            response = super().get(url, **kwargs)
            if response.status_code not in WAF_BLOCKED_STATUS or self._waf_bootstrapped:
                return response
            self._waf_bootstrapped = True
            print(f'[WAF] HTTP {response.status_code}，尝试浏览器引导：{url}', flush=True)
            if not WAF_AUTO_BOOTSTRAP:
                return response
            candidate = bootstrap_cookie(url)
            if not candidate or not candidate.get('cookie'):
                return response

            old_user_agent = self.headers.get('User-Agent')
            old_cookie = self.headers.get('Cookie')

            def restore_headers() -> None:
                if old_user_agent is None:
                    self.headers.pop('User-Agent', None)
                else:
                    self.headers['User-Agent'] = old_user_agent
                if old_cookie is None:
                    self.headers.pop('Cookie', None)
                else:
                    self.headers['Cookie'] = old_cookie

            self.headers['User-Agent'] = candidate.get('userAgent') or old_user_agent
            self.headers['Cookie'] = candidate['cookie']
            try:
                retry = super().get(url, **kwargs)
            except Exception:
                restore_headers()
                raise
            print(f'[WAF] Cookie 重试 HTTP {retry.status_code} '
                  f'（{len(retry.content)} bytes）', flush=True)
            if retry.status_code in WAF_BLOCKED_STATUS:
                restore_headers()
                return retry
            try:
                self._persist_cookie(candidate)
                print(f'[WAF] HTTP 重试通过，Cookie 已保存到 {WAF_COOKIE_FILE.name}', flush=True)
            except OSError as error:
                print(f'[WAF] HTTP 重试通过，但无法保存 Cookie：{error}', flush=True)
            return retry
