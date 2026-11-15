FROM oven/bun:1.4.4
WORKDIR /app
COPY package.json bun.lock ./
COPY pkgs ./pkgs
COPY apps/web ./apps/web
RUN bun install --frozen-lockfile --filter @pi-im-bot/web
RUN bun run build:web
ENV WEB_PORT=3000 BOT_PUBLIC_ORIGIN=http://localhost:19335
EXPOSE 3000
CMD ["bun", "apps/web/server.ts"]
