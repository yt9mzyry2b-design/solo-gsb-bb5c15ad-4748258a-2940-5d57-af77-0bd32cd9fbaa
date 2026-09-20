import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DecodeIssue, DiffCell, FloatSpan } from '@jacquard/shared';
import {
  ALIGN_MAX_SHIFT_DEFAULT,
  MAX_FLOAT_DEFAULT,
  MAX_FLOAT_MAX,
  MAX_FLOAT_MIN,
  checkFloats,
  compareCandidate,
  findMinRepeatUnit,
  searchBestAlignment,
} from '@jacquard/shared';
import { api } from './api.js';
import GridEditor from './GridEditor.js';
import CommandEditor from './CommandEditor.js';
import RepeatPanel from './RepeatPanel.js';
import DiffPanel from './DiffPanel.js';
import YarnPanel from './YarnPanel.js';

const SYMBOLS = ['A', 'B', 'C'];
const DEFAULT_WIDTH = 12;
const DEFAULT_HEIGHT = 8;

/** 对版页网格的固定空占位（不参与该页的编辑/校验/浮线/花版叠加） */
const EMPTY_ISSUE_MAP = new Map<number, string>();
const EMPTY_ROWS: number[] = [];
const EMPTY_FLOATS: FloatSpan[] = [];

function makeGrid(width: number, height: number, fill = 'A'): string[][] {
  return Array.from({ length: height }, () => new Array(width).fill(fill));
}

/** 对版页网格为只读，绘制回调为空操作 */
function noopPaint() {}

/** 偏移量带符号显示：+2 / 0 / -1 */
function formatOffset(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

/** 示例提花图案：交错菱形 */
function makeSample(width: number, height: number): string[][] {
  const grid = makeGrid(width, height, 'A');
  const cx = (width - 1) / 2;
  for (let r = 0; r < height; r += 1) {
    for (let c = 0; c < width; c += 1) {
      const d = Math.abs(c - cx) + Math.abs(r - (height - 1) / 2);
      if (d < 2.4) grid[r][c] = 'B';
      else if (d < 3.8) grid[r][c] = 'C';
    }
  }
  return grid;
}

type Tab = 'grid' | 'compare' | 'command';

export default function App() {
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const [grid, setGrid] = useState<string[][]>(() =>
    makeSample(DEFAULT_WIDTH, DEFAULT_HEIGHT),
  );
  const [activeSymbol, setActiveSymbol] = useState('B');
  const [tab, setTab] = useState<Tab>('grid');

  const [commandText, setCommandText] = useState('');
  const [issues, setIssues] = useState<DecodeIssue[]>([]);
  const [appliedRows, setAppliedRows] = useState<number[]>([]);
  const [selectedLine, setSelectedLine] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<{
    kind: 'ok' | 'warn' | 'error';
    text: string;
  } | null>(null);

  /** 浮线风险检查：最大浮线针数阈值与当前选中的风险条目 */
  const [maxFloat, setMaxFloat] = useState(MAX_FLOAT_DEFAULT);
  const [selectedFloat, setSelectedFloat] = useState<FloatSpan | null>(null);

  /**
   * 错位对齐搜索：把可比较的候选图案按视觉坐标在行、列方向循环平移，
   * 枚举 [−maxShift, +maxShift] 内全部偏移，按差异格总数选优；
   * 针数错误/缺失行不参与评分。纯函数实时重算——候选文本、当前网格、
   * 行宽/行数、最大偏移任一变化即重新搜索。
   */
  const [maxShift, setMaxShift] = useState(ALIGN_MAX_SHIFT_DEFAULT);
  const alignResult = useMemo(
    () =>
      searchBestAlignment({
        text: commandText,
        width,
        height,
        grid,
        symbols: SYMBOLS,
        maxShift,
      }),
    [commandText, width, height, grid, maxShift],
  );

  /** 是否正在预览最佳对齐（用户开启且最佳为非零偏移） */
  const [showAligned, setShowAligned] = useState(false);
  const alignActive =
    showAligned &&
    alignResult.scoredRows > 0 &&
    (alignResult.best.dr !== 0 || alignResult.best.dc !== 0);

  /**
   * 对版模式：候选口令（口令编辑区文本）→ 临时图案，与当前网格逐格比较。
   * 纯函数实时重算——候选文本、当前网格、行宽/行数任一变化即重新对版；
   * 只读比较，绝不回写网格；差异列恒为视觉坐标，不随偶数行镜像。
   * 开启最佳对齐预览时，候选图案整体按最佳偏移循环平移后再比较。
   */
  const compareResult = useMemo(
    () =>
      compareCandidate({
        text: commandText,
        width,
        height,
        grid,
        symbols: SYMBOLS,
        offset: alignActive
          ? { dr: alignResult.best.dr, dc: alignResult.best.dc }
          : undefined,
      }),
    [commandText, width, height, grid, alignActive, alignResult],
  );

  /** 对版状态是否被一键清除（清除后候选/网格再变化时自动恢复实时对版） */
  const [compareCleared, setCompareCleared] = useState(false);
  /** 侧栏当前定位的差异格 */
  const [selectedDiff, setSelectedDiff] = useState<DiffCell | null>(null);

  /** 候选文本或当前网格变化：对版结果实时重算，并解除“已清除”状态 */
  useEffect(() => {
    setCompareCleared(false);
  }, [commandText, grid]);

  /** 对版结果更新后，之前定位的差异格可能已不存在，清空选中态 */
  useEffect(() => {
    setSelectedDiff(null);
  }, [compareResult]);

  const clearCompare = useCallback(() => {
    setCompareCleared(true);
    setSelectedDiff(null);
    setShowAligned(false);
  }, []);

  /**
   * 浮线分析完全基于视觉坐标（不随偶数行镜像），纯函数实时重算：
   * 图案绘制、行宽/行数变化、口令回写（合法行覆盖、错误行保留原图）
   * 都会更新 grid，阈值变化更新 maxFloat，二者任一变化即重新检查。
   */
  const floatResult = useMemo(
    () => checkFloats(grid, maxFloat),
    [grid, maxFloat],
  );

  /** 图案或阈值变化后，之前选中的风险条目可能已不存在，清空选中态 */
  useEffect(() => {
    setSelectedFloat(null);
  }, [grid, maxFloat]);

  /**
   * 循环花版：最小二维重复单元搜索，纯函数实时重算——
   * 图案绘制、行宽/行数变化、口令回写都会更新 grid，随之立即重算。
   * 与浮线检查一致，完全基于视觉坐标，偶数行不镜像。
   */
  const repeatResult = useMemo(() => findMinRepeatUnit(grid), [grid]);

  /** 单元相位偏移（视觉坐标）；单元尺寸变化后归零，避免越界相位 */
  const [repeatOffset, setRepeatOffset] = useState({ r: 0, c: 0 });
  useEffect(() => {
    setRepeatOffset({ r: 0, c: 0 });
  }, [repeatResult.unitRows, repeatResult.unitCols]);

  /** 口令文本是否与当前网格一致（未手工修改） */
  const syncedText = useRef<string | null>(null);

  const paint = useCallback(
    (r: number, c: number) => {
      setGrid((prev) => {
        if (prev[r][c] === activeSymbol) return prev;
        const next = prev.map((row) => [...row]);
        next[r][c] = activeSymbol;
        return next;
      });
      // 网格一旦修改，旧的校验结果失效
      setIssues([]);
      setAppliedRows([]);
      setBanner(null);
      syncedText.current = null;
    },
    [activeSymbol],
  );

  const changeWidth = (w: number) => {
    setWidth(w);
    setGrid((prev) =>
      Array.from({ length: height }, (_, r) => {
        const old = prev[r] ?? [];
        const row = old.slice(0, w);
        while (row.length < w) row.push('A');
        return row;
      }),
    );
    setIssues([]);
    setAppliedRows([]);
    syncedText.current = null;
  };

  const changeHeight = (h: number) => {
    setHeight(h);
    setGrid((prev) => {
      const next = prev.slice(0, h);
      while (next.length < h) next.push(new Array(width).fill('A'));
      return next;
    });
    setIssues([]);
    setAppliedRows([]);
    syncedText.current = null;
  };

  const generateCommand = useCallback(
    async (switchTab: boolean) => {
      setBusy(true);
      setBanner(null);
      try {
        const res = await api.encode({ grid, width, height });
        setCommandText(res.text);
        syncedText.current = res.text;
        setIssues([]);
        setAppliedRows([]);
        if (switchTab) setTab('command');
      } catch (e) {
        setBanner({ kind: 'error', text: `生成口令失败：${(e as Error).message}` });
      } finally {
        setBusy(false);
      }
    },
    [grid, width, height],
  );

  const applyCommand = useCallback(async () => {
    setBusy(true);
    setBanner(null);
    try {
      const res = await api.decode({
        text: commandText,
        width,
        height,
        fallback: grid,
        symbols: SYMBOLS,
      });
      setGrid(res.grid);
      setIssues(res.issues);
      setAppliedRows(res.appliedRows);
      setSelectedLine(null);
      if (res.ok) {
        setBanner({
          kind: 'ok',
          text: `校验通过：${res.appliedRows.length} 行针数全部恰好等于行宽 ${width}，已回写网格。`,
        });
        syncedText.current = commandText;
      } else {
        setBanner({
          kind: 'warn',
          text: `已回写 ${res.appliedRows.length} 行；${res.issues.length} 处错误行保留原图（见下方定位）。偶数行按 ← 方向解析，视觉坐标不变。`,
        });
      }
      setTab('grid');
    } catch (e) {
      setBanner({ kind: 'error', text: `校验失败：${(e as Error).message}` });
    } finally {
      setBusy(false);
    }
  }, [commandText, width, height, grid]);

  const onCommandChange = (text: string) => {
    setCommandText(text);
    if (syncedText.current !== null && text !== syncedText.current) {
      syncedText.current = null;
    }
  };

  const switchTab = (next: Tab) => {
    // 首次进入口令页且尚无内容时，按当前网格自动生成；
    // 此后保留用户已编辑/已校验的口令文本，避免切换时丢修改
    if (
      next === 'command' &&
      commandText === '' &&
      syncedText.current === null &&
      !busy
    ) {
      void generateCommand(false).then(() => setTab('command'));
      return;
    }
    setTab(next);
  };

  const rowIssueMap = useMemo(() => {
    const m = new Map<number, string>();
    for (const issue of issues) {
      if (issue.row !== null && !m.has(issue.row)) {
        m.set(issue.row, issue.message);
      }
    }
    return m;
  }, [issues]);

  return (
    <div className="app">
      <header className="app-header">
        <h1>提花编织口令校验</h1>
        <p className="subtitle">
          奇数行 <strong>→ 自左向右</strong>，偶数行{' '}
          <strong>← 自右向左</strong>；口令按实际编织方向记录游程，
          偶数行视觉坐标始终保持原位、不做镜像。
        </p>
      </header>

      <div className="toolbar">
        <div className="tool-group">
          <label>
            行宽
            <input
              type="number"
              min={4}
              max={64}
              value={width}
              onChange={(e) => changeWidth(Number(e.target.value))}
            />
            针
          </label>
          <label>
            行数
            <input
              type="number"
              min={1}
              max={64}
              value={height}
              onChange={(e) => changeHeight(Number(e.target.value))}
            />
          </label>
        </div>

        <div className="tool-group symbol-group" role="group" aria-label="符号选择">
          {SYMBOLS.map((s) => (
            <button
              key={s}
              type="button"
              className={`symbol-btn sym-${s.toLowerCase()} ${
                activeSymbol === s ? 'selected' : ''
              }`}
              onClick={() => setActiveSymbol(s)}
            >
              {s}
            </button>
          ))}
          <span className="hint">点击或拖动绘制</span>
        </div>

        <div className="tool-group">
          <button type="button" onClick={() => setGrid(makeSample(width, height))}>
            示例图案
          </button>
          <button type="button" onClick={() => setGrid(makeGrid(width, height))}>
            清空
          </button>
        </div>
      </div>

      <div className="tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'grid'}
          className={tab === 'grid' ? 'tab active' : 'tab'}
          onClick={() => switchTab('grid')}
        >
          图案网格
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'compare'}
          className={tab === 'compare' ? 'tab active' : 'tab'}
          onClick={() => switchTab('compare')}
        >
          对版
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'command'}
          className={tab === 'command' ? 'tab active' : 'tab'}
          onClick={() => switchTab('command')}
        >
          游程口令
        </button>
      </div>

      {banner && <div className={`banner banner-${banner.kind}`}>{banner.text}</div>}

      <main className="panel">
        {tab === 'grid' ? (
          <>
            <GridEditor
              width={width}
              height={height}
              grid={grid}
              rowIssueMap={rowIssueMap}
              appliedRows={appliedRows}
              floatRisks={floatResult.risks}
              selectedFloat={selectedFloat}
              repeatOverlay={
                repeatResult.unitRows > 0
                  ? {
                      rowPeriod: repeatResult.unitRows,
                      colPeriod: repeatResult.unitCols,
                      rowOffset: repeatOffset.r,
                      colOffset: repeatOffset.c,
                    }
                  : null
              }
              onPaint={paint}
            />
            <section className="float-panel" aria-label="浮线风险检查">
              <div className="float-head">
                <label className="float-threshold">
                  最大浮线针数
                  <select
                    value={maxFloat}
                    onChange={(e) => setMaxFloat(Number(e.target.value))}
                  >
                    {Array.from(
                      { length: MAX_FLOAT_MAX - MAX_FLOAT_MIN + 1 },
                      (_, i) => MAX_FLOAT_MIN + i,
                    ).map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                  针
                </label>
                <span className="hint">
                  逐行检查：被同色针脚两端夹住的区间，跨针数超过阈值即标出起止列；
                  行首尾开放区间不计。按视觉坐标定位，不随偶数行镜像。
                </span>
              </div>
              {floatResult.risks.length === 0 ? (
                <div className="float-ok">
                  ✓ 当前图案没有超过 {maxFloat} 针的浮线
                </div>
              ) : (
                <ul className="float-list">
                  {floatResult.risks.map((span) => (
                    <li
                      key={`${span.row}-${span.startCol}-${span.endCol}-${span.symbol}`}
                    >
                      <button
                        type="button"
                        className={`float-item${
                          span === selectedFloat ? ' selected' : ''
                        }`}
                        onClick={() => setSelectedFloat(span)}
                      >
                        <i
                          className={`swatch sym-${span.symbol.toLowerCase()}`}
                        />
                        <span className="float-loc">
                          第 {span.row} 行 · 第 {span.startCol}–{span.endCol} 列
                        </span>
                        <span className="float-msg">
                          符号 {span.symbol} 浮线 {span.length} 针（阈值{' '}
                          {maxFloat}）
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <RepeatPanel
              repeat={repeatResult}
              offset={repeatOffset}
              onOffsetChange={setRepeatOffset}
            />
            <YarnPanel grid={grid} symbols={SYMBOLS} />
            <div className="action-bar">
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={() => void generateCommand(true)}
              >
                生成逐行口令
              </button>
              <div className="legend">
                <span className="legend-item">
                  <i className="swatch odd" /> → 奇数行（左起）
                </span>
                <span className="legend-item">
                  <i className="swatch even" /> ← 偶数行（右起，显示不镜像）
                </span>
                <span className="legend-item">
                  <i className="swatch err" /> 针数/语法错误行（保留原图）
                </span>
                <span className="legend-item">
                  <i className="swatch float" /> 浮线风险（超阈值，起止列描边）
                </span>
                <span className="legend-item">
                  <i className="swatch rep" /> 循环花版单元边界（视觉坐标）
                </span>
              </div>
            </div>
          </>
        ) : tab === 'compare' ? (
          compareCleared ? (
            <div className="compare-cleared">
              <p>
                对版状态已清除。修改候选口令或当前网格后会自动重新对版，
                也可以立即恢复：
              </p>
              <button type="button" onClick={() => setCompareCleared(false)}>
                重新对版
              </button>
            </div>
          ) : (
            <div className="compare-layout">
              <div className="compare-grid">
                <GridEditor
                  width={width}
                  height={height}
                  grid={grid}
                  rowIssueMap={EMPTY_ISSUE_MAP}
                  appliedRows={EMPTY_ROWS}
                  floatRisks={EMPTY_FLOATS}
                  selectedFloat={null}
                  repeatOverlay={null}
                  diffCells={compareResult.cells}
                  selectedDiff={selectedDiff}
                  readOnly
                  onPaint={noopPaint}
                />
                <div className="legend compare-legend">
                  <span className="legend-item">
                    <i className="swatch diff-add" /> 新增纹样（候选有、网格为底色
                    A）
                  </span>
                  <span className="legend-item">
                    <i className="swatch diff-miss" /> 缺失纹样（网格有、候选为底色
                    A）
                  </span>
                  <span className="legend-item">
                    <i className="swatch diff-rep" /> 颜色替换（两侧非底色且不同）
                  </span>
                  <span className="legend-item">
                    角标为候选符号；差异列为视觉坐标，偶数行不镜像
                  </span>
                  {alignActive && (
                    <span className="legend-item align-active-note">
                      最佳对齐预览中：候选整体循环平移 行{' '}
                      {formatOffset(alignResult.best.dr)} · 列{' '}
                      {formatOffset(alignResult.best.dc)}
                    </span>
                  )}
                </div>
              </div>
              <DiffPanel
                result={compareResult}
                align={alignResult}
                maxShift={maxShift}
                onMaxShiftChange={setMaxShift}
                alignActive={alignActive}
                onToggleAlign={() => setShowAligned((v) => !v)}
                selected={selectedDiff}
                onSelect={setSelectedDiff}
                onClear={clearCompare}
                onEditCommand={() => switchTab('command')}
                hasCandidateText={commandText.trim() !== ''}
              />
            </div>
          )
        ) : (
          <>
            <CommandEditor
              text={commandText}
              issues={issues}
              selectedLine={selectedLine}
              onChange={onCommandChange}
              onSelectLine={setSelectedLine}
            />
            <div className="action-bar">
              <button
                type="button"
                className="primary"
                disabled={busy || commandText.trim() === ''}
                onClick={() => void applyCommand()}
              >
                校验并回写网格
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void generateCommand(false)}
              >
                从网格重新生成（丢弃修改）
              </button>
              <span className="hint">
                规则：每行游程针数之和必须恰好等于行宽 {width}；行号（如
                02:）、方向箭头与 # 注释均可省略。
              </span>
            </div>
          </>
        )}
      </main>

      <footer className="app-footer">
        React + TypeScript + Node.js(Express) · 编解码核心由 Node 服务统一执行
      </footer>
    </div>
  );
}
