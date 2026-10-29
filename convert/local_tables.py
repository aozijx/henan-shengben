"""Explicit, hash-checked local PDF conversions independent of year links."""
from __future__ import annotations

from pathlib import Path

from convert.common import read_json, write_json
from crawler.source_plan import TABLE_PDF_PATHS, TABLE_SOURCE_SPECS, source_rows_for_seed
from pipeline_integrity import sha256_file


PARSERS = {parser for parser, _roles, _output in TABLE_SOURCE_SPECS}


def local_source_rows(data_root: Path, year: int) -> list[dict]:
    """Discover only parsers whose complete conventional PDF inputs exist."""
    root = Path(data_root)
    roles = {role: {} for role, pattern in TABLE_PDF_PATHS.items()
             if (root / pattern.format(year=year)).is_file()}
    rows = source_rows_for_seed({'year': year, 'sources': roles}, root)
    available = [row for row in rows if all((root / pdf).is_file() for pdf in row['pdfPaths'])]
    # The full mapping already incorporates the code table. Keep the standalone
    # code-table output only while the overview PDF has not been published.
    if any(row['parser'] == 'mapping' for row in available):
        available = [row for row in available if row['parser'] != 'mappingCodeTable']
    return available


def _manifest_path(root: Path, year: int) -> Path:
    return root / f'来源清单/本地表_{year}.json'


def record_local_tables(data_root: Path, year: int, rows: list[dict]) -> Path:
    root = Path(data_root)
    path = _manifest_path(root, year)
    entries = ({item['parser']: item for item in read_json(path).get('sources', [])
                if (root / item['outputPath']).is_file()} if path.is_file() else {})
    for row in rows:
        output = root / row['outputPath']
        if not output.is_file():
            raise ValueError(f'local conversion missing output: {output}')
        entries[row['parser']] = {
            'parser': row['parser'], 'outputPath': row['outputPath'],
            'pdfPaths': row['pdfPaths'],
            'pdfSha256': [sha256_file(root / pdf) for pdf in row['pdfPaths']],
            'outputSha256': sha256_file(output),
        }
    write_json(path, {'schemaVersion': 1, 'year': year,
                      'sources': [entries[key] for key in sorted(entries)]})
    return path


def load_local_tables(data_root: Path) -> dict[int, dict[str, str]]:
    """Use only recorded outputs whose PDFs and JSON still match their hashes."""
    root = Path(data_root).resolve()
    found: dict[int, dict[str, str]] = {}
    for path in sorted((root / '来源清单').glob('本地表_*.json')):
        year_text = path.stem.removeprefix('本地表_')
        if not year_text.isdigit():
            continue
        year = int(year_text)
        document = read_json(path)
        if document.get('schemaVersion') != 1 or document.get('year') != year:
            raise ValueError(f'invalid local table manifest: {path}')
        for item in document.get('sources', []):
            parser = item.get('parser')
            if parser not in PARSERS:
                raise ValueError(f'unsupported local table parser: {parser}')
            paths = [item.get('outputPath'), *item.get('pdfPaths', [])]
            hashes = [item.get('outputSha256'), *item.get('pdfSha256', [])]
            expected_inputs = 2 if parser == 'mapping' else 1
            if len(paths) != len(hashes) or len(paths) != expected_inputs + 1:
                raise ValueError(f'invalid local table record: {path}: {parser}')
            for relative, expected in zip(paths, hashes):
                if not isinstance(relative, str) or not isinstance(expected, str):
                    raise ValueError(f'invalid local table record: {path}: {parser}')
                target = (root / relative).resolve()
                if not target.is_relative_to(root) or not target.is_file() or sha256_file(target) != expected:
                    raise ValueError(f'local table source changed: {relative}')
            found.setdefault(year, {})[parser] = item['outputPath']
    return found
