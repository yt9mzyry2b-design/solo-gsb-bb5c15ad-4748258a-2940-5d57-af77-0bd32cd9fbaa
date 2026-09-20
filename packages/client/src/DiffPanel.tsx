import type {
  AlignSearchResult,
  CompareResult,
  DiffCell,
  DiffRowSummary,
} from '@jacquard/shared';
import { ALIGN_MAX_SHIFT_LIMIT } from '@jacquard/shared';

interface DiffPanelProps {
  /** 对版结果（随候选口令 / 当前网格实时重算） */
  result: CompareResult;
  /** 错位对齐搜索结果（随候选口令 / 当前网格 / 最大偏移实时重算） */
  align: AlignSearchResult;
  /** 用户限定的最大偏移（行、列方向 ±maxShift） */
  maxShift: number;
  onMaxShiftChange: (value: number) => void;
  /** 是否正在预览最佳对齐 */
  alignActive: boolean;
  /** 一键切换最佳对齐预览 */
  onToggleAlign: () => void;
  /** 当前定位选中的差异格 */
  selected: DiffCell | null;
  /** 点击行条目：定位该行首个差异 */
  onSelect: (cell: DiffCell) => void;
  /** 一键清除对版状态 */
  onClear: () => void;
  /** 跳转到「游程口令」页编辑候选 */
  onEditCommand: () => void;
  /** 候选口令是否为空（空时给出引导） */
  hasCandidateText: boolean;
}

/** 偏移量带符号显示：+2 / 0 / -1 */
function formatOffset(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

/** 最大偏移输入钳制到 [0, ALIGN_MAX_SHIFT_LIMIT] 的整数 */
function clampMaxShift(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(ALIGN_MAX_SHIFT_LIMIT, Math.trunc(value)));
}

/** 单条行汇总 */
function RowEntry({
  summary,
  firstCell,
  selected,
  onSelect,
}: {
  summary: DiffRowSummary;
  firstCell: DiffCell | null;
  selected: DiffCell | null;
  onSelect: (cell: DiffCell) => void;
}) {
  const { row, status } = summary;

  if (status === 'diff' && firstCell) {
    const isSelected = selected !== null && selected.row === row;
    return (
      <button
        type="button"
        className={`diff-item diff-item-diff${isSelected ? ' selected' : ''}`}
        onClick={() => onSelect(firstCell)}
        title="点击定位该行首个差异"
      >
        <span className="diff-loc">第 {row} 行</span>
        <span className="diff-counts">
          {summary.added > 0 && (
            <em className="diff-count added">新增 {summary.added}</em>
          )}
          {summary.missing > 0 && (
            <em className="diff-count missing">缺失 {summary.missing}</em>
          )}
          {summary.replaced > 0 && (
            <em className="diff-count replaced">替换 {summary.replaced}</em>
          )}
          <span className="diff-first">首个差异第 {summary.firstDiffCol} 列</span>
        </span>
      </button>
    );
  }

  if (status === 'same') {
    return (
      <div className="diff-item diff-item-same">
        <span className="diff-loc">第 {row} 行</span>
        <span className="diff-counts">✓ 与候选一致</span>
      </div>
    );
  }

  return (
    <div
      className={`diff-item diff-item-${status}`}
      title={summary.reason ?? undefined}
    >
      <span className="diff-loc">第 {row} 行</span>
      <span className="diff-counts">
        不可比较：{status === 'missing' ? '无候选口令' : (summary.reason ?? '')}
      </span>
    </div>
  );
}

/**
 * 对版侧栏：按行汇总新增/缺失/替换数量，点击条目定位首个差异。
 * 差异列恒为视觉坐标，不随偶数行镜像；不可比较行（针数错误 /
 * 无法解析 / 无候选）不参与差异。
 * 错位对齐区块：显示原始与最佳差异数及最佳偏移，支持一键切换
 * 最佳对齐预览；针数错误/缺失行不参与评分。
 */
export default function DiffPanel({
  result,
  align,
  maxShift,
  onMaxShiftChange,
  alignActive,
  onToggleAlign,
  selected,
  onSelect,
  onClear,
  onEditCommand,
  hasCandidateText,
}: DiffPanelProps) {
  const { totals, rows, comparableRows, issues } = result;
  const diffRows = rows.filter((r) => r.status === 'diff').length;
  // 行号冲突 / 越界等无法落到图案行的候选问题（行内校验问题已在行条目里体现）
  const mappingIssues = issues.filter(
    (i) => i.code === 'DUPLICATE_ROW' || i.code === 'ROW_OUT_OF_RANGE',
  );

  return (
    <aside className="diff-panel" aria-label="对版结果">
      <div className="diff-head">
        <span className="diff-title">对版结果</span>
        <button type="button" className="diff-clear" onClick={onClear}>
          清除对版
        </button>
      </div>

      <div className="diff-summary">
        <em className="diff-count added">新增 {totals.added}</em>
        <em className="diff-count missing">缺失 {totals.missing}</em>
        <em className="diff-count replaced">替换 {totals.replaced}</em>
        <span className="diff-meta">
          {comparableRows} 行可比较 · {diffRows} 行有差异
          {alignActive && ' · 最佳对齐预览中'}
        </span>
      </div>

      <div className="align-box">
        <div className="align-head">
          <span className="align-title">错位对齐</span>
          <label className="align-max">
            最大偏移
            <input
              type="number"
              min={0}
              max={ALIGN_MAX_SHIFT_LIMIT}
              value={maxShift}
              onChange={(e) =>
                onMaxShiftChange(clampMaxShift(Number(e.target.value)))
              }
            />
          </label>
        </div>
        {align.scoredRows === 0 ? (
          <div className="align-note">
            没有可比较的候选行（针数错误或缺失行不参与评分），无法搜索错位对齐。
          </div>
        ) : (
          <>
            <div className="align-stats">
              <span>
                原始差异 <strong>{align.originalDiffs}</strong> 格
              </span>
              <span>
                最佳差异 <strong>{align.best.diffs}</strong> 格（行{' '}
                {formatOffset(align.best.dr)} · 列 {formatOffset(align.best.dc)}
                ）
              </span>
            </div>
            <div className="align-meta">
              {align.scoredRows} 行参与评分 · 枚举 {align.evaluated} 种循环平移
            </div>
            {align.improved ? (
              <button
                type="button"
                className={`align-toggle${alignActive ? ' active' : ''}`}
                onClick={onToggleAlign}
              >
                {alignActive ? '返回原始对版' : '预览最佳对齐'}
              </button>
            ) : (
              <div className="align-note">
                最佳对齐即原始位置（偏移 0,0），无需平移。
              </div>
            )}
          </>
        )}
      </div>

      {!hasCandidateText && (
        <div className="diff-empty">
          候选口令为空——请先在「游程口令」页输入或生成候选口令，
          对版只读比较、绝不回写当前网格。
          <button type="button" className="diff-goto" onClick={onEditCommand}>
            去编辑候选口令
          </button>
        </div>
      )}

      <ul className="diff-list">
        {rows.map((summary) => (
          <li key={summary.row}>
            <RowEntry
              summary={summary}
              firstCell={
                summary.status === 'diff'
                  ? (result.cells.find((c) => c.row === summary.row) ?? null)
                  : null
              }
              selected={selected}
              onSelect={onSelect}
            />
          </li>
        ))}
      </ul>

      {mappingIssues.length > 0 && (
        <div className="diff-mapping-issues">
          候选口令另有 {mappingIssues.length} 处行号冲突/越界，未参与对版：
          {mappingIssues.map((i, idx) => (
            <span key={idx} className="diff-mapping-issue">
              口令第 {i.line} 行（
              {i.code === 'DUPLICATE_ROW' ? '行号冲突' : '行号越界'}）
            </span>
          ))}
        </div>
      )}
    </aside>
  );
}
