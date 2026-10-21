# -*- coding: utf-8 -*-
"""从 pdf/ 官方文件重新抽取数据，与 data/ 现有 JSON 比对，防止数据错误。

用法：
  python tools/convert.py            # 校验模式：逐文件比对，报告差异（不变更文件）
  python tools/convert.py --write    # 更新模式：将重新抽取的结果写回 data/（仅写有差异的文件）

各源抽取规则（与页面读取逻辑无关，仅负责还原 PDF）：
  分数线 x3        专业代号/专业名称/分数线，跨页重复表头，标题行跳过
  2026代号对照表   本科专业 → 专业代号、考试科目代号（None 沿用上一行）
  2026对照一览表   序号/本科专业代码名称/专科专业代码名称/考试科目（合并单元格沿承）
  招生计划 x3      12 列（2024 为 11 列，无「其他说明」），建档立卡与公/民办从括号标注还原
  招生总表 2026    8 列，院校单元格纵向合并
"""
import io
import json
import re
import sys
from pathlib import Path

import pdfplumber

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

ROOT = Path(__file__).resolve().parent.parent
PDF = ROOT / 'pdf'
DATA = ROOT / 'data'

# 已知不变量：转换结果行数必须与官方文件一致
EXPECTED_COUNTS = {
    '分数线2024.json': 143,
    '分数线2025.json': 172,
    '分数线2026.json': 185,
    '专科专业可报本科专业对照.json': 558,
    '招生计划2024.json': 1111,
    '招生计划2025.json': 1066,
    '招生计划2026.json': 1259,
    '招生高校及专业2026.json': 987,
}


def squash(text):
    """去掉换行与多余空白（PDF 单元格内自动换行不含语义）。"""
    if text is None:
        return ''
    return re.sub(r'\s+', '', str(text))


def to_int(text):
    text = squash(text)
    if not text:
        return None
    m = re.search(r'\d+', text)
    return int(m.group()) if m else None


def is_header(row):
    joined = squash(''.join(c or '' for c in row[:3]))
    return '代号' in joined or '序号' in joined or '代码' in joined


def is_title(row):
    joined = squash(''.join(c or '' for c in row))
    return '河南省' in joined and '代号' not in joined and len(squash(row[0] or '')) > 8


def tables_of(name):
    with pdfplumber.open(PDF / name) as pdf:
        for page in pdf.pages:
            for table in page.extract_tables():
                yield table


def rows_of(name):
    """跨页拉平所有表格行。"""
    for table in tables_of(name):
        for row in table:
            yield row


# ---------- 分数线 ----------

def extract_scorelines(name):
    out = []
    for row in rows_of(name):
        if len(row) < 3 or is_header(row) or is_title(row):
            continue
        code, title, score = squash(row[0]), row[1], to_int(row[2])
        if not re.fullmatch(r'[0-9A-Z]{1,2}', code) or title is None or score is None:
            continue
        out.append({'专业代号': code, '专业名称': squash(title), '分数线': score})
    return out


# ---------- 2026 代号对照表：本科专业 → 专业代号 / 考试科目代号 ----------

def baseName(name):
    """去除「本科层次职业教育…」括号与「试点」字样，用于对照表与代号表名称对齐。"""
    base = re.sub(r'[（(]本科层次职业[^（）()]*[）)]', '', name or '')
    return base.replace('试点', '')


def extract_code_table():
    out = {}
    prev_code, prev_subject = '', ''
    for row in rows_of('2026代号对照表.pdf'):
        if len(row) < 4 or is_header(row):
            continue
        title = squash(row[1])
        if not title:
            continue
        code_raw = squash(row[0])
        code = code_raw if re.fullmatch(r'[0-9A-Z]{1,2}', code_raw or '') else prev_code
        prev_code = code
        subject_code = squash(row[2]) or prev_subject
        prev_subject = subject_code
        out[title] = {'专业代号': code, '考试科目代码': subject_code}
    return out


def code_ref(code_table, name):
    """按名称查代号；对照表与代号表的括号注释措辞可能不同，回退到基础名匹配。"""
    if name in code_table:
        return code_table[name]
    base = baseName(name)
    if base and base in code_table:
        return code_table[base]
    for title, ref in code_table.items():
        if baseName(title) == base:
            return ref
    return {}


# ---------- 2026 对照一览表：专科专业 → 可报本科专业 ----------

CODE_NAME = re.compile(r'^([0-9A-Z]{6}[KT]{0,2})\s*(.+)$')


def parse_master_cell(cell):
    """「020101 经济学」单元格。多行时：每行以 6 位代码开头即新的本科专业，
    否则视为上一专业名称的换行续写（如「电子商务（本科层次职 / 业技术）」）。"""
    pairs = []
    for line in str(cell or '').split('\n'):
        line = line.strip()
        if not line:
            continue
        m = CODE_NAME.match(line)
        if m:
            pairs.append({'代码6位': m.group(1), '专业名称': m.group(2).strip()})
        elif pairs:
            pairs[-1]['专业名称'] += line
    return pairs


def extract_mapping():
    edges = []  # (专科专业名称, 本科条目)
    current_masters = []
    prev_subject = ''
    for row in rows_of('2026对照一览表.pdf'):
        if len(row) < 5 or is_header(row):
            continue
        seq = squash(row[0])
        subject = row[4]
        if subject is not None and squash(subject):
            prev_subject = str(subject).strip()
        if seq:  # 序号行：新的本科专业（可含多行代码+名称）
            masters = parse_master_cell(row[1])
            if masters:
                current_masters = masters
        elif row[1] is not None and squash(row[1]) and parse_master_cell(row[1]):
            current_masters = parse_master_cell(row[1])
        major = squash(row[3])
        if not major or not current_masters:
            continue
        for master in current_masters:
            item = dict(master)
            item['考试科目'] = prev_subject
            edges.append((major, item))
    grouped = {}
    order = []
    seen = set()
    for major, item in edges:
        key = (major, item['专业名称'], item['代码6位'])
        if key in seen:
            continue
        seen.add(key)
        if major not in grouped:
            grouped[major] = []
            order.append(major)
        grouped[major].append(item)
    code_table = extract_code_table()
    out = []
    for major in order:
        items = []
        for item in grouped[major]:
            ref = code_ref(code_table, item['专业名称'])
            items.append({
                '专业名称': item['专业名称'],
                '专业代号': ref.get('专业代号', ''),
                '考试科目代码': ref.get('考试科目代码', ''),
                '考试科目': item['考试科目'],
                '代码6位': item['代码6位'],
            })
        out.append({'专科专业': major, '可报本科专业': items})
    return out


# ---------- 招生计划 ----------

def clean_school_name(raw):
    """还原院校名称并识别标注：去掉 (专升本…)、(民办) 等括号标注与换行；
    建档立卡专项标注也在该括号内（如「(专升本只招建档立卡贫困家庭考生)」）。"""
    text = squash(raw)
    poor = '是' if '建档立卡' in text else '否'
    nature = '民办' if '民办' in text else '公办'
    text = re.sub(r'[（(]专升本[^（）()]*[）)]?', '', text)
    text = re.sub(r'[（(]民办[^（）()]*[）)]?', '', text)
    text = re.sub(r'[（(]民$', '', text)
    text = re.sub(r'[（(][^（）()]*[）)]', '', text)  # 其余注释括号，如（原新乡医学院三全学院）
    return text, nature, poor


def clean_major_name(raw):
    """专业名称及方向：剔除「建档立卡」括号标注，保留 (师范) 等方向。"""
    text = squash(raw)
    if '建档立卡' in text:
        text = re.sub(r'[（(][^（）()]*建档立卡[^（）()]*[）)]?', '', text)
    return text


def extract_plans(name, year, twelve_cols_default=True):
    out = []
    for table in tables_of(name):
        header = next((r for r in table if is_header(r)), None)
        if header is None:
            continue
        twelve = '其他说明' in squash(''.join(c or '' for c in header)) or \
            (header is None and twelve_cols_default)
        twelve = twelve if header is not None else twelve_cols_default
        for row in table:
            if len(row) < 11 or is_header(row):
                continue
            code = squash(row[0])
            school_code = squash(row[6])
            plan = to_int(row[2])
            if not re.fullmatch(r'[0-9A-Z]{1,2}', code or '') or not school_code or plan is None:
                continue
            if twelve:
                addr, extra, phone, url = row[8], row[9], row[10], row[11]
            else:
                addr, extra, phone, url = row[8], '', row[9], row[10]
            school, nature, poor = clean_school_name(row[7])
            major_raw = squash(row[1])
            if '建档立卡' in major_raw:
                poor = '是'
            category = '建档立卡专项' if poor == '是' else '普通专升本'
            out.append({
                '年度': year,
                '专业代号': code,
                '专业名称': clean_major_name(major_raw),
                '计划人数': plan,
                '学制': to_int(row[3]) or 0,
                '学费标准': to_int(row[4]) or 0,
                '最低住宿费': to_int(row[5]) or 0,
                '院校代号': school_code,
                '院校名称': school,
                '办学性质': nature,
                '招生类别': category,
                '建档立卡': poor,
                '通信地址': squash(addr),
                '其他说明': squash(extra),
                '咨询电话': squash(phone),
                '招生章程网址': squash(url),
            })
    return out


# ---------- 招生总表 2026 ----------

def extract_master_table():
    out = []
    cur_code, cur_school = '', ''
    for row in rows_of('河南省2026年普通高职（专科）毕业生进入本科阶段学习招生高校及专业总表.pdf'):
        if len(row) < 8 or is_header(row):
            continue
        if squash(row[0]) and squash(row[1]):
            cur_code, cur_school = squash(row[0]), squash(row[1])
        major_code = squash(row[2])
        if not major_code:
            continue
        out.append({
            '院校代码': cur_code,
            '学校名称': cur_school,
            '专业代码': major_code,
            '专业名称': squash(row[3]),
            '学制': squash(row[4]),
            '师范': squash(row[5]),
            '艺术': squash(row[6]),
            '备注': squash(row[7]),
        })
    return out


# ---------- 校验与写回 ----------

def norm_item(item):
    if isinstance(item, dict):
        return {k: norm_item(v) for k, v in item.items()}
    if isinstance(item, list):
        return [norm_item(v) for v in item]
    if isinstance(item, str):
        return re.sub(r'\s+', '', item)
    return item


def diff_rows(a, b):
    """按顺序逐条、逐字段比对（文本做空白归一）。返回 [(序号, 字段, 抽取值, 现有值)]。"""
    diffs = []
    for i in range(max(len(a), len(b))):
        ra = a[i] if i < len(a) else None
        rb = b[i] if i < len(b) else None
        if ra is None or rb is None:
            diffs.append((i, '<行>', ra, rb))
            continue
        keys = set(ra) | set(rb)
        for k in sorted(keys):
            va, vb = norm_item(ra.get(k)), norm_item(rb.get(k))
            if va != vb:
                diffs.append((i, k, ra.get(k), rb.get(k)))
    return diffs


def diff_mapping(extracted, existing):
    """对照表按「专科专业 → 本科条目集合」比对，忽略分组顺序。"""
    def key_map(rows):
        out = {}
        for row in rows:
            items = {(i['专业名称'], i['专业代号'], i['考试科目代码'],
                      norm_item(i['考试科目']), i['代码6位']) for i in row['可报本科专业']}
            out[squash(row['专科专业'])] = items
        return out

    a, b = key_map(extracted), key_map(existing)
    diffs = []
    for major in sorted(set(a) | set(b)):
        if major not in a:
            diffs.append((major, '<专科专业缺失于PDF>', '', b[major]))
        elif major not in b:
            diffs.append((major, '<专科专业缺失于现有JSON>', a[major], ''))
        else:
            extra, missing = a[major] - b[major], b[major] - a[major]
            for item in list(extra)[:3]:
                diffs.append((major, '<多出>', item, ''))
            for item in list(missing)[:3]:
                diffs.append((major, '<缺少>', '', item))
    return diffs


SOURCES = [
    ('分数线2024.json', lambda: extract_scorelines('2024年河南省普通高校专升本招生录取控制分数线.pdf')),
    ('分数线2025.json', lambda: extract_scorelines('2025年河南省普通高校专升本招生录取控制分数线.pdf')),
    ('分数线2026.json', lambda: extract_scorelines('2026年河南省普通高校专升本招生录取控制分数线.pdf')),
    ('专科专业可报本科专业对照.json', extract_mapping),
    ('招生计划2024.json', lambda: extract_plans('河南省2024年普通高等学校专科毕业生升入本科阶段学习招生计划.pdf', 2024, twelve_cols_default=False)),
    ('招生计划2025.json', lambda: extract_plans('河南省2025年普通高等学校专科毕业生升入本科阶段学习招生计划.pdf', 2025)),
    ('招生计划2026.json', lambda: extract_plans('河南省2026年普通高等学校专科毕业生升入本科阶段学习招生计划.pdf', 2026)),
    ('招生高校及专业2026.json', extract_master_table),
]


def main():
    write = '--write' in sys.argv
    total_bad = 0
    for filename, extractor in SOURCES:
        extracted = extractor()
        existing = json.loads((DATA / filename).read_text(encoding='utf-8'))
        if filename == '专科专业可报本科专业对照.json':
            diffs = diff_mapping(extracted, existing)
        else:
            diffs = diff_rows(extracted, existing)
        expected = EXPECTED_COUNTS.get(filename)
        count_note = ''
        if expected is not None and len(extracted) != expected:
            count_note = f'  [行数异常: 抽取 {len(extracted)} != 官方 {expected}]'
            total_bad += 1
        label = '一致' if not diffs else f'{len(diffs)} 处差异'
        print(f'{filename}: 抽取 {len(extracted)} 条 / 现有 {len(existing)} 条 — {label}{count_note}')
        if len(extracted) != len(existing):
            total_bad += 1
        for i, key, va, vb in diffs[:5]:
            total_bad += 1
            print(f'   #{i} [{key}] PDF: {va!r}  |  现有: {vb!r}')
        if diffs:
            total_bad += 1
            if write:
                (DATA / filename).write_text(
                    json.dumps(extracted, ensure_ascii=False) + '\n', encoding='utf-8')
                print('   -> 已写回')
    print('结果：' + ('全部一致' if total_bad == 0 else f'共 {total_bad} 处异常/差异'))
    sys.exit(1 if total_bad and not write else 0)


if __name__ == '__main__':
    main()
