/* ============================================================
   河南专升本 · 查询工具  —  数据模块
   数据源：同目录 data/*.json（相对路径 fetch，不挂 window、不内联 JS）
   - 分数线2024/2025/2026.json：三年录取控制分数线
   - 专科专业可报本科专业对照.json：558 个专科专业 → 可报本科专业
   - 招生计划2024/2025/2026.json：三年招生计划全量（计划人数/学费/住宿费/办学性质/建档立卡专项等全字段）
   - 招生高校及专业2026.json：2026 招生总表（师范/艺术/备注，兜底数据源）
   本模块只负责加载、索引与读取，不触碰 DOM。
   ============================================================ */

import { normCode6 } from './utils.js';

export var YEARS = [2024, 2025, 2026];
export var FILES = {
  '2024': 'data/分数线2024.json',
  '2025': 'data/分数线2025.json',
  '2026': 'data/分数线2026.json'
};
export var MAP_FILE = 'data/专科专业可报本科专业对照.json';
export var PLAN_FILES = {
  '2024': 'data/招生计划2024.json',
  '2025': 'data/招生计划2025.json',
  '2026': 'data/招生计划2026.json'
};
export var COLLEGE_FILE = 'data/招生高校及专业2026.json';

export var SCORE_BY_YEAR = {};      // year -> [{专业代号,专业名称,分数线}]
export var MAPPING = [];            // [{专科专业,可报本科专业:[...]}]
export var PLANS = [];              // 2026 招生计划（向后兼容：默认年份）
export var PLAN_BY_YEAR = { 2024: [], 2025: [], 2026: [] };  // year -> 招生计划条目
export var COLLEGES = [];           // [{院校代码,学校名称,专业代码,专业名称,学制,师范,艺术,备注}]
export var ALL_MAJORS = [];         // 唯一本科专业列表（由 MAPPING 推导）

var ready = false;
export function isReady() { return ready; }

/* ---------- 数据加载（相对路径 fetch，返回 Promise） ---------- */
export function loadAll() {
  var jobs = [
    fetch(MAP_FILE, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error(MAP_FILE + ' 加载失败（HTTP ' + r.status + '）');
      return r.json();
    }).then(function (d) { MAPPING = d; }),
    fetch(COLLEGE_FILE, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error(COLLEGE_FILE + ' 加载失败（HTTP ' + r.status + '）');
      return r.json();
    }).then(function (d) { COLLEGES = d; })
  ];
  YEARS.forEach(function (y) {
    jobs.push(fetch(FILES[y], { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error(FILES[y] + ' 加载失败（HTTP ' + r.status + '）');
      return r.json();
    }).then(function (d) { SCORE_BY_YEAR[y] = d; }));
    jobs.push(fetch(PLAN_FILES[y], { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error(PLAN_FILES[y] + ' 加载失败（HTTP ' + r.status + '）');
      return r.json();
    }).then(function (d) { PLAN_BY_YEAR[y] = d; }));
  });
  return Promise.all(jobs).then(function () {
    PLANS = PLAN_BY_YEAR[2026];
    ready = true;
  });
}

/* ---------- 索引 ---------- */
var scoreIndex = {};              // year -> { code: {name, score} }
var collegeByCode = {}, collegeByName = {};
var planByName = {};              // year -> { name -> [条目] }
var planByCode = {};              // year -> { code -> [条目] }
var planByYearName = {}, planByYearCode = {};

/* 名称规范化：去除所有空白（与招生计划 PDF 解析一致） */
function normName(s) {
  return String(s || '').replace(/\s+/g, '');
}

export function buildIndexes() {
  YEARS.forEach(function (y) {
    var db = {};
    (SCORE_BY_YEAR[y] || []).forEach(function (e) {
      if (e['专业代号']) db[String(e['专业代号']).trim()] = { name: e['专业名称'], score: e['分数线'] };
    });
    scoreIndex[y] = db;
  });
  COLLEGES.forEach(function (r) {
    var c6 = normCode6(r['专业代码']);
    (collegeByCode[c6] = collegeByCode[c6] || []).push(r);
    (collegeByName[normName(r['专业名称'])] = collegeByName[normName(r['专业名称'])] || []).push(r);
  });
  YEARS.forEach(function (y) {
    var byName = {}, byCode = {};
    (PLAN_BY_YEAR[y] || []).forEach(function (r) {
      (byName[normName(r['专业名称'])] = byName[normName(r['专业名称'])] || []).push(r);
      (byCode[String(r['专业代号']).trim()] = byCode[String(r['专业代号']).trim()] || []).push(r);
    });
    planByYearName[y] = byName;
    planByYearCode[y] = byCode;
    if (y === 2026) { planByName = byName; planByCode = byCode; }
  });
}

/* 供 stats 模块使用：year -> { code: {name, score} } */
export function getScoreIndex() { return scoreIndex; }

/* ---------- 分数线读取（代号→名称精确→名称包含） ---------- */
export function getScore(major, year) {
  var db = scoreIndex[year];
  if (!db) return null;
  var code = String(major['专业代号'] || '').trim();
  var name = String(major['专业名称'] || '').trim();
  if (code && db[code]) return db[code].score;
  if (name) {
    for (var k in db) if (db[k].name === name) return db[k].score;
    for (var k2 in db) if (db[k2].name && db[k2].name.indexOf(name) > -1) return db[k2].score;
  }
  return null;
}

/* ---------- 招生院校读取（按年份，返回 JSON 原始条目） ----------
   匹配顺序：① 该年招生计划按专业名称（全字段）
             ② 该年招生计划按填报代号（处理财务管理代号 99/A1 差异）
             ③ 招生总表按 6 位专业代码 / 专业名称（兜底，保留师范/艺术/备注）
   排序：按办学性质（公办在前）→ 院校名称 → 院校代号 */
export function getCollegesByYear(year, major) {
  var nm = normName(major['专业名称'] || '');
  var code = String(major['专业代号'] || '').trim();
  var c6 = normCode6(major['代码6位'] || '');

  var byName = planByYearName[year] || planByName;
  var byCode = planByYearCode[year] || planByCode;

  var list = null;
  if (nm && byName[nm]) list = byName[nm];
  if (!list && code) {
    // 财务管理在对照表代号为 99、招生计划代号为 A1
    var codeAlias = code === '99' ? 'A1' : (code === 'A1' ? '99' : code);
    if (byCode[code]) list = byCode[code];
    else if (byCode[codeAlias]) list = byCode[codeAlias];
  }
  if (!list) {
    if (c6 && collegeByCode[c6]) list = collegeByCode[c6];
    else if (nm && collegeByName[nm]) list = collegeByName[nm];
  }
  if (!list) return [];
  return list.slice().sort(function (a, b) {
    var g = (a['办学性质'] || '公办') === (b['办学性质'] || '公办') ? 0 : (a['办学性质'] === '公办' ? -1 : 1);
    if (g) return g;
    var an = a['院校名称'] || a['学校名称'] || '', bn = b['院校名称'] || b['学校名称'] || '';
    if (an !== bn) return an < bn ? -1 : 1;
    return String(a['院校代号'] || '') < String(b['院校代号'] || '') ? -1 : 1;
  });
}

/* 默认年份（2026）读取，向后兼容 */
export function getColleges(major) {
  return getCollegesByYear(2026, major);
}

/* ---------- 按年聚合（供年份折叠与汇总表使用） ----------
   返回：{
     schools: { 2024: {pub,min,total}, 2025: {...}, 2026: {...} },   // 院校数（按院校名称去重）
     plans:   { 2024: {pub,min,total}, ... },                         // 计划人数合计（公办/民办分列）
     union:   { pub, min, total }                                     // 三年去重后的院校合计
   }
   公办/民办按招生计划「办学性质」判定；总表兜底条目按未标注=公办处理。 */
export function getMajorYearStats(major) {
  var stats = { schools: {}, plans: {}, union: { pub: 0, min: 0, total: 0 } };
  var unionSeen = {}, unionPub = 0, unionMin = 0;
  YEARS.forEach(function (y) {
    var list = getCollegesByYear(y, major);
    var seen = {}, pub = 0, min = 0, planPub = 0, planMin = 0;
    list.forEach(function (c) {
      var sn = c['院校名称'] || c['学校名称'] || '';
      var isMin = c['办学性质'] === '民办';
      if (!seen[sn]) {
        seen[sn] = 1;
        if (isMin) min++; else pub++;
        if (!unionSeen[sn]) {
          unionSeen[sn] = 1;
          if (isMin) unionMin++; else unionPub++;
        }
      }
      var n = Number(c['计划人数']) || 0;
      if (isMin) planMin += n; else planPub += n;
    });
    stats.schools[y] = { pub: pub, min: min, total: pub + min };
    stats.plans[y] = { pub: planPub, min: planMin, total: planPub + planMin };
  });
  stats.union = { pub: unionPub, min: unionMin, total: unionPub + unionMin };
  return stats;
}

/* ---------- 全量统计（供 stats 模块） ---------- */
export function getPlanStats() {
  var n = PLANS.length;
  var schools = {};
  var min = 0, card = 0, plan = 0, total = 0;
  PLANS.forEach(function (r) {
    schools[r['院校名称']] = 1;
    if (r['办学性质'] === '民办') min++;
    if (r['建档立卡'] === '是') card++;
    if (r['招生类别'] === '普通专升本') plan++;
    total += r['计划人数'] || 0;
  });
  return { 条数: n, 院校数: Object.keys(schools).length, 民办条目: min, 建档立卡专项: card, 普通计划: plan, 计划人数合计: total };
}

/* ---------- 唯一本科专业列表（去重） ---------- */
export function uniqueMajors() {
  var seen = {}, out = [];
  MAPPING.forEach(function (m) {
    (m['可报本科专业'] || []).forEach(function (x) {
      if (!seen[x['专业名称']]) { seen[x['专业名称']] = 1; out.push(x); }
    });
  });
  ALL_MAJORS = out;
  return out;
}
