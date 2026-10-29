from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from pipeline_integrity import sha256_file


@dataclass(frozen=True)
class ValidationError:
    code: str
    path: str
    message: str


@dataclass(frozen=True)
class ValidationReport:
    valid: bool
    errors: tuple[ValidationError, ...]


def validate_score_segment_major(major: object, data_root: Path, path: str = "major") -> tuple[ValidationError, ...]:
    errors: list[ValidationError] = []
    if not isinstance(major, dict):
        return (ValidationError("invalid-major", path, "专业分片必须为对象"),)
    segments = major.get("segments")
    if not isinstance(segments, list) or not segments:
        errors.append(ValidationError("empty-segments", path + ".segments", "分数段不能为空"))
        segments = []
    for previous, current in zip(segments, segments[1:]):
        if current.get("score", 0) >= previous.get("score", 0):
            errors.append(ValidationError("score-not-descending", path + ".segments", "分数必须严格降序"))
        if current.get("cumulativeCount", 0) < previous.get("cumulativeCount", 0):
            errors.append(ValidationError("count-not-monotonic", path + ".segments", "累计人数必须单调不减"))
    if not major.get("sourceId"):
        errors.append(ValidationError("missing-source-id", path + ".sourceId", "sourceId 缺失"))
    source_pdf = major.get("sourcePdf")
    source_path = data_root / str(source_pdf or "")
    if not source_pdf or not source_path.is_file():
        errors.append(ValidationError("source-missing", path + ".sourcePdf", "源 PDF 不存在"))
    elif sha256_file(source_path) != major.get("sourceSha256"):
        errors.append(ValidationError("source-hash-mismatch", path + ".sourceSha256", "源 PDF 哈希不一致"))
    return tuple(errors)


def validate_score_segment_year(document: object, data_root: Path) -> ValidationReport:
    if not isinstance(document, dict) or not isinstance(document.get("majors"), list):
        return ValidationReport(False, (ValidationError("invalid-document", "", "majors 必须为数组"),))
    errors: list[ValidationError] = []
    seen: set[str] = set()
    for index, major in enumerate(document["majors"]):
        path = f"majors[{index}]"
        code = str(major.get("majorCode", "")) if isinstance(major, dict) else ""
        if code in seen:
            errors.append(ValidationError("duplicate-major-code", path + ".majorCode", f"专业代号 {code} 重复"))
        seen.add(code)
        errors.extend(validate_score_segment_major(major, data_root, path))
    return ValidationReport(not errors, tuple(errors))
