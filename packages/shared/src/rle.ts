import type {
  DecodeIssue,
  DecodeRequest,
  DecodeResponse,
  EncodedLine,
  EncodeRequest,
  EncodeResponse,
  Run,
} from './types.js';

/** 1 基行号是否为奇数行（奇数行自左向右 →） */
export function isOddRow(rowOneBased: number): boolean {
  return rowOneBased % 2 === 1;
}

/**
 * 将一行视觉网格编码为按“实际编织方向”排列的游程。
 * - 奇数行：视觉左→右，与编织方向一致
 * - 偶数行：视觉右→左读取，第一个游程是网格最右段
 * 视觉坐标不做任何镜像变换，仅改变读取顺序。
 */
export function encodeRow(visualCells: string[], rowOneBased: number): Run[] {
  const ordered = isOddRow(rowOneBased)
    ? visualCells
    : [...visualCells].reverse();

  const runs: Run[] = [];
  for (const symbol of ordered) {
    const last = runs[runs.length - 1];
    if (last && last.symbol === symbol) {
      last.count += 1;
    } else {
      runs.push({ symbol, count: 1 });
    }
  }
  return runs;
}

/** 游程序列转规范化口令文本 */
export function runsToText(runs: Run[]): string {
  return runs.map((r) => `${r.symbol}${r.count}`).join(' ');
}

/** 带行号与方向箭头的完整口令行 */
export function formatCanonical(rowOneBased: number, runs: Run[]): string {
  const rowLabel = String(rowOneBased).padStart(2, '0');
  const arrow = isOddRow(rowOneBased) ? '→' : '←';
  return `${rowLabel} ${arrow} ${runsToText(runs)}`;
}

/** 整张网格 → 逐行口令 */
export function encodeGrid(req: EncodeRequest): EncodeResponse {
  const lines: EncodedLine[] = [];
  for (let r = 0; r < req.height; r += 1) {
    const rowOneBased = r + 1;
    const cells = req.grid[r] ?? [];
    const runs = encodeRow(cells, rowOneBased);
    const text = runsToText(runs);
    lines.push({
      row: rowOneBased,
      direction: isOddRow(rowOneBased) ? 'LR' : 'RL',
      runs,
      text,
      canonical: formatCanonical(rowOneBased, runs),
    });
  }
  return { lines, text: lines.map((l) => l.canonical).join('\n') };
}

/** 匹配 符号+针数，如 A4、b12 */
const RUN_TOKEN = /^([A-Za-z])(\d+)$/;
/** 全局提取相邻游程，支持 A2B4A2 这类无分隔写法（必须完整消费整段） */
const RUN_TOKEN_GLOBAL = /([A-Za-z])(\d+)/y;
/** 匹配显式行号前缀，如 3:、03、12、5、2行 */
const ROW_TOKEN = /^(?:0*(\d+)[\s:：.、]?|(\d+)\s*行)$/;
/** 行内分隔符：空白、逗号、顿号、分号 */
const SEPARATOR = /[\s,，、;；]+/;
/** 注释（# 之后内容）与方向箭头 */
const COMMENT_RE = /[#＃].*$/;
const ARROW_RE = /[→←><]|->|<-/g;

interface ParsedLine {
  line: number;
  explicitRow: number | null;
  runs: Run[] | null; // null = 本行存在语法错误
  badToken?: string;
  unknownSymbol?: string;
  empty: boolean;
}

function parseRawLine(raw: string, line: number): ParsedLine {
  const stripped = raw.replace(COMMENT_RE, '').replace(ARROW_RE, ' ').trim();
  if (stripped === '') {
    return { line, explicitRow: null, runs: null, empty: true };
  }

  const tokens = stripped.split(SEPARATOR).filter((t) => t !== '');
  let idx = 0;
  let explicitRow: number | null = null;

  if (tokens.length > 0 && ROW_TOKEN.test(tokens[0])) {
    const m = tokens[0].match(/\d+/);
    explicitRow = m ? parseInt(m[0], 10) : null;
    idx = 1;
  }

  if (idx >= tokens.length) {
    return { line, explicitRow, runs: null, empty: false };
  }

  const runs: Run[] = [];
  for (let i = idx; i < tokens.length; i += 1) {
    // 先按标准单游程解析；失败时尝试把整段当作多个相邻游程（A2B4）
    const single = RUN_TOKEN.exec(tokens[i]);
    if (single) {
      runs.push({ symbol: single[1].toUpperCase(), count: parseInt(single[2], 10) });
      continue;
    }
    RUN_TOKEN_GLOBAL.lastIndex = 0;
    const glued: Run[] = [];
    let m: RegExpExecArray | null;
    let consumed = 0;
    while ((m = RUN_TOKEN_GLOBAL.exec(tokens[i])) !== null) {
      glued.push({ symbol: m[1].toUpperCase(), count: parseInt(m[2], 10) });
      // 注意：下次 exec 若失配会把 lastIndex 重置为 0，必须在此记录
      consumed = RUN_TOKEN_GLOBAL.lastIndex;
    }
    if (glued.length === 0 || consumed !== tokens[i].length) {
      return { line, explicitRow, runs: null, badToken: tokens[i], empty: false };
    }
    runs.push(...glued);
  }
  return { line, explicitRow, runs, empty: false };
}

/**
 * 按编织方向把游程铺回“视觉坐标”的一行。
 * 偶数行第一个游程对应网格最右端，因此从右向左填充。
 * 仅在针数恰好等于行宽时调用——欠针/溢出的行不允许用部分结果。
 */
export function placeRuns(runs: Run[], rowOneBased: number, width: number): string[] {
  const cells = new Array<string>(width).fill('');
  const ltr = isOddRow(rowOneBased);
  let cursor = ltr ? 0 : width - 1;
  for (const run of runs) {
    for (let k = 0; k < run.count; k += 1) {
      if (cursor >= 0 && cursor < width) {
        cells[cursor] = run.symbol;
      }
      cursor += ltr ? 1 : -1;
    }
  }
  return cells;
}

export interface AnalyzeRequest {
  text: string;
  width: number;
  height: number;
  /** 允许的符号集合（如 ['A','B','C']） */
  symbols: string[];
}

/** 一条成功映射到图案行的口令的校验归宿 */
export interface AnalyzedRow {
  /** 目标图案行（1 基） */
  row: number;
  /** 口令文本行（1 基） */
  line: number;
  /** 校验通过（针数恰好等于行宽）时的游程；否则为 null */
  runs: Run[] | null;
  /** 校验失败原因（runs 为 null 时存在） */
  issue: DecodeIssue | null;
}

export interface TextAnalysis {
  /** 每个成功落行的口令行（含校验失败行），按文本顺序 */
  rows: AnalyzedRow[];
  /** 全部问题：行号冲突/越界等映射问题在前，逐行校验问题在后 */
  issues: DecodeIssue[];
}

/**
 * 解析口令文本并逐行校验（不回写、不比较，只做“文本 → 行”的归宿判定）。
 * decodeText（回写）与 compareCandidate（对版）共用同一套规则：
 * 行号映射、语法、符号集合、针数必须恰好等于行宽。
 */
export function analyzeText(req: AnalyzeRequest): TextAnalysis {
  const { text, width, height, symbols } = req;
  const allowed = new Set(symbols.map((s) => s.toUpperCase()));
  const rawLines = text.split(/\r?\n/);
  const issues: DecodeIssue[] = [];
  const rows: AnalyzedRow[] = [];

  const parsed = rawLines.map((raw, i) => parseRawLine(raw, i + 1));

  /**
   * 行号映射：
   * - 显式行号（如 02:）直接指定图案行；
   * - 无显式行号的文本行，对应“与自身物理行号相同的图案行”，
   *   即第 2 条口令永远表示图案第 2 行（空行不占位）；
   * - 两条口令指向同一图案行时报冲突（含重复显式行号、显式与隐式撞行）。
   */
  const rowMap = new Map<number, { line: number; explicit: boolean }>();

  for (const p of parsed) {
    if (p.empty) continue;
    const target = p.explicitRow ?? p.line;
    const existing = rowMap.get(target);
    if (existing) {
      const bothExplicit = existing.explicit && p.explicitRow !== null;
      issues.push({
        line: p.line,
        row: target,
        code: 'DUPLICATE_ROW',
        message: bothExplicit
          ? `图案第 ${target} 行被行号重复指定（口令第 ${existing.line}、${p.line} 行），本行保留原图`
          : `图案第 ${target} 行已由口令第 ${existing.line} 行指定，与第 ${p.line} 行冲突，本行保留原图`,
      });
      continue;
    }
    if (target < 1 || target > height) {
      issues.push({
        line: p.line,
        row: p.explicitRow !== null ? target : null,
        code: 'ROW_OUT_OF_RANGE',
        message:
          p.explicitRow !== null
            ? `行号 ${target} 超出范围（应为 1–${height}），本行保留原图`
            : `口令第 ${p.line} 行隐含对应图案第 ${target} 行，但图案只有 ${height} 行，本行被忽略`,
      });
      continue;
    }
    rowMap.set(target, { line: p.line, explicit: p.explicitRow !== null });
  }

  // 第二遍：逐行校验（行号冲突/越界的文本行不在 rowMap 中，跳过）
  for (const p of parsed) {
    if (p.empty) continue;
    const mapped = rowMap.get(p.explicitRow ?? p.line);
    if (!mapped || mapped.line !== p.line) continue;
    const rowOneBased = p.explicitRow ?? p.line;

    // 语法错误
    if (p.runs === null) {
      const issue: DecodeIssue =
        p.badToken !== undefined
          ? {
              line: p.line,
              row: rowOneBased,
              code: 'BAD_TOKEN',
              message: `第 ${p.line} 行存在无法识别的片段“${p.badToken}”（格式应为 符号+针数，如 A4），整行保留原图`,
            }
          : {
              line: p.line,
              row: rowOneBased,
              code: 'EMPTY_RUNS',
              message: `第 ${p.line} 行只有行号、没有游程，整行保留原图`,
            };
      issues.push(issue);
      rows.push({ row: rowOneBased, line: p.line, runs: null, issue });
      continue;
    }

    // 符号集合校验
    const badSymbolRun = p.runs.find((r) => !allowed.has(r.symbol));
    if (badSymbolRun) {
      const issue: DecodeIssue = {
        line: p.line,
        row: rowOneBased,
        code: 'UNKNOWN_SYMBOL',
        message: `第 ${p.line} 行出现未启用的符号“${badSymbolRun.symbol}”（当前符号：${symbols.join('/')}），整行保留原图`,
      };
      issues.push(issue);
      rows.push({ row: rowOneBased, line: p.line, runs: null, issue });
      continue;
    }

    const total = p.runs.reduce((sum, r) => sum + r.count, 0);
    const ltr = isOddRow(rowOneBased);
    const dirText = ltr ? '自左向右（→）' : '自右向左（←）';

    if (total !== width) {
      let detail: string;
      if (total > width) {
        // 定位第一个越过右/左边界的游程
        let acc = 0;
        let overIndex = -1;
        for (let i = 0; i < p.runs.length; i += 1) {
          if (acc + p.runs[i].count > width) {
            overIndex = i;
            break;
          }
          acc += p.runs[i].count;
        }
        const overRun = p.runs[overIndex];
        const boundary = ltr ? '最右端' : '最左端';
        // 该游程在边界内的最后一针所处的视觉列
        const lastInBoundCol = ltr ? width : 1;
        const overflowCount = acc + overRun.count - width;
        detail =
          `共 ${total} 针，比行宽多 ${total - width} 针；` +
          `本行${dirText}，游程“${overRun.symbol}${overRun.count}”` +
          `在第 ${lastInBoundCol} 列（${boundary}）之后仍有 ${overflowCount} 针无处落位`;
      } else {
        // 欠针：奇数行从左向右落针，缺口在右侧；偶数行从右向左，缺口在视觉左侧
        const gapCols = ltr
          ? `缺口在右侧第 ${total + 1}–${width} 列`
          : `缺口在左侧第 1–${width - total} 列`;
        detail =
          `共 ${total} 针，比行宽少 ${width - total} 针（应恰好 ${width} 针），${gapCols}`;
      }
      const issue: DecodeIssue = {
        line: p.line,
        row: rowOneBased,
        code: 'COUNT_MISMATCH',
        message: `第 ${rowOneBased} 行（口令第 ${p.line} 行）针数不符：${detail}，整行保留原图`,
        actualCount: total,
        expectedCount: width,
      };
      issues.push(issue);
      rows.push({ row: rowOneBased, line: p.line, runs: null, issue });
      continue;
    }

    // 针数恰好等于行宽：校验通过
    rows.push({ row: rowOneBased, line: p.line, runs: p.runs, issue: null });
  }

  return { rows, issues };
}

/**
 * 解析口令文本并回写网格。
 * 仅当某行针数恰好等于行宽时回写该行；任何错误行保留 fallback 原图，
 * 并生成可定位的 issue（口令行号 / 图案行号 / 视觉列范围）。
 */
export function decodeText(req: DecodeRequest): DecodeResponse {
  const { text, width, height, fallback, symbols } = req;
  const analysis = analyzeText({ text, width, height, symbols });

  // 以原图为基底：合法行覆盖，非法行自然保留
  const grid: string[][] = fallback.map((row) => [...row]);
  const appliedRows: number[] = [];

  for (const r of analysis.rows) {
    if (r.runs === null) continue;
    grid[r.row - 1] = placeRuns(r.runs, r.row, width);
    appliedRows.push(r.row);
  }

  return {
    grid,
    issues: analysis.issues,
    appliedRows,
    ok: analysis.issues.length === 0,
  };
}
