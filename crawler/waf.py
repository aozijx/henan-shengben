"""官方站会话构建与瑞数 WAF 自动引导。

官方站公告页部署了瑞数动态安全 WAF（403/412 挑战页），纯 HTTP 客户端无法
解出挑战；PDF 附件域不受影响。两种通过方式：

1. 自动引导：首次遇到 403/412 时用 DrissionPage 驱动真实 Chromium 打开
   目标页，挑战通过后把 Cookie 与 UA 写回 .waf-cookie 并原地重试一次。
2. 手动借用：在真浏览器打开任一公告页，把请求头 Cookie 保存到仓库根
   .waf-cookie（纯字符串，或 {'userAgent','cookie'} JSON，已 gitignore）。

注意瑞数会校验 Cookie 与 User-Agent 的绑定关系，会话 UA 一律跟随
.waf-cookie 内的浏览器 UA；无 Cookie 文件时保持 requests 默认 UA，
首个被拦请求会触发自动引导补全。
"""
from __future__ import annotations

import json
import time
from pathlib import Path

import requests

from pipeline_config import WAF_AUTO_BOOTSTRAP

WAF_COOKIE_FILE = Path(__file__).resolve().parent.parent / '.waf-cookie'
WAF_BLOCKED_STATUS = {403, 412}
EDGE_PATHS = (
    r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    r'C:\Program Files\Microsoft\Edge\Application\msedge.exe',
)


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


def bootstrap_cookie(url: str) -> bool:
    """用 DrissionPage 驱动真实 Chromium 过瑞数挑战，成功则写回 .waf-cookie。"""
    try:
        from DrissionPage import ChromiumOptions, ChromiumPage
    except ImportError:
        print('[WAF] 未安装 DrissionPage（pip install DrissionPage），无法自动过 WAF；'
              '可改用手动 .waf-cookie 方式（见 crawler/README.md）', flush=True)
        return False
    options = ChromiumOptions()
    options.auto_port()
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
        for _ in range(20):  # 瑞数挑战页执行 JS 后自动重载，等待真实内容出现
            if '$_ts' not in (browser.html or ''):
                break
            time.sleep(1)
        cookie_header = '; '.join(f"{item['name']}={item['value']}" for item in browser.cookies())
        if not cookie_header:
            print('[WAF] 未取到官方站 Cookie，引导失败', flush=True)
            return False
        WAF_COOKIE_FILE.write_text(
            json.dumps({'userAgent': browser.user_agent, 'cookie': cookie_header}, ensure_ascii=False),
            encoding='utf-8')
        print(f'[WAF] Cookie 已写入 {WAF_COOKIE_FILE.name}，会话生效', flush=True)
        return True
    finally:
        if browser is not None:
            browser.quit()


class WafSession(requests.Session):
    """官方站会话：首次 403/412 自动引导 WAF Cookie 并重试一次。"""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._waf_bootstrapped = False

    def get(self, url, **kwargs):
        response = super().get(url, **kwargs)
        if response.status_code in WAF_BLOCKED_STATUS and not self._waf_bootstrapped:
            self._waf_bootstrapped = True
            if WAF_AUTO_BOOTSTRAP and bootstrap_cookie(url):
                stored = _load_waf_session()
                self.headers['User-Agent'] = stored.get('userAgent') or self.headers['User-Agent']
                self.headers['Cookie'] = stored.get('cookie', '')
                response = super().get(url, **kwargs)
        return response
