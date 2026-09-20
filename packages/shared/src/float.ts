import type { FloatCheckResult, FloatSpan } from './types.js';

/** 最大浮线针数阈值的可选范围与默认值 */
export const MAX_FLOAT_MIN = 3;
export const MAX_FLOAT_MAX = 12;
export const MAX_FLOAT_DEFAULT = 5;

/** 浮线按视觉坐标排序：行 → 起始列 → 结束列 → 符号 */
function byVisualPosition(a: FloatSpan, b: FloatSpan): number {
  return (
    a.row - b.row ||
    a.startCol - b.startCol ||
    a.endCol - b.endCol ||
    a.symbol.localeCompare(b.symbol)
  );
}

/**
 * 分析一行（视觉坐标）中的全部浮线区间。
 *
 * 定义：某种颜色相邻两次落针之间跨过的其他颜色针数，即为该颜色的一段浮线。
 * 只有被同色针脚两端夹住的区间才计为浮线——行首/行尾的开放区间
 * （该颜色尚未首次出现之前、最后一次出现之后）不计入。
 *
 * 注意：本分析完全基于视觉坐标，与奇偶行的实际编织方向无关；
 * 奇偶行只影响口令的阅读顺序，浮线位置绝不随偶数行镜像。
 */
export function findRowFloats(
  visualCells: string[],
  rowOneBased: number,
): FloatSpan[] {
  const spans: FloatSpan[] = [];
  // 每种符号最近一次出现的视觉列（0 基）；相邻两次出现即构成一段候选浮线
  const lastSeen = new Map<string, number>();
  for (let c = 0; c < visualCells.length; c += 1) {
    const symbol = visualCells[c];
    const prev = lastSeen.get(symbol);
    if (prev !== undefined && c - prev - 1 > 0) {
      spans.push({
        row: rowOneBased,
        symbol,
        startCol: prev + 1, // 转为 1 基视觉列
        endCol: c + 1,
        length: c - prev - 1,
      });
    }
    lastSeen.set(symbol, c);
  }
  return spans.sort(byVisualPosition);
}

/**
 * 整张网格的浮线风险检查。
 * 返回全部浮线区间，以及其中长度超过 maxFloat 的风险子集，
 * 两者均按视觉坐标汇总排序。
 */
export function checkFloats(
  grid: string[][],
  maxFloat: number,
): FloatCheckResult {
  const spans: FloatSpan[] = [];
  const risks: FloatSpan[] = [];
  for (let r = 0; r < grid.length; r += 1) {
    for (const span of findRowFloats(grid[r] ?? [], r + 1)) {
      spans.push(span);
      if (span.length > maxFloat) risks.push(span);
    }
  }
  spans.sort(byVisualPosition);
  risks.sort(byVisualPosition);
  return { maxFloat, spans, risks };
}
