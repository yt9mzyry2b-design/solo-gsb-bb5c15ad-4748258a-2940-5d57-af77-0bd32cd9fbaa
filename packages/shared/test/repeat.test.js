import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  REPEAT_PREVIEW_TILES,
  buildTiledPreview,
  findMinRepeatUnit,
  isRepeatUnit,
  shiftUnit,
} from '../dist/index.js';

/** 用 unit 按 (行数, 列数) 平铺生成整幅网格（不要求整除） */
function tile(unit, rows, cols) {
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => unit[r % unit.length][c % unit[0].length]),
  );
}

test('全同色网格的最小单元为 1×1，压缩比 = 总格数', () => {
  const grid = tile([['A']], 6, 9);
  const res = findMinRepeatUnit(grid);
  assert.equal(res.unitRows, 1);
  assert.equal(res.unitCols, 1);
  assert.equal(res.unitArea, 1);
  assert.deepEqual(res.cells, [['A']]);
  assert.equal(res.totalCells, 54);
  assert.equal(res.ratio, 54);
});

test('水平周期不整除行宽：1×7 的 ABCABCA 最小单元为 1×3', () => {
  const grid = tile([['A', 'B', 'C']], 1, 7); // A B C A B C A
  assert.equal(grid[0].join(''), 'ABCABCA');
  const res = findMinRepeatUnit(grid);
  assert.equal(res.unitRows, 1);
  assert.equal(res.unitCols, 3);
  assert.deepEqual(res.cells, [['A', 'B', 'C']]);
  assert.equal(res.totalCells, 7);
  assert.ok(Math.abs(res.ratio - 7 / 3) < 1e-9);
});

test('垂直周期不整除行数：逐格验证拒绝“只比较首块”的误判', () => {
  // 行序列 A B A B C：前 4 行看似周期 2，但第 5 行破坏周期
  const grid = [['A'], ['B'], ['A'], ['B'], ['C']];
  // 若只比较完整首块（行0-1 vs 行2-3）会误判 2×1；按单元内坐标映射逐格验证必须拒绝
  assert.equal(isRepeatUnit(grid, 2, 1), false);
  assert.equal(isRepeatUnit(grid, 5, 1), true);
  const res = findMinRepeatUnit(grid);
  assert.equal(res.unitRows, 5);
  assert.equal(res.unitCols, 1);
  assert.equal(res.ratio, 1);
});

test('二维周期均不整除：5×7 网格的最小单元为 2×3', () => {
  const unit = [
    ['A', 'B', 'C'],
    ['B', 'C', 'A'],
  ];
  const grid = tile(unit, 5, 7);
  const res = findMinRepeatUnit(grid);
  assert.equal(res.unitRows, 2);
  assert.equal(res.unitCols, 3);
  assert.equal(res.unitArea, 6);
  assert.deepEqual(res.cells, unit);
  assert.equal(res.totalCells, 35);
  assert.ok(Math.abs(res.ratio - 35 / 6) < 1e-9);
});

test('决胜顺序：面积优先，其次行数、列数（棋盘格取 2×2 而非更大候选）', () => {
  // 2×2 棋盘平铺到 6×6：(2,2) 面积 4 优于 (2,4)/(4,2)/(4,4) 等候选
  const grid = tile(
    [
      ['A', 'B'],
      ['B', 'A'],
    ],
    6,
    6,
  );
  const res = findMinRepeatUnit(grid);
  assert.deepEqual([res.unitRows, res.unitCols], [2, 2]);
});

test('决胜顺序：所有行相同时取 1×k（行数升序优先于列数）', () => {
  // 每行都是 A B A B（水平周期 2），垂直周期 1 → 1×2 而非 2×2
  const grid = tile([['A', 'B']], 3, 4);
  const res = findMinRepeatUnit(grid);
  assert.deepEqual([res.unitRows, res.unitCols], [1, 2]);
});

test('无重复的网格：最小单元即整幅', () => {
  const grid = [
    ['A', 'B', 'C'],
    ['B', 'C', 'A'],
    ['C', 'A', 'A'],
  ];
  const res = findMinRepeatUnit(grid);
  assert.deepEqual([res.unitRows, res.unitCols], [3, 3]);
  assert.equal(res.ratio, 1);
});

test('isRepeatUnit：越界候选直接拒绝', () => {
  const grid = tile([['A', 'B']], 2, 4);
  assert.equal(isRepeatUnit(grid, 0, 1), false);
  assert.equal(isRepeatUnit(grid, 3, 1), false); // 超过行数
  assert.equal(isRepeatUnit(grid, 1, 5), false); // 超过行宽
  assert.equal(isRepeatUnit(grid, 1, 2), true);
});

test('shiftUnit：视觉坐标相位平移，不镜像', () => {
  const unit = [
    ['A', 'B', 'C'],
    ['B', 'C', 'A'],
  ];
  // 零偏移恒等
  assert.deepEqual(shiftUnit(unit, 0, 0), unit);
  // 行偏移 1：第 0 行变为原第 1 行（平移而非翻转）
  assert.deepEqual(shiftUnit(unit, 1, 0), [
    ['B', 'C', 'A'],
    ['A', 'B', 'C'],
  ]);
  // 列偏移 2：循环左移 2 列
  assert.deepEqual(shiftUnit(unit, 0, 2), [
    ['C', 'A', 'B'],
    ['A', 'B', 'C'],
  ]);
  // 偏移量取模：行偏移 = 行数时回到原位
  assert.deepEqual(shiftUnit(unit, 2, 3), unit);
});

test('buildTiledPreview：3×3 平铺，中心块等于偏移后的单元', () => {
  const unit = [
    ['A', 'B'],
    ['B', 'C'],
  ];
  const preview = buildTiledPreview(unit, 1, 1);
  assert.equal(preview.length, 6);
  assert.equal(preview[0].length, 6);
  const shifted = shiftUnit(unit, 1, 1);
  // 中心块（第 2 块，0 基索引从 (2,2) 开始）等于偏移后的单元
  for (let i = 0; i < 2; i += 1) {
    for (let j = 0; j < 2; j += 1) {
      assert.equal(preview[2 + i][2 + j], shifted[i][j]);
    }
  }
  // 平铺一致性：相邻块完全相同
  for (let r = 0; r < 4; r += 1) {
    for (let c = 0; c < 4; c += 1) {
      assert.equal(preview[r][c], preview[r + 2][c]);
      assert.equal(preview[r][c], preview[r][c + 2]);
    }
  }
  assert.equal(REPEAT_PREVIEW_TILES, 3);
});

test('偏移后的单元仍是同一网格的合法周期相位（偶数行不镜像）', () => {
  // 非对称 2×3 单元平铺到 5×7；偏移相位仅平移，逐格验证仍按视觉坐标
  const unit = [
    ['A', 'B', 'A'],
    ['B', 'A', 'C'],
  ];
  const grid = tile(unit, 5, 7);
  const res = findMinRepeatUnit(grid);
  assert.deepEqual([res.unitRows, res.unitCols], [2, 3]);
  // 偏移 (1,2) 后：平铺预览的第 0 行第 0 格 = 原单元 (1,2) = 'C'，
  // 若被镜像则会取到对称位置的 'A'——明确否定
  const preview = buildTiledPreview(res.cells, 1, 2);
  assert.equal(preview[0][0], 'C');
  assert.notEqual(preview[0][0], grid[0][0]);
});

test('空网格防御：返回零尺寸结果', () => {
  const res = findMinRepeatUnit([]);
  assert.equal(res.unitRows, 0);
  assert.equal(res.unitCols, 0);
  assert.equal(res.totalCells, 0);
});
