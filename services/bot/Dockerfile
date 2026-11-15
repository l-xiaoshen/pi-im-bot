FROM oven/bun:1.4.4
USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates e2fsprogs fuse2fs fuse3 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json bun.lock ./
COPY pkgs ./pkgs
COPY services/bot ./services/bot
RUN bun install --frozen-lockfile --production --filter @pi-im-bot/bot
COPY examples ./examples
COPY config/bot.example.json config/providers.example.json ./config/
COPY config/bot.example.json config/providers.example.json ./config-defaults/
ENV BOT_CONFIG_DIR=/app/config BOT_DATA_DIR=/app/data BOT_EXAMPLES_DIR=/app/config-defaults
ENV BOT_WEB_ORIGINS=http://localhost:3000
EXPOSE 19335
CMD ["bun", "services/bot/src/main.ts"]
