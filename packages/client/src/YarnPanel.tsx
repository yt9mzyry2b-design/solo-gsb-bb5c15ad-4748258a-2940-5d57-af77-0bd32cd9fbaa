import { useEffect, useMemo, useState } from 'react';
import type { YarnCone, YarnPlanResult } from '@jacquard/shared';
import {
  YARN_LOSS_MAX,
  YARN_MAX_CONES,
  planYarn,
} from '@jacquard/shared';

/**
 * 备纱配筒面板（「图案网格」页）：
 * - 用户为 A/B/C 分别设置 克/1000针 与 损耗率（0～30%），
 *   并录入最多 20 个带唯一编号与可用克重的纱筒；
 * - 按当前网格各符号针数计算毛需求（针数 × 克/1000针 ÷ 1000 × (1+损耗率)，
 *   向上取到 0.1 克），再精确选出覆盖需求的纱筒子集，
 *   依次最小化 启用筒数 → 超出克重 → 编号序列（精确枚举，非逐筒贪心）；
 * - 库存不足时不生成伪可行组合，只显示缺口与全部可用量；
 * - 绘制、改尺寸或口令回写后随 grid 实时重算；配置保存在浏览器本地。
 *
 * 针数按视觉坐标统计，与浮线检查/循环花版一致，偶数行绝不镜像。
 */

interface SymbolConfig {
  /** 克/1000针（输入框文本，允许临时为空） */
  gramsPerK: string;
  /** 损耗率百分比文本（0～30） */
  lossPct: string;
  /** 纱筒列表（录入态，编号可能临时为空/重复，提交计算前规整） */
  cones: { id: string; weight: string }[];
}

interface StoredConfig {
  version: 1;
  symbols: Record<string, SymbolConfig>;
}

const STORAGE_KEY = 'jacquard.yarnPanel.v1';

function defaultSymbols(): string[] {
  return ['A', 'B', 'C'];
}

/** 首次使用的内置库存示例（用户可任意改写；配置保存在本地） */
function defaultConfig(): Record<string, SymbolConfig> {
  const seed = (
    prefix: string,
    weights: number[],
  ): { id: string; weight: string }[] =>
    weights.map((w, i) => ({
      id: `${prefix}${String(i + 1).padStart(2, '0')}`,
      weight: String(w),
    }));
  return {
    // 小克重筒：示例图案下可以直接看到“多筒覆盖 + 余量/决胜”的选筒结果
    A: { gramsPerK: '20', lossPct: '5', cones: seed('A', [1, 0.8, 0.5, 0.5]) },
    B: { gramsPerK: '25', lossPct: '5', cones: seed('B', [0.2, 0.3, 0.2, 0.4]) },
    C: { gramsPerK: '30', lossPct: '5', cones: seed('C', [0.2, 0.3, 0.2, 0.1]) },
  };
}

/** 解析非负有限数；空串/非法返回 0 */
function parseNonNeg(text: string): number {
  const v = Number(text);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/** 损耗率百分比：裁剪到 0～30，空串/非法按 0 */
function parseLossPct(text: string): number {
  const v = Number(text);
  if (!Number.isFinite(v) || v <= 0) return 0;
  return Math.min(YARN_LOSS_MAX * 100, v) / 100;
}

/** 克重展示：恒保留一位小数（0.1 克粒度） */
function fmt(g: number): string {
  return (Math.round(g * 10) / 10).toFixed(1);
}

/** 损耗率百分比展示，如 0.05 → "5%" */
function fmtPct(rate: number): string {
  return `${Math.round(rate * 1000) / 10}%`;
}

/** 从 localStorage 读取配置；损坏/缺字段时回退默认值 */
function loadConfig(): Record<string, SymbolConfig> {
  const fallback = defaultConfig();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as StoredConfig;
    if (!parsed || parsed.version !== 1 || typeof parsed.symbols !== 'object') {
      return fallback;
    }
    const out: Record<string, SymbolConfig> = {};
    for (const s of defaultSymbols()) {
      const c = parsed.symbols[s];
      if (!c || typeof c.gramsPerK !== 'string' || typeof c.lossPct !== 'string') {
        out[s] = fallback[s];
        continue;
      }
      const cones = Array.isArray(c.cones)
        ? c.cones
            .filter((x) => x && typeof x.id === 'string' && typeof x.weight === 'string')
            .slice(0, YARN_MAX_CONES)
            .map((x) => ({ id: x.id, weight: x.weight }))
        : [];
      out[s] = { gramsPerK: c.gramsPerK, lossPct: c.lossPct, cones };
    }
    return out;
  } catch {
    return fallback;
  }
}

interface YarnPanelProps {
  /** 当前网格（视觉坐标）；绘制、改尺寸、口令回写后引用变化即实时重算 */
  grid: string[][];
  symbols: string[];
}

export default function YarnPanel({ grid, symbols }: YarnPanelProps) {
  const [config, setConfig] = useState<Record<string, SymbolConfig>>(() =>
    typeof localStorage === 'undefined' ? defaultConfig() : loadConfig(),
  );

  /** 配置变化即写入本地（首次渲染也写一次，保证键存在） */
  useEffect(() => {
    try {
      const payload: StoredConfig = { version: 1, symbols: config };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // 隐私模式/配额异常时静默：配置仍在当前会话内有效
    }
  }, [config]);

  /** 更新单个符号的配置片段 */
  const patchSymbol = (s: string, patch: Partial<SymbolConfig>) =>
    setConfig((prev) => ({ ...prev, [s]: { ...prev[s], ...patch } }));

  const updateCone = (s: string, idx: number, key: 'id' | 'weight', value: string) =>
    setConfig((prev) => {
      const cones = prev[s].cones.map((c, i) =>
        i === idx ? { ...c, [key]: value } : c,
      );
      return { ...prev, [s]: { ...prev[s], cones } };
    });

  const addCone = (s: string) =>
    setConfig((prev) => {
      if (prev[s].cones.length >= YARN_MAX_CONES) return prev;
      return {
        ...prev,
        [s]: { ...prev[s], cones: [...prev[s].cones, { id: '', weight: '' }] },
      };
    });

  const removeCone = (s: string, idx: number) =>
    setConfig((prev) => ({
      ...prev,
      [s]: { ...prev[s], cones: prev[s].cones.filter((_, i) => i !== idx) },
    }));

  const resetSymbol = (s: string) =>
    setConfig((prev) => ({ ...prev, [s]: defaultConfig()[s] }));

  /**
   * 实时配筒：网格、单耗、损耗或纱筒任一变化立即重新计算。
   * 空编号的录入行不参与计算；重复编号由共享核心规整（保留首个）。
   */
  const plan: YarnPlanResult = useMemo(() => {
    const params: Record<string, { gramsPerK: number; lossRate: number }> = {};
    const cones: Record<string, YarnCone[]> = {};
    for (const raw of symbols) {
      const s = raw.toUpperCase();
      const cfg = config[s] ?? defaultConfig()[s];
      params[s] = {
        gramsPerK: parseNonNeg(cfg.gramsPerK),
        lossRate: parseLossPct(cfg.lossPct),
      };
      cones[s] = cfg.cones
        .filter((c) => c.id.trim() !== '')
        .map((c) => ({ id: c.id.trim(), weight: parseNonNeg(c.weight) }));
    }
    return planYarn({ grid, symbols, params, cones });
  }, [grid, symbols, config]);

  /** 每个符号录入中的重复编号（trim 后、忽略空行），用于提示 */
  const dupIdsBySymbol = useMemo(() => {
    const out: Record<string, Set<string>> = {};
    for (const raw of symbols) {
      const s = raw.toUpperCase();
      const seen = new Set<string>();
      const dup = new Set<string>();
      for (const c of config[s]?.cones ?? []) {
        const id = c.id.trim();
        if (id === '') continue;
        if (seen.has(id)) dup.add(id);
        seen.add(id);
      }
      out[s] = dup;
    }
    return out;
  }, [config, symbols]);

  const rowBySymbol = useMemo(
    () => new Map(plan.rows.map((r) => [r.symbol, r])),
    [plan],
  );

  return (
    <section className="yarn-panel" aria-label="备纱配筒">
      <div className="yarn-head">
        <span className="yarn-title">备纱配筒</span>
        <span className="yarn-meta">
          需求 = 针数 × 克/1000针 ÷ 1000 × (1+损耗率)，向上取到 0.1 克；
          选筒依次最小化 <strong>启用筒数 → 超出克重 → 编号序列</strong>
          （定基数子集和精确求解，非逐筒贪心）。库存不足时不报伪方案，只显示缺口。
          配置自动保存在本机浏览器。
        </span>
      </div>

      <div className="yarn-grid">
        {symbols.map((raw) => {
          const s = raw.toUpperCase();
          const cfg = config[s] ?? defaultConfig()[s];
          const row = rowBySymbol.get(s);
          const dupIds = dupIdsBySymbol[s] ?? new Set<string>();
          const lossWarn =
            cfg.lossPct.trim() !== '' &&
            (Number(cfg.lossPct) < 0 || Number(cfg.lossPct) > YARN_LOSS_MAX * 100);
          return (
            <div className={`yarn-sym sym-block-${s.toLowerCase()}`} key={s}>
              <div className="yarn-sym-head">
                <i className={`swatch sym-${s.toLowerCase()}`} />
                <strong>符号 {s}</strong>
                <button
                  type="button"
                  className="yarn-reset"
                  onClick={() => resetSymbol(s)}
                >
                  重置
                </button>
              </div>

              <div className="yarn-params">
                <label>
                  克/1000针
                  <input
                    type="number"
                    min={0}
                    step="0.1"
                    value={cfg.gramsPerK}
                    onChange={(e) => patchSymbol(s, { gramsPerK: e.target.value })}
                  />
                </label>
                <label className={lossWarn ? 'param-warn' : ''}>
                  损耗率%
                  <input
                    type="number"
                    min={0}
                    max={30}
                    step="0.5"
                    value={cfg.lossPct}
                    onChange={(e) => patchSymbol(s, { lossPct: e.target.value })}
                  />
                  （0～30）
                </label>
              </div>

              <div className="yarn-stats">
                <span>
                  针数 <strong>{row?.stitches ?? 0}</strong>
                </span>
                <span>
                  需求 <strong>{fmt(row?.demand ?? 0)}</strong> 克
                </span>
                <span className="yarn-loss-note">
                  单耗 {fmt(row?.gramsPerK ?? 0)} · 损耗 {fmtPct(row?.lossRate ?? 0)}
                </span>
              </div>

              <div className="yarn-cones">
                <div className="yarn-cones-head">
                  纱筒（{cfg.cones.length}/{YARN_MAX_CONES}）
                </div>
                {cfg.cones.length === 0 && (
                  <div className="yarn-cones-empty">暂无纱筒，点击下方“加纱筒”录入</div>
                )}
                {cfg.cones.map((cone, idx) => {
                  const trimmedId = cone.id.trim();
                  const isDup = dupIds.has(trimmedId) && trimmedId !== '';
                  // 核心规整时重复编号只保留首个，因此高亮也只给该编号
                  // 在录入列表中的第一个非空行，避免与实际选中筒不一致。
                  const firstIdx = cfg.cones.findIndex(
                    (c) => c.id.trim() === trimmedId,
                  );
                  const selected =
                    trimmedId !== '' &&
                    firstIdx === idx &&
                    (row?.selected.some((c) => c.id === trimmedId) ?? false);
                  return (
                    <div
                      className={`yarn-cone-row${isDup ? ' dup' : ''}${
                        selected ? ' selected' : ''
                      }`}
                      key={idx}
                    >
                      <input
                        className="yarn-cone-id"
                        type="text"
                        placeholder="编号"
                        value={cone.id}
                        maxLength={16}
                        onChange={(e) => updateCone(s, idx, 'id', e.target.value)}
                      />
                      <input
                        className="yarn-cone-weight"
                        type="number"
                        min={0}
                        step="0.1"
                        placeholder="克重"
                        value={cone.weight}
                        onChange={(e) => updateCone(s, idx, 'weight', e.target.value)}
                      />
                      <span className="yarn-cone-unit">克</span>
                      <button
                        type="button"
                        className="yarn-cone-del"
                        onClick={() => removeCone(s, idx)}
                        aria-label={`删除纱筒 ${cone.id || idx + 1}`}
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
                <button
                  type="button"
                  className="yarn-add"
                  disabled={cfg.cones.length >= YARN_MAX_CONES}
                  onClick={() => addCone(s)}
                >
                  + 加纱筒
                </button>
                {dupIds.size > 0 && (
                  <div className="yarn-dup-note">
                    编号重复：{[...dupIds].join('、')}（计算时各保留第一个）
                  </div>
                )}
              </div>

              <YarnResult symbol={s} />
            </div>
          );
        })}
      </div>
    </section>
  );

  /** 单个符号的配筒结论 */
  function YarnResult({ symbol }: { symbol: string }) {
    const r = rowBySymbol.get(symbol);
    if (!r) return null;

    if (r.stitches === 0) {
      return (
        <div className="yarn-result yarn-result-zero">
          当前网格没有符号 {symbol}：针数 0、需求 0，无需配筒。
        </div>
      );
    }

    if (!r.feasible) {
      return (
        <div className="yarn-result yarn-result-short">
          <div className="yarn-result-title">✗ 库存不足，不生成配筒方案</div>
          <div>
            需求 <strong>{fmt(r.demand)}</strong> 克 · 全部可用量{' '}
            <strong>{fmt(r.available)}</strong> 克（{r.coneCount} 个筒）
          </div>
          <div className="yarn-shortage">
            缺口 <strong>{fmt(r.shortage)}</strong> 克
          </div>
        </div>
      );
    }

    if (r.selected.length === 0) {
      // 有针数但需求向上取整后为 0（单耗为 0 或极小）：无需启用纱筒
      return (
        <div className="yarn-result yarn-result-zero">
          需求取整为 0.0 克（单耗 {fmt(r.gramsPerK)} 克/1000针），无需启用纱筒；
          库存 {fmt(r.available)} 克。
        </div>
      );
    }

    return (
      <div className="yarn-result yarn-result-ok">
        <div className="yarn-result-title">
          ✓ 启用 {r.selected.length} 筒
          {r.minCones !== null && r.evaluated !== null && (
            <span className="yarn-enum-note">
              （最少筒数 {r.minCones}，对应组合空间 C({r.coneCount},{r.minCones})=
              {Number.isFinite(r.evaluated) ? r.evaluated : '大量'}
              ，精确子集和求解）
            </span>
          )}
        </div>
        <ul className="yarn-selected">
          {r.selected.map((c) => (
            <li key={c.id}>
              <span className="yarn-cone-tag">{c.id}</span>
              {fmt(c.weight)} 克
            </li>
          ))}
        </ul>
        <div className="yarn-sum">
          合计 {fmt(r.selectedWeight)} 克 ·{' '}
          <span className="yarn-surplus">余量 {fmt(r.surplus)} 克</span>
        </div>
      </div>
    );
  }
}
