"""Shared UTF-8 JSON and atomic file writes for pipeline packages."""
from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
from typing import Any


def read_json(path: Path) -> Any:
    return json.loads(Path(path).read_text(encoding='utf-8'))


def write_bytes_if_changed(path: Path, content: bytes) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_file() and path.read_bytes() == content:
        return
    temporary = path.with_name(path.name + '.new')
    try:
        temporary.write_bytes(content)
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()


def copy_file_atomically(source: Path, destination: Path) -> None:
    """Copy a file with metadata, replacing the destination only when complete."""
    source, destination = Path(source), Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(destination.name + '.new')
    try:
        shutil.copy2(source, temporary)
        os.replace(temporary, destination)
    finally:
        if temporary.exists():
            temporary.unlink()


def write_json(path: Path, value: object, *, indent: int | None = None) -> None:
    content = json.dumps(value, ensure_ascii=False, indent=indent) + '\n'
    write_bytes_if_changed(path, content.encode('utf-8'))
