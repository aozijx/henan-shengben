/* ============================================================
   河南专升本 · 查询工具  —  渲染模块
   分数线结果表：每个专业行下方直接展开该专业的招生院校明细
   （两级折叠：专业行 → 院校条目 → 详细信息，JSON 全部字段）。
   只负责把数据渲染成 HTML 并绑定结果区内部交互，不持有查询状态。
   ============================================================ */

import { getScore, getColleges } from './data.js';
import { esc } from './utils.js';

function subjectBadge(subject, code) {
  var cls = 'other';
  if (subject === '高等数学') cls = 'math';
  else if (subject === '管理学') cls = 'mgmt';
  var codeHtml = code ? ' <span style="opacity:.6">' + esc(code) + '</span>' : '';
  return '<span class="badge-subject ' + cls + '">' + esc(subject) + codeHtml + '</span>';
}

function publicLabel(majorName) {
  return /英语|翻译/.test(majorName) ? '专业英语' : '公共英语';
}

function trendCell(s26, s25) {
  if (s26 == null || s25 == null) return '<span class="trend na">—</span>';
  if (s26 > s25) return '<span class="trend up">▲ +' + (s26 - s25) + '</span>';
  if (s26 < s25) return '<span class="trend down">▼ −' + (s25 - s26) + '</span>';
  return '<span class="trend flat">＝ ±0</span>';
}

function scoreCell(major, year) {
  var s = getScore(major, year);
  if (s == null) return '<span class="score na">—</span>';
  var hot = year === 2026 ? ' hot' : '';
  return '<span class="score' + hot + '">' + s + '</span>';
}

/* ---------- 招生院校明细（挂在每个专业行下方） ---------- */

/* 办学性质 / 建档立卡标签 */
function schoolTags(c) {
  var out = [];
  if (c['办学性质'] === '民办') out.push('<span class="tag-min">民办</span>');
  else if (c['办学性质'] === '公办') out.push('<span class="tag-pub">公办</span>');
  if (c['建档立卡'] === '是') out.push('<span class="tag-card">建档立卡专项</span>');
  return out.join('');
}

/* 摘要信息（summary 行右侧）：学制 / 计划人数 / 学费 */
function schoolSum(c) {
  var parts = [];
  if (c['学制']) parts.push(esc(String(c['学制'])) + ' 年');
  if (c['计划人数'] != null) parts.push('计划 ' + c['计划人数'] + ' 人');
  if (c['学费标准'] != null) parts.push('学费 ¥' + c['学费标准'] + '/年');
  if (!parts.length && c['备注']) parts.push(esc(String(c['备注'])));
  return parts.join(' · ');
}

/* 二级：单个院校条目（可折叠，展开显示该条目的全部字段） */
function schoolItemHtml(c, seenName) {
  var sn = c['院校名称'] || c['学校名称'] || '';
  seenName[sn] = (seenName[sn] || 0) + 1;
  var dup = seenName[sn] > 1 ? '（' + seenName[sn] + '）' : '';
  var isPlan = c['办学性质'] != null;   // 招生计划条目（全字段） vs 总表兜底条目

  var meta;
  if (isPlan) {
    meta = [
      ['院校代码', c['院校代号']],
      ['专业代号', c['专业代号']],
      ['专业名称', c['专业名称']],
      ['学制', c['学制'] || '—'],
      ['计划人数', c['计划人数'] != null ? c['计划人数'] + ' 人' : '—'],
      ['学费标准（元/年）', c['学费标准'] != null ? '¥' + c['学费标准'] : '—'],
      ['最低住宿费（元/年）', c['最低住宿费'] != null ? '¥' + c['最低住宿费'] : '—'],
      ['办学性质', c['办学性质'] || '—'],
      ['招生类别', c['招生类别'] || '—'],
      ['通信地址', c['通信地址'] || '—'],
      ['其他说明', c['其他说明'] || '—'],
      ['咨询电话', c['咨询电话'] || '—'],
      ['招生章程网址', c['招生章程网址'] || '—']
    ];
  } else {
    meta = [
      ['院校代码', c['院校代码']],
      ['学校名称', c['学校名称']],
      ['专业代码', c['专业代码']],
      ['专业名称', c['专业名称']],
      ['学制', c['学制'] || '—'],
      ['师范', c['师范'] === '是' ? '是' : '—'],
      ['艺术', c['艺术'] === '是' ? '是' : '—'],
      ['备注', c['备注'] || '—']
    ];
  }
  /* 长字段独占整行：通信地址 / 其他说明 / 招生章程网址 / 备注 */
  var fullSet = { '通信地址': 1, '其他说明': 1, '招生章程网址': 1, '备注': 1 };
  var metaHtml = meta.map(function (kv) {
    var label = kv[0], val = kv[1];
    var cls = fullSet[label] ? ' meta-row full' : '';
    var v = val === '是'
      ? '<span class="mark on">是</span>'
      : (label === '办学性质'
          ? '<span class="' + (val === '民办' ? 'tag-min' : 'tag-pub') + '">' + esc(val) + '</span>'
          : esc(val));
    return '<div class="meta-row' + cls + '"><dt>' + label + '</dt><dd>' + v + '</dd></div>';
  }).join('');

  var tags = schoolTags(c);
  var sumInfo = schoolSum(c);
  return '<details class="school-item">' +
    '<summary><span class="si-name">' + esc(sn) + dup + '</span>' +
    tags +
    (sumInfo ? '<span class="count">' + sumInfo + '</span>' : '') +
    '</summary>' +
    '<dl class="school-meta">' + metaHtml + '</dl></details>';
}

/* 一级：某个专业的院校明细（含全部院校条目） */
function collegeDetailHtml(m) {
  var list = getColleges(m);
  if (!list.length) {
    return '<div class="cb-empty">2026 年普通本科专业总表未单列（职业本科或计划另文下达）</div>';
  }
  var schoolSet = {};
  list.forEach(function (c) { schoolSet[c['院校名称'] || c['学校名称']] = 1; });
  var schools = Object.keys(schoolSet).length;
  var countLabel = list.length === schools
    ? schools + ' 所院校'
    : schools + ' 所院校（' + list.length + ' 条）';
  var seenName = {};
  var items = list.map(function (c) { return schoolItemHtml(c, seenName); }).join('');
  return '<div class="school-list">' +
    '<div class="school-list-head">' + esc(m['专业名称']) +
    '<span class="count">' + countLabel + '</span></div>' +
    items + '</div>';
}

/* ---------- 分数线结果表（每行下挂院校明细） ---------- */
export function renderTable($result, title, majors, countNote) {
  var body = [];
  var total = 0;
  majors.forEach(function (m) {
    var s26 = getScore(m, 2026), s25 = getScore(m, 2025);
    var nameHtml = esc(m['专业名称']);
    if (/职业教育/.test(m['专业名称'])) nameHtml += '<span class="tag">职教本科</span>';

    var list = getColleges(m);
    total += list.length;
    var id = 'cd-' + Math.random().toString(36).slice(2, 8);

    var schoolBtn = list.length
      ? '<button type="button" class="school-sum" data-target="' + id + '" aria-expanded="false" title="点击展开该专业招生院校明细">' +
        '院校 ' + list.length + ' 所 <span class="arr">▸</span></button>'
      : '<span class="na">—</span>';

    body.push(
      '<tr class="major-row">' +
        '<td class="major-name">' + nameHtml + '</td>' +
        '<td><span class="code">' + (m['专业代号'] ? esc(m['专业代号']) : '—') + '</span></td>' +
        '<td class="public">' + publicLabel(m['专业名称']) + '</td>' +
        '<td>' + subjectBadge(m['考试科目'] || '—', m['考试科目代码']) + '</td>' +
        '<td>' + scoreCell(m, 2024) + '</td>' +
        '<td>' + scoreCell(m, 2025) + '</td>' +
        '<td>' + scoreCell(m, 2026) + '</td>' +
        '<td>' + trendCell(s26, s25) + '</td>' +
        '<td class="school-cell">' + schoolBtn + '</td>' +
      '</tr>',
      '<tr class="college-row" data-id="' + id + '"><td colspan="9">' +
        '<details class="college-detail" id="' + id + '">' +
        '<summary class="sr-only">招生院校明细</summary>' +
        collegeDetailHtml(m) +
        '</details></td></tr>'
    );
  });

  $result.innerHTML =
    '<div class="result-head"><b>' + esc(title) + '</b>' +
    (countNote ? '<span class="count">' + esc(countNote) + '</span>' : '') +
    '<span class="count">共 ' + total + ' 个院校条目</span>' +
    '<button type="button" class="cb-toggle" id="cbToggle">全部展开</button></div>' +
    '<div class="table-wrap"><table><colgroup>' +
    '<col class="c-name"><col class="c-code"><col class="c-public"><col class="c-subject">' +
    '<col class="c-y"><col class="c-y"><col class="c-y"><col class="c-trend"><col class="c-school">' +
    '</colgroup><thead><tr>' +
    '<th>本科专业</th><th>代号</th><th>公共课</th><th>专业基础课</th>' +
    '<th>2024</th><th>2025</th><th>2026</th><th>较2025</th><th>2026招生</th>' +
    '</tr></thead><tbody>' + body.join('') + '</tbody></table></div>';

  /* 展开 / 收起单个专业的院校明细 */
  $result.querySelectorAll('.school-sum').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var det = document.getElementById(btn.getAttribute('data-target'));
      var open = det.open;
      det.open = !open;
      btn.classList.toggle('is-open', !open);
      btn.setAttribute('aria-expanded', String(!open));
      var row = btn.closest('tr');
      if (row) row.classList.toggle('is-open', !open);
    });
  });

  /* 全部展开 / 全部收起 */
  var toggle = document.getElementById('cbToggle');
  if (toggle) {
    toggle.addEventListener('click', function () {
      var anyOpen = $result.querySelectorAll('.college-detail[open]').length > 0;
      $result.querySelectorAll('.college-detail').forEach(function (d) { d.open = !anyOpen; });
      $result.querySelectorAll('.major-row').forEach(function (r) { r.classList.toggle('is-open', !anyOpen); });
      $result.querySelectorAll('.school-sum').forEach(function (b) {
        b.classList.toggle('is-open', !anyOpen);
        b.setAttribute('aria-expanded', String(!anyOpen));
      });
      toggle.textContent = anyOpen ? '全部展开' : '全部收起';
    });
  }
}

/* 多匹配候选列表（点击后执行 clickFn） */
export function renderMatchList($result, items, clickFn, typeLabel) {
  var html = '<div class="result-head"><span class="count">共匹配 ' + items.length + ' 个' + typeLabel + '</span></div>' +
    '<div class="school-chips" style="margin-bottom:14px">' +
    items.map(function (it, i) {
      return '<button type="button" class="chip" data-i="' + i + '" style="cursor:pointer;font:inherit;font-size:13px;color:var(--blue);border-color:var(--line-strong)">' +
        esc(it.name) + '</button>';
    }).join('') + '</div>';
  $result.insertAdjacentHTML('afterbegin', html);
  $result.querySelectorAll('.chip[data-i]').forEach(function (btn) {
    btn.addEventListener('click', function () { clickFn(items[+btn.getAttribute('data-i')]); });
  });
}
