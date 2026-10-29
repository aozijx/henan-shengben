"""Keep only unpublished annual seeds for the new-year CI importer."""
from __future__ import annotations

import argparse
from pathlib import Path
import re

from pipeline_io import read_json, write_bytes_if_changed


SEED_PATH = re.compile(r'data/year-links/([0-9]{4})\.json')


def select_unpublished(paths: list[str], metadata: dict) -> tuple[list[str], list[str]]:
    published = {str(year) for year in metadata.get('supportedYears', [])}
    published.update(metadata.get('yearSources', {}))
    selected, skipped = [], []
    for path in dict.fromkeys(paths):
        match = SEED_PATH.fullmatch(path)
        if not match:
            raise ValueError(f'Invalid yearly seed path: {path}')
        (skipped if match.group(1) in published else selected).append(path)
    return selected, skipped


def main() -> None:
    parser = argparse.ArgumentParser(description='Select unpublished changed yearly seeds')
    parser.add_argument('seeds_file', type=Path)
    parser.add_argument('metadata_file', type=Path)
    args = parser.parse_args()
    paths = [line.strip() for line in args.seeds_file.read_text(encoding='utf-8').splitlines() if line.strip()]
    metadata = read_json(args.metadata_file)
    selected, skipped = select_unpublished(paths, metadata)
    write_bytes_if_changed(args.seeds_file, ''.join(f'{path}\n' for path in selected).encode('utf-8'))
    for path in skipped:
        print(f'Already published, skipping new-year ingest: {path}', flush=True)
    print(f'Unpublished yearly seeds: {len(selected)}', flush=True)


if __name__ == '__main__':
    main()
