import { useState } from 'react';
import type { YarnCone, YarnSymbolPlan, YarnSymbolSpec } from '@jacquard/shared';
import { YARN_MAX_CONES, YARN_MAX_LOSS_PERCENT } from '@jacquard/shared';

/** 备纱配筒的本地配置（保存到 localStorage） */
export interface YarnConfig {
  /** 各符号用纱参数（lossRate 为 0～0.30 的比率） */
  specs: YarnSymbolSpec[];
  /** 全部纱筒（跨符号合计不超过 YARN_MAX_CONES，编号唯一） */
  cones: YarnCone[];
}

interface YarnPanelProps {
  symbols: string[];
  config: YarnConfig;
  /** 随网格/配置实时重算的配筒方案（与 config.specs 同序） */
  plan: YarnSymbolPlan[];
  onConfigChange: (next: YarnConfig) => void;
}

/** 克重显示：固定 0.1 克精度 */
function fmtGrams(g: number): string {
  return g.toFixed(1);
}

/** 钳制并取整到 0.1 刻度 */
function clampTenths(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.round(Math.min(max, Math.max(min, value)) * 10) / 10;
}

interface ConeDraft {
  id: string;
  grams: string;
}

/**
 * 备纱配筒面板：为 A/B/C 设置克/1000针与损耗率，录入带唯一编号和
 * 可用克重的纱筒（合计最多 20 个）；按当前网格针数实时计算需求并
 * 精确选筒，展示针数、需求、选中筒与余量/缺口。配置保存于本地。
 */
export default function YarnPanel({
  symbols,
  config,
  plan,
  onConfigChange,
}: YarnPanelProps) {
  /** 各符号新筒录入草稿（受控文本，添加时才校验） */
  const [drafts, setDrafts] = useState<Record<string, ConeDraft>>({});
  /** 各符号录入错误信息 */
  const [errors, setErrors] = useState<Record<string, string>>({});

  const specOf = (symbol: string): YarnSymbolSpec =>
    config.specs.find((s) => s.symbol === symbol) ?? {
      symbol,
      gramsPer1000: 0,
      lossRate: 0,
    };
  const planOf = (symbol: string): YarnSymbolPlan | undefined =>
    plan.find((p) => p.symbol === symbol);
  const conesOf = (symbol: string): YarnCone[] =>
    config.cones.filter((c) => c.symbol === symbol);
  const draftOf = (symbol: string): ConeDraft =>
    drafts[symbol] ?? { id: '', grams: '' };

  const updateSpec = (
    symbol: string,
    patch: Partial<Pick<YarnSymbolSpec, 'gramsPer1000' | 'lossRate'>>,
  ) => {
    const rest = config.specs.filter((s) => s.symbol !== symbol);
    onConfigChange({
      ...config,
      specs: [...rest, { ...specOf(symbol), ...patch }].sort((a, b) =>
        symbols.indexOf(a.symbol) - symbols.indexOf(b.symbol),
      ),
    });
  };

  const setDraft = (symbol: string, draft: ConeDraft) => {
    setDrafts((prev) => ({ ...prev, [symbol]: draft }));
  };

  const addCone = (symbol: string) => {
    const draft = draftOf(symbol);
    const id = draft.id.trim();
    const fail = (msg: string) =>
      setErrors((prev) => ({ ...prev, [symbol]: msg }));
    if (id === '') return fail('编号不能为空');
    if (config.cones.some((c) => c.id === id))
      return fail(`编号 ${id} 已存在（编号必须唯一）`);
    if (config.cones.length >= YARN_MAX_CONES)
      return fail(`纱筒总数已达上限 ${YARN_MAX_CONES} 个`);
    const grams = Number(draft.grams);
    if (!Number.isFinite(grams) || grams <= 0)
      return fail('可用克重必须是大于 0 的数');
    const rounded = clampTenths(grams, 0, 999.9);
    if (rounded <= 0) return fail('可用克重至少 0.1 克');

    onConfigChange({
      ...config,
      cones: [...config.cones, { id, symbol, grams: rounded }],
    });
    setDrafts((prev) => ({ ...prev, [symbol]: { id: '', grams: '' } }));
    setErrors((prev) => ({ ...prev, [symbol]: '' }));
  };

  const removeCone = (id: string) => {
    onConfigChange({
      ...config,
      cones: config.cones.filter((c) => c.id !== id),
    });
  };

  const totalDemand = plan.reduce((acc, p) => acc + p.demand, 0);
  const totalUsed = plan.reduce(
    (acc, p) => acc + (p.selected?.length ?? 0),
    0,
  );
  const shortSymbols = plan.filter((p) => !p.feasible).map((p) => p.symbol);

  return (
    <section className="yarn-panel" aria-label="备纱配筒">
      <div className="yarn-head">
        <span className="yarn-title">备纱配筒</span>
        <span className="yarn-meta">
          已录 <strong>{config.cones.length}</strong> / {YARN_MAX_CONES} 筒 ·
          需求合计 <strong>{fmtGrams(totalDemand)}</strong> 克 · 启用{' '}
          <strong>{totalUsed}</strong> 筒
          {shortSymbols.length > 0 && (
            <strong className="yarn-short">
              ｜库存不足：{shortSymbols.join('、')}
            </strong>
          )}
        </span>
        <span className="hint">
          需求 = 针数 × 克/1000针 ÷ 1000 ×（1＋损耗率），向上取到 0.1 克；
          精确选筒：依次最小化启用筒数、超出克重、编号序列。
        </span>
      </div>

      <div className="yarn-body">
        {symbols.map((symbol) => {
          const spec = specOf(symbol);
          const p = planOf(symbol);
          const cones = conesOf(symbol);
          const draft = draftOf(symbol);
          const error = errors[symbol];
          const selectedIds = new Set(
            (p?.selected ?? []).map((c) => c.id),
          );
          const selectedSum = (p?.selected ?? []).reduce(
            (acc, c) => acc + c.grams,
            0,
          );
          return (
            <div className="yarn-symbol" key={symbol}>
              <div className="yarn-symbol-head">
                <span className="yarn-symbol-name">
                  <i className={`swatch sym-${symbol.toLowerCase()}`} />
                  符号 {symbol}
                </span>
                <label>
                  克/1000针
                  <input
                    type="number"
                    min={0}
                    max={999.9}
                    step={0.1}
                    value={spec.gramsPer1000}
                    onChange={(e) =>
                      updateSpec(symbol, {
                        gramsPer1000: clampTenths(
                          Number(e.target.value),
                          0,
                          999.9,
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  损耗率
                  <input
                    type="number"
                    min={0}
                    max={YARN_MAX_LOSS_PERCENT}
                    step={0.1}
                    value={Math.round(spec.lossRate * 1000) / 10}
                    onChange={(e) =>
                      updateSpec(symbol, {
                        lossRate:
                          clampTenths(
                            Number(e.target.value),
                            0,
                            YARN_MAX_LOSS_PERCENT,
                          ) / 100,
                      })
                    }
                  />
                  %
                </label>
              </div>

              {p && (
                <div
                  className={`yarn-stats${p.feasible ? '' : ' infeasible'}`}
                >
                  <span>
                    针数 <strong>{p.stitches}</strong>
                  </span>
                  <span>
                    需求 <strong>{fmtGrams(p.demand)}</strong> 克
                  </span>
                  {p.feasible ? (
                    p.selected && p.selected.length > 0 ? (
                      <>
                        <span>
                          选中筒：
                          {(p.selected ?? []).map((c) => (
                            <code key={c.id} className="yarn-pick">
                              {c.id}
                            </code>
                          ))}
                          （合计 {fmtGrams(selectedSum)} 克）
                        </span>
                        <span className="yarn-surplus">
                          余量 {fmtGrams(p.surplus ?? 0)} 克
                        </span>
                      </>
                    ) : (
                      <span className="yarn-surplus">无需用纱，不启用筒</span>
                    )
                  ) : (
                    <>
                      <span className="yarn-gap">
                        库存不足：缺口 {fmtGrams(p.shortfall ?? 0)} 克
                      </span>
                      <span>
                        （全部可用量 {fmtGrams(p.totalAvailable)} 克）
                      </span>
                    </>
                  )}
                </div>
              )}

              {cones.length > 0 && (
                <ul className="yarn-cone-list">
                  {cones.map((c) => (
                    <li
                      key={c.id}
                      className={`yarn-cone${
                        selectedIds.has(c.id) ? ' selected' : ''
                      }`}
                    >
                      <code className="yarn-cone-id">{c.id}</code>
                      <span className="yarn-cone-grams">
                        {fmtGrams(c.grams)} 克
                      </span>
                      {selectedIds.has(c.id) && (
                        <span className="yarn-badge">选中</span>
                      )}
                      <button
                        type="button"
                        className="yarn-remove"
                        title={`删除纱筒 ${c.id}`}
                        onClick={() => removeCone(c.id)}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <div className="yarn-add">
                <input
                  type="text"
                  placeholder="编号（唯一）"
                  value={draft.id}
                  onChange={(e) =>
                    setDraft(symbol, { ...draft, id: e.target.value })
                  }
                />
                <input
                  type="number"
                  placeholder="可用克重"
                  min={0.1}
                  max={999.9}
                  step={0.1}
                  value={draft.grams}
                  onChange={(e) =>
                    setDraft(symbol, { ...draft, grams: e.target.value })
                  }
                />
                <button
                  type="button"
                  disabled={config.cones.length >= YARN_MAX_CONES}
                  onClick={() => addCone(symbol)}
                >
                  添加纱筒
                </button>
                {error && <span className="yarn-error">{error}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
