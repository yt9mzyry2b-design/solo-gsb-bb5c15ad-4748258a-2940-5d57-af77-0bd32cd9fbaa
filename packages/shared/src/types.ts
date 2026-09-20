/**
 * 提花编织口令：共享类型定义
 *
 * 编织约定（与提花机实际走针一致）：
 * - 第 1 行为奇数行，自左向右编织（→）
 * - 第 2 行为偶数行，自右向左编织（←）
 * - 视觉网格坐标恒定：列 0 始终在左侧，偶数行绝不镜像显示
 * - 口令按“实际编织方向”记录游程：偶数行最右侧的游程先被读出
 */

/** 单个符号游程：符号 + 连续针数 */
export interface Run {
  symbol: string;
  count: number;
}

/** 逐行编码结果中的一行 */
export interface EncodedLine {
  /** 1 基行号 */
  row: number;
  direction: 'LR' | 'RL';
  /** 按实际编织方向排列的游程序列 */
  runs: Run[];
  /** 规范化口令文本（不含行号/箭头），如 B3 A4 B1 */
  text: string;
  /** 含行号与方向箭头的完整文本，如 02 ← A2 B4 A2 */
  canonical: string;
}

export interface EncodeRequest {
  grid: string[][];
  width: number;
  height: number;
}

export interface EncodeResponse {
  lines: EncodedLine[];
  text: string;
}

/** 口令解析阶段的错误类型 */
export type DecodeErrorCode =
  | 'BAD_TOKEN' // 无法识别的片段
  | 'UNKNOWN_SYMBOL' // 出现网格符号集之外的符号
  | 'EMPTY_RUNS' // 只有行号没有游程
  | 'DUPLICATE_ROW' // 显式行号重复
  | 'ROW_OUT_OF_RANGE' // 显式行号超出 [1,height]
  | 'COUNT_MISMATCH'; // 行针数不等于行宽（过多/过少）

export interface DecodeIssue {
  /** 口令文本中的 1 基行号（第几行文本，跳过空行后仍按物理行计算） */
  line: number;
  /** 对应的图案行（1 基），无法判定时为 null */
  row: number | null;
  code: DecodeErrorCode;
  message: string;
  /** 该行针数；针数错误时存在 */
  actualCount?: number;
  expectedCount?: number;
}

export interface DecodeRequest {
  text: string;
  width: number;
  height: number;
  /** 当前网格：针数错误的行保留此原图内容 */
  fallback: string[][];
  /** 允许的符号集合（如 ['A','B','C']） */
  symbols: string[];
}

export interface DecodeResponse {
  /** 合并后的网格：合法行回写，非法行保留原图 */
  grid: string[][];
  issues: DecodeIssue[];
  /** 成功回写的 1 基行号列表 */
  appliedRows: number[];
  ok: boolean;
}

/**
 * 对版（候选口令 ↔ 当前网格）差异类别。
 * 以底色符号（默认 A）为基准：
 * - added：候选在该格织入纹样，当前网格为底色
 * - missing：当前网格有纹样，候选在该格回到底色
 * - replaced：两侧均为非底色但符号不同
 */
export type DiffKind = 'added' | 'missing' | 'replaced';

/** 一个差异格，全部使用视觉坐标（1 基），绝不随偶数行镜像 */
export interface DiffCell {
  /** 1 基行号 */
  row: number;
  /** 1 基视觉列号 */
  col: number;
  kind: DiffKind;
  /** 当前网格符号 */
  gridSymbol: string;
  /** 候选临时图案符号 */
  candidateSymbol: string;
}

/**
 * 对版行状态：
 * - same：可比较且与候选完全一致
 * - diff：可比较，存在差异
 * - invalid：候选行存在但针数错误/无法解析，整行不参与差异
 * - missing：该行没有对应的候选口令，无可比较
 */
export type DiffRowStatus = 'same' | 'diff' | 'invalid' | 'missing';

/** 侧栏按行汇总的一条记录 */
export interface DiffRowSummary {
  /** 1 基行号 */
  row: number;
  status: DiffRowStatus;
  added: number;
  missing: number;
  replaced: number;
  /** 首个差异所在的 1 基视觉列；无差异或不可比较时为 null */
  firstDiffCol: number | null;
  /** 不可比较原因（status 为 invalid / missing 时存在） */
  reason: string | null;
  /** 候选口令所在的 1 基文本行；无候选行时为 null */
  line: number | null;
}

/**
 * 错位对齐：候选图案整体循环平移量（视觉坐标，绝不随偶数行镜像）。
 * 正 dr 表示候选内容向下平移（目标行 r 读取候选源行 r-dr，取模循环）；
 * 正 dc 表示候选内容向右平移（目标列 c 读取候选源列 c-dc，取模循环）。
 */
export interface AlignOffset {
  /** 行偏移（向下为正，按行数取模循环） */
  dr: number;
  /** 列偏移（向右为正，按行宽取模循环） */
  dc: number;
}

export interface CompareRequest {
  text: string;
  width: number;
  height: number;
  /** 当前网格：仅作对照基准，绝不回写 */
  grid: string[][];
  /** 允许的符号集合（如 ['A','B','C']） */
  symbols: string[];
  /** 底色符号，默认 'A' */
  baseSymbol?: string;
  /**
   * 候选图案整体的循环平移量（视觉坐标）；缺省为 (0,0) 即原始对版。
   * 平移作用于解码后的候选图案：行、列均取模循环，偶数行绝不镜像。
   */
  offset?: AlignOffset;
}

export interface CompareResult {
  /** 按行汇总（1..height 每行一条） */
  rows: DiffRowSummary[];
  /** 全部差异格（视觉坐标，行 → 列升序） */
  cells: DiffCell[];
  /** 全图合计 */
  totals: { added: number; missing: number; replaced: number };
  /** 可比较行数（same + diff） */
  comparableRows: number;
  /** 候选口令的解析问题（与 decodeText 同一套规则） */
  issues: DecodeIssue[];
  /** 本次比较实际使用的循环平移量（未指定时为 0,0） */
  offset: AlignOffset;
}

/** 错位对齐搜索请求：在对版参数上追加用户限定的最大偏移 */
export interface AlignSearchRequest extends CompareRequest {
  /**
   * 用户限定的最大偏移：行、列方向各自枚举 [-maxShift, +maxShift]
   * 的全部整数偏移（含 0,0 原始位置），按差异格总数选优。
   */
  maxShift: number;
}

/** 一个参与决胜的偏移方案 */
export interface AlignCandidate {
  dr: number;
  dc: number;
  /** 该偏移下的差异格总数（仅统计可比较行） */
  diffs: number;
}

export interface AlignSearchResult {
  /** 本次搜索使用的最大偏移（规范化后，≥ 0 的整数） */
  maxShift: number;
  /** 参与评分的可比较候选行数（针数错误/缺失行不参与评分） */
  scoredRows: number;
  /** 实际枚举的偏移数量 = (2·maxShift+1)² */
  evaluated: number;
  /** 原始位置（偏移 0,0）的差异格总数 */
  originalDiffs: number;
  /** 最佳方案（同分时按固定顺序决胜，结果确定） */
  best: AlignCandidate;
  /** 最佳方案是否严格优于原始位置 */
  improved: boolean;
}

/**
 * 一段浮线：同一行内某种颜色相邻两次落针之间、被同色针脚两端夹住的区间。
 * 全部使用视觉坐标（1 基），与奇偶行编织方向无关。
 */
export interface FloatSpan {
  /** 1 基行号 */
  row: number;
  /** 浮线所属符号（颜色） */
  symbol: string;
  /** 左端同色针脚所在视觉列（1 基） */
  startCol: number;
  /** 右端同色针脚所在视觉列（1 基） */
  endCol: number;
  /** 跨过的其他颜色针数 = endCol - startCol - 1 */
  length: number;
}

export interface FloatCheckResult {
  /** 本次检查使用的最大浮线针数阈值 */
  maxFloat: number;
  /** 全部浮线区间（按视觉坐标排序：行 → 起始列 → 结束列） */
  spans: FloatSpan[];
  /** 超过阈值的浮线（spans 的子集，同样按视觉坐标排序） */
  risks: FloatSpan[];
}

/**
 * 循环花版：最小二维重复单元的搜索结果。
 * 全部使用视觉坐标——重复单元与奇偶行编织方向无关，偶数行绝不镜像。
 */
export interface RepeatResult {
  /** 单元行数（垂直周期） */
  unitRows: number;
  /** 单元列数（水平周期） */
  unitCols: number;
  /** 单元面积（格数）= unitRows × unitCols */
  unitArea: number;
  /** 单元内容（视觉坐标，锚定于网格左上角的零偏移相位） */
  cells: string[][];
  /** 整幅行数 */
  gridRows: number;
  /** 整幅列数 */
  gridCols: number;
  /** 整幅总格数 = gridRows × gridCols */
  totalCells: number;
  /** 压缩比 = totalCells / unitArea（≥ 1） */
  ratio: number;
}
