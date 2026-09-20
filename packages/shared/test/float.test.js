import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAX_FLOAT_DEFAULT,
  MAX_FLOAT_MAX,
  MAX_FLOAT_MIN,
  checkFloats,
  decodeText,
  findRowFloats,
} from '../dist/index.js';

const SYMBOLS = ['A', 'B', 'C'];

test('被同色针脚夹住的区间计为浮线，长度为跨过的其他针数', () => {
  // A A B B B A A：A 在第 2、6 列（1 基）之间夹住 3 针 B
  const spans = findRowFloats(['A', 'A', 'B', 'B', 'B', 'A', 'A'], 1);
  assert.deepEqual(spans, [
    { row: 1, symbol: 'A', startCol: 2, endCol: 6, length: 3 },
  ]);
});

test('行首/行尾的开放区间不计为浮线', () => {
  // 行首的 B 段与行尾的 A 段都是开放区间
  assert.deepEqual(findRowFloats(['B', 'B', 'B', 'A', 'A', 'A', 'A'], 1), []);
  assert.deepEqual(findRowFloats(['A', 'A', 'A', 'A', 'B', 'B', 'B'], 1), []);
  // B B A A B B：中间 A 段被两端的 B 夹住，计为 B 的浮线（跨 2 针）
  assert.deepEqual(findRowFloats(['B', 'B', 'A', 'A', 'B', 'B'], 1), [
    { row: 1, symbol: 'B', startCol: 2, endCol: 5, length: 2 },
  ]);
  // C C C A C C C：单个 A 被 C 夹住，浮线长 1
  assert.deepEqual(findRowFloats(['C', 'C', 'C', 'A', 'C', 'C', 'C'], 1), [
    { row: 1, symbol: 'C', startCol: 3, endCol: 5, length: 1 },
  ]);
});

test('相邻同色针脚（间隔 0）不产生浮线；全同色行与空行无浮线', () => {
  assert.deepEqual(findRowFloats(['A', 'A', 'A', 'A'], 1), []);
  assert.deepEqual(findRowFloats([], 1), []);
  // A B A：A 夹住 1 针 B
  assert.deepEqual(findRowFloats(['A', 'B', 'A'], 1), [
    { row: 1, symbol: 'A', startCol: 1, endCol: 3, length: 1 },
  ]);
});

test('超过阈值才计入风险：等于阈值不算超', () => {
  // A B B B B B B A：A 的浮线跨 6 针
  const grid = [['A', 'B', 'B', 'B', 'B', 'B', 'B', 'A']];
  assert.equal(checkFloats(grid, 5).risks.length, 1);
  assert.equal(checkFloats(grid, 3).risks.length, 1);
  // 恰好等于阈值 6：不超过，无风险
  const atThreshold = checkFloats(grid, 6);
  assert.equal(atThreshold.risks.length, 0);
  assert.equal(atThreshold.spans.length, 1); // 浮线区间本身仍被识别
  assert.equal(atThreshold.maxFloat, 6);
});

test('多种颜色交错时各自独立计算，按起始视觉列排序', () => {
  // A B C A B C：A/B/C 各夹住 2 针
  const spans = findRowFloats(['A', 'B', 'C', 'A', 'B', 'C'], 1);
  assert.deepEqual(spans, [
    { row: 1, symbol: 'A', startCol: 1, endCol: 4, length: 2 },
    { row: 1, symbol: 'B', startCol: 2, endCol: 5, length: 2 },
    { row: 1, symbol: 'C', startCol: 3, endCol: 6, length: 2 },
  ]);
});

test('整网检查按视觉坐标汇总：行 → 起始列 → 结束列', () => {
  const grid = [
    ['A', 'B', 'B', 'B', 'B', 'A'], // 行1：A 浮线 1–6 列，跨 4 针
    ['C', 'C', 'C', 'C', 'C', 'C'], // 行2：无
    ['B', 'A', 'B', 'B', 'B', 'B'], // 行3：B 浮线 1–3 列，跨 1 针
  ];
  const res = checkFloats(grid, 3);
  assert.deepEqual(res.spans, [
    { row: 1, symbol: 'A', startCol: 1, endCol: 6, length: 4 },
    { row: 3, symbol: 'B', startCol: 1, endCol: 3, length: 1 },
  ]);
  // 只有行 1 的 4 针浮线超过阈值 3
  assert.deepEqual(res.risks, [
    { row: 1, symbol: 'A', startCol: 1, endCol: 6, length: 4 },
  ]);
});

test('偶数行不镜像：风险位置始终是视觉坐标', () => {
  // 非对称图案：A 的浮线在第 1–5 列之间（视觉左侧）
  const row = ['A', 'B', 'B', 'B', 'A', 'A', 'A', 'A'];
  const grid = [
    [...row], // 行1（奇数 →）
    [...row], // 行2（偶数 ←，视觉坐标不得翻转）
  ];
  const res = checkFloats(grid, 2);
  assert.deepEqual(res.risks, [
    { row: 1, symbol: 'A', startCol: 1, endCol: 5, length: 3 },
    { row: 2, symbol: 'A', startCol: 1, endCol: 5, length: 3 },
  ]);
  // 若偶数行被镜像，行 2 的区间会变成第 4–8 列——明确否定
  assert.notDeepEqual(res.risks[1], {
    row: 2,
    symbol: 'A',
    startCol: 4,
    endCol: 8,
    length: 3,
  });
});

test('口令回写后的网格直接检查：偶数行 ← 解析与浮线视觉坐标一致', () => {
  // 02 ← A4 B3 A1：偶数行自右向左落针（A4 落在最右端）→ 视觉行为 A B B B A A A A
  const res = decodeText({
    text: '02 ← A4 B3 A1',
    width: 8,
    height: 2,
    fallback: [new Array(8).fill('C'), new Array(8).fill('C')],
    symbols: SYMBOLS,
  });
  assert.ok(res.ok);
  assert.deepEqual(res.grid[1], ['A', 'B', 'B', 'B', 'A', 'A', 'A', 'A']);
  // 视觉第 1 列与第 5 列的 A 夹住 3 针 B——位置不随偶数行镜像
  const floats = checkFloats(res.grid, 2);
  assert.deepEqual(floats.risks, [
    { row: 2, symbol: 'A', startCol: 1, endCol: 5, length: 3 },
  ]);
});

test('阈值常量：可选范围 3–12，默认 5', () => {
  assert.equal(MAX_FLOAT_MIN, 3);
  assert.equal(MAX_FLOAT_MAX, 12);
  assert.equal(MAX_FLOAT_DEFAULT, 5);
});
