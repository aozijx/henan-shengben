from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
import re
from typing import Iterable

import pdfplumber

from PIL import Image, ImageOps

from .ocr_engine import get_ocr_engine


@dataclass(frozen=True)
class RawPdfRow:
    page_number: int
    cells: tuple[str, ...]


def _clean_cell(value: object) -> str:
    return " ".join(str(value or "").replace("\n", " ").split())


def _text_rows(page: object, page_number: int) -> list[RawPdfRow]:
    rows: list[RawPdfRow] = []
    for table in page.extract_tables() or []:
        rows.extend(RawPdfRow(page_number, tuple(_clean_cell(cell) for cell in row)) for row in table)
    return rows


def _embedded_images(page: object) -> Iterable[Image.Image]:
    for item in page.images:
        data = item["stream"].get_data()
        with Image.open(BytesIO(data)) as image:
            yield image.convert("RGB")


def _ocr_rows(image: Image.Image, page_number: int, engine: object, thorough: bool = False) -> list[RawPdfRow]:
    result = engine(image, use_det=True, use_cls=True, use_rec=True)
    boxes = result.boxes if result and result.boxes is not None else []
    texts = result.txts if result and result.txts is not None else []
    width = image.width
    numeric_tokens: list[tuple[float, int, str]] = []
    for box, text in zip(boxes, texts):
        normalized = re.sub(r"\s+", "", text)
        if not normalized.isdigit():
            continue
        x = sum(float(point[0]) for point in box) / 4
        y = sum(float(point[1]) for point in box) / 4
        if x < width * 0.29:
            column = 0 if x < width * 0.17 else 1
        elif x < width * 0.66:
            column = 2 if x < width * 0.51 else 3
        else:
            continue
        numeric_tokens.append((y, column, normalized))

    groups: list[dict[int, str]] = []
    centers: list[float] = []
    for y, column, text in sorted(numeric_tokens):
        nearest = min(range(len(centers)), key=lambda i: abs(centers[i] - y), default=-1)
        if nearest < 0 or abs(centers[nearest] - y) > 12:
            centers.append(y)
            groups.append({column: text})
        else:
            groups[nearest][column] = text
            centers[nearest] = (centers[nearest] + y) / 2
    column_bounds = ((0.05, 0.17), (0.176, 0.303), (0.378, 0.51), (0.516, 0.642))
    rows: list[RawPdfRow] = []
    for center, detected in zip(centers, groups):
        cells: list[str] = []
        for column, (left, right) in enumerate(column_bounds):
            if not thorough and detected.get(column, "").isdigit():
                cells.append(detected[column])
                continue
            crop = image.crop((int(width * left), max(0, int(center - 15)), int(width * right), min(image.height, int(center + 15))))
            monochrome = ImageOps.grayscale(crop).point(lambda pixel: 255 if pixel > 120 else 0)
            enlarged = monochrome.resize((monochrome.width * 4, monochrome.height * 4))
            recognized = engine(enlarged, use_det=False, use_cls=False, use_rec=True)
            text = "" if not recognized or not recognized.txts else re.sub(r"\s+", "", recognized.txts[0])
            cells.append(text if text.isdigit() else "")
        rows.append(RawPdfRow(page_number, tuple(cells)))
    return rows


def extract_rows(pdf_path: Path, thorough: bool = False) -> list[RawPdfRow]:
    """Extract table-shaped rows from text PDFs or scanned official PDFs."""
    rows: list[RawPdfRow] = []
    with pdfplumber.open(pdf_path) as document:
        for page_number, page in enumerate(document.pages, start=1):
            page_rows = _text_rows(page, page_number)
            if page_rows:
                rows.extend(page_rows)
                continue
            for image in _embedded_images(page):
                rows.extend(_ocr_rows(image, page_number, get_ocr_engine(), thorough=thorough))
    return rows
