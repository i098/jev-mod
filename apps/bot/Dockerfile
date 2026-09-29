FROM node:26.7.0-bookworm-slim
WORKDIR /app
RUN npm install --global pnpm@10.33.2
COPY . .
RUN pnpm install --frozen-lockfile --prod --ignore-scripts
USER node
EXPOSE 8080
CMD ["node", "apps/bot/src/index.ts"]
