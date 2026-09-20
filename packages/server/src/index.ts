import express from 'express';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { decodeText, encodeGrid } from '@jacquard/shared';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8080);

const app = express();
app.use(express.json({ limit: '1mb' }));

/** 简单参数校验 */
function validateGridBody(body: any): string | null {
  if (!body || typeof body !== 'object') return '请求体无效';
  const { width, height, grid } = body;
  if (!Number.isInteger(width) || width < 1 || width > 200)
    return 'width 必须是 1–200 的整数';
  if (!Number.isInteger(height) || height < 1 || height > 200)
    return 'height 必须是 1–200 的整数';
  if (!Array.isArray(grid) || grid.length !== height)
    return 'grid 行数必须等于 height';
  for (const row of grid) {
    if (!Array.isArray(row) || row.length !== width)
      return 'grid 每一行的针数必须等于 width';
    for (const cell of row) {
      if (typeof cell !== 'string' || !/^[A-Za-z]$/.test(cell))
        return 'grid 单元格必须是单个字母符号';
    }
  }
  return null;
}

app.post('/api/encode', (req, res) => {
  const err = validateGridBody(req.body);
  if (err) return res.status(400).json({ error: err });
  const { grid, width, height } = req.body;
  return res.json(
    encodeGrid({
      grid: grid as string[][],
      width,
      height,
    }),
  );
});

app.post('/api/decode', (req, res) => {
  const { text, width, height, fallback, symbols } = req.body ?? {};
  if (typeof text !== 'string')
    return res.status(400).json({ error: 'text 必须是字符串' });
  if (!Number.isInteger(width) || width < 1 || width > 200)
    return res.status(400).json({ error: 'width 非法' });
  if (!Number.isInteger(height) || height < 1 || height > 200)
    return res.status(400).json({ error: 'height 非法' });
  if (!Array.isArray(fallback) || fallback.length !== height)
    return res.status(400).json({ error: 'fallback 行数必须等于 height' });
  if (
    !Array.isArray(symbols) ||
    symbols.length === 0 ||
    symbols.some((s: unknown) => typeof s !== 'string')
  )
    return res.status(400).json({ error: 'symbols 非法' });

  return res.json(
    decodeText({
      text,
      width,
      height,
      fallback: fallback as string[][],
      symbols: symbols as string[],
    }),
  );
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// 托管前端构建产物（packages/client/dist）
const clientDist = path.resolve(__dirname, '../../client/dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
} else {
  app.get('/', (_req, res) =>
    res
      .status(200)
      .send('服务已启动，但未找到前端构建产物（packages/client/dist）。'),
  );
}

app.listen(PORT, () => {
  console.log(`提花编织口令校验服务已启动: http://localhost:${PORT}`);
});
