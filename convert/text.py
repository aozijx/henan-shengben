"""Shared text normalization for PDF extraction and comparison."""
from __future__ import annotations

import re


def squash(text: str | None) -> str:
    """Remove whitespace that carries no meaning in extracted table cells."""
    if text is None:
        return ""
    return re.sub(r"\s+", "", str(text))
