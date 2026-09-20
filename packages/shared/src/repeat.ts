import type { RepeatResult } from './types.js';

/**
 * 循环花版：在视觉坐标网格上搜索可平铺生成整幅图案的最小二维重复单元。
 *
 * 与浮线检查一致，本模块完全基于视觉坐标——奇偶行只影响口令阅读顺序，
 * 重复单元、偏移相位与平铺预览绝不随偶数行镜像。
 */

/** 平铺预览的单元重复次数（tiles × tiles） */
export const REPEAT_PREVIEW_TILES = 3;

/** 正取模（防御负偏移） */
function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

/**
 * 逐格验证 (rows, cols) 是否为网格的二维重复单元：
 * 每个格子 (r, c) 映射到单元内坐标 (r mod rows, c mod cols)，
 * 与锚定在网格左上角的单元内容逐格比对。
 *
 * 候选周期不要求整除行数或行宽——边界处的残缺单元同样逐格参与校验，
 * 避免“只比较首个完整块”造成的误判（例如行数 5、周期 2 时漏检第 5 行）。
 */
export function isRepeatUnit(
  grid: string[][],
  rows: number,
  cols: number,
): boolean {
  const height = grid.length;
  const width = grid[0]?.length ?? 0;
  if (rows < 1 || cols < 1 || rows > height || cols > width) return false;
  for (let r = 0; r < height; r += 1) {
    const unitRow = grid[r % rows];
    const thisRow = grid[r];
    const cc = cols;
    for (let c = 0; c < width; c += 1) {
      if (thisRow[c] !== unitRow[c % cc]) return false;
    }
  }
  return true;
}

/** ph 是否为垂直周期：所有在界内的 grid[r][c] === grid[r+ph][c] */
function isVerticalPeriod(grid: string[][], ph: number): boolean {
  for (let r = 0; r + ph < grid.length; r += 1) {
    const a = grid[r];
    const b = grid[r + ph];
    for (let c = 0; c < a.length; c += 1) {
      if (a[c] !== b[c]) return false;
    }
  }
  return true;
}

/** pw 是否为水平周期：所有在界内的 grid[r][c] === grid[r][c+pw] */
function isHorizontalPeriod(grid: string[][], pw: number): boolean {
  for (let r = 0; r < grid.length; r += 1) {
    const row = grid[r];
    for (let c = 0; c + pw < row.length; c += 1) {
      if (row[c] !== row[c + pw]) return false;
    }
  }
  return true;
}

function toResult(grid: string[][], unitRows: number, unitCols: number): RepeatResult {
  const gridRows = grid.length;
  const gridCols = grid[0]?.length ?? 0;
  const cells: string[][] = [];
  for (let r = 0; r < unitRows; r += 1) {
    cells.push(grid[r].slice(0, unitCols));
  }
  const unitArea = unitRows * unitCols;
  const totalCells = gridRows * gridCols;
  return {
    unitRows,
    unitCols,
    unitArea,
    cells,
    gridRows,
    gridCols,
    totalCells,
    ratio: unitArea === 0 ? 1 : totalCells / unitArea,
  };
}

/**
 * 搜索最小二维重复单元。
 *
 * 候选为 (单元行数 ph, 单元列数 pw)，1 ≤ ph ≤ 行数、1 ≤ pw ≤ 行宽，
 * 不要求整除；按 面积 → 行数 → 列数 升序枚举，第一个通过
 * {@link isRepeatUnit} 逐格验证的候选即为所求。
 *
 * 实现上利用“二维周期 ⟺ 垂直周期 × 水平周期”的等价性先筛出
 * 垂直/水平周期全集，再按上述顺序合并枚举，最后仍用单元内坐标
 * 映射逐格确认，保证返回结果与朴素全量枚举完全一致。
 */
export function findMinRepeatUnit(grid: string[][]): RepeatResult {
  const height = grid.length;
  const width = grid[0]?.length ?? 0;
  if (height === 0 || width === 0) {
    return {
      unitRows: 0,
      unitCols: 0,
      unitArea: 0,
      cells: [],
      gridRows: height,
      gridCols: width,
      totalCells: 0,
      ratio: 1,
    };
  }

  const vPeriods: number[] = [];
  for (let ph = 1; ph <= height; ph += 1) {
    if (isVerticalPeriod(grid, ph)) vPeriods.push(ph);
  }
  const hPeriods: number[] = [];
  for (let pw = 1; pw <= width; pw += 1) {
    if (isHorizontalPeriod(grid, pw)) hPeriods.push(pw);
  }

  let best: RepeatResult | null = null;
  for (const ph of vPeriods) {
    for (const pw of hPeriods) {
      const area = ph * pw;
      if (
        best !== null &&
        (area > best.unitArea ||
          // 同面积时行数小者优先；行数相同则列数必然相同（同一候选）
          (area === best.unitArea && ph >= best.unitRows))
      ) {
        continue;
      }
      // 逐格验证（按单元内坐标映射）；垂直/水平周期已保证必过，此处作最终确认
      if (!isRepeatUnit(grid, ph, pw)) continue;
      best = toResult(grid, ph, pw);
    }
  }
  // (height, width) 恒为合法周期，best 不可能为空
  return best ?? toResult(grid, height, width);
}

/**
 * 按视觉坐标偏移 (dr, dc) 取单元相位：
 * shifted[i][j] = unit[(i + dr) mod rows][(j + dc) mod cols]。
 * 偏移只是相位平移，不做任何镜像——偶数行视觉坐标保持原位。
 */
export function shiftUnit(
  cells: string[][],
  dr: number,
  dc: number,
): string[][] {
  const rows = cells.length;
  const cols = cells[0]?.length ?? 0;
  return Array.from({ length: rows }, (_, i) =>
    Array.from({ length: cols }, (_, j) => cells[mod(i + dr, rows)][mod(j + dc, cols)]),
  );
}

/**
 * 生成 tiles × tiles 平铺预览（先按视觉坐标偏移相位，再平铺），
 * 返回 (tiles·rows) × (tiles·cols) 的符号网格。
 */
export function buildTiledPreview(
  cells: string[][],
  dr: number,
  dc: number,
  tiles: number = REPEAT_PREVIEW_TILES,
): string[][] {
  const shifted = shiftUnit(cells, dr, dc);
  const rows = shifted.length;
  const cols = shifted[0]?.length ?? 0;
  return Array.from({ length: rows * tiles }, (_, r) =>
    Array.from({ length: cols * tiles }, (_, c) => shifted[r % rows][c % cols]),
  );
}
