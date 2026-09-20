import type { YarnCone, YarnSymbolPlan, YarnSymbolSpec } from './types.js';

/**
 * 备纱配筒：按当前网格的各符号针数计算用纱需求，
 * 并为每种符号从该符号的纱筒中精确选出可覆盖需求的子集。
 *
 * 需求公式：针数 × 克/1000针 ÷ 1000 × (1 + 损耗率)，向上取到 0.1 克。
 * 选筒目标（依次）：最小化启用筒数 → 最小化超出克重 → 最小化编号序列。
 *
 * 选筒算法为子集和动态规划（精确求解），绝非逐筒贪心近似：
 * 贪心“从大到小逐筒加入”虽然筒数必然最少，但超出克重可能不是最优
 * （如需求 10、筒 [6,5,5]，贪心得 6+5=11，最优为 5+5=10）。
 *
 * 全部克重运算在 0.1 克整数刻度上进行，避免浮点误差影响向上取整
 * （如 1000 针 × 0.3 克/1000针 的浮点结果 0.30000000000000004
 * 会被错误地上取为 0.4 克）。
 */

/** 同一配置内纱筒数量上限 */
export const YARN_MAX_CONES = 20;
/** 损耗率上限（百分比） */
export const YARN_MAX_LOSS_PERCENT = 30;

/** 克 → 0.1 克整数刻度（四舍五入到最近刻度；非有限值/负值归为 0） */
function toTenths(grams: number): number {
  if (!Number.isFinite(grams) || grams <= 0) return 0;
  return Math.round(grams * 10);
}

/** 0.1 克整数刻度 → 克 */
function fromTenths(tenths: number): number {
  return tenths / 10;
}

/** 损耗率钳制到 [0, 0.3]（非有限值归为 0） */
function clampLossRate(lossRate: number): number {
  if (!Number.isFinite(lossRate)) return 0;
  return Math.min(YARN_MAX_LOSS_PERCENT / 100, Math.max(0, lossRate));
}

/**
 * 计算某符号的需求克重：针数 × 克/1000针 ÷ 1000 × (1 + 损耗率)，
 * 向上取到 0.1 克。
 *
 * 全程整数运算：克/1000针 先化为 0.1 克刻度，损耗率化为万分之一，
 * 需求(0.1克) = ⌈针数 × 克刻度 × (10000 + 损耗万分) ÷ 10⁷⌉。
 * 最大中间值约 4096 × 9999 × 13000 ≈ 5.3×10¹¹，远在安全整数范围内。
 */
export function computeDemandGrams(
  stitches: number,
  gramsPer1000: number,
  lossRate: number,
): number {
  const n = Number.isFinite(stitches) ? Math.max(0, Math.trunc(stitches)) : 0;
  const g1000t = toTenths(gramsPer1000);
  const lossBp = Math.round(clampLossRate(lossRate) * 10000);
  const tenths = Math.ceil((n * g1000t * (10000 + lossBp)) / 10_000_000);
  return fromTenths(tenths);
}

/** 统计网格中各符号的针数（视觉坐标逐格计数，与编织方向无关） */
export function countSymbolStitches(
  grid: string[][],
  symbols: string[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const s of symbols) counts[s] = 0;
  for (const row of grid) {
    for (const cell of row ?? []) {
      if (cell in counts) counts[cell] += 1;
    }
  }
  return counts;
}

/** 编号序列比较：按编号升序排列后逐位字典序（编码单元序），构成全序 */
function compareIdSeq(a: string[], b: string[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return a.length - b.length;
}

/**
 * 精确选筒：从 cones 中选出合计克重 ≥ demand 的子集，依次最小化
 * 1. 启用筒数
 * 2. 超出克重（合计 − 需求）
 * 3. 编号序列（选中筒编号升序排列后的字典序，保证结果唯一确定）
 *
 * 算法：子集和动态规划。把筒按编号升序排列后，自右向左构建后缀位集
 * reach[i][c]——第 s 位置 1 表示“后缀 cones[i..] 中恰好 c 个筒可凑出
 * 合计 s（0.1 克刻度）”。位集长度截断到 L = 需求 + 最大筒重：
 * 最优解的合计必小于 L（否则去掉该子集中任意一筒仍覆盖需求，
 * 与筒数最少矛盾），故截断不影响结果。
 *
 * 求解分三步，全部基于位集查询，复杂度与筒数（≤20）多项式相关：
 * 1. 最小筒数 bestK：最小的 c 使 reach[0][c] 存在 ≥ 需求的置位；
 * 2. 最小合计 bestSum：reach[0][bestK] 中 ≥ 需求的最低置位；
 * 3. 编号序列决胜：按编号升序贪心——当前筒若能由后缀补全
 *    （bestK, bestSum）则必选，如此得到的升序编号序列字典序最小。
 *
 * 库存不足（全部筒合计 < 需求）时返回 null——绝不返回伪可行组合；
 * 需求 ≤ 0 时返回空数组（不启用任何筒）。
 * 返回的筒按编号升序排列。
 */
export function selectCones(
  cones: YarnCone[],
  demandGrams: number,
): YarnCone[] | null {
  const demand = toTenths(demandGrams);
  if (demand <= 0) return [];

  // 按编号升序排列（编号序列决胜的求解顺序）
  const ordered = cones
    .map((cone, index) => ({ cone, index, weight: toTenths(cone.grams) }))
    .sort((a, b) => compareIdSeq([a.cone.id], [b.cone.id]) || a.index - b.index);
  const n = ordered.length;
  const weights = ordered.map((o) => o.weight);

  let total = 0;
  let maxW = 0;
  for (const w of weights) {
    total += w;
    if (w > maxW) maxW = w;
  }
  if (total < demand) return null;

  // 位集截断长度：最优合计 ∈ [demand, demand + maxW)
  const limit = demand + maxW;
  const capMask = (1n << BigInt(limit)) - 1n;

  // reach[i][c]：后缀 ordered[i..] 中恰好 c 个筒可凑出的合计集合（位集）
  const reach: bigint[][] = Array.from({ length: n + 1 }, () =>
    new Array<bigint>(n + 1).fill(0n),
  );
  reach[n][0] = 1n; // 空后缀：0 个筒凑出合计 0
  for (let i = n - 1; i >= 0; i -= 1) {
    const shift = BigInt(weights[i]);
    for (let c = 0; c <= n; c += 1) {
      let bits = reach[i + 1][c];
      if (c > 0) bits |= (reach[i + 1][c - 1] << shift) & capMask;
      reach[i][c] = bits;
    }
  }

  const demandBit = BigInt(demand);

  // 第一步：最小筒数
  let bestK = -1;
  for (let c = 0; c <= n; c += 1) {
    if ((reach[0][c] >> demandBit) !== 0n) {
      bestK = c;
      break;
    }
  }
  // total ≥ demand 保证必有可行子集，bestK 不可能仍为 -1
  if (bestK < 0) return null;

  // 第二步：该筒数下的最小合计（≥ 需求的最低置位）
  const above = reach[0][bestK] >> demandBit;
  const lowbit = above & -above;
  const bestSum = demand + lowbit.toString(2).length - 1;

  // 第三步：编号升序贪心重构——能由后缀补全 (bestK, bestSum) 的最小编号必选
  const picked: YarnCone[] = [];
  let need = bestSum;
  let rest = bestK;
  for (let i = 0; i < n && rest > 0; i += 1) {
    const w = weights[i];
    const rem = need - w;
    if (rem < 0) continue;
    if (((reach[i + 1][rest - 1] >> BigInt(rem)) & 1n) === 1n) {
      picked.push(ordered[i].cone);
      need = rem;
      rest -= 1;
    }
  }
  return picked;
}

/**
 * 整张网格的备纱配筒方案：逐符号统计针数、计算需求（向上取 0.1 克）、
 * 从该符号自己的纱筒中精确选筒。库存不足的符号不生成伪可行组合，
 * 转而给出缺口（需求 − 全部可用量）与全部可用量。
 */
export function planYarn(
  grid: string[][],
  specs: YarnSymbolSpec[],
  cones: YarnCone[],
): YarnSymbolPlan[] {
  const counts = countSymbolStitches(
    grid,
    specs.map((s) => s.symbol),
  );
  return specs.map((spec) => {
    const stitches = counts[spec.symbol] ?? 0;
    const gramsPer1000 = Number.isFinite(spec.gramsPer1000)
      ? Math.max(0, spec.gramsPer1000)
      : 0;
    const lossRate = clampLossRate(spec.lossRate);
    const demand = computeDemandGrams(stitches, gramsPer1000, lossRate);
    const mine = cones.filter((c) => c.symbol === spec.symbol);
    let availableTenths = 0;
    for (const c of mine) availableTenths += toTenths(c.grams);
    const totalAvailable = fromTenths(availableTenths);

    const selected = selectCones(mine, demand);
    if (selected === null) {
      return {
        symbol: spec.symbol,
        stitches,
        gramsPer1000,
        lossRate,
        demand,
        totalAvailable,
        feasible: false,
        selected: null,
        surplus: null,
        shortfall: fromTenths(toTenths(demand) - availableTenths),
      };
    }
    let usedTenths = 0;
    for (const c of selected) usedTenths += toTenths(c.grams);
    return {
      symbol: spec.symbol,
      stitches,
      gramsPer1000,
      lossRate,
      demand,
      totalAvailable,
      feasible: true,
      selected,
      surplus: fromTenths(usedTenths - toTenths(demand)),
      shortfall: null,
    };
  });
}
