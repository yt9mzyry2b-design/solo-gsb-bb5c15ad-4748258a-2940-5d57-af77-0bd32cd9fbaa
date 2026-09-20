import type {
  AlignCandidate,
  AlignOffset,
  AlignSearchRequest,
  AlignSearchResult,
} from './types.js';
import { analyzeText, placeRuns } from './rle.js';
import { DIFF_BASE_SYMBOL } from './diff.js';

/**
 * 错位对齐搜索：把可比较的候选图案（针数校验通过的候选行解码后的
 * 视觉坐标图案）整体按行、列方向循环平移，枚举用户限定的最大偏移，
 * 按差异格总数选出最佳方案。
 *
 * 与对版一致，本模块完全基于视觉坐标——候选行先按实际编织方向落针
 * （偶数行 ←），再对解码后的图案做循环平移，绝不随偶数行镜像。
 * 针数错误或缺失的候选行不参与评分：它们不产生任何差异格，
 * 每个偏移方案的被评分格数恒为 可比较行数 × 行宽。
 */

/** 最大偏移的可选上限与默认值（客户端控件使用） */
export const ALIGN_MAX_SHIFT_LIMIT = 8;
export const ALIGN_MAX_SHIFT_DEFAULT = 3;

/** 正取模（防御负偏移） */
function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

/**
 * 决胜顺序（全部为升序，返回负数表示 a 更优）：
 * 1. 差异格总数
 * 2. 偏移曼哈顿距离 |dr| + |dc|
 * 3. 行偏移绝对值 |dr|
 * 4. 列偏移绝对值 |dc|
 * 5. 带符号行偏移 dr
 * 6. 带符号列偏移 dc
 * 末两级按有符号数值比较，构成全序——同分时结果唯一确定（稳定决胜）。
 */
export function compareAlignments(a: AlignCandidate, b: AlignCandidate): number {
  return (
    a.diffs - b.diffs ||
    Math.abs(a.dr) + Math.abs(a.dc) - (Math.abs(b.dr) + Math.abs(b.dc)) ||
    Math.abs(a.dr) - Math.abs(b.dr) ||
    Math.abs(a.dc) - Math.abs(b.dc) ||
    a.dr - b.dr ||
    a.dc - b.dc
  );
}

/**
 * 枚举 dr、dc ∈ [-maxShift, +maxShift] 的全部循环平移（含 0,0 原始位置），
 * 对每个偏移统计可比较候选行与当前网格的差异格总数，按
 * {@link compareAlignments} 的顺序选出最佳方案。
 *
 * 评分口径与 compareCandidate 完全一致：逐格比较符号是否相同，
 * 每个差异格计 1（不区分新增/缺失/替换）；针数错误/缺失行不参与评分。
 */
export function searchBestAlignment(req: AlignSearchRequest): AlignSearchResult {
  const { text, width, height, grid, symbols } = req;
  const base = (req.baseSymbol ?? DIFF_BASE_SYMBOL).toUpperCase();
  const maxShift = Math.max(
    0,
    Math.min(ALIGN_MAX_SHIFT_LIMIT, Math.trunc(req.maxShift) || 0),
  );

  const analysis = analyzeText({ text, width, height, symbols });

  // 仅针数校验通过的候选行参与评分：先按编织方向解码到视觉坐标
  const validRows: { row: number; cells: string[] }[] = [];
  for (const r of analysis.rows) {
    if (r.runs === null) continue;
    validRows.push({ row: r.row, cells: placeRuns(r.runs, r.row, width) });
  }
  const scoredRows = validRows.length;

  // 网格行规范化（与 compareCandidate 同一口径：缺格补底色、统一大写）
  const gridRows: string[][] = Array.from({ length: height }, (_, r) => {
    const current = grid[r] ?? [];
    return Array.from({ length: width }, (_, c) =>
      (current[c] ?? base).toUpperCase(),
    );
  });

  /** 偏移 (dr, dc) 下的差异格总数：候选源行 r0 平移到目标行 r0+dr（取模） */
  const scoreAt = (dr: number, dc: number): number => {
    let diffs = 0;
    for (const { row, cells } of validRows) {
      const target = gridRows[mod(row - 1 + dr, height)];
      for (let c = 0; c < width; c += 1) {
        if (target[c] !== cells[mod(c - dc, width)]) diffs += 1;
      }
    }
    return diffs;
  };

  let best: AlignCandidate = { dr: 0, dc: 0, diffs: scoreAt(0, 0) };
  const originalDiffs = best.diffs;
  let evaluated = 1;

  for (let dr = -maxShift; dr <= maxShift; dr += 1) {
    for (let dc = -maxShift; dc <= maxShift; dc += 1) {
      if (dr === 0 && dc === 0) continue;
      evaluated += 1;
      const candidate: AlignCandidate = { dr, dc, diffs: scoreAt(dr, dc) };
      if (compareAlignments(candidate, best) < 0) best = candidate;
    }
  }

  return {
    maxShift,
    scoredRows,
    evaluated,
    originalDiffs,
    best,
    improved: best.diffs < originalDiffs,
  };
}

/** 便捷判断：偏移是否为零（原始位置） */
export function isZeroOffset(offset: AlignOffset): boolean {
  return offset.dr === 0 && offset.dc === 0;
}
