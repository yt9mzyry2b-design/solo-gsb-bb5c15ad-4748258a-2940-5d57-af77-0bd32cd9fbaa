# ---- 构建阶段：安装全部依赖并构建共享库 / 服务端 / 前端 ----
FROM node:20-alpine AS build
WORKDIR /app

# 先拷贝 workspace 清单，优先利用 Docker 缓存安装依赖
COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN npm ci || npm install

# 拷贝源码并构建（shared → server → client）
COPY packages ./packages
RUN npm run build

# 裁剪为生产依赖（workspace 软链接 node_modules/@jacquard/* 保持有效）
RUN npm prune --omit=dev

# ---- 运行阶段：直接携带构建产物与生产依赖 ----
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

# 含：各 package 的 package.json、dist，以及根 node_modules（生产依赖 + workspace 软链接）
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/server/package.json ./packages/server/package.json
COPY --from=build /app/packages/server/dist ./packages/server/dist
COPY --from=build /app/packages/client/package.json ./packages/client/package.json
COPY --from=build /app/packages/client/dist ./packages/client/dist

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "packages/server/dist/index.js"]
