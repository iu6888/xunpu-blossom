# 蟳埔花事后端 · 生产镜像
# 零依赖，不需要 npm install，直接跑
FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    TZ=Asia/Shanghai

WORKDIR /app

COPY . .

RUN mkdir -p /app/data \
 && chown -R node:node /app \
 && chmod 750 /app/data

USER node
EXPOSE 3000

VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
