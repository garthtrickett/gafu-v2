FROM oven/bun:1.3.2-alpine

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

ENV NODE_ENV=production
ENV GAFU_PUBLIC_DEPLOYMENT=1

CMD ["bun", "run", "start"]
