"""Read PDF tables, using page grid lines and OCR for image-only pages."""
from __future__ import annotations

from bisect import bisect_right
from io import BytesIO
from pathlib import Path
from typing import Iterator

import numpy as np
import pdfplumber
from PIL import Image

from .ocr_engine import get_ocr_engine


def _line_centers(mask: np.ndarray) -> list[float]:
    positions = np.flatnonzero(mask)
    runs: list[list[int]] = []
    for position in positions:
        position = int(position)
        if not runs or position > runs[-1][1] + 1:
            runs.append([position, position])
        else:
            runs[-1][1] = position
    return [(start + end) / 2 for start, end in runs if end - start <= 24]


def _grid_bounds(image: Image.Image) -> tuple[list[float], list[float]] | None:
    """Locate continuous horizontal and vertical rules in a scanned page."""
    pixels = np.asarray(image.convert("L"))
    height, width = pixels.shape
    x0, x1 = int(width * 0.035), int(width * 0.965)
    horizontal = (pixels[:, x0:x1] < 110).sum(axis=1) > (x1 - x0) * 0.68
    y_bounds = _line_centers(horizontal)
    if len(y_bounds) < 3:
        return None
    y0, y1 = int(y_bounds[0]), int(y_bounds[-1])
    vertical = (pixels[y0:y1, :] < 110).sum(axis=0) > (y1 - y0) * 0.70
    x_bounds = _line_centers(vertical)
    return (x_bounds, y_bounds) if len(x_bounds) >= 4 else None


def _group_scanned_table_tokens(boxes: list, texts: list[str], x_bounds: list[float],
                                y_bounds: list[float]) -> list[list[str]]:
    """Assign OCR detections to cells using the detected table rules."""
    cells: list[list[list[tuple[float, float, str]]]] = [
        [[] for _ in range(len(x_bounds) - 1)] for _ in range(len(y_bounds) - 1)
    ]
    for box, text in zip(boxes if boxes is not None else [], texts if texts is not None else []):
        points = [(float(point[0]), float(point[1])) for point in box]
        x = sum(point[0] for point in points) / len(points)
        y = sum(point[1] for point in points) / len(points)
        column = bisect_right(x_bounds, x) - 1
        row = bisect_right(y_bounds, y) - 1
        if 0 <= row < len(cells) and 0 <= column < len(cells[row]):
            cells[row][column].append((y, x, "".join(str(text).split())))
    return [["".join(text for _y, _x, text in sorted(cell)) for cell in row]
            for row in cells]


def tables_of(pdf_path: Path) -> Iterator[list[list[str | None]]]:
    """Stream text tables directly; OCR only pages containing scanned tables."""
    with pdfplumber.open(pdf_path) as document:
        total_pages = len(document.pages)
        next_progress = 5
        for page_number, page in enumerate(document.pages, start=1):
            text_tables = page.extract_tables() or []
            if text_tables:
                yield from text_tables
                continue
            scanned = False
            for item in page.images:
                try:
                    with Image.open(BytesIO(item["stream"].get_data())) as source_image:
                        image = source_image.convert("RGB")
                    bounds = _grid_bounds(image)
                    if not bounds:
                        continue
                    result = get_ocr_engine()(image, use_det=True, use_cls=True, use_rec=True)
                    boxes = result.boxes if result and result.boxes is not None else []
                    texts = result.txts if result and result.txts is not None else []
                    table = _group_scanned_table_tokens(boxes, texts, *bounds)
                    if table:
                        yield table
                        scanned = True
                except Exception as error:
                    raise ValueError(f"{pdf_path} 第 {page_number} 页扫描表格 OCR 失败：{error}") from error
            if scanned:
                percent = page_number * 100 // max(1, total_pages)
                if percent >= next_progress:
                    print(f"[表格 OCR] 页 {page_number}/{total_pages}（{percent}%）", flush=True)
                    next_progress = (percent // 5 + 1) * 5
