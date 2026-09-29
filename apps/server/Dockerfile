FROM node:26.7.0-bookworm-slim AS build
WORKDIR /app
RUN npm install --global pnpm@10.33.2
COPY . .
RUN pnpm install --frozen-lockfile --ignore-scripts
RUN pnpm --filter @jev-mod/web build

FROM node:26.7.0-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
RUN npm install --global pnpm@10.33.2
COPY . .
RUN pnpm install --frozen-lockfile --prod --ignore-scripts && mkdir -p /app/data && chown node:node /app/data
COPY --from=build /app/apps/web/dist ./apps/web/dist
USER node
EXPOSE 7102
CMD ["node", "apps/server/src/node.ts"]
