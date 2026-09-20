import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  YARN_MAX_CONES,
  YARN_MAX_LOSS_PERCENT,
  computeDemandGrams,
  countSymbolStitches,
  planYarn,
  selectCones,
} from '../dist/index.js';

/** 快捷造筒：id 列表 + 克重列表（等长） */
function cones(ids, grams) {
  return ids.map((id, i) => ({ id, symbol: 'A', grams: grams[i] }));
}

/** 选中筒的编号序列（便于断言） */
function idsOf(selected) {
  return selected.map((c) => c.id);
}

test('需求计算：针数 × 克/1000针 ÷ 1000 × (1 + 损耗率)，向上取到 0.1 克', () => {
  // 整除情形恰好落在刻度上，绝不上浮
  assert.equal(computeDemandGrams(1000, 100, 0), 100);
  assert.equal(computeDemandGrams(1000, 100, 0.1), 110);
  assert.equal(computeDemandGrams(2000, 50, 0.3), 130);
  // 非整除向上取到 0.1 克
  assert.equal(computeDemandGrams(3, 0.1, 0), 0.1); // 0.0003 → 0.1
  assert.equal(computeDemandGrams(100, 1, 0.15), 0.2); // 0.115 → 0.2
  assert.equal(computeDemandGrams(1, 0.1, 0), 0.1); // 0.0001 → 0.1
  // 大数值：999 针 × 999.9 克/1000针 × 1.3 = 1298.57013 → 1298.6
  assert.equal(computeDemandGrams(999, 999.9, 0.3), 1298.6);
});

test('精度舍入：浮点噪声不得把恰好刻度上的需求向上顶一格', () => {
  // 浮点下 1000 × 0.3 ÷ 1000 = 0.30000000000000004，
  // 若先算浮点再 ceil 会错误得到 0.4；整数刻度运算必须恰好得 0.3
  assert.equal(computeDemandGrams(1000, 0.3, 0), 0.3);
  // 333 针 × 0.3 克/1000针 = 0.0999 克，不在刻度上 → 上取 0.1
  assert.equal(computeDemandGrams(333, 0.3, 0), 0.1);
  // 损耗率同样精确：1000 × 1.0 × 1.1 = 1.1 恰好落在刻度上，不上浮
  assert.equal(computeDemandGrams(1000, 1, 0.1), 1.1);
  // 0.3 × 1.1 = 0.33 不在刻度上 → 上取 0.4
  assert.equal(computeDemandGrams(1000, 0.3, 0.1), 0.4);
  // 需求恰好等于某筒克重时必须选中它而不是更大的筒（联动验证）
  const selected = selectCones(cones(['T1', 'T2'], [0.3, 0.4]), 0.3);
  assert.deepEqual(idsOf(selected), ['T1']);
});

test('0 需求：不启用任何筒，余量为 0，即使无库存也可行', () => {
  assert.deepEqual(selectCones(cones(['T1', 'T2'], [5, 8]), 0), []);
  assert.deepEqual(selectCones([], 0), []);
  const plan = planYarn(
    [['A', 'A']],
    [{ symbol: 'B', gramsPer1000: 100, lossRate: 0.3 }],
    [],
  );
  assert.equal(plan[0].stitches, 0);
  assert.equal(plan[0].demand, 0);
  assert.equal(plan[0].feasible, true);
  assert.deepEqual(plan[0].selected, []);
  assert.equal(plan[0].surplus, 0);
  assert.equal(plan[0].shortfall, null);
});

test('贪心反例：逐筒贪心（从大到小）不是最优，必须精确搜索', () => {
  // 需求 10，筒 [6,5,5]：贪心先拿 6 再补 5 得 11（超 1）；
  // 最优为 5+5=10（超 0），筒数同为 2
  const s1 = selectCones(cones(['G1', 'G2', 'G3'], [6, 5, 5]), 10);
  assert.deepEqual(idsOf(s1), ['G2', 'G3']);
  // 需求 9，筒 [6,5,4]：贪心 6+4=10（超 1）；最优 5+4=9（超 0）
  const s2 = selectCones(cones(['G1', 'G2', 'G3'], [6, 5, 4]), 9);
  assert.deepEqual(idsOf(s2), ['G2', 'G3']);
  // 需求 11，筒 [10,6,5]：贪心 10+5=15（超 4）；最优 6+5=11（超 0）
  const s3 = selectCones(cones(['G1', 'G2', 'G3'], [10, 6, 5]), 11);
  assert.deepEqual(idsOf(s3), ['G2', 'G3']);
});

test('目标顺序：先筒数，再超出克重，最后编号序列', () => {
  // 筒数优先：{11} 一筒超 1，{6,5} 两筒也超 1 —— 筒数少者胜
  const s1 = selectCones(cones(['T1', 'T2', 'T3'], [11, 6, 5]), 10);
  assert.deepEqual(idsOf(s1), ['T1']);
  // 超出克重次之：同为一筒，11 < 12
  const s2 = selectCones(cones(['T1', 'T2'], [12, 11]), 10);
  assert.deepEqual(idsOf(s2), ['T2']);
  // 编号序列决胜：{a,b}=10 与 {c,d}=10 同筒数同合计，取字典序最小
  const s3 = selectCones(
    cones(['d', 'c', 'b', 'a'], [5, 5, 6, 4]),
    10,
  );
  assert.deepEqual(idsOf(s3), ['a', 'b']);
});

test('稳定决胜：结果唯一确定，与录入顺序无关，重复调用一致', () => {
  // 三个等重筒：必选编号最小者
  const s1 = selectCones(cones(['C', 'B', 'A'], [1, 1, 1]), 1);
  assert.deepEqual(idsOf(s1), ['A']);
  // 打乱录入顺序，选中集合与排序结果完全一致
  // 需求 10：{T2,T4}=6+4=10 与 {T1,T3}=5+5=10 同筒数同合计，
  // 编号序列 [T1,T3] < [T2,T4] → 选 {T1,T3}
  const base = cones(['T4', 'T2', 'T1', 'T3'], [4, 6, 5, 5]);
  const shuffled = [base[2], base[0], base[3], base[1]];
  const r1 = selectCones(base, 10);
  const r2 = selectCones(shuffled, 10);
  assert.deepEqual(idsOf(r1), ['T1', 'T3']);
  assert.deepEqual(idsOf(r2), idsOf(r1));
  // 重复调用结果一致
  assert.deepEqual(idsOf(selectCones(base, 10)), idsOf(r1));
  // 20 筒上限规模的全等重极端情形：结果确定且为编号最小的 10 个
  const many = cones(
    Array.from({ length: YARN_MAX_CONES }, (_, i) => `K${String(i + 1).padStart(2, '0')}`),
    new Array(YARN_MAX_CONES).fill(1),
  );
  const s20 = selectCones(many, 10);
  assert.deepEqual(
    idsOf(s20),
    Array.from({ length: 10 }, (_, i) => `K${String(i + 1).padStart(2, '0')}`),
  );
});

test('库存不足：返回 null，绝不生成伪可行组合；方案给出缺口与全部可用量', () => {
  assert.equal(selectCones(cones(['T1', 'T2'], [3, 4]), 10), null);
  assert.equal(selectCones([], 5), null);
  const plan = planYarn(
    [['A', 'A', 'A', 'A']],
    [{ symbol: 'A', gramsPer1000: 100, lossRate: 0 }],
    [
      { id: 'T1', symbol: 'A', grams: 0.2 },
      { id: 'T2', symbol: 'A', grams: 0.1 },
    ],
  );
  // 需求 0.4，可用 0.3 → 缺口 0.1
  assert.equal(plan[0].demand, 0.4);
  assert.equal(plan[0].totalAvailable, 0.3);
  assert.equal(plan[0].feasible, false);
  assert.equal(plan[0].selected, null);
  assert.equal(plan[0].surplus, null);
  assert.equal(plan[0].shortfall, 0.1);
});

test('planYarn：逐符号统计针数，筒按符号归属，余量/需求精确到 0.1 克', () => {
  const grid = [
    ['A', 'B', 'B'],
    ['C', 'A', 'B'],
  ];
  const counts = countSymbolStitches(grid, ['A', 'B', 'C']);
  assert.deepEqual(counts, { A: 2, B: 3, C: 1 });

  const plans = planYarn(
    grid,
    [
      { symbol: 'A', gramsPer1000: 100, lossRate: 0 },
      { symbol: 'B', gramsPer1000: 100, lossRate: 0.1 },
      { symbol: 'C', gramsPer1000: 0, lossRate: 0 },
    ],
    [
      { id: 'A-2', symbol: 'A', grams: 0.2 },
      { id: 'A-1', symbol: 'A', grams: 0.1 },
      { id: 'B-1', symbol: 'B', grams: 0.5 },
      { id: 'C-1', symbol: 'C', grams: 9.9 }, // C 需求为 0，不启用
    ],
  );
  // A：2 针 × 100/1000 = 0.2 → 选 A-2（一筒恰好），余量 0
  assert.equal(plans[0].demand, 0.2);
  assert.deepEqual(idsOf(plans[0].selected), ['A-2']);
  assert.equal(plans[0].surplus, 0);
  // B：3 针 × 100/1000 × 1.1 = 0.33 → 0.4；B-1（0.5）覆盖，余量 0.1
  assert.equal(plans[1].demand, 0.4);
  assert.deepEqual(idsOf(plans[1].selected), ['B-1']);
  assert.equal(plans[1].surplus, 0.1);
  // C：克/1000针 为 0 → 需求 0，不启用任何筒
  assert.equal(plans[2].demand, 0);
  assert.deepEqual(plans[2].selected, []);
  // 符号归属隔离：A 的筒不会被 B 使用
  assert.ok(plans[1].selected.every((c) => c.symbol === 'B'));
});

test('参数防御：损耗率钳制到 0～30%，非法克重/针数按 0 处理', () => {
  assert.equal(YARN_MAX_LOSS_PERCENT, 30);
  // 损耗率超过 30% 按 30% 计，负损耗按 0 计
  assert.equal(computeDemandGrams(1000, 100, 0.5), computeDemandGrams(1000, 100, 0.3));
  assert.equal(computeDemandGrams(1000, 100, -0.2), 100);
  assert.equal(computeDemandGrams(1000, 100, Number.NaN), 100);
  // 非法输入不抛异常
  assert.equal(computeDemandGrams(-5, 100, 0), 0);
  assert.equal(computeDemandGrams(100, Number.NaN, 0), 0);
  assert.deepEqual(selectCones(cones(['T1'], [Number.NaN]), 1), null);
});
