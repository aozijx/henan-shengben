import hashlib
import argparse
import json
from pathlib import Path

import requests


def _sha256(content):
    return hashlib.sha256(content).hexdigest()


def download_entry(url, target: Path, session, expected_sha256=None):
    try:
        if expected_sha256 and target.is_file() and _sha256(target.read_bytes()) == expected_sha256:
            return {'downloadStatus': 'skipped', 'sha256': expected_sha256, 'bytes': target.stat().st_size}
        response = session.get(url, timeout=60)
        response.raise_for_status()
        content = response.content
        content_type = response.headers.get('content-type', '').lower()
        if 'pdf' not in content_type or not content.startswith(b'%PDF-'):
            raise ValueError('响应不是 PDF')
        target.parent.mkdir(parents=True, exist_ok=True)
        part = target.with_suffix(target.suffix + '.part')
        part.write_bytes(content)
        part.replace(target)
        return {'downloadStatus': 'downloaded', 'sha256': _sha256(content), 'bytes': len(content)}
    except Exception as error:
        part = target.with_suffix(target.suffix + '.part')
        if part.exists():
            part.unlink()
        return {'downloadStatus': 'failed', 'error': str(error)}


def download_manifest(manifest_path: Path, data_root: Path, session):
    document = json.loads(manifest_path.read_text(encoding='utf-8'))
    counts = {'downloaded': 0, 'skipped': 0, 'failed': 0}
    for entry in document['entries']:
        result = download_entry(entry['pdfUrl'], data_root / entry['localPath'], session, entry.get('sha256'))
        entry.update(result)
        counts[result['downloadStatus']] += 1
    manifest_path.write_text(json.dumps(document, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return counts


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--manifests', default='data/来源清单')
    parser.add_argument('--data-root', default='data')
    args = parser.parse_args()
    session = requests.Session()
    session.headers['User-Agent'] = 'henan-shengben-data/1.0'
    for manifest in sorted(Path(args.manifests).glob('来源清单_*.json')):
        counts = download_manifest(manifest, Path(args.data_root), session)
        print(f'{manifest.name}: {counts}')


if __name__ == '__main__':
    main()
