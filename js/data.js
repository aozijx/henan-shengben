/* ============================================================
   河南专升本 · 查询工具  —  数据模块
   数据源：同目录 data/*.json（相对路径 fetch，不挂 window、不内联 JS）
   - 分数线2024/2025/2026.json：三年录取控制分数线
   - 专科专业可报本科专业对照.json：558 个专科专业 → 可报本科专业
   - 招生计划2026.json：2026 招生计划（计划人数/学费/住宿费/办学性质/建档立卡专项等全字段）
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
export var PLAN_FILE = 'data/招生计划2026.json';
export var COLLEGE_FILE = 'data/招生高校及专业2026.json';

export var SCORE_BY_YEAR = {};   // year -> [{专业代号,专业名称,分数线}]
export var MAPPING = [];         // [{专科专业,可报本科专业:[...]}]
export var PLANS = [];           // [{年度,专业代号,专业名称,计划人数,学制,学费标准,最低住宿费,院校代号,院校名称,办学性质,招生类别,建档立卡,通信地址,其他说明,咨询电话,招生章程网址}]
export var COLLEGES = [];        // [{院校代码,学校名称,专业代码,专业名称,学制,师范,艺术,备注}]
export var ALL_MAJORS = [];      // 唯一本科专业列表（由 MAPPING 推导）

var ready = false;
export function isReady() { return ready; }

/* ---------- 数据加载（相对路径 fetch，返回 Promise） ---------- */
export function loadAll() {
  var jobs = [
    fetch(MAP_FILE, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error(MAP_FILE + ' 加载失败（HTTP ' + r.status + '）');
      return r.json();
    }).then(function (d) { MAPPING = d; }),
    fetch(PLAN_FILE, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error(PLAN_FILE + ' 加载失败（HTTP ' + r.status + '）');
      return r.json();
    }).then(function (d) { PLANS = d; }),
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
  });
  return Promise.all(jobs).then(function () {
    ready = true;
  });
}

/* ---------- 索引 ---------- */
var scoreIndex = {};      // year -> { code: {name, score} }
var collegeByCode = {}, collegeByName = {};
var planByName = {}, planByCode = {};

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
  PLANS.forEach(function (r) {
    (planByName[normName(r['专业名称'])] = planByName[normName(r['专业名称'])] || []).push(r);
    (planByCode[String(r['专业代号']).trim()] = planByCode[String(r['专业代号']).trim()] || []).push(r);
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

/* ---------- 招生院校读取（返回 JSON 原始条目） ----------
   匹配顺序：① 招生计划按专业名称（2026 全字段）
             ② 招生计划按填报代号（处理财务管理代号 99/A1 差异）
             ③ 招生总表按 6 位专业代码 / 专业名称（兜底，保留师范/艺术/备注）
   排序：按办学性质（公办在前）→ 院校名称 → 院校代号 */
export function getColleges(major) {
  var nm = normName(major['专业名称'] || '');
  var code = String(major['专业代号'] || '').trim();
  var c6 = normCode6(major['代码6位'] || '');

  var list = null;
  if (nm && planByName[nm]) list = planByName[nm];
  if (!list && code) {
    // 财务管理在对照表代号为 99、招生计划代号为 A1
    var codeAlias = code === '99' ? 'A1' : (code === 'A1' ? '99' : code);
    if (planByCode[code]) list = planByCode[code];
    else if (planByCode[codeAlias]) list = planByCode[codeAlias];
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
