import { useEffect, useMemo, useRef } from 'react';
import type { RepeatResult } from '@jacquard/shared';
import {
  REPEAT_PREVIEW_TILES,
  buildTiledPreview,
  shiftUnit,
} from '@jacquard/shared';

interface RepeatPanelProps {
  /** 最小二维重复单元搜索结果（随网格实时重算） */
  repeat: RepeatResult;
  /** 单元相位偏移（视觉坐标，0..单元行数/列数-1） */
  offset: { r: number; c: number };
  onOffsetChange: (offset: { r: number; c: number }) => void;
}

/** 与 styles.css 中符号底色保持一致（canvas 无法读 CSS 变量，单列一份） */
const SYM_FILL: Record<string, string> = {
  A: '#eef2f7',
  B: '#2b3a55',
  C: '#d9893d',
};
const REP_COLOR = '#6d28d9';

function clampOffset(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(max, Math.trunc(value)));
}

/** 单元本体预览（应用偏移后的相位，带符号字母） */
function UnitPreview({ cells }: { cells: string[][] }) {
  return (
    <div className="unit-preview">
      {cells.map((row, r) => (
        <div className="unit-row" key={r}>
          {row.map((s, c) => (
            <i key={c} className={`unit-cell sym-${s.toLowerCase()}`}>
              {s}
            </i>
          ))}
        </div>
      ))}
    </div>
  );
}

/** 3×3 平铺预览：canvas 绘制（大单元时格子极多，DOM 会卡顿），中心描出当前单元 */
function TilingPreview({
  unit,
  dr,
  dc,
}: {
  unit: string[][];
  dr: number;
  dc: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const unitRows = unit.length;
  const unitCols = unit[0]?.length ?? 0;
  const tiles = REPEAT_PREVIEW_TILES;
  const cell = Math.max(
    2,
    Math.min(16, Math.floor(300 / (tiles * Math.max(unitRows, unitCols, 1)))),
  );

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || unitRows === 0 || unitCols === 0) return;
    const tiled = buildTiledPreview(unit, dr, dc, tiles);
    const rows = tiled.length;
    const cols = tiled[0]?.length ?? 0;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = cols * cell * dpr;
    canvas.height = rows * cell * dpr;
    canvas.style.width = `${cols * cell}px`;
    canvas.style.height = `${rows * cell}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        ctx.fillStyle = SYM_FILL[tiled[r][c]] ?? '#eeeeee';
        ctx.fillRect(c * cell, r * cell, cell, cell);
      }
    }
    // 格子细分线（格子太密时省略，避免糊成一片）
    if (cell >= 5) {
      ctx.strokeStyle = 'rgba(31, 41, 51, 0.10)';
      ctx.lineWidth = 1;
      for (let r = 0; r < rows; r += 1) {
        for (let c = 0; c < cols; c += 1) {
          ctx.strokeRect(c * cell + 0.5, r * cell + 0.5, cell - 1, cell - 1);
        }
      }
    }
    // 单元分界线
    ctx.strokeStyle = 'rgba(109, 40, 217, 0.55)';
    ctx.lineWidth = 1;
    for (let i = 1; i < tiles; i += 1) {
      const y = i * unitRows * cell + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(cols * cell, y);
      ctx.stroke();
      const x = i * unitCols * cell + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, rows * cell);
      ctx.stroke();
    }
    // 中心单元（当前相位的一个完整单元）描边
    ctx.strokeStyle = REP_COLOR;
    ctx.lineWidth = 2;
    ctx.strokeRect(
      unitCols * cell + 1,
      unitRows * cell + 1,
      unitCols * cell - 2,
      unitRows * cell - 2,
    );
  }, [unit, dr, dc, cell, unitRows, unitCols, tiles]);

  return <canvas ref={ref} className="tiling-canvas" role="img" aria-label="3×3 平铺预览" />;
}

/**
 * 循环花版面板：显示最小重复单元尺寸与压缩比，
 * 提供行/列偏移控制（视觉坐标，偶数行不镜像）与 3×3 平铺预览。
 */
export default function RepeatPanel({
  repeat,
  offset,
  onOffsetChange,
}: RepeatPanelProps) {
  const { unitRows, unitCols, unitArea, gridRows, gridCols, totalCells, ratio } =
    repeat;

  /** 应用当前偏移后的单元内容（纯相位平移，无镜像） */
  const shifted = useMemo(
    () => shiftUnit(repeat.cells, offset.r, offset.c),
    [repeat.cells, offset],
  );

  const ratioText = Number.isInteger(ratio) ? String(ratio) : ratio.toFixed(1);
  const percent =
    totalCells === 0 ? '0.0' : ((unitArea / totalCells) * 100).toFixed(1);
  const irreducible = unitArea === totalCells;

  return (
    <section className="repeat-panel" aria-label="循环花版">
      <div className="repeat-head">
        <span className="repeat-title">循环花版</span>
        <span className="repeat-meta">
          最小重复单元{' '}
          <strong>
            {unitRows} 行 × {unitCols} 列
          </strong>
          （{unitArea} 格） · 整幅 {gridRows}×{gridCols}（{totalCells} 格） ·
          压缩比 <strong>{ratioText} : 1</strong>（单元占整幅 {percent}%）
          {irreducible && ' · 当前图案无更小重复单元'}
        </span>
      </div>

      <div className="repeat-body">
        <div className="repeat-controls">
          <label>
            行偏移
            <input
              type="number"
              min={0}
              max={Math.max(0, unitRows - 1)}
              value={offset.r}
              onChange={(e) =>
                onOffsetChange({
                  r: clampOffset(Number(e.target.value), unitRows - 1),
                  c: offset.c,
                })
              }
            />
          </label>
          <label>
            列偏移
            <input
              type="number"
              min={0}
              max={Math.max(0, unitCols - 1)}
              value={offset.c}
              onChange={(e) =>
                onOffsetChange({
                  r: offset.r,
                  c: clampOffset(Number(e.target.value), unitCols - 1),
                })
              }
            />
          </label>
          <span className="hint">
            偏移按视觉坐标平移单元相位（0～周期-1 循环），偶数行不镜像；
            上方网格中的紫色线即单元边界。
          </span>
        </div>

        <div className="repeat-previews">
          <figure className="preview-block">
            <figcaption>单元（偏移后）</figcaption>
            <div className="preview-scroll">
              <UnitPreview cells={shifted} />
            </div>
          </figure>
          <figure className="preview-block">
            <figcaption>3×3 平铺预览</figcaption>
            <div className="preview-scroll">
              <TilingPreview unit={repeat.cells} dr={offset.r} dc={offset.c} />
            </div>
          </figure>
        </div>
      </div>
    </section>
  );
}
