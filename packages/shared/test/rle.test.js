import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeText, encodeGrid } from '../dist/index.js';

const SYMBOLS = ['A', 'B', 'C'];
// 8 列 × 4 行示例网格
const GRID = [
  ['B', 'B', 'A', 'A', 'A', 'A', 'B', 'B'], // 行1 →
  ['B', 'B', 'A', 'A', 'A', 'A', 'B', 'B'], // 行2 ←（对称）
  ['A', 'A', 'A', 'B', 'B', 'C', 'C', 'A'], // 行3 →
  ['A', 'A', 'A', 'B', 'B', 'C', 'C', 'A'], // 行4 ←（非对称，关键）
];

test('奇数行按 → 编码，偶数行按 ← 读取但视觉坐标不镜像', () => {
  const { lines } = encodeGrid({ grid: GRID, width: 8, height: 4 });
  assert.deepEqual(
    lines[0].runs,
    [
      { symbol: 'B', count: 2 },
      { symbol: 'A', count: 4 },
      { symbol: 'B', count: 2 },
    ],
  );
  // 第 4 行视觉为 A A A B B C C A；自右向左读应为 A1 C2 B2 A3
  assert.deepEqual(
    lines[3].runs,
    [
      { symbol: 'A', count: 1 },
      { symbol: 'C', count: 2 },
      { symbol: 'B', count: 2 },
      { symbol: 'A', count: 3 },
    ],
  );
  assert.equal(lines[3].canonical, '04 ← A1 C2 B2 A3');
});

test('编码 → 解码完整往返，网格逐格一致（偶数行不翻转）', () => {
  const { text } = encodeGrid({ grid: GRID, width: 8, height: 4 });
  const res = decodeText({
    text,
    width: 8,
    height: 4,
    fallback: GRID.map((r) => r.map(() => 'A')),
    symbols: SYMBOLS,
  });
  assert.ok(res.ok, res.issues.map((i) => i.message).join('; '));
  assert.deepEqual(res.grid, GRID);
  // 明确验证第 4 行左侧仍是 A（若被镜像会变成 A C C B B A A A）
  assert.deepEqual(res.grid[3], GRID[3]);
});

test('针数多于行宽：保留原图并定位溢出，其他合法行照常回写', () => {
  const text = ['01 → A8', '02 ← A3 B6' /* 9 针 */].join('\n');
  const fallback = GRID.slice(0, 2);
  const res = decodeText({
    text,
    width: 8,
    height: 2,
    fallback,
    symbols: SYMBOLS,
  });
  assert.equal(res.ok, false);
  assert.deepEqual(res.appliedRows, [1]);
  assert.deepEqual(res.grid[0], new Array(8).fill('A'));
  // 第 2 行原样保留
  assert.deepEqual(res.grid[1], GRID[1]);
  const issue = res.issues.find((i) => i.code === 'COUNT_MISMATCH');
  assert.ok(issue);
  assert.equal(issue.row, 2);
  assert.equal(issue.actualCount, 9);
});

test('针数少于行宽：偶数行缺口定位在视觉左侧', () => {
  const res = decodeText({
    text: ['A8', 'A2 B3' /* 第二行 5 针，偶数行 ←，缺 3 针应在左侧 */].join(
      '\n',
    ),
    width: 8,
    height: 2,
    fallback: GRID.slice(0, 2),
    symbols: SYMBOLS,
  });
  assert.equal(res.issues.length, 1);
  assert.equal(res.issues[0].code, 'COUNT_MISMATCH');
  assert.equal(res.issues[0].row, 2);
  assert.match(res.issues[0].message, /左侧第 1–3 列/);
  // 合法的第 1 行正常回写；针数错误的第 2 行保留原图
  assert.deepEqual(res.grid[0], new Array(8).fill('A'));
  assert.deepEqual(res.grid[1], GRID[1]);
});

test('无行号文本按物理行顺序对应；错误片段与未知符号被拒绝', () => {
  const res = decodeText({
    text: ['A8', 'A4 X4' /* 未知符号 */, 'A8', 'B?' /* 坏片段 */].join('\n'),
    width: 8,
    height: 4,
    fallback: GRID,
    symbols: SYMBOLS,
  });
  assert.equal(res.appliedRows.length, 2);
  assert.deepEqual(res.appliedRows, [1, 3]);
  const codes = res.issues.map((i) => i.code).sort();
  assert.deepEqual(codes, ['BAD_TOKEN', 'UNKNOWN_SYMBOL']);
  assert.deepEqual(res.grid[1], GRID[1]);
  assert.deepEqual(res.grid[3], GRID[3]);
});

test('显式行号越界报错，忽略行上的合法文本不回写', () => {
  const res = decodeText({
    text: ['A8', '02 ← B8', '99 → A8' /* 越界 */].join('\n'),
    width: 8,
    height: 3,
    fallback: GRID.slice(0, 3),
    symbols: SYMBOLS,
  });
  assert.deepEqual(
    res.issues.map((i) => i.code),
    ['ROW_OUT_OF_RANGE'],
  );
  assert.deepEqual(res.appliedRows, [1, 2]);
});

test('重复显式行号与显式/隐式撞行均报冲突，冲突行保留原图', () => {
  const res = decodeText({
    text: [
      'A8',
      '02 ← B8',
      '02 ← A8' /* 重复显式行号 */,
      '01 → B8' /* 与第 1 条隐式行撞行 */,
    ].join('\n'),
    width: 8,
    height: 3,
    fallback: GRID.slice(0, 3),
    symbols: SYMBOLS,
  });
  assert.deepEqual(
    res.issues.map((i) => `${i.code}@${i.line}`),
    ['DUPLICATE_ROW@3', 'DUPLICATE_ROW@4'],
  );
  assert.deepEqual(res.appliedRows, [1, 2]);
  // 被撞的两行以先到者为准
  assert.deepEqual(res.grid[0], new Array(8).fill('A'));
  assert.deepEqual(res.grid[1], new Array(8).fill('B'));
});

test('显式行重排后，无行号文本仍按物理行号对应，不顺延不跳行', () => {
  // 第 1 条口令显式指向第 3 行；第 2 条无行号，对应图案第 2 行（而非顺延到第 1 行）
  const res = decodeText({
    text: ['03 C8', 'B8'].join('\n'),
    width: 8,
    height: 3,
    fallback: GRID.slice(0, 3),
    symbols: SYMBOLS,
  });
  assert.deepEqual(res.appliedRows, [3, 2]);
  assert.deepEqual(res.grid[2], new Array(8).fill('C'));
  assert.deepEqual(res.grid[1], new Array(8).fill('B'));
  // 第 1 行无任何口令，保留原图
  assert.deepEqual(res.grid[0], GRID[0]);
});

test('无分隔符的相邻游程（A2B4A2）可解析；含杂质整段拒绝', () => {
  const ok = decodeText({
    text: 'A2B4A2',
    width: 8,
    height: 1,
    fallback: [new Array(8).fill('Z')],
    symbols: SYMBOLS,
  });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.grid[0], ['A', 'A', 'B', 'B', 'B', 'B', 'A', 'A']);

  const bad = decodeText({
    text: 'A2B?4',
    width: 8,
    height: 1,
    fallback: [new Array(8).fill('Z')],
    symbols: SYMBOLS,
  });
  assert.equal(bad.ok, false);
  assert.equal(bad.issues[0].code, 'BAD_TOKEN');
  assert.deepEqual(bad.grid[0], new Array(8).fill('Z'));
});
