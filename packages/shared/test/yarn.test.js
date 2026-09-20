import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  YARN_LOSS_MAX,
  YARN_MAX_CONES,
  binomial,
  clampLossRate,
  compareConeId,
  countStitches,
  normalizeCones,
  planYarn,
  selectCones,
  yarnDemand,
} from '../dist/index.js';

/** 从 selectCones 结果取选中编号，便于断言 */
function chosenIds(res) {
  return res.selected.map((c) => c.id);
}

test('需求公式：针数 × 克/1000针 ÷ 1000 × (1+损耗率)，向上取到 0.1 克', () => {
  // 1000 针 × 20 克/1000 = 20 克
  assert.equal(yarnDemand(1000, 20, 0), 20);
  // 100 针 × 20 克/1000 = 2 克
  assert.equal(yarnDemand(100, 20, 0), 2);
  // 1000 针 × 20 × 1.05 = 21 克
  assert.equal(yarnDemand(1000, 20, 0.05), 21);
  // 100 针 × 20 × 1.30 = 2.6 克（损耗率上限 30%）
  assert.equal(yarnDemand(100, 20, 0.3), 2.6);
  // 损耗率越界裁剪：0.5 按 0.3 处理，负数按 0 处理
  assert.equal(yarnDemand(100, 20, 0.5), 2.6);
  assert.equal(yarnDemand(100, 20, -0.2), 2);
});

test('精度舍入：不是 0.1 整数倍的需求一律向上取一格', () => {
  // 333 针 × 20 / 1000 = 6.66 → 向上到 6.7
  assert.equal(yarnDemand(333, 20, 0), 6.7);
  // 333 × 20 × 1.05 = 6.993 → 7.0
  assert.equal(yarnDemand(333, 20, 0.05), 7);
  // 1 针 × 30 / 1000 = 0.03 → 0.1
  assert.equal(yarnDemand(1, 30, 0), 0.1);
  // 3 针 × 10 / 1000 = 0.03 → 0.1
  assert.equal(yarnDemand(3, 10, 0), 0.1);
  // 4 针 × 10 / 1000 = 0.04 → 0.1（不是四舍五入成 0.0）
  assert.equal(yarnDemand(4, 10, 0), 0.1);
  // 恰为 0.1 倍数时不多取：1050 针 × 20 × 1.05 / 1000 = 22.05 → 22.1
  assert.equal(yarnDemand(1050, 20, 0.05), 22.1);
});

test('精度舍入：浮点上近似 0.1 倍数的值不被多取（0.1+0.2 类误差）', () => {
  // 333 × 25 × 1.05 / 1000 = 8.74125 → 8.8（非倍数，正常向上）
  assert.equal(yarnDemand(333, 25, 0.05), 8.8);
  // 构造“数学上恰为 0.1 倍数、浮点上略小”的值：
  // 123 针 × 10 / 1000 = 1.23 → 1.3
  assert.equal(yarnDemand(123, 10, 0), 1.3);
  // 200 针 × 10 / 1000 = 2 恰好 → 2.0，不得变成 2.1
  assert.equal(yarnDemand(200, 10, 0), 2);
  // 250 针 × 8 / 1000 = 2 恰好 → 2.0
  assert.equal(yarnDemand(250, 8, 0), 2);
  // 损耗 30%：100 针 × 10 × 1.3 / 1000 = 1.3 恰好 → 1.3
  assert.equal(yarnDemand(100, 10, 0.3), 1.3);
});

test('0 需求：针数为 0 或单耗为 0 时需求为 0', () => {
  assert.equal(yarnDemand(0, 20, 0.05), 0);
  assert.equal(yarnDemand(1000, 0, 0.05), 0);
  assert.equal(yarnDemand(-5, 20, 0.05), 0);
});

test('0 需求配筒：不启用任何纱筒（即使存在完全匹配的整筒），余量为 0', () => {
  const res = selectCones(
    [
      { id: 'A01', weight: 10 },
      { id: 'A02', weight: 0.1 },
    ],
    0,
  );
  assert.equal(res.feasible, true);
  assert.deepEqual(chosenIds(res), []);
  assert.equal(res.selectedWeight, 0);
  assert.equal(res.surplus, 0);
  assert.equal(res.minCones, null);
  assert.equal(res.available, 10.1);
});

test('库存不足：绝不生成伪可行组合，报告缺口与全部可用量', () => {
  const res = selectCones(
    [
      { id: '1', weight: 1.2 },
      { id: '2', weight: 3.4 },
    ],
    5,
  );
  assert.equal(res.feasible, false);
  assert.deepEqual(chosenIds(res), []);
  assert.equal(res.selectedWeight, 0);
  assert.equal(res.surplus, 0);
  assert.equal(res.available, 4.6);
  assert.equal(res.shortage, 0.4);
  assert.equal(res.minCones, null);
  assert.equal(res.evaluated, null);
});

test('库存恰好满足：余量可以为 0', () => {
  const res = selectCones(
    [
      { id: '1', weight: 2.3 },
      { id: '2', weight: 2.7 },
    ],
    5,
  );
  assert.equal(res.feasible, true);
  assert.deepEqual(chosenIds(res), ['1', '2']);
  assert.equal(res.selectedWeight, 5);
  assert.equal(res.surplus, 0);
  assert.equal(res.minCones, 2);
  assert.equal(res.evaluated, 1);
});

test('贪心反例：逐筒取大筒得到 2 筒，精确解只需 1 筒', () => {
  // 需求 6；大筒优先贪心会先取 5（剩 1 再取 1，共 2 筒），
  // 而单筒 7 即可覆盖——最优必须是 1 筒。
  const res = selectCones(
    [
      { id: '7', weight: 7 },
      { id: '5', weight: 5 },
      { id: '1', weight: 1 },
    ],
    6,
  );
  assert.equal(res.feasible, true);
  assert.equal(res.minCones, 1);
  assert.deepEqual(chosenIds(res), ['7']);
  assert.equal(res.surplus, 1);
  assert.equal(res.evaluated, 3); // C(3,1)
});

test('贪心反例：筒数相同也要精确比较超出克重，不能取贪心先撞到的组合', () => {
  // 需求 6.5；筒数下界为 2（任何单筒 < 6.5）。
  // 大筒优先贪心：5 + 2 = 7（余 0.5）即停；
  // 但 4 + 2.6 = 6.6（余 0.1）才是最小超出。
  const res = selectCones(
    [
      { id: '1', weight: 5 },
      { id: '2', weight: 4 },
      { id: '3', weight: 2.6 },
      { id: '4', weight: 2 },
    ],
    6.5,
  );
  assert.equal(res.minCones, 2);
  assert.deepEqual(chosenIds(res), ['2', '3']);
  assert.equal(res.selectedWeight, 6.6);
  assert.equal(res.surplus, 0.1);
});

test('稳定决胜：筒数与超出量相同（互为近似子集和）时取编号序列最小者', () => {
  // 需求 9；筒：1=4, 2=4, 3=2, 4=4, 5=2。
  // 和为 10（余 1）的三元组包括 [1,2,3]=4+4+2、[1,3,4]=2+4+4、
  // [2,3,4]、[1,2,5]、[1,4,5]、[2,4,5] 等；编号序列最小者为 [1,2,3]。
  const cones = [
    { id: '1', weight: 4 },
    { id: '2', weight: 4 },
    { id: '3', weight: 2 },
    { id: '4', weight: 4 },
    { id: '5', weight: 2 },
  ];
  const res = selectCones(cones, 9);
  assert.equal(res.minCones, 3);
  assert.equal(res.selectedWeight, 10);
  assert.equal(res.surplus, 1);
  assert.deepEqual(chosenIds(res), ['1', '2', '3']);
});

test('稳定决胜：编号按自然序比较（2 < 10），而非字典序（"10" < "2"）', () => {
  // 需求 5；[1,?] 与 [2,?] ... 直接构造单筒决胜：两个 6 克筒编号 2、10
  const res = selectCones(
    [
      { id: '10', weight: 6 },
      { id: '2', weight: 6 },
    ],
    5,
  );
  assert.equal(res.minCones, 1);
  assert.deepEqual(chosenIds(res), ['2']);
  // compareConeId 直接验证自然序
  assert.ok(compareConeId('2', '10') < 0);
  assert.ok(compareConeId('10', '2') > 0);
  assert.ok(compareConeId('A1', 'A2') < 0);
  assert.equal(compareConeId('x', 'x'), 0);
});

test('稳定决胜：与录入顺序无关——打乱顺序与编号大小写无关，结果唯一', () => {
  const mk = () => [
    { id: 'B', weight: 3 },
    { id: 'A', weight: 3 },
    { id: 'C', weight: 4 },
    { id: 'D', weight: 4 },
  ];
  // 需求 6：两两组合 [A,B]=6 是唯一恰好方案
  const r1 = selectCones(mk(), 6);
  const r2 = selectCones(mk().reverse(), 6);
  assert.deepEqual(chosenIds(r1), ['A', 'B']);
  assert.deepEqual(chosenIds(r2), ['A', 'B']);
  assert.equal(r1.surplus, 0);
});

test('枚举量：evaluated = C(n, minCones)，精确枚举而非逐筒贪心', () => {
  // n=5 个筒，最小筒数 2 → C(5,2)=10
  const res = selectCones(
    [
      { id: '1', weight: 3 },
      { id: '2', weight: 3 },
      { id: '3', weight: 3 },
      { id: '4', weight: 3 },
      { id: '5', weight: 3 },
    ],
    5,
  );
  assert.equal(res.minCones, 2);
  assert.equal(res.evaluated, 10);
  assert.equal(binomial(5, 2), 10);
  assert.equal(binomial(20, 10), 184756);
});

test('20 筒上限下的全量枚举仍快速且最优（穷举交叉验证）', () => {
  // 构造 20 个克重交错的筒，需求迫使最小筒数为 3，枚举 C(20,3)=1140
  const cones = Array.from({ length: 20 }, (_, i) => ({
    id: String(i + 1),
    weight: 2 + ((i * 7) % 5) * 0.3, // 2.0 ~ 3.2
  }));
  const res = selectCones(cones, 8);
  assert.equal(res.feasible, true);
  assert.equal(res.minCones, 3);
  assert.equal(res.evaluated, binomial(20, 3));
  // 穷举所有三元组交叉验证最优（在整数 0.1 克域比较，杜绝浮点累加误差）
  let best = null;
  const tenths = cones.map((c) => Math.round(c.weight * 10));
  // 编号序列按自然数逐位比较（不能直接 join 成字符串，否则 "10" < "3"）
  const seqLess = (a, b) => {
    for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
      if (a[i] !== b[i]) return a[i] < b[i];
    }
    return a.length < b.length;
  };
  for (let i = 0; i < 20; i += 1)
    for (let j = i + 1; j < 20; j += 1)
      for (let k2 = j + 1; k2 < 20; k2 += 1) {
        const totalT = tenths[i] + tenths[j] + tenths[k2];
        if (totalT < 80) continue;
        const ids = [i + 1, j + 1, k2 + 1].sort((a, b) => a - b);
        if (
          best === null ||
          totalT < best.totalT ||
          (totalT === best.totalT && seqLess(ids, best.ids))
        ) {
          best = { totalT, ids };
        }
      }
  assert.ok(best);
  assert.equal(res.selectedWeight, best.totalT / 10);
  assert.deepEqual(
    chosenIds(res),
    best.ids.map(String),
  );
});

test('纱筒规整：空编号剔除、重复编号保留首个、克重规整到 0.1 克', () => {
  const norm = normalizeCones([
    { id: ' 1 ', weight: 2.04 }, // 2.0（四舍五入式规整：2.04 → 2.0）
    { id: '', weight: 9 }, // 空编号剔除
    { id: '1', weight: 9 }, // 重复编号剔除（保留首个）
    { id: '2', weight: 3.05 }, // 3.1（0.1 粒度四舍五入）
    { id: '3', weight: -5 }, // 负克重按 0
    { id: '4', weight: NaN }, // 非数按 0
  ]);
  assert.deepEqual(
    norm.map((c) => [c.id, c.weight]),
    [
      ['1', 2],
      ['2', 3.1],
      ['3', 0],
      ['4', 0],
    ],
  );
});

test('损耗率裁剪常量与上限', () => {
  assert.equal(YARN_LOSS_MAX, 0.3);
  assert.equal(YARN_MAX_CONES, 20);
  assert.equal(clampLossRate(0.5), 0.3);
  assert.equal(clampLossRate(-0.1), 0);
  assert.equal(clampLossRate(NaN), 0);
  assert.equal(clampLossRate(0.123456), 0.123456);
});

test('空筒（克重 0）参与库存总量但不帮助覆盖：最小筒数不计空筒', () => {
  // 需求 2；空筒 0 克 + 2 克筒：空筒不能把筒数降到 1 以下之外，
  // 最优只用 2 克筒（1 筒）；编号决胜在“恰好 2 克”的筒中取最小
  const res = selectCones(
    [
      { id: 'E', weight: 0 },
      { id: '9', weight: 2 },
      { id: '2', weight: 2 },
    ],
    2,
  );
  assert.equal(res.minCones, 1);
  assert.deepEqual(chosenIds(res), ['2']);
  assert.equal(res.available, 4);
});

test('全部为空筒且有需求：库存不足，缺口等于需求', () => {
  const res = selectCones(
    [
      { id: '1', weight: 0 },
      { id: '2', weight: 0 },
    ],
    0.3,
  );
  assert.equal(res.feasible, false);
  assert.equal(res.available, 0);
  assert.equal(res.shortage, 0.3);
});

test('20 筒等重：定基数 DP 给出最小筒数 10 与编号最小序列（非贪心/无枚举膨胀）', () => {
  const cones = Array.from({ length: 20 }, (_, i) => ({
    id: String(20 - i),
    weight: 1,
  }));
  const res = selectCones(cones, 10);
  assert.equal(res.minCones, 10);
  assert.equal(res.evaluated, 184756); // C(20,10) 仍作为“该基数组合空间”展示
  assert.deepEqual(chosenIds(res), [
    '1', '2', '3', '4', '5', '6', '7', '8', '9', '10',
  ]);
  assert.equal(res.surplus, 0);
});

test('整图配筒：针数按视觉坐标统计（偶数行不镜像），逐符号求需求与子集', () => {  // 2 行 × 4 列：
  //   行1（奇 →） A A B B
  //   行2（偶 ←） A B B C
  const grid = [
    ['A', 'A', 'B', 'B'],
    ['A', 'B', 'B', 'C'],
  ];
  const counts = countStitches(grid);
  assert.equal(counts.get('A'), 3);
  assert.equal(counts.get('B'), 4);
  assert.equal(counts.get('C'), 1);

  const res = planYarn({
    grid,
    symbols: ['A', 'B', 'C'],
    params: {
      A: { gramsPerK: 20, lossRate: 0 },
      B: { gramsPerK: 25, lossRate: 0.05 },
      C: { gramsPerK: 30, lossRate: 0.3 },
    },
    cones: {
      // A: 3 × 20/1000 = 0.06 → 0.1
      A: [{ id: 'A1', weight: 0.1 }],
      // B: 4 × 25 × 1.05 / 1000 = 0.105 → 0.2
      B: [{ id: 'B1', weight: 0.1 }], // 不足
      // C: 1 × 30 × 1.3 / 1000 = 0.039 → 0.1；无筒 → 缺口
      C: [],
    },
  });
  const [a, b, c] = res.rows;
  assert.equal(a.symbol, 'A');
  assert.equal(a.stitches, 3);
  assert.equal(a.demand, 0.1);
  assert.equal(a.feasible, true);
  assert.deepEqual(chosenIds(a), ['A1']);
  assert.equal(a.surplus, 0);

  assert.equal(b.stitches, 4);
  assert.equal(b.demand, 0.2);
  assert.equal(b.feasible, false);
  assert.equal(b.available, 0.1);
  assert.equal(b.shortage, 0.1);
  assert.deepEqual(chosenIds(b), []);

  assert.equal(c.stitches, 1);
  assert.equal(c.demand, 0.1);
  assert.equal(c.feasible, false);
  assert.equal(c.available, 0);
  assert.equal(c.shortage, 0.1);
});
