import { admissionSchoolKey } from './utils.js';

function text(value) {
  var normalized = String(value == null ? '' : value).trim().replace(/（/g, '(').replace(/）/g, ')');
  return normalized || null;
}

function numberOrNull(value) {
  if (value === '' || value == null) return null;
  var number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function normalizeMajorOption(row, publicCourseRules) {
  var rules = publicCourseRules || {};
  var professionalName = text(row['考试科目']);
  var pattern = rules.professionalEnglishPattern || '专业英语';
  return {
    majorId: text(row['代码6位']) || text(row['专业代号']) || text(row['专业名称']),
    majorName: text(row['专业名称']),
    majorCode: text(row['专业代号']),
    disciplineCode6: text(row['代码6位']),
    publicCourse: professionalName && professionalName.indexOf(pattern) >= 0 ? (rules.professionalEnglishLabel || '专业英语') : (rules.defaultLabel || '公共英语'),
    professionalCourse: { code: text(row['考试科目代码']), name: professionalName }
  };
}

export function normalizePlanEntry(row) {
  var schoolName = text(row['院校名称']);
  var schoolCode = text(row['院校代号']);
  return {
    year: numberOrNull(row['年度']),
    majorCode: text(row['专业代号']),
    majorName: text(row['专业名称']),
    schoolId: admissionSchoolKey({ schoolCode: schoolCode, schoolName: schoolName }),
    schoolCode: schoolCode,
    schoolName: schoolName,
    schoolType: text(row['办学性质']),
    admissionCategory: text(row['招生类别']),
    povertyStatus: text(row['建档立卡']),
    planCount: numberOrNull(row['计划人数']),
    duration: numberOrNull(row['学制']),
    tuition: numberOrNull(row['学费标准']),
    accommodation: numberOrNull(row['最低住宿费']),
    address: text(row['通信地址']),
    notes: text(row['其他说明']),
    phone: text(row['咨询电话']),
    charterUrl: text(row['招生章程网址']),
    teacherTraining: /师范/.test(String(row['专业名称'] || '')),
    arts: /艺术|美术|音乐|舞蹈|表演|设计|动画|摄影/.test(String(row['专业名称'] || ''))
  };
}

export function normalizeScoreSegmentSeries(row) {
  return {
    year: numberOrNull(row.year),
    majorCode: text(row.majorCode),
    majorName: text(row.majorName),
    controlScore: numberOrNull(row.controlScore),
    sourceId: text(row.sourceId),
    segments: (row.segments || []).map(function (item) {
      return { score: numberOrNull(item.score), cumulativeCount: numberOrNull(item.cumulativeCount) };
    })
  };
}
