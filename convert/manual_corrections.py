from __future__ import annotations

from pathlib import Path
from typing import Any

from .common import write_json
from .pdf_tables import RawPdfRow


def ensure_manual_corrections(path: Path, reports: list[dict[str, Any]]) -> bool:
    """Create the review ledger once; never replace user-confirmed decisions."""
    if path.exists():
        return False
    corrections = []
    for report in reports:
        for issue in report["issues"]:
            corrections.append({
                "issueId": issue["issueId"],
                "year": issue["year"],
                "majorCode": issue["majorCode"],
                "majorName": issue["majorName"],
                "status": "pending",
                "cellOverrides": [],
                "replacementSegments": [],
                "evidenceNote": "",
            })
    if not corrections:
        return False
    write_json(path, {"schemaVersion": 1, "corrections": corrections})
    return True


def apply_manual_correction(
    rows: list[RawPdfRow], correction: dict[str, Any] | None
) -> tuple[list[RawPdfRow], list[dict[str, int]] | None]:
    if not correction or correction.get("status") != "confirmed":
        return rows, None
    replacement = correction.get("replacementSegments") or []
    if replacement:
        return rows, replacement
    cells_by_row = [list(row.cells) for row in rows]
    for override in correction.get("cellOverrides") or []:
        row_index = int(override["rowIndex"])
        column_index = int(override["columnIndex"])
        if not 0 <= row_index < len(rows) or rows[row_index].page_number != int(override["pageNumber"]):
            raise ValueError(f"人工修正行不存在：page={override['pageNumber']} row={row_index}")
        if not 0 <= column_index < len(cells_by_row[row_index]):
            raise ValueError(f"人工修正列不存在：column={column_index}")
        cells_by_row[row_index][column_index] = str(override["value"])
    return [RawPdfRow(row.page_number, tuple(cells_by_row[index])) for index, row in enumerate(rows)], None
