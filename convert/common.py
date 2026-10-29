"""convert/ 包内的共用常量与文件 IO 工具。

所有脚本都从这里拿 REPO_ROOT / DATA_ROOT / read_json / write_json，
避免每个文件各自写一份 `REPO_ROOT = Path(__file__).resolve().parents[1]` 和 JSON 文件读写逻辑。
"""
from __future__ import annotations

import io
import sys
from pathlib import Path
from typing import Any

from pipeline_io import read_json, write_bytes_if_changed, write_json

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


def load_data_plan(data_root: Path = DATA_ROOT, years: set[int] | None = None) -> dict[str, Any]:
    from crawler.year_sources import build_data_plan

    return build_data_plan(Path(data_root), years)
