"""Normalize and compare major identities across yearly catalog sources."""
from __future__ import annotations


def normalize_major_name(value: object) -> str:
    name = ''.join(str(value or '').split()).replace('（', '(').replace('）', ')')
    return name.removesuffix('(本科层次职业教育专业)')


def major_name_matches(code: str, expected_name: str, mapping_names: dict,
                       plan_names: dict) -> bool:
    expected = normalize_major_name(expected_name)
    mapped = {normalize_major_name(name) for name in mapping_names.get(code, set())}
    planned = {normalize_major_name(name) for name in plan_names.get(code, set())}
    if expected in mapped or mapped & planned:
        return True
    # Older years borrow the current mapping; when it has no row for a legacy
    # code, validate the scoreline against that year's plan. Current-year
    # mapping coverage is checked separately below.
    if not mapped and any(name == expected or name == f'{expected}(师范)' for name in planned):
        return True

    # An official A1 scoreline uses this qualified name, while the
    # same major is listed as 财务管理 under mapping code 99 and plan code A1.
    # Keep this as an evidence-backed exception rather than stripping arbitrary
    # parentheses or merging names across the two codes.
    return (
        code == 'A1'
        and expected == '财务管理(含大数据与财务管理)'
        and '财务管理' in planned
        and '财务管理' in {normalize_major_name(name) for name in mapping_names.get('99', set())}
    )
