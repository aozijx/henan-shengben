"""Build per-year analytics from canonical mapping, scoreline, and plan rows."""
from __future__ import annotations

from typing import Any

from .catalog_identity import normalize_major_name


def major_rows(mapping: list[dict[str, Any]]) -> dict[tuple[str, str], dict[str, Any]]:
    found = {}
    for item in mapping:
        for major in item.get('可报本科专业', []):
            code = str(major.get('专业代号', '')).strip()
            if code:
                found.setdefault((code, major['专业名称']), major)
    return found


def matching_plan_rows(major: dict[str, Any], plan_by_code: dict[str, list[dict[str, Any]]],
                       plans: list[dict[str, Any]]) -> list[dict[str, Any]]:
    code = str(major['专业代号']).strip()
    name = normalize_major_name(major['专业名称'])
    exact = [row for row in plans if normalize_major_name(row.get('专业名称')) == name]
    if exact:
        same_code = [row for row in exact if str(row.get('专业代号', '')).strip() == code]
        return same_code or exact
    codes = [code]
    if code in ('99', 'A1'):
        codes.append('A1' if code == '99' else '99')
    for candidate_code in codes:
        rows = plan_by_code.get(candidate_code, [])
        if len({normalize_major_name(row.get('专业名称')) for row in rows}) == 1:
            return rows
    return []


def build_annual_analytics(year: int, mapping: list[dict[str, Any]], scores: list[dict[str, Any]],
                           plans: list[dict[str, Any]]) -> dict[str, Any]:
    score_by_code = {str(row['专业代号']): row for row in scores}
    plan_by_code = {}
    for row in plans:
        plan_by_code.setdefault(str(row.get('专业代号', '')), []).append(row)
    result = []
    for (code, _name), major in sorted(major_rows(mapping).items()):
        school_types = {}
        candidates = matching_plan_rows(major, plan_by_code, plans)
        for label, key in [('公办', 'public'), ('民办', 'private')]:
            rows = [r for r in candidates if r.get('办学性质', '公办') == label]
            ordinary = [r for r in rows if r.get('建档立卡') != '是' and '建档立卡' not in r.get('招生类别', '')]
            poverty = [r for r in rows if r not in ordinary]
            schools = {}
            for row in rows:
                name = str(row.get('院校名称') or '').strip()
                school_code = str(row.get('院校代号') or '').strip()
                identity = (school_code, name) if school_code else ('', name)
                school = schools.setdefault(identity, {'schoolName': name, 'schoolCode': school_code,
                                                    'ordinaryPlanCount': 0,
                                                    'povertyPlanCount': 0, 'hasOrdinaryPlan': False,
                                                    'hasPovertyPlan': False})
                special = row in poverty
                school['povertyPlanCount' if special else 'ordinaryPlanCount'] += int(row.get('计划人数') or 0)
                school['hasPovertyPlan' if special else 'hasOrdinaryPlan'] = True
            school_types[key] = {
                'allSchoolCount': len(schools),
                'ordinarySchoolCount': sum(1 for school in schools.values() if school['ordinaryPlanCount'] > 0),
                'ordinaryPlanCount': sum(int(r.get('计划人数') or 0) for r in ordinary),
                'povertyPlanCount': sum(int(r.get('计划人数') or 0) for r in poverty),
                'schools': [schools[identity] for identity in sorted(schools)],
            }
        score = score_by_code.get(code)
        if score is None and code in ('99', 'A1'):
            score = score_by_code.get('A1' if code == '99' else '99')
        result.append({'majorCode': code, 'majorName': major['专业名称'],
                       'controlScore': score.get('分数线') if score else None,
                       'schoolTypes': school_types})
    return {'schemaVersion': 1, 'year': year, 'majors': result}
