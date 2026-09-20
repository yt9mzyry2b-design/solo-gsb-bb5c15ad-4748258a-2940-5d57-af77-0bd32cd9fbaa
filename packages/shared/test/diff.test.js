import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareCandidate } from '../dist/index.js';

const SYMBOLS = ['A', 'B', 'C'];

// 8 列 × 4 行基准网格
const GRID = [
  ['A', 'A', 'A', 'A', 'A', 'A', 'A', 'A'], // 行1 →
  ['B', 'B', 'A', 'A', 'A', 'A', 'B', 'B'], // 行2 ←
  ['A', 'A', 'A', 'B', 'B', 'C', 'C', 'A'], // 行3 →
  ['A', 'A', 'A', 'B', 'B', 'C', 'C', 'A'], // 行4 ←
];

function compare(text, grid = GRID, width = 8, height = 4) {
  return compareCandidate({ text, width, height, grid, symbols: SYMBOLS });
}

test('以 A 为底色分类：新增 / 缺失 / 替换，逐格视觉坐标定位', () => {
  // 行1：A8 → 候选 B2 A4 B2：第 1、2、7、8 列为新增
  // 行3：A3 B2 C2 A1 → 候选 A3 C2 B2 A1：第 4、5 列 B→C、第 6、7 列 C→B 均为替换
  const res = compare(['B2 A4 B2', 'B2 A4 B2', 'A3 C2 B2 A1', 'A1 C2 B2 A3'].join('\n'));
  const row1 = res.rows[0];
  assert.equal(row1.status, 'diff');
  assert.deepEqual(
    { added: row1.added, missing: row1.missing, replaced: row1.replaced },
    { added: 4, missing: 0, replaced: 0 },
  );
  assert.equal(row1.firstDiffCol, 1);
  const row3 = res.rows[2];
  assert.deepEqual(
    { added: row3.added, missing: row3.missing, replaced: row3.replaced },
    { added: 0, missing: 0, replaced: 4 },
  );
  assert.equal(row3.firstDiffCol, 4);
  // 差异格内容
  const c1 = res.cells.filter((c) => c.row === 1);
  assert.deepEqual(
    c1.map((c) => [c.col, c.kind, c.gridSymbol, c.candidateSymbol]),
    [
      [1, 'added', 'A', 'B'],
      [2, 'added', 'A', 'B'],
      [7, 'added', 'A', 'B'],
      [8, 'added', 'A', 'B'],
    ],
  );
  // 缺失：候选回到底色 A，当前网格有纹样
  const res2 = compare(['A8', 'A8', 'A8', 'A8'].join('\n'));
  const r2 = res2.rows[1];
  assert.deepEqual(
    { added: r2.added, missing: r2.missing, replaced: r2.replaced },
    { added: 0, missing: 4, replaced: 0 },
  );
  assert.deepEqual(
    res2.cells.filter((c) => c.row === 2).map((c) => c.col),
    [1, 2, 7, 8],
  );
});

test('偶数行仍按 ← 解码，差异列号为视觉坐标、绝不镜像', () => {
  // 行2（偶数行 ←）视觉：B B A A A A B B
  // 候选口令 C2 A4 B2 自右向左落针 → 视觉：B B A A A A C C
  // 差异应在视觉第 7、8 列（若被镜像会错报为第 1、2 列）
  const res = compare(['A8', 'C2 A4 B2', 'A3 B2 C2 A1', 'A1 C2 B2 A3'].join('\n'));
  const row2 = res.rows[1];
  assert.equal(row2.status, 'diff');
  assert.equal(row2.firstDiffCol, 7);
  assert.deepEqual(
    res.cells
      .filter((c) => c.row === 2)
      .map((c) => [c.col, c.kind, c.gridSymbol, c.candidateSymbol]),
    [
      [7, 'replaced', 'B', 'C'],
      [8, 'replaced', 'B', 'C'],
    ],
  );
});

test('完全一致的候选：全部行 same，无差异格', () => {
  const res = compare(['A8', 'B2 A4 B2', 'A3 B2 C2 A1', 'A1 C2 B2 A3'].join('\n'));
  assert.equal(res.cells.length, 0);
  assert.deepEqual(
    res.rows.map((r) => r.status),
    ['same', 'same', 'same', 'same'],
  );
  assert.equal(res.comparableRows, 4);
  assert.deepEqual(res.totals, { added: 0, missing: 0, replaced: 0 });
});

test('针数错误的候选行不可比较，部分落针结果绝不参与差异', () => {
  // 行2 候选 9 针（多 1 针）；行3 候选 5 针（少 3 针）
  const res = compare(['A8', 'B2 A4 B3', 'A3 B2', 'A1 C2 B2 A3'].join('\n'));
  assert.equal(res.rows[1].status, 'invalid');
  assert.match(res.rows[1].reason, /针数不符/);
  assert.equal(res.rows[2].status, 'invalid');
  // 不可比较行不产生任何差异格
  assert.equal(res.cells.some((c) => c.row === 2 || c.row === 3), false);
  assert.equal(res.comparableRows, 2);
  // 其余行照常比较
  assert.equal(res.rows[0].status, 'same');
  assert.equal(res.rows[3].status, 'same');
});

test('无法解析与未启用符号的候选行不可比较', () => {
  const res = compare(['A8', 'B? A4 B2', 'A3 X2 C2 A1', 'A1 C2 B2 A3'].join('\n'));
  assert.equal(res.rows[1].status, 'invalid');
  assert.equal(res.rows[2].status, 'invalid');
  assert.equal(res.cells.length, 0);
  assert.deepEqual(
    res.issues.map((i) => i.code).sort(),
    ['BAD_TOKEN', 'UNKNOWN_SYMBOL'],
  );
});

test('没有候选口令的行不可比较；空文本时全部行 missing', () => {
  const res = compare('A8\n\nA3 B2 C2 A1');
  assert.deepEqual(
    res.rows.map((r) => r.status),
    ['same', 'missing', 'same', 'missing'],
  );
  assert.equal(res.rows[1].reason != null, true);
  assert.equal(res.comparableRows, 2);

  const empty = compare('');
  assert.deepEqual(
    empty.rows.map((r) => r.status),
    ['missing', 'missing', 'missing', 'missing'],
  );
  assert.equal(empty.comparableRows, 0);
});

test('显式行号参与对版；对版绝不回写当前网格', () => {
  const grid = GRID.map((r) => [...r]);
  const snapshot = JSON.stringify(grid);
  // 候选只给第 2 行（显式行号），且与网格不同
  const res = compareCandidate({
    text: '02 ← C2 A4 C2',
    width: 8,
    height: 4,
    grid,
    symbols: SYMBOLS,
  });
  assert.equal(res.rows[1].status, 'diff');
  assert.deepEqual(
    res.cells
      .filter((c) => c.row === 2)
      .map((c) => [c.col, c.kind]),
    [
      [1, 'replaced'],
      [2, 'replaced'],
      [7, 'replaced'],
      [8, 'replaced'],
    ],
  );
  assert.deepEqual(
    res.rows.map((r) => r.status),
    ['missing', 'diff', 'missing', 'missing'],
  );
  // 网格原样未动
  assert.equal(JSON.stringify(grid), snapshot);
});

test('行号冲突的候选行以先到者为准参与对版，冲突本身计入 issues', () => {
  const res = compare(['A8', '02 ← B2 A4 B2', '02 ← C8', 'A1 C2 B2 A3'].join('\n'));
  // 第 2 行用第一条候选（与网格一致）
  assert.equal(res.rows[1].status, 'same');
  assert.deepEqual(
    res.issues.map((i) => i.code),
    ['DUPLICATE_ROW'],
  );
});

test('差异格按视觉坐标排序，totals 为全图合计', () => {
  const res = compare(['B1 A6 B1', 'C2 A4 C2', 'A8', 'A1 C2 B2 A3'].join('\n'));
  // 行1：新增 2（第 1、8 列）；行2：替换 4；行3：缺失 4
  assert.deepEqual(res.totals, { added: 2, missing: 4, replaced: 4 });
  const keys = res.cells.map((c) => `${c.row}:${c.col}`);
  const sorted = [...keys].sort((a, b) => {
    const [ra, ca] = a.split(':').map(Number);
    const [rb, cb] = b.split(':').map(Number);
    return ra - rb || ca - cb;
  });
  assert.deepEqual(keys, sorted);
});
