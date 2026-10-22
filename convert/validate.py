from __future__ import annotations

from dataclasses import dataclass
import hashlib
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class ValidationError:
    code: str
    path: str
    message: str


@dataclass(frozen=True)
class ValidationReport:
    valid: bool
    errors: tuple[ValidationError, ...]


def validate_score_segment_year(document: object, data_root: Path) -> ValidationReport:
    errors: list[ValidationError] = []
    if not isinstance(document, dict) or not isinstance(document.get("majors"), list):
        return ValidationReport(False, (ValidationError("invalid-document", "", "majors 必须为数组"),))
    seen: set[str] = set()
    for index, major in enumerate(document["majors"]):
        path = f"majors[{index}]"
        code = str(major.get("majorCode", ""))
        if code in seen:
            errors.append(ValidationError("duplicate-major-code", path + ".majorCode", f"专业代号 {code} 重复"))
        seen.add(code)
        segments = major.get("segments")
        if not isinstance(segments, list) or not segments:
            errors.append(ValidationError("empty-segments", path + ".segments", "分数段不能为空"))
            segments = []
        for previous, current in zip(segments, segments[1:]):
            if current.get("score", 0) >= previous.get("score", 0):
                errors.append(ValidationError("score-not-descending", path + ".segments", "分数必须严格降序"))
            if current.get("cumulativeCount", 0) < previous.get("cumulativeCount", 0):
                errors.append(ValidationError("count-not-monotonic", path + ".segments", "累计人数必须单调不减"))
        source_id = major.get("sourceId")
        if not source_id:
            errors.append(ValidationError("missing-source-id", path + ".sourceId", "sourceId 缺失"))
        source_pdf = major.get("sourcePdf")
        source_path = data_root / str(source_pdf or "")
        if not source_pdf or not source_path.is_file():
            errors.append(ValidationError("source-missing", path + ".sourcePdf", "源 PDF 不存在"))
        else:
            actual = hashlib.sha256(source_path.read_bytes()).hexdigest()
            if actual != major.get("sourceSha256"):
                errors.append(ValidationError("source-hash-mismatch", path + ".sourceSha256", "源 PDF 哈希不一致"))
    return ValidationReport(not errors, tuple(errors))
