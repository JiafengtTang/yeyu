# syntax=docker/dockerfile:1
#
# yeyu 服务端镜像（SQLite 单文件 + uploads 目录，全部落在 /data 卷里）
#
# 构建（在仓库根目录执行，context 必须是仓库根，因为要拷 shared/ 与 server/）：
#   docker build -f deploy/Dockerfile -t yeyu-server:0.1.0 .
# 或直接用 compose（deploy/docker-compose.yml 已经配好 context）：
#   cd deploy && docker compose up -d --build
#
# 说明：
# - 服务端没有编译产物，运行期用 tsx 直接跑 TypeScript，因此镜像里保留 devDependencies
#   （prisma CLI、tsx 都在 devDependencies 中）。
# - Prisma 的 SQLite 引擎依赖 openssl，slim 镜像需显式安装。
FROM node:24-bookworm-slim

ENV PNPM_HOME=/usr/local/pnpm \
    PATH=/usr/local/pnpm:$PATH \
    PNPM_VERSION=11.21.0 \
    TZ=Asia/Shanghai \
    NODE_ENV=production \
    PORT=4000 \
    DATABASE_URL=file:/data/app.db \
    UPLOAD_DIR=/data/uploads

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates openssl tini curl \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g pnpm@${PNPM_VERSION}

WORKDIR /app

# 先只拷依赖清单，利用 Docker 层缓存：只有 lockfile 变化时才重新装依赖
COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc package.json ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY desktop/package.json ./desktop/

RUN pnpm install --frozen-lockfile --prod=false --filter "@yeyu/server..."

# 再拷源码并生成 Prisma Client
COPY shared ./shared
COPY server ./server

WORKDIR /app/server
RUN pnpm exec prisma generate

# /data 保存 app.db 与 uploads/：一个卷 = 一次备份
RUN mkdir -p /data/uploads
VOLUME ["/data"]

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]

# 每次启动先把 schema 同步到 SQLite（等效于 db push，不丢数据）；
# 升级后如想自己控制时机，设置 SKIP_DB_PUSH=1 再手动执行。
CMD ["sh", "-c", "if [ \"$SKIP_DB_PUSH\" != \"1\" ]; then pnpm exec prisma db push --skip-generate; fi; exec pnpm exec tsx src/index.ts"]
