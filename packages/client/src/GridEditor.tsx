import { useEffect, useMemo, useRef } from 'react';
import type { CSSProperties } from 'react';
import type { DiffCell, FloatSpan } from '@jacquard/shared';

/** 循环花版单元边界叠加（视觉坐标相位） */
export interface RepeatOverlay {
  /** 单元行数（垂直周期） */
  rowPeriod: number;
  /** 单元列数（水平周期） */
  colPeriod: number;
  /** 行相位偏移（0..rowPeriod-1，视觉坐标） */
  rowOffset: number;
  /** 列相位偏移（0..colPeriod-1，视觉坐标） */
  colOffset: number;
}

interface GridEditorProps {
  width: number;
  height: number;
  grid: string[][];
  rowIssueMap: Map<number, string>; // 1 基行号 -> 错误简述
  appliedRows: number[];
  /** 超过阈值的浮线区间（视觉坐标） */
  floatRisks: FloatSpan[];
  /** 当前在风险列表中选中的浮线（来自同一 floatRisks 数组，按引用比较） */
  selectedFloat: FloatSpan | null;
  /** 循环花版单元边界叠加；null 表示不绘制 */
  repeatOverlay: RepeatOverlay | null;
  /** 对版差异格（视觉坐标）；缺省/空数组表示不叠加 */
  diffCells?: DiffCell[];
  /** 对版侧栏选中的差异格（定位高亮） */
  selectedDiff?: DiffCell | null;
  /** 只读模式（对版页）：禁止绘制 */
  readOnly?: boolean;
  onPaint: (row: number, col: number) => void;
}

const SYMBOL_CLASS: Record<string, string> = {
  A: 'sym-a',
  B: 'sym-b',
  C: 'sym-c',
};

interface FloatMark {
  /** 是否为某段浮线的起/止列（同色针脚） */
  anchor: boolean;
  /** 是否属于当前选中的浮线 */
  selected: boolean;
  /** 覆盖该格的第一段浮线说明（用于悬浮提示） */
  tip: string;
}

/**
 * 定宽符号网格。
 * 关键约束：视觉坐标恒定——列 0 始终在最左；
 * 偶数行行首用 ← 标注实际编织方向，但该行绝不做视觉镜像。
 * 浮线风险同样按视觉坐标标注：起止列描边、区间下划红线，不随偶数行翻转。
 * 循环花版边界按单元周期与视觉坐标相位描线，同样不做镜像。
 * 对版差异也按视觉坐标叠加：新增/缺失/替换描边，角标显示候选符号。
 */
export default function GridEditor({
  width,
  height,
  grid,
  rowIssueMap,
  appliedRows,
  floatRisks,
  selectedFloat,
  repeatOverlay,
  diffCells,
  selectedDiff,
  readOnly = false,
  onPaint,
}: GridEditorProps) {
  const painting = useRef(false);
  const tableRef = useRef<HTMLTableElement>(null);

  /** 格子（0 基 "r-c"）→ 浮线标注；不同颜色的浮线区间可能重叠，逐格合并 */
  const floatMarks = useMemo(() => {
    const marks = new Map<string, FloatMark>();
    for (const span of floatRisks) {
      const isSelected = span === selectedFloat;
      const tip = `浮线风险：符号 ${span.symbol} 第 ${span.startCol}–${span.endCol} 列，跨 ${span.length} 针`;
      for (let c1 = span.startCol; c1 <= span.endCol; c1 += 1) {
        const key = `${span.row - 1}-${c1 - 1}`;
        const prev = marks.get(key);
        marks.set(key, {
          anchor:
            (prev?.anchor ?? false) ||
            c1 === span.startCol ||
            c1 === span.endCol,
          selected: (prev?.selected ?? false) || isSelected,
          tip: prev?.tip ?? tip,
        });
      }
    }
    return marks;
  }, [floatRisks, selectedFloat]);

  /** 格子（0 基 "r-c"）→ 对版差异；差异列恒为视觉坐标，不随偶数行镜像 */
  const diffMarks = useMemo(() => {
    const marks = new Map<string, DiffCell>();
    for (const cell of diffCells ?? []) {
      marks.set(`${cell.row - 1}-${cell.col - 1}`, cell);
    }
    return marks;
  }, [diffCells]);

  /** 选中风险条目后，把该浮线起始列滚动到可视区域 */
  useEffect(() => {
    if (!selectedFloat) return;
    const el = tableRef.current?.querySelector(
      `[data-cell="${selectedFloat.row - 1}-${selectedFloat.startCol - 1}"]`,
    );
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }, [selectedFloat]);

  /** 对版侧栏点击条目后，把首个差异格滚动到可视区域 */
  useEffect(() => {
    if (!selectedDiff) return;
    const el = tableRef.current?.querySelector(
      `[data-cell="${selectedDiff.row - 1}-${selectedDiff.col - 1}"]`,
    );
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }, [selectedDiff]);

  const rowClass = (r1: number) => {
    const classes: string[] = [];
    if (rowIssueMap.has(r1)) classes.push('row-error');
    if (appliedRows.includes(r1)) classes.push('row-applied');
    if (selectedFloat && selectedFloat.row === r1)
      classes.push('row-float-selected');
    if (selectedDiff && selectedDiff.row === r1)
      classes.push('row-diff-selected');
    return classes.join(' ');
  };

  /**
   * 循环花版单元边界：按视觉坐标相位 (rowOffset, colOffset) 以
   * (rowPeriod, colPeriod) 为周期逐格描线；网格外缘自动闭合边界处的
   * 残缺单元。与错误行的红色内阴影合成，避免样式互相覆盖。
   */
  const repeatCellStyle = (
    r: number,
    c: number,
    hasIssue: boolean,
  ): CSSProperties | undefined => {
    if (!repeatOverlay) return undefined;
    const { rowPeriod, colPeriod, rowOffset, colOffset } = repeatOverlay;
    const rm = (((r - rowOffset) % rowPeriod) + rowPeriod) % rowPeriod;
    const cm = (((c - colOffset) % colPeriod) + colPeriod) % colPeriod;
    const shadows: string[] = [];
    if (hasIssue) shadows.push('inset 0 0 0 2px rgba(214, 69, 69, 0.55)');
    if (rm === 0 || r === 0) shadows.push('inset 0 3px 0 var(--rep)');
    if (cm === 0 || c === 0) shadows.push('inset 3px 0 0 var(--rep)');
    if (rm === rowPeriod - 1 || r === height - 1)
      shadows.push('inset 0 -3px 0 var(--rep)');
    if (cm === colPeriod - 1 || c === width - 1)
      shadows.push('inset -3px 0 0 var(--rep)');
    return shadows.length > 0 ? { boxShadow: shadows.join(', ') } : undefined;
  };

  return (
    <div className="grid-scroll">
      <table
        ref={tableRef}
        className={`grid-table${readOnly ? ' readonly' : ''}`}
        onPointerDown={() => {
          painting.current = true;
        }}
        onPointerUp={() => {
          painting.current = false;
        }}
        onPointerLeave={() => {
          painting.current = false;
        }}
      >
        <thead>
          <tr>
            <th className="corner-head">行</th>
            {Array.from({ length: width }, (_, c) => (
              <th key={c} className="col-head">
                {c + 1}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: height }, (_, r) => {
            const r1 = r + 1;
            const isOdd = r1 % 2 === 1;
            const issue = rowIssueMap.get(r1);
            return (
              <tr key={r} className={rowClass(r1)}>
                <th className="row-head" title={isOdd ? '奇数行：自左向右 →' : '偶数行：自右向左 ←'}>
                  <span className="row-no">{String(r1).padStart(2, '0')}</span>
                  <span className={`dir-arrow ${isOdd ? 'odd' : 'even'}`}>
                    {isOdd ? '→' : '←'}
                  </span>
                </th>
                {Array.from({ length: width }, (_, c) => {
                  const symbol = grid[r]?.[c] ?? '';
                  const mark = floatMarks.get(`${r}-${c}`);
                  const diff = diffMarks.get(`${r}-${c}`);
                  const cellClasses = ['grid-cell', SYMBOL_CLASS[symbol] ?? ''];
                  if (mark) cellClasses.push('float-risk');
                  if (mark?.anchor) cellClasses.push('float-anchor');
                  if (mark?.selected) cellClasses.push('float-selected');
                  if (diff) {
                    cellClasses.push('diff-mark', `diff-${diff.kind}`);
                    if (
                      selectedDiff &&
                      selectedDiff.row === diff.row &&
                      selectedDiff.col === diff.col
                    ) {
                      cellClasses.push('diff-selected');
                    }
                  }
                  const baseTitle = `第 ${r1} 行 第 ${c + 1} 列（视觉坐标）`;
                  const diffKindText =
                    diff?.kind === 'added'
                      ? '新增纹样'
                      : diff?.kind === 'missing'
                        ? '缺失纹样'
                        : '颜色替换';
                  const title = diff
                    ? `${baseTitle}｜对版差异·${diffKindText}：当前 ${diff.gridSymbol} → 候选 ${diff.candidateSymbol}`
                    : mark
                      ? `${baseTitle}｜${mark.tip}`
                      : baseTitle;
                  return (
                    <td key={c} className="grid-cell-td">
                      <button
                        type="button"
                        data-cell={`${r}-${c}`}
                        data-cand={diff ? diff.candidateSymbol : undefined}
                        className={cellClasses.join(' ')}
                        style={repeatCellStyle(r, c, issue !== undefined)}
                        title={title}
                        onPointerDown={(e) => {
                          if (readOnly) return;
                          e.preventDefault();
                          painting.current = true;
                          onPaint(r, c);
                        }}
                        onPointerEnter={() => {
                          if (!readOnly && painting.current) onPaint(r, c);
                        }}
                      >
                        {symbol}
                      </button>
                    </td>
                  );
                })}
                {issue ? (
                  <th className="row-flag" title={issue}>
                    !
                  </th>
                ) : (
                  <th className="row-flag row-flag-empty" />
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
