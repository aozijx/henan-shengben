"""convert/ 包内的共用常量与文件 IO 工具。

所有脚本都从这里拿 REPO_ROOT / DATA_ROOT / read_json / write_json，
避免每个文件各自写一份 `REPO_ROOT = Path(__file__).resolve().parents[1]` 和 JSON 文件读写逻辑。
"""
from __future__ import annotations

import io
import json
import os
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
DATA_ROOT = REPO_ROOT / "data"


def _ensure_stdout_utf8() -> None:
    """Windows 控制台默认 GBK，pdfplumber 输出中文会炸；统一 reconfigure。"""
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except AttributeError:
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8")


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_bytes_if_changed(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_file() and path.read_bytes() == content:
        return
    temporary = path.with_name(path.name + '.new')
    temporary.write_bytes(content)
    os.replace(temporary, path)


def write_json(path: Path, value: object) -> None:
    write_bytes_if_changed(path, (json.dumps(value, ensure_ascii=False) + "\n").encode("utf-8"))


def load_data_plan(data_root: Path = DATA_ROOT, years: set[int] | None = None) -> dict[str, Any]:
    from crawler.year_sources import build_data_plan

    return build_data_plan(Path(data_root), years)
