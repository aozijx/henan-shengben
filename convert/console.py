"""Console setup shared by command-line entry points."""
from __future__ import annotations

import io
import sys


def ensure_stdout_utf8() -> None:
    """Use UTF-8 for multilingual diagnostics on Windows consoles."""
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except AttributeError:
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8")
