"""convert/ 包内的共用常量与文件 IO 工具。

所有脚本都从这里拿 REPO_ROOT / DATA_ROOT / _read_json / _write_json，
避免每个文件各自写一份 `REPO_ROOT = Path(__file__).resolve().parents[1]` 和 `_read_json`。
"""
from __future__ import annotations

import io
import json
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
DATA_ROOT = REPO_ROOT / "data"
REGISTRY_PATH = DATA_ROOT / "source-registry.json"


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


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False) + "\n", encoding="utf-8")


def load_registry(path: Path | None = None) -> dict[str, Any]:
    return read_json(Path(path) if path else REGISTRY_PATH)
