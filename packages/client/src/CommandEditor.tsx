import { useRef } from 'react';
import type { DecodeIssue } from '@jacquard/shared';

interface CommandEditorProps {
  text: string;
  issues: DecodeIssue[];
  selectedLine: number | null;
  onChange: (text: string) => void;
  onSelectLine: (line: number | null) => void;
}

/**
 * 口令编辑区。
 * 底层 backdrop 与 textarea 采用完全相同的排版（等宽、不换行、横向滚动），
 * 同步滚动后按物理行高亮错误行，保证长行（针数多）时不错位。
 */
export default function CommandEditor({
  text,
  issues,
  selectedLine,
  onChange,
  onSelectLine,
}: CommandEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  const errorLines = new Map<number, DecodeIssue>();
  for (const issue of issues) errorLines.set(issue.line, issue);

  const lines = text.split('\n');
  const lineCount = Math.max(lines.length, 1);

  const syncScroll = () => {
    if (textareaRef.current && backdropRef.current) {
      backdropRef.current.scrollTop = textareaRef.current.scrollTop;
      backdropRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  };

  const focusLine = (line: number) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const before = lines.slice(0, line - 1).join('\n').length;
    const start = before + (line === 1 ? 0 : 1);
    const end = start + (lines[line - 1]?.length ?? 0);
    ta.focus();
    ta.setSelectionRange(start, end);
    // 滚动到目标行附近
    const lineHeight = 24;
    ta.scrollTop = Math.max(0, (line - 2) * lineHeight);
    onSelectLine(line);
  };

  return (
    <div className="cmd-wrap">
      <div className="editor-shell">
        <div ref={backdropRef} className="editor-backdrop" aria-hidden>
          {Array.from({ length: lineCount }, (_, i) => {
            const line = i + 1;
            const issue = errorLines.get(line);
            const cls = issue
              ? 'bg-line bg-line-error'
              : selectedLine === line
                ? 'bg-line bg-line-selected'
                : 'bg-line';
            return <div key={line} className={cls}>{'​'}</div>;
          })}
        </div>
        <textarea
          ref={textareaRef}
          className="cmd-textarea"
          value={text}
          spellCheck={false}
          wrap="off"
          placeholder={
            '在此输入游程口令，每行对应一个图案行，例如：\n01 → A2 B4 A2\n02 ← A2 B4 A2\n\n省略行号时按文本顺序对应；箭头可选；# 后为注释。'
          }
          onChange={(e) => onChange(e.target.value)}
          onScroll={syncScroll}
          onKeyDown={() => onSelectLine(null)}
        />
      </div>

      {issues.length > 0 && (
        <div className="issue-panel">
          <div className="issue-head">
            发现 {issues.length} 处问题——针数错误或语法错误的行已保留原图，点击条目可定位：
          </div>
          <ul>
            {issues.map((issue, idx) => (
              <li key={idx}>
                <button
                  type="button"
                  className={`issue-item issue-${issue.code}`}
                  onClick={() => focusLine(issue.line)}
                >
                  <span className="issue-loc">
                    口令第 {issue.line} 行
                    {issue.row !== null ? ` → 图案第 ${issue.row} 行` : ''}
                  </span>
                  <span className="issue-msg">{issue.message}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
