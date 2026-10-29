import argparse
import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import sys

import requests

if __package__ in {None, ''}:
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pipeline_config import DOWNLOAD_WORKERS, REQUEST_TIMEOUT
from crawler.source_rules import is_official_url
from crawler.waf import build_session
from crawler.year_sources import build_data_plan, seed_paths_in
from pipeline_integrity import sha256_bytes, sha256_file


def download_entry(url, target: Path, session, expected_sha256=None):
    try:
        if not is_official_url(url):
            raise ValueError('PDF URL is not on the official host allowlist')
        if expected_sha256 and target.is_file() and sha256_file(target) == expected_sha256:
            return {'downloadStatus': 'skipped', 'sha256': expected_sha256, 'bytes': target.stat().st_size}
        response = session.get(url, timeout=REQUEST_TIMEOUT)
        response.raise_for_status()
        final_url = getattr(response, 'url', url)
        if not is_official_url(final_url):
            raise ValueError('PDF redirect left the official host allowlist')
        content = response.content
        content_type = response.headers.get('content-type', '').lower()
        if 'pdf' not in content_type or not content.startswith(b'%PDF-'):
            raise ValueError('响应不是 PDF')
        target.parent.mkdir(parents=True, exist_ok=True)
        part = target.with_suffix(target.suffix + '.part')
        part.write_bytes(content)
        part.replace(target)
        result = {'downloadStatus': 'downloaded', 'sha256': sha256_bytes(content), 'bytes': len(content)}
        if requests.utils.requote_uri(final_url) != requests.utils.requote_uri(url):
            result['finalUrl'] = final_url
        return result
    except Exception as error:
        part = target.with_suffix(target.suffix + '.part')
        if part.exists():
            part.unlink()
        return {'downloadStatus': 'failed', 'error': str(error)}


DOWNLOAD_STATUS_LABELS = {'downloaded': '已下载', 'skipped': '跳过（SHA-256 一致）', 'failed': '失败'}


def compact_manifest_urls(manifest_path: Path) -> int:
    """Remove URL-encoding duplicates while retaining actual redirects and hashes."""
    document = json.loads(Path(manifest_path).read_text(encoding='utf-8'))
    removed = 0
    for entry in document['entries']:
        final_url = entry.get('finalUrl')
        if final_url and requests.utils.requote_uri(final_url) == requests.utils.requote_uri(entry['pdfUrl']):
            del entry['finalUrl']
            removed += 1
    if removed:
        Path(manifest_path).write_text(json.dumps(document, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return removed


def download_manifest(manifest_path: Path, data_root: Path, session, workers: int | None = None,
                     major_codes: set[str] | None = None):
    document = json.loads(manifest_path.read_text(encoding='utf-8'))
    counts = {'downloaded': 0, 'skipped': 0, 'failed': 0}
    destinations = set()
    targets = []
    selected = [entry for entry in document['entries']
                if not major_codes or entry['majorCode'] in major_codes]
    known_codes = {entry['majorCode'] for entry in document['entries']}
    unknown = (major_codes or set()) - known_codes
    if unknown:
        raise ValueError(f"unknown major code(s): {', '.join(sorted(unknown))}")
    for entry in selected:
        target = (data_root / entry['localPath']).resolve()
        if not target.is_relative_to(data_root.resolve()):
            raise ValueError(f"manifest path escapes data root: {entry['localPath']}")
        if target in destinations:
            raise ValueError(f"duplicate manifest destination: {entry['localPath']}")
        if not is_official_url(entry['pdfUrl']):
            raise ValueError(f"manifest PDF URL is not on the official host allowlist: {entry['pdfUrl']}")
        destinations.add(target)
        targets.append(target)
    year = document.get('year', manifest_path.stem)
    total = len(selected)
    workers = max(1, DOWNLOAD_WORKERS if workers is None else workers)
    print(f'[{year}] 下载一分一段官方 PDF：共 {total} 个，{workers} 线程（{manifest_path}）', flush=True)

    def _download(position_entry):
        position, (entry, target) = position_entry
        result = download_entry(entry['pdfUrl'], target, session, entry.get('sha256'))
        status = DOWNLOAD_STATUS_LABELS[result['downloadStatus']]
        suffix = f"：{result['error']}" if result['downloadStatus'] == 'failed' else ''
        print(f'[{year}] {position}/{total} {status} {Path(entry["localPath"]).name}{suffix}', flush=True)
        return entry, result

    pairs = list(zip(selected, targets))
    if workers > 1:
        with ThreadPoolExecutor(max_workers=workers) as executor:
            outcomes = list(executor.map(_download, enumerate(pairs, start=1)))
    else:
        outcomes = [_download(item) for item in enumerate(pairs, start=1)]
    for entry, result in outcomes:
        if entry.get('finalUrl') and requests.utils.requote_uri(entry['finalUrl']) == requests.utils.requote_uri(entry['pdfUrl']):
            entry.pop('finalUrl')
        entry.update(result)
        counts[result['downloadStatus']] += 1
    manifest_path.write_text(json.dumps(document, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return counts


def download_targets(seed_paths, data_root: Path, years: set[int] | None, session,
                     major_codes: set[str] | None = None) -> dict[int, dict[str, int]]:
    counts_by_year = {}
    matched_codes = set()
    targets = build_data_plan(data_root, years, seed_paths)['targets']
    if not targets:
        print('[下载] 所选年份没有声明一分一段来源，跳过', flush=True)
    for target in targets:
        year = int(target['year'])
        manifest_path = data_root / target['manifestPath']
        if not manifest_path.is_file():
            print(f'[{year}] 一分一段清单不存在，跳过下载：{manifest_path}', flush=True)
            continue
        target_codes = major_codes
        if major_codes:
            document = json.loads(manifest_path.read_text(encoding='utf-8'))
            available = {entry['majorCode'] for entry in document['entries']}
            target_codes = major_codes & available
            matched_codes.update(target_codes)
            if not target_codes:
                continue
        counts_by_year[year] = download_manifest(
            manifest_path, data_root, session, major_codes=target_codes)
    if major_codes and matched_codes != major_codes:
        missing = ', '.join(sorted(major_codes - matched_codes))
        raise ValueError(f'unknown major code(s) in selected year(s): {missing}')
    return counts_by_year


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--seed', action='append', type=Path,
                        help='annual data/year-links/YYYY.json seed; defaults to every seed under --data-root')
    parser.add_argument('--years', nargs='*', type=int)
    parser.add_argument('--major', action='append', dest='major_codes',
                        help='只重试指定专业的 PDF，可重复传入')
    parser.add_argument('--data-root', type=Path, default=Path('data'))
    parser.add_argument('--compact-url-fields', action='store_true',
                        help='只清理清单中重复的 finalUrl，不联网')
    args = parser.parse_args()
    seed_paths = args.seed or seed_paths_in(args.data_root)
    if not seed_paths:
        parser.error('no year-links seeds found')
    if args.compact_url_fields:
        if args.major_codes:
            parser.error('--major cannot be used with --compact-url-fields')
        plan = build_data_plan(args.data_root, set(args.years) if args.years else None, seed_paths)
        for target in plan['targets']:
            path = args.data_root / target['manifestPath']
            print(f'{target["year"]}: 删除 {compact_manifest_urls(path)} 个重复 finalUrl — {path}')
        return
    session = build_session()
    for year, counts in download_targets(seed_paths, args.data_root,
            set(args.years) if args.years else None, session, set(args.major_codes or [])).items():
        print(f'{year}: {counts}')


if __name__ == '__main__':
    main()
