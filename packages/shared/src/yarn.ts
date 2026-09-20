import type {
  YarnCone,
  YarnParams,
  YarnPlanRequest,
  YarnPlanResult,
  YarnSymbolPlan,
} from './types.js';

/**
 * 备纱配筒：按当前网格各符号针数计算用纱需求，并从库存纱筒中
 * 精确选出覆盖需求的最优子集。
 *
 * 与浮线检查、循环花版一致，本模块完全基于视觉坐标统计针数——
 * 奇偶行只影响口令阅读顺序，针数与配筒结果绝不随偶数行镜像。
 *
 * 选筒是带决胜序的精确子集和问题（最小化 启用筒数 → 超出克重 →
 * 编号序列），逐筒贪心（先取大筒/先取小编号）可能得到筒数更多或
 * 余量更大的方案。这里用定基数子集和 DP 求最小筒数与最小超出总量
 * （覆盖全部同基数组合，绝非逐筒贪心），再以可行性 DP 沿编号自然序
 * 构造决胜序下唯一确定的组合。
 */

/** 损耗率范围（0～30%）与默认值 */
export const YARN_LOSS_MIN = 0;
export const YARN_LOSS_MAX = 0.3;
export const YARN_LOSS_DEFAULT = 0;

/** 单个符号允许录入的纱筒数上限 */
export const YARN_MAX_CONES = 20;

/** 克重粒度：所有克重（需求、筒重、余量、缺口）均为 0.1 克的整数倍 */
export const YARN_WEIGHT_STEP = 0.1;

/** 浮点比较/取整容差：消去 0.1 倍数的二进制误差（如 0.1+0.2） */
const EPS = 1e-9;

/** 损耗率裁剪到 [0, 0.30]；NaN/Infinity 一律按 0 处理 */
export function clampLossRate(rate: number): number {
  if (!Number.isFinite(rate)) return YARN_LOSS_MIN;
  return Math.min(YARN_LOSS_MAX, Math.max(YARN_LOSS_MIN, rate));
}

/**
 * 毛需求克重 = 针数 × 克/1000针 ÷ 1000 × (1 + 损耗率)，向上取到 0.1 克。
 * 返回值恒为 0.1 的非负整数倍。
 *
 * 先在浮点域算出连续需求，再用 ceil(x + 容差) 取整，最后 step 化，
 * 保证恰为 0.1 倍数的值（浮点上可能略小或略大）不会多取或少取一格。
 */
export function yarnDemand(
  stitches: number,
  gramsPerK: number,
  lossRate: number,
): number {
  if (!Number.isFinite(stitches) || stitches <= 0) return 0;
  const per = Number.isFinite(gramsPerK) && gramsPerK > 0 ? gramsPerK : 0;
  if (per === 0) return 0;
  const loss = clampLossRate(lossRate);
  const raw = stitches * per * (1 + loss) / 1000;
  if (raw <= EPS) return 0;
  const tenths = Math.ceil(raw / YARN_WEIGHT_STEP - EPS / YARN_WEIGHT_STEP);
  return round1(tenths * YARN_WEIGHT_STEP);
}

/** 规整到 0.1 克（消除 0.1 倍数的二进制误差） */
export function round1(weight: number): number {
  if (!Number.isFinite(weight) || weight < 0) return 0;
  return Math.round((weight + EPS) * 10) / 10;
}

interface NormCone {
  id: string;
  /** 规整后的克重 */
  weight: number;
  /** 以 0.1 克为单位的整数克重（子集和在整数域求解，杜绝浮点误差） */
  tenths: number;
}

/**
 * 规整纱筒列表：
 * - 编号 trim 后为空者剔除；编号（trim 后、大小写敏感）重复者保留首个；
 * - 克重规整到 0.1 克，负数/非数按 0 处理（空筒仍占编号、参与总量）；
 * - 保持录入顺序返回（选筒决胜不依赖该顺序，结果唯一确定）。
 */
export function normalizeCones(cones: YarnCone[] | undefined): NormCone[] {
  const out: NormCone[] = [];
  const seen = new Set<string>();
  for (const cone of cones ?? []) {
    if (!cone || typeof cone.id !== 'string') continue;
    const id = cone.id.trim();
    if (id === '' || seen.has(id)) continue;
    seen.add(id);
    const weight = round1(typeof cone.weight === 'number' ? cone.weight : 0);
    out.push({ id, weight, tenths: Math.round(weight * 10) });
  }
  return out;
}

/**
 * 编号自然序比较（稳定决胜用，全序——编号已保证唯一）：
 * 纯数字串按数值比较（2 < 10），其余按 JS 字典序比较；
 * 数字段与非数字段之间视为“数字更小”，避免依赖 locale 造成不确定性。
 */
export function compareConeId(a: string, b: string): number {
  const aNum = /^\d+$/.test(a);
  const bNum = /^\d+$/.test(b);
  if (aNum && bNum) {
    // 编号长度 ≤ 20 位时走 Number，超长数字串退化为 BigInt，避免精度丢失
    if (a.length <= 15 && b.length <= 15) return Number(a) - Number(b);
    const ba = BigInt(a);
    const bb = BigInt(b);
    return ba < bb ? -1 : ba > bb ? 1 : 0;
  }
  if (aNum !== bNum) return aNum ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 组合数 C(n, k)（结果可能超过 2^53 时饱和为 Infinity，仅用于展示枚举量） */
export function binomial(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  const kk = Math.min(k, n - k);
  let result = 1;
  for (let i = 1; i <= kk; i += 1) {
    result = result * (n - kk + i) / i;
  }
  return result;
}

/**
 * 可行性判定：items 中是否存在“恰好 choose 个、整数克重之和恰好
 * 等于 targetTenths”的子集。0.1 克整数域上的二维子集和 DP。
 */
function exactSubsetExists(
  items: NormCone[],
  choose: number,
  targetTenths: number,
): boolean {
  if (choose < 0 || targetTenths < 0 || choose > items.length) return false;
  if (choose === 0) return targetTenths === 0;
  // 逐筒更新：dp[j] 为“已处理筒中恰好选 j 个”可达总量集合。
  // next 先复制 dp（不选当前筒），再由 dp[j] → next[j+1]（选当前筒），
  // 倒序读旧表即可，这里用“复制 + 读旧引用”显式分离两代，避免一筒用两次。
  let dp: Set<number>[] = Array.from(
    { length: choose + 1 },
    () => new Set<number>(),
  );
  dp[0].add(0);
  for (const item of items) {
    const next = dp.map((s) => new Set(s));
    for (let j = 0; j < choose; j += 1) {
      for (const s of dp[j]) {
        const ns = s + item.tenths;
        if (ns <= targetTenths) next[j + 1].add(ns);
      }
    }
    dp = next;
    if (dp[choose].has(targetTenths)) return true;
  }
  return dp[choose].has(targetTenths);
}

export interface ConeSelection {
  feasible: boolean;
  selected: NormCone[];
  selectedWeight: number;
  surplus: number;
  available: number;
  shortage: number;
  coneCount: number;
  /** 最优方案筒数；零需求/库存不足时为 null */
  minCones: number | null;
  /** 精确枚举的组合数 C(n,k)；零需求/库存不足时为 null */
  evaluated: number | null;
}

/**
 * 在给定纱筒中精确选出总克重 ≥ 需求（0.1 克整数域）的最优子集。
 *
 * 决胜顺序（全部升序）：
 * 1. 启用筒数最少；
 * 2. 超出克重（选中合计 − 需求）最小；
 * 3. 选中编号按自然序排列后的序列字典序最小。
 *
 * 两阶段精确算法（n ≤ 20，全程整数运算，无逐筒贪心近似）：
 * - 阶段 1：定基数子集和 DP，sums[j] 记录“恰好选 j 个筒”可达的全部
 *   整数总量——首个 max(sums[j]) ≥ 需求的 j 即最小筒数，sums[j] 中
 *   ≥ 需求的最小值即最小超出总量。所有同基数组合都参与比较，
 *   “先取大筒”这类贪心答案不会被采用；
 * - 阶段 2：按编号自然序逐个决定，每纳入一个小编号就用定基数子集和
 *   DP 校验剩余候选中仍能恰好凑出（筒数、总量），得到决胜序下
 *   唯一确定的集合。
 */
export function selectCones(
  cones: YarnCone[] | undefined,
  demand: number,
): ConeSelection {
  const pool = normalizeCones(cones);
  const n = pool.length;
  const demandT = Math.max(0, Math.round(round1(demand) * 10));
  const availableT = pool.reduce((sum, c) => sum + c.tenths, 0);
  const available = round1(availableT * YARN_WEIGHT_STEP);

  /** 零需求：不需要启用任何纱筒，空方案即最优（不产生余量） */
  if (demandT === 0) {
    return {
      feasible: true,
      selected: [],
      selectedWeight: 0,
      surplus: 0,
      available,
      shortage: 0,
      coneCount: n,
      minCones: null,
      evaluated: null,
    };
  }

  /** 库存不足：绝不生成伪可行组合，只报告缺口与全部可用量 */
  if (availableT < demandT) {
    return {
      feasible: false,
      selected: [],
      selectedWeight: 0,
      surplus: 0,
      available,
      shortage: round1((demandT - availableT) * YARN_WEIGHT_STEP),
      coneCount: n,
      minCones: null,
      evaluated: null,
    };
  }

  /**
   * 阶段 1：定基数子集和 DP 求“最小可行筒数 k”与该筒数下的最小可行总量。
   * sums[j] = 使用已处理筒中“恰好 j 个”可达的全部整数总量集合。
   * - 最小可行筒数 = 满足 max(sums[j]) ≥ 需求 的最小 j；
   *   （最大 j 筒之和即降序前 j 大之和，与先求 minCones 等价，但 DP 同时
   *   给出该基数下的全部可达总量，无需再做 C(n,k) 枚举）
   * - 该基数下的最小可行总量 bestTotal = sums[k] 中 ≥ demandT 的最小值。
   * 这是精确解，不是逐筒贪心：筒数相同的所有组合的总量都在 sums[k] 中。
   */
  const sums: Set<number>[] = Array.from(
    { length: n + 1 },
    () => new Set<number>(),
  );
  sums[0].add(0);
  for (const cone of pool) {
    // 0/1 背包：从大基数向小基数读旧值更新，避免同一筒被使用两次
    for (let j = n; j >= 1; j -= 1) {
      for (const s of sums[j - 1]) sums[j].add(s + cone.tenths);
    }
  }
  let k = -1;
  for (let j = 1; j <= n; j += 1) {
    let max = 0;
    for (const s of sums[j]) if (s > max) max = s;
    if (max >= demandT) {
      k = j;
      break;
    }
  }
  // availableT ≥ demandT 已保证 k 必有解
  let bestTotal = Infinity;
  for (const s of sums[k]) {
    if (s >= demandT && s < bestTotal) bestTotal = s;
  }

  /**
   * 阶段 2：在恰好等于 bestTotal 的 k 元组合中取“编号按自然序排序后
   * 序列字典序最小”者。决胜序列是排序后的集合，与组合在任何遍历序中的
   * 先后无关，因此按编号自然序逐个决定：纳入当前编号后，若编号更大的
   * 候选筒中仍存在“恰好 needJ 个、总量恰好 needS”的组合，就保留小编号。
   * 每一步的可行性由一个定基数子集和 DP（{@link exactSubsetExists}）回答；
   * n ≤ 20，总体代价远小于 C(n,k) 枚举，且构造出的集合被全序唯一确定。
   */
  const byId = pool.slice().sort((a, b) => compareConeId(a.id, b.id));
  const chosenCones: NormCone[] = [];
  let needJ = k;
  let needS = bestTotal;
  for (let t = 0; t < byId.length && needJ > 0; t += 1) {
    const cand = byId[t];
    if (cand.tenths > needS) continue; // 纳入即超过目标总量
    const rest = byId.slice(t + 1);
    if (exactSubsetExists(rest, needJ - 1, needS - cand.tenths)) {
      chosenCones.push(cand);
      needJ -= 1;
      needS -= cand.tenths;
    }
  }
  // byId 已按编号自然序排列，chosenCones 即最终展示顺序
  const chosen = chosenCones;
  return {
    feasible: true,
    selected: chosen,
    selectedWeight: round1(bestTotal * YARN_WEIGHT_STEP),
    surplus: round1((bestTotal - demandT) * YARN_WEIGHT_STEP),
    available,
    shortage: 0,
    coneCount: n,
    minCones: k,
    evaluated: binomial(n, k),
  };
}

/** 统计网格中各符号的针数（视觉坐标逐格计数，与编织方向无关） */
export function countStitches(grid: string[][]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of grid) {
    for (const cell of row ?? []) {
      if (typeof cell !== 'string' || cell === '') continue;
      const symbol = cell.toUpperCase();
      counts.set(symbol, (counts.get(symbol) ?? 0) + 1);
    }
  }
  return counts;
}

/** 整张网格的备纱配筒：按 symbols 顺序逐符号计算针数、需求与最优纱筒子集 */
export function planYarn(req: YarnPlanRequest): YarnPlanResult {
  const counts = countStitches(req.grid);
  const rows: YarnSymbolPlan[] = req.symbols.map((raw) => {
    const symbol = raw.toUpperCase();
    const p: YarnParams = req.params?.[symbol] ?? req.params?.[raw] ?? {
      gramsPerK: 0,
      lossRate: YARN_LOSS_DEFAULT,
    };
    const gramsPerK =
      Number.isFinite(p.gramsPerK) && p.gramsPerK > 0 ? p.gramsPerK : 0;
    const lossRate = clampLossRate(p.lossRate);
    const stitches = counts.get(symbol) ?? 0;
    const demand = yarnDemand(stitches, gramsPerK, lossRate);
    const sel = selectCones(req.cones?.[symbol] ?? req.cones?.[raw], demand);
    return {
      symbol,
      stitches,
      gramsPerK,
      lossRate,
      demand,
      feasible: sel.feasible,
      selected: sel.selected.map((c) => ({ id: c.id, weight: c.weight })),
      selectedWeight: sel.selectedWeight,
      surplus: sel.surplus,
      available: sel.available,
      shortage: sel.shortage,
      coneCount: sel.coneCount,
      minCones: sel.minCones,
      evaluated: sel.evaluated,
    } satisfies YarnSymbolPlan;
  });
  return { rows };
}
