"""Per-major score-segment storage. Year files are indexes, never row stores."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
from typing import Iterator

from .common import DATA_ROOT, read_json


def _bytes(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode('utf-8')


def _write(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_file() and path.read_bytes() == content:
        return
    temporary = path.with_name(path.name + '.new')
    temporary.write_bytes(content)
    os.replace(temporary, path)


def _shard_path(index_path: Path, data_root: Path, year: int, code: str) -> Path:
    if not code.isascii() or not code.isalnum():
        raise ValueError(f'invalid major code: {code!r}')
    path = index_path.parent / str(year) / f'{code}.json'
    if not path.resolve().is_relative_to(data_root.resolve()):
        raise ValueError(f'invalid shard path: {path}')
    return path


def write_year(index_path: Path, data_root: Path, document: dict) -> dict:
    """Write shards first and atomically replace the yearly index last."""
    data_root, index_path = Path(data_root).resolve(), Path(index_path).resolve()
    year = document['year']
    entries = []
    seen = set()
    prepared = []
    for major in document['majors']:
        code = str(major['majorCode'])
        if code in seen:
            raise ValueError(f'duplicate major code: {code}')
        seen.add(code)
        path = _shard_path(index_path, data_root, year, code)
        content = _bytes(major)
        prepared.append((path, content))
        entries.append({'majorCode': code, 'majorName': major['majorName'],
                        **({'status': major['status']} if 'status' in major else {}),
                        'path': path.relative_to(data_root).as_posix(),
                        'sha256': hashlib.sha256(content).hexdigest()})
    for path, content in prepared:
        _write(path, content)
    index = {key: value for key, value in document.items() if key not in ('schemaVersion', 'majors')}
    index.update({'schemaVersion': 2, 'majors': entries})
    _write(index_path, _bytes(index))
    return index


def iter_year(index_path: Path, data_root: Path) -> Iterator[dict]:
    data_root, index_path = Path(data_root).resolve(), Path(index_path).resolve()
    index = read_json(index_path)
    if index.get('schemaVersion') != 2 or not isinstance(index.get('majors'), list):
        raise ValueError(f'expected sharded yearly index: {index_path}')
    seen = set()
    for entry in index['majors']:
        code = str(entry['majorCode'])
        if code in seen:
            raise ValueError(f'duplicate major code: {code}')
        seen.add(code)
        expected = _shard_path(index_path, data_root, index['year'], code)
        if entry.get('path') != expected.relative_to(data_root).as_posix():
            raise ValueError(f'invalid shard path for {code}')
        content = expected.read_bytes()
        if hashlib.sha256(content).hexdigest() != entry.get('sha256'):
            raise ValueError(f'hash mismatch for {code}: {expected}')
        major = json.loads(content)
        if major.get('majorCode') != code or major.get('majorName') != entry.get('majorName'):
            raise ValueError(f'shard identity mismatch for {code}')
        if 'status' in entry and major.get('status') != entry['status']:
            raise ValueError(f'shard status mismatch for {code}')
        yield major


def merge_year(index_path: Path, data_root: Path) -> dict:
    index = read_json(index_path)
    majors = list(iter_year(index_path, data_root))
    return {**{key: value for key, value in index.items() if key != 'majors'},
            'schemaVersion': 1, 'majors': majors}


def main() -> int:
    parser = argparse.ArgumentParser(description='Export a merged copy of the canonical yearly score segments')
    parser.add_argument('--year', type=int, required=True, help='year of the upstream output')
    parser.add_argument('--data-root', type=Path, default=DATA_ROOT)
    parser.add_argument('--output', type=Path, required=True, help='new merged copy; never overwrites the index')
    args = parser.parse_args()
    from .common import load_data_plan
    targets = [item for item in load_data_plan(args.data_root, {args.year})['targets']
               if item['year'] == args.year and item['dataset'] == 'score-segments']
    if len(targets) != 1:
        parser.error(f'year-links does not define one score-segments target for {args.year}')
    index_path = Path(args.data_root) / targets[0]['normalizedPath']
    if args.output.resolve() == index_path.resolve() or args.output.exists():
        parser.error('--output must be a new path distinct from the index')
    _write(args.output, _bytes(merge_year(index_path, args.data_root)))
    print(args.output)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
