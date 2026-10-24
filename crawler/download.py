import hashlib
import argparse
import json
from pathlib import Path
import sys

import requests

if __package__ in {None, ''}:
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from crawler.source_rules import is_official_pdf_url
from crawler.year_sources import load_seed_targets


def _sha256(content):
    return hashlib.sha256(content).hexdigest()


def download_entry(url, target: Path, session, expected_sha256=None):
    try:
        if not is_official_pdf_url(url):
            raise ValueError('PDF URL is not on the official host allowlist')
        if expected_sha256 and target.is_file() and _sha256(target.read_bytes()) == expected_sha256:
            return {'downloadStatus': 'skipped', 'sha256': expected_sha256, 'bytes': target.stat().st_size}
        response = session.get(url, timeout=60)
        response.raise_for_status()
        final_url = getattr(response, 'url', url)
        if not is_official_pdf_url(final_url):
            raise ValueError('PDF redirect left the official host allowlist')
        content = response.content
        content_type = response.headers.get('content-type', '').lower()
        if 'pdf' not in content_type or not content.startswith(b'%PDF-'):
            raise ValueError('响应不是 PDF')
        target.parent.mkdir(parents=True, exist_ok=True)
        part = target.with_suffix(target.suffix + '.part')
        part.write_bytes(content)
        part.replace(target)
        return {'downloadStatus': 'downloaded', 'sha256': _sha256(content), 'bytes': len(content), 'finalUrl': final_url}
    except Exception as error:
        part = target.with_suffix(target.suffix + '.part')
        if part.exists():
            part.unlink()
        return {'downloadStatus': 'failed', 'error': str(error)}


def download_manifest(manifest_path: Path, data_root: Path, session):
    document = json.loads(manifest_path.read_text(encoding='utf-8'))
    counts = {'downloaded': 0, 'skipped': 0, 'failed': 0}
    destinations = set()
    targets = []
    for entry in document['entries']:
        target = (data_root / entry['localPath']).resolve()
        if not target.is_relative_to(data_root.resolve()):
            raise ValueError(f"manifest path escapes data root: {entry['localPath']}")
        if target in destinations:
            raise ValueError(f"duplicate manifest destination: {entry['localPath']}")
        if not is_official_pdf_url(entry['pdfUrl']):
            raise ValueError(f"manifest PDF URL is not on the official host allowlist: {entry['pdfUrl']}")
        destinations.add(target)
        targets.append(target)
    for entry, target in zip(document['entries'], targets):
        result = download_entry(entry['pdfUrl'], target, session, entry.get('sha256'))
        entry.update(result)
        counts[result['downloadStatus']] += 1
    manifest_path.write_text(json.dumps(document, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return counts


def download_targets(seed_paths, data_root: Path, years: set[int] | None, session) -> dict[int, dict[str, int]]:
    counts_by_year = {}
    for target in load_seed_targets(seed_paths, years):
        counts_by_year[target.year] = download_manifest(data_root / target.manifest_path, data_root, session)
    return counts_by_year


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--seed', action='append', type=Path,
                        help='annual data/year-links/YYYY.json seed; defaults to every seed under --data-root')
    parser.add_argument('--years', nargs='*', type=int)
    parser.add_argument('--data-root', type=Path, default=Path('data'))
    args = parser.parse_args()
    session = requests.Session()
    session.headers['User-Agent'] = 'henan-shengben-data/1.0'
    seed_paths = args.seed or sorted((args.data_root / 'year-links').glob('*.json'))
    if not seed_paths:
        parser.error('no year-links seeds found')
    for year, counts in download_targets(seed_paths, args.data_root, set(args.years) if args.years else None, session).items():
        print(f'{year}: {counts}')


if __name__ == '__main__':
    main()
