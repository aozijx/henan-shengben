"""Hash helpers for exact source and artifact bytes across the data pipeline."""
from __future__ import annotations

import hashlib
from pathlib import Path


def sha256_bytes(content: bytes) -> str:
    """Hash bytes exactly as supplied; canonicalization belongs to the caller."""
    return hashlib.sha256(content).hexdigest()


def sha256_file(path: Path) -> str:
    """Hash a file incrementally to avoid loading large source PDFs at once."""
    digest = hashlib.sha256()
    with Path(path).open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()
