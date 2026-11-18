# 轻量镜像，适合 2G 内存 VPS（使用 Node 内置 sqlite，无原生编译）
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && cp -r src/web dist/web

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV DATA_DIR=/app/data
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
RUN mkdir -p /app/data
EXPOSE 3000
CMD ["node", "--experimental-sqlite", "dist/index.js"]
