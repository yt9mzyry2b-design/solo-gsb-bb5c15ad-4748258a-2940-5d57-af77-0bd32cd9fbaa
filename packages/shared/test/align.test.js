import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ALIGN_MAX_SHIFT_LIMIT,
  compareAlignments,
  compareCandidate,
  encodeGrid,
  searchBestAlignment,
} from '../dist/index.js';

const SYMBOLS = ['A', 'B', 'C'];

// 8 列 × 4 行基准网格（与 diff.test.js 相同）
const GRID = [
  ['A', 'A', 'A', 'A', 'A', 'A', 'A', 'A'], // 行1 →
  ['B', 'B', 'A', 'A', 'A', 'A', 'B', 'B'], // 行2 ←
  ['A', 'A', 'A', 'B', 'B', 'C', 'C', 'A'], // 行3 →
  ['A', 'A', 'A', 'B', 'B', 'C', 'C', 'A'], // 行4 ←
];

/** 视觉坐标循环平移：out[r][c] = grid[r-dr][c-dc]（取模），正 dr 向下、正 dc 向右 */
function shiftGrid(grid, dr, dc) {
  const h = grid.length;
  const w = grid[0].length;
  const mod = (a, n) => ((a % n) + n) % n;
  return Array.from({ length: h }, (_, r) =>
    Array.from({ length: w }, (_, c) => grid[mod(r - dr, h)][mod(c - dc, w)]),
  );
}

function search(text, grid, width, height, maxShift = 3) {
  return searchBestAlignment({
    text,
    width,
    height,
    grid,
    symbols: SYMBOLS,
    maxShift,
  });
}

test('候选为网格循环平移后的口令：搜索找回偏移，差异归零', () => {
  // 候选图案 = 网格向下 1 行、向右 2 列循环平移 → 对齐需 dr=-1, dc=-2
  const shifted = shiftGrid(GRID, 1, 2);
  const text = encodeGrid({ grid: shifted, width: 8, height: 4 }).text;
  const res = search(text, GRID, 8, 4);
  assert.equal(res.scoredRows, 4);
  assert.equal(res.evaluated, 49); // (2·3+1)²
  assert.ok(res.originalDiffs > 0);
  assert.deepEqual(
    { dr: res.best.dr, dc: res.best.dc, diffs: res.best.diffs },
    { dr: -1, dc: -2, diffs: 0 },
  );
  assert.equal(res.improved, true);

  // 用最佳偏移对版：零差异、全部行一致
  const aligned = compareCandidate({
    text,
    width: 8,
    height: 4,
    grid: GRID,
    symbols: SYMBOLS,
    offset: { dr: res.best.dr, dc: res.best.dc },
  });
  assert.equal(aligned.cells.length, 0);
  assert.deepEqual(
    aligned.rows.map((r) => r.status),
    ['same', 'same', 'same', 'same'],
  );
  assert.deepEqual(aligned.offset, { dr: -1, dc: -2 });
});

test('针数错误与缺失行不参与评分：合法行对齐即可归零', () => {
  const grid = [
    ['A', 'B', 'B', 'A'], // 行1
    ['A', 'A', 'A', 'A'], // 行2
    ['A', 'A', 'A', 'B'], // 行3
  ];
  // 行1 针数错误（9≠4）；行2 合法（偶数行 ←：B1 A3 → 视觉 A A A B）；行3 无候选
  const text = ['B9', 'B1 A3'].join('\n');
  const res = search(text, grid, 4, 3, 2);
  assert.equal(res.scoredRows, 1); // 只有行2参与评分
  // 候选行2 与网格行3 相同：dr=+1 时差异归零
  assert.deepEqual(
    { dr: res.best.dr, dc: res.best.dc, diffs: res.best.diffs },
    { dr: 1, dc: 0, diffs: 0 },
  );
  assert.equal(res.originalDiffs, 1); // 原始位置：候选行2 对网格行2 差 1 格
  assert.equal(res.improved, true);

  // 平移后非法/缺失标记随候选层一起循环移动
  const aligned = compareCandidate({
    text,
    width: 4,
    height: 3,
    grid,
    symbols: SYMBOLS,
    offset: { dr: 1, dc: 0 },
  });
  assert.deepEqual(
    aligned.rows.map((r) => r.status),
    ['missing', 'invalid', 'same'],
  );
  assert.equal(aligned.cells.length, 0);
});

test('同分决胜：曼哈顿距离相同、绝对值相同，按带符号行偏移取负者', () => {
  // 网格行1/行3 相同（B A），候选只有行2（B A）：
  // dr=+1 与 dr=-1 同为 0 差异，决胜应取 dr=-1
  const grid = [
    ['B', 'A'],
    ['A', 'A'],
    ['B', 'A'],
  ];
  const text = '\nA1 B1\n'; // 行2（偶数行 ←）：A1 B1 → 视觉 B A
  const res = search(text, grid, 2, 3, 1);
  assert.equal(res.scoredRows, 1);
  assert.equal(res.originalDiffs, 1);
  assert.deepEqual(
    { dr: res.best.dr, dc: res.best.dc, diffs: res.best.diffs },
    { dr: -1, dc: 0, diffs: 0 },
  );
});

test('compareAlignments：按差异数 → 曼哈顿 → |dr| → |dc| → 带符号 dr → 带符号 dc 决胜', () => {
  const c = compareAlignments;
  // 差异格总数优先
  assert.ok(c({ dr: 0, dc: 0, diffs: 4 }, { dr: 3, dc: 3, diffs: 5 }) < 0);
  // 同分：曼哈顿距离小者优先
  assert.ok(c({ dr: 0, dc: 1, diffs: 3 }, { dr: 2, dc: 0, diffs: 3 }) < 0);
  // 曼哈顿相同：行偏移绝对值小者优先
  assert.ok(c({ dr: 1, dc: 2, diffs: 3 }, { dr: 2, dc: 1, diffs: 3 }) < 0);
  // |dr| 也相同：带符号行偏移小者（负）优先
  assert.ok(c({ dr: -1, dc: 0, diffs: 3 }, { dr: 1, dc: 0, diffs: 3 }) < 0);
  // 带符号 dr 也相同：带符号列偏移小者（负）优先
  assert.ok(c({ dr: 0, dc: -2, diffs: 3 }, { dr: 0, dc: 2, diffs: 3 }) < 0);
  // 全序：同一候选相等；完全相反偏移可比较
  assert.equal(c({ dr: 1, dc: -2, diffs: 3 }, { dr: 1, dc: -2, diffs: 3 }), 0);
  assert.notEqual(c({ dr: 1, dc: 2, diffs: 3 }, { dr: -1, dc: -2, diffs: 3 }), 0);
});

test('列偏移循环回绕：候选右移 1 列，dc=+1 对齐后零差异', () => {
  const grid = [
    ['B', 'A', 'A', 'A'],
    ['A', 'A', 'A', 'A'],
  ];
  // 候选行1 = A A A B（网格行1 向右循环 1 列）；行2 相同
  const text = ['A3 B1', 'A4'].join('\n');
  const res = search(text, grid, 4, 2, 1);
  assert.deepEqual(
    { dr: res.best.dr, dc: res.best.dc, diffs: res.best.diffs },
    { dr: 0, dc: 1, diffs: 0 },
  );
  const aligned = compareCandidate({
    text,
    width: 4,
    height: 2,
    grid,
    symbols: SYMBOLS,
    offset: { dr: 0, dc: 1 },
  });
  assert.equal(aligned.cells.length, 0);
});

test('maxShift=0 只评估原始位置；maxShift 超出上限被钳制', () => {
  const text = encodeGrid({ grid: shiftGrid(GRID, 0, 1), width: 8, height: 4 }).text;
  const zero = search(text, GRID, 8, 4, 0);
  assert.equal(zero.evaluated, 1);
  assert.deepEqual(
    { dr: zero.best.dr, dc: zero.best.dc },
    { dr: 0, dc: 0 },
  );
  assert.equal(zero.best.diffs, zero.originalDiffs);
  assert.equal(zero.improved, false);

  const clamped = search(text, GRID, 8, 4, 99);
  assert.equal(clamped.maxShift, ALIGN_MAX_SHIFT_LIMIT);
  assert.equal(clamped.evaluated, (2 * ALIGN_MAX_SHIFT_LIMIT + 1) ** 2);
});

test('没有可比较候选行：评分行数为 0，最佳即原始位置', () => {
  const res = search('', GRID, 8, 4, 3);
  assert.equal(res.scoredRows, 0);
  assert.equal(res.originalDiffs, 0);
  assert.deepEqual(
    { dr: res.best.dr, dc: res.best.dc, diffs: res.best.diffs },
    { dr: 0, dc: 0, diffs: 0 },
  );
  assert.equal(res.improved, false);

  // 全部行针数错误同样不参与评分
  const bad = search('B9\nB9\nB9\nB9', GRID, 8, 4, 3);
  assert.equal(bad.scoredRows, 0);
  assert.equal(bad.best.diffs, 0);
});

test('对版缺省偏移为 0,0；搜索结果与对版差异数一致', () => {
  const shifted = shiftGrid(GRID, 1, 2);
  const text = encodeGrid({ grid: shifted, width: 8, height: 4 }).text;

  const plain = compareCandidate({
    text,
    width: 8,
    height: 4,
    grid: GRID,
    symbols: SYMBOLS,
  });
  assert.deepEqual(plain.offset, { dr: 0, dc: 0 });

  const res = search(text, GRID, 8, 4);
  const total = (r) => r.totals.added + r.totals.missing + r.totals.replaced;
  assert.equal(total(plain), res.originalDiffs);

  const aligned = compareCandidate({
    text,
    width: 8,
    height: 4,
    grid: GRID,
    symbols: SYMBOLS,
    offset: { dr: res.best.dr, dc: res.best.dc },
  });
  assert.equal(total(aligned), res.best.diffs);
});
