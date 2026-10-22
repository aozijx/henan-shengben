from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class SourceValue:
    value: Any
    source_id: str
    priority: int


@dataclass(frozen=True)
class Resolution:
    field: str
    value: Any
    source_id: str | None
    reason: str
    blocking: bool
    candidates: tuple[SourceValue, ...]


def _present(value: Any) -> bool:
    return value is not None and (not isinstance(value, str) or bool(value.strip()))


def resolve_field(field: str, candidates: list[SourceValue]) -> Resolution:
    usable = sorted((item for item in candidates if _present(item.value)), key=lambda item: item.priority, reverse=True)
    if not usable:
        return Resolution(field, None, None, "no-value", True, tuple(candidates))
    top_priority = usable[0].priority
    top = [item for item in usable if item.priority == top_priority]
    distinct = {repr(item.value) for item in top}
    if len(distinct) > 1:
        return Resolution(field, None, None, "unresolved-conflict", True, tuple(usable))
    reason = "highest-priority" if _present(candidates[0].value) and candidates[0].priority == top_priority else "fallback-nonempty"
    return Resolution(field, top[0].value, top[0].source_id, reason, False, tuple(usable))
