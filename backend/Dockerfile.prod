FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install
COPY tsconfig.json ./
COPY src ./src
RUN bun run build

FROM oven/bun:1
WORKDIR /app
ENV NODE_ENV=production
COPY package.json bun.lock ./
RUN bun install --production
COPY --from=build /app/dist ./dist
EXPOSE 4000
CMD ["bun", "run", "dist/server.js"]
