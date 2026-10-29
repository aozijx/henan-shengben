"""Shared text normalization for PDF extraction and comparison."""
from __future__ import annotations

import re


def squash(text: object) -> str:
    """Remove whitespace that carries no meaning in extracted table cells."""
    return re.sub(r"\s+", "", "" if text is None else str(text))
